const {
    SlashCommandBuilder, PermissionFlagsBits, MessageFlags,
    ContainerBuilder, TextDisplayBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');

const jsonStore = require('../../utils/jsonStore');
const { ensureMigrated } = require('../../utils/ticketPanels');
const {
    fetchAllMessages, buildTranscriptAttachments, postTranscriptToLogChannel,
} = require('../../utils/ticketTranscript');
const {
    E, COLOR, errorContainer, v2Reply, canManageTicket, formatDuration,
} = require('../../utils/ticketUI');

/* ───────────────────────── store helpers ───────────────────────── */

function loadConfig() {
    if (!jsonStore.has('tickets')) {
        jsonStore.write('tickets', {});
        return {};
    }
    const data = jsonStore.read('tickets');
    if (Array.isArray(data)) {
        jsonStore.write('tickets', {});
        return {};
    }
    return data;
}

function saveConfig(config) {
    jsonStore.write('tickets', config);
}

/* ──────────────────────── transcript runner ────────────────────── */

const TRANSCRIPT_BUDGET_MS = 30_000;
const POST_TRANSCRIPT_DELETE_DELAY_MS = 2_000;
const NO_TRANSCRIPT_DELETE_DELAY_MS   = 5_000;

/**
 * Save a transcript for the closing ticket. Best-effort: any error is
 * caught and logged but never bubbled — closing the ticket is more
 * important than the transcript working.
 */
async function autoSaveTranscript({ client, guild, channel, ticket, closedByTag, transcriptChannelId }) {
    try {
        const messages = await fetchAllMessages(channel, { limit: 2000 });
        const opener  = ticket?.userId    ? await client.users.fetch(ticket.userId).catch(() => null)    : null;
        const claimer = ticket?.claimedBy ? await client.users.fetch(ticket.claimedBy).catch(() => null) : null;

        const meta = {
            channelName:   channel.name,
            guildName:     guild.name,
            openerTag:     opener?.tag || ticket?.userId,
            openerId:      ticket?.userId,
            categoryLabel: ticket?.categoryLabel || 'N/A',
            createdAt:     ticket?.createdAt,
            closedAt:      Date.now(),
            closedBy:      closedByTag,
            claimedByTag:  claimer?.tag,
            addedMembers:  (ticket?.members || []).map(id => ({ id })),
            messageCount:  messages.length,
        };

        const attachments = buildTranscriptAttachments(messages, meta);
        await postTranscriptToLogChannel(guild, transcriptChannelId, attachments, meta);

        if (opener) {
            try {
                await opener.send({
                    content:
                        `${E.transcript} Your ticket **${channel.name}** in **${guild.name}** has been closed.\n` +
                        `A copy of the transcript is attached.`,
                    files: attachments,
                });
            } catch { /* DMs closed — ignore */ }
        }
    } catch (err) {
        console.error(`[ticket-close] transcript failed: ${err.message}`);
    }
}

async function awaitTranscriptWithBudget(promise, budgetMs = TRANSCRIPT_BUDGET_MS) {
    return Promise.race([promise, new Promise(res => setTimeout(res, budgetMs))]);
}

/* ───────────────────────── shared logic ────────────────────────── */

function buildClosedContainer({ channel, ticket, byTag, willTranscript, reason }) {
    const opened = ticket?.createdAt ? `<t:${Math.floor(ticket.createdAt / 1000)}:R>` : 'unknown';
    const dur    = ticket?.createdAt ? formatDuration(Date.now() - ticket.createdAt) : 'unknown';
    const reasonLine = reason ? `\n${E.pin} **Reason:** ${reason}` : '';

    const text =
        `# ${E.lock} Ticket Closed\n\n` +
        `This ticket has been closed by **${byTag}**.\n\n` +
        `### ${E.clipboard} Summary\n` +
        `${E.pin} **Channel:** ${channel.name}\n` +
        `${E.pin} **Category:** ${ticket?.categoryLabel || 'N/A'}\n` +
        `${E.pin} **Opened:** ${opened}\n` +
        `${E.pin} **Duration:** ${dur}` +
        reasonLine +
        `\n\n` +
        (willTranscript
            ? `${E.transcript} *Saving transcript and deleting the channel in **8 seconds**…*`
            : `${E.warn} *This channel will be deleted in **5 seconds**…*`);

    return new ContainerBuilder()
        .setAccentColor(COLOR.DANGER)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
}

/**
 * Run the actual close routine. Returns a Promise that resolves once
 * the channel deletion has been scheduled (transcript saving runs
 * inside the budget).
 */
async function performClose({ client, channel, guild, ticket, byTag, guildConfig }) {
    const tMode = guildConfig.transcriptMode || 'manual';
    const wantsAuto = (tMode === 'auto' || tMode === 'both') && !!guildConfig.transcriptChannelId;

    if (wantsAuto) {
        await awaitTranscriptWithBudget(autoSaveTranscript({
            client,
            guild,
            channel,
            ticket,
            closedByTag:         byTag,
            transcriptChannelId: guildConfig.transcriptChannelId,
        }));
        setTimeout(() => {
            channel.delete().catch(err => console.error(`[ticket-close] delete failed: ${err.message}`));
        }, POST_TRANSCRIPT_DELETE_DELAY_MS);
    } else {
        setTimeout(() => {
            channel.delete().catch(err => console.error(`[ticket-close] delete failed: ${err.message}`));
        }, NO_TRANSCRIPT_DELETE_DELAY_MS);
    }
}

/* ─────────────────────────── command ──────────────────────────── */

module.exports = {
    category: 'automation',
    data: new SlashCommandBuilder()
        .setName('ticket-close')
        .setDescription('Close the current ticket (with optional transcript)')
        .addStringOption(o => o
            .setName('reason')
            .setDescription('Optional reason shown in the closing message and transcript')
            .setRequired(false))
        .setDMPermission(false),

    async execute(interaction) {
        try {
            const config = loadConfig();
            const guildConfig = ensureMigrated(config[interaction.guild.id]);
            if (!guildConfig) {
                return interaction.reply({
                    ...v2Reply(errorContainer('Ticket system is not configured for this server.'), true),
                });
            }
            const ticket = guildConfig.tickets?.[interaction.channel.id];
            if (!ticket) {
                return interaction.reply({
                    ...v2Reply(errorContainer('This is not a ticket channel.'), true),
                });
            }
            if (!canManageTicket(interaction.member, guildConfig, ticket)) {
                return interaction.reply({
                    ...v2Reply(errorContainer('Only the ticket owner, claimer, support team, or admins can close this ticket.'), true),
                });
            }

            const reason = interaction.options.getString('reason')?.slice(0, 200) || null;
            const tMode = guildConfig.transcriptMode || 'manual';
            const wantsAuto = (tMode === 'auto' || tMode === 'both') && !!guildConfig.transcriptChannelId;

            // Snapshot
            const closingChannel = interaction.channel;
            const closingGuild   = interaction.guild;

            const container = buildClosedContainer({
                channel: closingChannel,
                ticket,
                byTag: interaction.user.tag,
                willTranscript: wantsAuto,
                reason,
            });

            // Reply FIRST — only delete the store entry once Discord has
            // accepted the public closing message. If the reply throws
            // (rate limit, perms revoked) the ticket stays usable so staff
            // can retry from the welcome buttons.
            try {
                await interaction.reply({
                    components: [container],
                    flags: MessageFlags.IsComponentsV2,
                });
            } catch (replyErr) {
                console.error(`[ticket-close] reply failed, ticket left intact: ${replyErr.message}`);
                throw replyErr;
            }

            delete guildConfig.tickets[closingChannel.id];
            saveConfig(config);

            await performClose({
                client:  interaction.client,
                channel: closingChannel,
                guild:   closingGuild,
                ticket,
                byTag:   `${interaction.user.tag} (slash close${reason ? `: ${reason}` : ''})`,
                guildConfig,
            });
        } catch (error) {
            console.error(`[ticket-close] ${error.message}`, error);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    ...v2Reply(errorContainer('Failed to close ticket.'), true),
                }).catch(() => {});
            }
        }
    },

    async executePrefix(message, args) {
        try {
            const config = loadConfig();
            const guildConfig = ensureMigrated(config[message.guild.id]);
            if (!guildConfig) {
                return message.reply({ ...v2Reply(errorContainer('Ticket system is not configured for this server.')) });
            }
            const ticket = guildConfig.tickets?.[message.channel.id];
            if (!ticket) {
                return message.reply({ ...v2Reply(errorContainer('This is not a ticket channel.')) });
            }
            if (!canManageTicket(message.member, guildConfig, ticket)) {
                return message.reply({ ...v2Reply(errorContainer('Only the ticket owner, claimer, support team, or admins can close this ticket.')) });
            }

            const reason = (Array.isArray(args) && args.length) ? args.join(' ').slice(0, 200) : null;
            const tMode = guildConfig.transcriptMode || 'manual';
            const wantsAuto = (tMode === 'auto' || tMode === 'both') && !!guildConfig.transcriptChannelId;

            const closingChannel = message.channel;
            const closingGuild   = message.guild;

            const container = buildClosedContainer({
                channel: closingChannel,
                ticket,
                byTag: message.author.tag,
                willTranscript: wantsAuto,
                reason,
            });

            // Same reply-first-then-delete order as the slash path.
            try {
                await message.reply({
                    components: [container],
                    flags: MessageFlags.IsComponentsV2,
                });
            } catch (replyErr) {
                console.error(`[ticket-close] prefix reply failed, ticket left intact: ${replyErr.message}`);
                throw replyErr;
            }

            delete guildConfig.tickets[closingChannel.id];
            saveConfig(config);

            await performClose({
                client:  message.client,
                channel: closingChannel,
                guild:   closingGuild,
                ticket,
                byTag:   `${message.author.tag} (prefix close${reason ? `: ${reason}` : ''})`,
                guildConfig,
            });
        } catch (error) {
            console.error(`[ticket-close] ${error.message}`, error);
        }
    },

    /* exported for index.js handlers */
    performClose,
    autoSaveTranscript,
    awaitTranscriptWithBudget,
};
