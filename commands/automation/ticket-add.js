const {
    SlashCommandBuilder, PermissionFlagsBits, MessageFlags,
    ContainerBuilder, TextDisplayBuilder,
} = require('discord.js');

const jsonStore = require('../../utils/jsonStore');
const { ensureMigrated } = require('../../utils/ticketPanels');
const {
    E, COLOR, errorContainer, v2Reply, canManageTicket,
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

/**
 * Resolve the ticket entry, the live store config object, and the
 * effective guild config for `channelId` in this guild.
 * Returns `null` when the channel isn't a ticket.
 */
function resolveTicketContext(guild, channelId) {
    const config = loadConfig();
    const guildConfig = ensureMigrated(config[guild.id]);
    if (!guildConfig) return null;
    const ticket = guildConfig.tickets?.[channelId];
    if (!ticket) return null;
    return { config, guildConfig, ticket };
}

/* ─────────────────────────── shared logic ──────────────────────── */

/**
 * Add a user to the current ticket channel.
 * Returns either `{ ok: true, container }` for success,
 * or `{ ok: false, message }` so each entry-point (slash / prefix)
 * can render the error in its own style.
 */
async function addUserToTicket({ guild, channel, member, targetUser }) {
    const ctx = resolveTicketContext(guild, channel.id);
    if (!ctx) return { ok: false, message: 'This is not a ticket channel.' };

    const { config, guildConfig, ticket } = ctx;

    // Owners can invite people they trust; staff can always invite.
    if (!canManageTicket(member, guildConfig, ticket)) {
        return { ok: false, message: 'Only the ticket owner, claimer, or support team can add users.' };
    }

    if (!targetUser) {
        return { ok: false, message: 'Please specify a user to add.' };
    }
    if (targetUser.bot) {
        return { ok: false, message: 'Bots cannot be added to tickets through this command.' };
    }
    if (targetUser.id === ticket.userId) {
        return { ok: false, message: 'That user is already the ticket owner.' };
    }
    const alreadyTracked = ticket.members?.includes(targetUser.id);
    if (!guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels)) {
        return { ok: false, message: 'I need **Manage Channels** permission to update this ticket.' };
    }

    try {
        // Always re-create the overwrite. If a previous add was lost (manual
        // permissions edit, role wipe, etc.) tracking it in `members` doesn't
        // give the user real visibility — we have to (re)apply the channel
        // permission too. discord.js merges with existing overwrites so this
        // is idempotent for the happy path.
        await channel.permissionOverwrites.create(targetUser, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true,
            AttachFiles: true,
            EmbedLinks: true,
        });
    } catch (err) {
        return { ok: false, message: `Failed to update channel permissions: ${err.message}` };
    }

    ticket.members = ticket.members || [];
    if (!ticket.members.includes(targetUser.id)) ticket.members.push(targetUser.id);
    jsonStore.write('tickets', config);

    const text = alreadyTracked
        ? `# ${E.ok} Access Restored\n\n` +
          `${targetUser} was already in this ticket — their channel access has been re-applied.`
        : `# ${E.ok} User Added\n\n` +
          `${targetUser} has been added to this ticket by ${member}.\n\n` +
          `${E.pin} They can now read and reply in this channel.`;

    const container = new ContainerBuilder()
        .setAccentColor(COLOR.SUCCESS)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(text));

    return { ok: true, container };
}

/* ─────────────────────────── command ──────────────────────────── */

module.exports = {
    category: 'automation',
    data: new SlashCommandBuilder()
        .setName('ticket-add')
        .setDescription('Add a user to the current ticket channel')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('User to add to this ticket')
                .setRequired(true))
        .setDMPermission(false),

    async execute(interaction) {
        try {
            const targetUser = interaction.options.getUser('user');
            const result = await addUserToTicket({
                guild:   interaction.guild,
                channel: interaction.channel,
                member:  interaction.member,
                targetUser,
            });

            if (!result.ok) {
                return interaction.reply({
                    ...v2Reply(errorContainer(result.message), true),
                });
            }
            await interaction.reply({
                components: [result.container],
                flags: MessageFlags.IsComponentsV2,
            });
        } catch (error) {
            console.error(`[ticket-add] ${error.message}`, error);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    ...v2Reply(errorContainer('Failed to add user to ticket.'), true),
                }).catch(() => {});
            }
        }
    },

    async executePrefix(message) {
        try {
            const targetUser = message.mentions.users.first();
            if (!targetUser) {
                return message.reply({
                    ...v2Reply(errorContainer('Mention the user to add. Example: `-ticket-add @user`')),
                });
            }
            const result = await addUserToTicket({
                guild:   message.guild,
                channel: message.channel,
                member:  message.member,
                targetUser,
            });

            if (!result.ok) {
                return message.reply({ ...v2Reply(errorContainer(result.message)) });
            }
            await message.reply({
                components: [result.container],
                flags: MessageFlags.IsComponentsV2,
            });
        } catch (error) {
            console.error(`[ticket-add] ${error.message}`, error);
        }
    },
};
