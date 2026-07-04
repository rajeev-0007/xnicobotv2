'use strict';

/**
 * /confession-setup
 * ──────────────────
 * Professional admin panel for the confession system.
 *
 * Configurable:
 *   • Confession channel + optional log/staff channel
 *   • Toggle anonymous mode, public mode, replies, reports
 *   • Manage user bans (block from submitting) and blocked words
 *   • Send the public Submit panel to any channel
 *   • Look up confessions by ID
 *
 * The panel refreshes itself in-place after every change.
 */

const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags,
    ChannelType,
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    ChannelSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');

const cm = require('../../utils/confessionManager');

const SETUP_PREFIX = 'confsetup';

// ── Helpers ────────────────────────────────────────────────────────────

function ensureManageGuild(interaction) {
    return interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild);
}

function modeBadge(on) {
    return on ? '<:Toggleon:1521227758011809964> On' : '<:Toggleoff:1521227763816595559> Off';
}

// ── Setup panel ────────────────────────────────────────────────────────

function buildSetupPanel(guild, opts = {}) {
    const cfg = cm.getGuildConfig(guild.id);
    const ready = !!cfg.channelId;
    const notice = opts.notice;

    const channelTxt = cfg.channelId ? `<#${cfg.channelId}>` : '`Not set`';
    const logTxt = cfg.logChannelId ? `<#${cfg.logChannelId}>` : '`None`';
    const panelTxt = cfg.panel?.channelId ? `Posted in <#${cfg.panel.channelId}>` : '`Not posted yet`';
    const banCount = (cfg.bannedUserIds || []).length;
    const wordCount = (cfg.blockedWords || []).length;

    const headerBlock =
        `# <:Envelope:1521228013910626426>  Confession System\n` +
        `-# Anonymous & public confessions for **${guild.name}**\n\n` +
        `### <:Settings:1521227767780343879> Configuration\n` +
        `**Confession Channel:** ${channelTxt}\n` +
        `**Staff Log Channel:** ${logTxt}\n` +
        `**Public Panel:** ${panelTxt}\n` +
        `**Total Confessions:** \`${cfg.count || 0}\`\n\n` +
        `### <:Shield:1521227694677692467> Modes\n` +
        `**Anonymous:** ${modeBadge(cfg.allowAnonymous)} · **Public:** ${modeBadge(cfg.allowPublic)}\n` +
        `**Replies:** ${modeBadge(cfg.allowReplies)} · **Reports:** ${modeBadge(cfg.allowReports)}\n\n` +
        `### <:Bookopen:1521227911137595605> Moderation\n` +
        `**Banned Users:** \`${banCount}\` · **Blocked Words:** \`${wordCount}\`\n` +
        (notice ? `\n${notice}\n` : '') +
        `\n-# Members confess via the public panel or \`/confess <message>\` (anonymous slash command).`;

    const container = new ContainerBuilder()
        .setAccentColor(ready ? 0x57F287 : 0x5865F2)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(headerBlock))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

    // Channel select
    container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
                .setCustomId(`${SETUP_PREFIX}_channelpick`)
                .setPlaceholder(cfg.channelId ? 'Change confession channel…' : 'Pick confession channel…')
                .setMinValues(1)
                .setMaxValues(1)
                .addChannelTypes(ChannelType.GuildText)
        )
    );

    // Log channel select
    container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
                .setCustomId(`${SETUP_PREFIX}_logpick`)
                .setPlaceholder(cfg.logChannelId ? 'Change staff log channel…' : 'Pick staff log channel (optional)…')
                .setMinValues(0)
                .setMaxValues(1)
                .addChannelTypes(ChannelType.GuildText)
        )
    );

    // Mode toggles
    container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`${SETUP_PREFIX}_toggle_anon`)
                .setLabel(`Anonymous: ${cfg.allowAnonymous ? 'On' : 'Off'}`)
                .setEmoji(cfg.allowAnonymous ? '<:Toggleon:1521227758011809964>' : '<:Toggleoff:1521227763816595559>')
                .setStyle(cfg.allowAnonymous ? ButtonStyle.Success : ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`${SETUP_PREFIX}_toggle_public`)
                .setLabel(`Public: ${cfg.allowPublic ? 'On' : 'Off'}`)
                .setEmoji(cfg.allowPublic ? '<:Toggleon:1521227758011809964>' : '<:Toggleoff:1521227763816595559>')
                .setStyle(cfg.allowPublic ? ButtonStyle.Success : ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`${SETUP_PREFIX}_toggle_replies`)
                .setLabel(`Replies: ${cfg.allowReplies ? 'On' : 'Off'}`)
                .setEmoji(cfg.allowReplies ? '<:Toggleon:1521227758011809964>' : '<:Toggleoff:1521227763816595559>')
                .setStyle(cfg.allowReplies ? ButtonStyle.Success : ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`${SETUP_PREFIX}_toggle_reports`)
                .setLabel(`Reports: ${cfg.allowReports ? 'On' : 'Off'}`)
                .setEmoji(cfg.allowReports ? '<:Toggleon:1521227758011809964>' : '<:Toggleoff:1521227763816595559>')
                .setStyle(cfg.allowReports ? ButtonStyle.Success : ButtonStyle.Secondary)
        )
    );

    // Public panel + moderation tools
    container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`${SETUP_PREFIX}_panel`)
                .setLabel('Send Public Panel')
                .setEmoji('<:Add:1521227828199293152>')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(!cfg.channelId),
            new ButtonBuilder()
                .setCustomId(`${SETUP_PREFIX}_bans`)
                .setLabel(`Banned Users (${banCount})`)
                .setEmoji('<:banhammer:1521227777083314529>')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`${SETUP_PREFIX}_words`)
                .setLabel(`Blocked Words (${wordCount})`)
                .setEmoji('<:Shield:1521227694677692467>')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`${SETUP_PREFIX}_lookup`)
                .setLabel('Lookup by ID')
                .setEmoji('<:Eye:1521227940480815156>')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(!Object.keys(cfg.log || {}).length)
        )
    );

    // Refresh + reset
    container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`${SETUP_PREFIX}_refresh`)
                .setLabel('Refresh')
                .setEmoji('<:Refresh:1521227946441052420>')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`${SETUP_PREFIX}_clearlog`)
                .setLabel('Clear Log')
                .setEmoji('<:Trash:1521227750420254820>')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(!Object.keys(cfg.log || {}).length),
            new ButtonBuilder()
                .setCustomId(`${SETUP_PREFIX}_reset`)
                .setLabel('Reset Settings')
                .setEmoji('<:Trash:1521227750420254820>')
                .setStyle(ButtonStyle.Danger)
        )
    );

    return container;
}

// ── Public submit panel (posted into a server channel) ─────────────────

function buildPublicPanel(guild) {
    const cfg = cm.getGuildConfig(guild.id);
    const both = cfg.allowAnonymous && cfg.allowPublic;
    const onlyAnon = cfg.allowAnonymous && !cfg.allowPublic;
    const onlyPub = !cfg.allowAnonymous && cfg.allowPublic;

    let modeLine = '';
    if (both) modeLine = '> <:Caretright:1521227704953864202> Pick **Anonymous** to hide your identity\n> <:Caretright:1521227704953864202> Pick **Public** to attach your name';
    else if (onlyAnon) modeLine = '> <:Caretright:1521227704953864202> Confessions are **anonymous** in this server';
    else if (onlyPub) modeLine = '> <:Caretright:1521227704953864202> Confessions are **public** (your name will be shown) in this server';
    else modeLine = '> <:Cancel:1521227723916181644> Confessions are currently disabled by staff';

    const container = new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `# <:Envelope:1521228013910626426>  Confessions\n` +
            `-# Share your thoughts in **${guild.name}** — your way.`
        ))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `### <:Lightbulbalt:1521227880703463675> How it works\n` +
            modeLine + '\n' +
            `> <:Caretright:1521227704953864202> Click a button below and type your message in the modal\n` +
            `> <:Caretright:1521227704953864202> Confession is posted in the configured channel\n` +
            `> <:Caretright:1521227704953864202> Each confession gets a unique ID for moderation\n\n` +
            `### <:Document:1521227875016114266> Privacy\n` +
            `Anonymous confessions never display your name publicly. Server admins can ` +
            `still look up the author for safety reviews — be respectful.`
        ))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addActionRowComponents(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('confpanel_anon')
                    .setLabel('Confess Anonymously')
                    .setEmoji('<:Shield:1521227694677692467>')
                    .setStyle(ButtonStyle.Success)
                    .setDisabled(!cfg.allowAnonymous || !cfg.channelId),
                new ButtonBuilder()
                    .setCustomId('confpanel_public')
                    .setLabel('Confess Publicly')
                    .setEmoji('<:User:1521227714227343380>')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(!cfg.allowPublic || !cfg.channelId),
                new ButtonBuilder()
                    .setCustomId('confpanel_help')
                    .setLabel('Rules')
                    .setEmoji('<:Document:1521227875016114266>')
                    .setStyle(ButtonStyle.Secondary)
            )
        );

    return container;
}

// ── Refresh helper ─────────────────────────────────────────────────────

async function refreshPanel(interaction, notice) {
    const panel = buildSetupPanel(interaction.guild, { notice });
    const payload = {
        components: [panel],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
    };
    if (interaction.deferred || interaction.replied) {
        await interaction.editReply(payload).catch(() => {});
    } else {
        await interaction.update(payload).catch(async () => {
            await interaction.reply(payload).catch(() => {});
        });
    }
}

// ── Command export ─────────────────────────────────────────────────────

module.exports = {
    /**
     * Premium-gated feature. `premiumOnly` is read by the
     * command dispatcher in index.js — non-premium users get a
     * polite message instead of execution.
     */
    premiumOnly: true,

    data: new SlashCommandBuilder()
        .setName('confession-setup')
        .setDescription('Configure the confession system')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    prefix: 'confession-setup',
    description: 'Configure the confession system',
    usage: 'confession-setup',
    category: 'admin',
    aliases: ['confessionsetup', 'confess-setup'],

    SETUP_PREFIX,
    buildSetupPanel,
    buildPublicPanel,

    async execute(interaction) {
        if (!ensureManageGuild(interaction)) {
            return interaction.reply({
                content: '<:Cancel:1521227723916181644> You need **Manage Server** permission.',
                flags: MessageFlags.Ephemeral
            });
        }
        const panel = buildSetupPanel(interaction.guild);
        await interaction.reply({
            components: [panel],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
        });
    },

    async executePrefix(message, args) {
        if (!message.member?.permissions?.has(PermissionFlagsBits.ManageGuild)) {
            return message.reply('<:Cancel:1521227723916181644> You need **Manage Server** permission.');
        }
        // Legacy prefix sub-command: -confession-log <ID>
        if (args[0]?.toLowerCase() === 'log') {
            const confId = args[1]?.toUpperCase();
            if (!confId) return message.reply('<:Cancel:1521227723916181644> Usage: `-confession-setup log <ID>`');
            const cfg = cm.getGuildConfig(message.guild.id);
            if (!cfg.log?.[confId]) return message.reply('<:Cancel:1521227723916181644> Confession not found.');
            const e = cfg.log[confId];
            return message.reply({
                components: [
                    new ContainerBuilder()
                        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                            `## <:Bookopen:1521227911137595605> Confession Log\n\n` +
                            `**ID:** \`${confId}\`\n` +
                            `**Mode:** \`${e.mode || 'anonymous'}\`\n` +
                            `**Author:** <@${e.userId}> (\`${e.userId}\`)\n` +
                            `**Number:** ${cm.formatNumber(e.number || 0)}\n` +
                            `**Posted:** <t:${Math.floor(e.timestamp / 1000)}:R>\n\n` +
                            `> ${(e.text || '').slice(0, 1500).replace(/\n/g, '\n> ')}\n\n` +
                            `-# Visible only to moderators.`
                        ))
                ],
                flags: MessageFlags.IsComponentsV2
            });
        }
        const panel = buildSetupPanel(message.guild);
        await message.reply({
            components: [panel],
            flags: MessageFlags.IsComponentsV2
        });
    },

    /**
     * Master button/select/modal handler for the setup panel.
     */
    async handleInteraction(interaction) {
        const id = interaction.customId;
        if (!id || !id.startsWith(SETUP_PREFIX + '_')) return false;

        if (!ensureManageGuild(interaction)) {
            await interaction.reply({
                content: '<:Cancel:1521227723916181644> You need **Manage Server** permission.',
                flags: MessageFlags.Ephemeral
            }).catch(() => {});
            return true;
        }

        // ── Premium gate ───────────────────────────────────────────
        // The slash dispatcher gates `/confession-setup` at command
        // entry, but panel buttons / modals route here directly. Re-
        // validate so the setup panel fails closed if the server
        // loses premium after the panel was opened.
        const premiumManager = require('../../utils/premiumManager');
        if (!premiumManager.hasPremiumAccess(interaction.user.id, interaction.guild?.id)) {
            const { buildPremiumGate } = require('../../utils/responseBuilder');
            await interaction.reply({
                components: [buildPremiumGate('/confession-setup')],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            }).catch(() => {});
            return true;
        }

        const action = id.replace(SETUP_PREFIX + '_', '');
        const guildId = interaction.guild.id;

        try {
            // ── Channel pick ──────────────────────────────────────────
            if (interaction.isChannelSelectMenu() && action === 'channelpick') {
                const channelId = interaction.values[0];
                const cfg = cm.getGuildConfig(guildId);
                cfg.channelId = channelId;
                cm.saveGuildConfig(guildId, cfg);
                await refreshPanel(interaction,
                    `<:Checkedbox:1521227734943269077> Confession channel set to <#${channelId}>.`);
                return true;
            }
            if (interaction.isChannelSelectMenu() && action === 'logpick') {
                const channelId = interaction.values[0] || null;
                const cfg = cm.getGuildConfig(guildId);
                cfg.logChannelId = channelId;
                cm.saveGuildConfig(guildId, cfg);
                await refreshPanel(interaction, channelId
                    ? `<:Checkedbox:1521227734943269077> Staff log channel set to <#${channelId}>.`
                    : `<:Checkedbox:1521227734943269077> Staff log channel cleared.`);
                return true;
            }

            // ── Toggles ───────────────────────────────────────────────
            if (interaction.isButton() && action.startsWith('toggle_')) {
                const which = action.replace('toggle_', '');
                const map = {
                    anon: 'allowAnonymous',
                    public: 'allowPublic',
                    replies: 'allowReplies',
                    reports: 'allowReports'
                };
                const key = map[which];
                if (!key) return true;
                const cfg = cm.getGuildConfig(guildId);
                cfg[key] = !cfg[key];
                cm.saveGuildConfig(guildId, cfg);
                await refreshPanel(interaction,
                    `<:Checkedbox:1521227734943269077> ${key.replace(/^allow/, '').toLowerCase()} ${cfg[key] ? 'enabled' : 'disabled'}.`);
                return true;
            }

            // ── Public panel deploy ───────────────────────────────────
            if (interaction.isButton() && action === 'panel') {
                const cfg = cm.getGuildConfig(guildId);
                if (!cfg.channelId) {
                    await refreshPanel(interaction, '<:Cancel:1521227723916181644> Set the confession channel first.');
                    return true;
                }
                const row = new ActionRowBuilder().addComponents(
                    new ChannelSelectMenuBuilder()
                        .setCustomId(`${SETUP_PREFIX}_panelpick`)
                        .setPlaceholder('Pick the channel to host the public Submit panel')
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                );
                await interaction.reply({
                    components: [new ContainerBuilder()
                        .addTextDisplayComponents(new TextDisplayBuilder().setContent('<:Add:1521227828199293152> Pick the channel where the public Submit panel should be posted:'))
                        .addActionRowComponents(row)],
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
                });
                return true;
            }
            if (interaction.isChannelSelectMenu() && action === 'panelpick') {
                const channelId = interaction.values[0];
                const channel = interaction.guild.channels.cache.get(channelId)
                    || await interaction.guild.channels.fetch(channelId).catch(() => null);
                if (!channel) {
                    await interaction.update({ content: '<:Cancel:1521227723916181644> Channel not found.', components: [] });
                    return true;
                }
                const me = interaction.guild.members.me;
                const perms = channel.permissionsFor(me);
                if (!perms?.has(['ViewChannel', 'SendMessages'])) {
                    await interaction.update({
                        content: `<:Cancel:1521227723916181644> I don't have **View Channel + Send Messages** in ${channel}.`,
                        components: []
                    });
                    return true;
                }
                try {
                    const cfg = cm.getGuildConfig(guildId);
                    if (cfg.panel?.channelId && cfg.panel?.messageId) {
                        const oldCh = interaction.guild.channels.cache.get(cfg.panel.channelId)
                            || await interaction.guild.channels.fetch(cfg.panel.channelId).catch(() => null);
                        if (oldCh) {
                            const oldMsg = await oldCh.messages.fetch(cfg.panel.messageId).catch(() => null);
                            if (oldMsg) await oldMsg.delete().catch(() => {});
                        }
                    }
                    const panel = buildPublicPanel(interaction.guild);
                    const sent = await channel.send({
                        components: [panel],
                        flags: MessageFlags.IsComponentsV2
                    });
                    cfg.panel = { channelId: channel.id, messageId: sent.id };
                    cm.saveGuildConfig(guildId, cfg);
                    await interaction.update({
                        content: `<:Checkedbox:1521227734943269077> Public Submit panel posted in ${channel}.`,
                        components: []
                    });
                } catch (e) {
                    await interaction.update({
                        content: `<:Cancel:1521227723916181644> Could not post panel: ${e.message || e}`,
                        components: []
                    });
                }
                return true;
            }

            // ── Banned users management ───────────────────────────────
            if (interaction.isButton() && action === 'bans') {
                const cfg = cm.getGuildConfig(guildId);
                const list = (cfg.bannedUserIds || []);
                const body = list.length
                    ? list.slice(0, 30).map(uid => `> <@${uid}> (\`${uid}\`)`).join('\n')
                    : '_No banned users yet._';
                const card = new ContainerBuilder()
                    .setAccentColor(0xED4245)
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                        `## <:banhammer:1521227777083314529> Banned Users\n` +
                        `These users can't submit confessions.\n\n${body}`
                    ))
                    .addActionRowComponents(
                        new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setCustomId(`${SETUP_PREFIX}_banadd`)
                                .setLabel('Add User')
                                .setEmoji('<:Add:1521227828199293152>')
                                .setStyle(ButtonStyle.Danger),
                            new ButtonBuilder()
                                .setCustomId(`${SETUP_PREFIX}_banremove`)
                                .setLabel('Remove User')
                                .setEmoji('<:Trash:1521227750420254820>')
                                .setStyle(ButtonStyle.Secondary)
                                .setDisabled(!list.length)
                        )
                    );
                await interaction.reply({
                    components: [card],
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
                });
                return true;
            }
            if (interaction.isButton() && action === 'banadd') {
                const modal = new ModalBuilder()
                    .setCustomId(`${SETUP_PREFIX}_modal_banadd`)
                    .setTitle('Ban User from Confessions')
                    .addComponents(new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('user_id')
                            .setLabel('User ID')
                            .setPlaceholder('e.g. 1234567890')
                            .setStyle(TextInputStyle.Short)
                            .setMinLength(15)
                            .setMaxLength(25)
                            .setRequired(true)
                    ));
                await interaction.showModal(modal);
                return true;
            }
            if (interaction.isButton() && action === 'banremove') {
                const modal = new ModalBuilder()
                    .setCustomId(`${SETUP_PREFIX}_modal_banremove`)
                    .setTitle('Unban User')
                    .addComponents(new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('user_id')
                            .setLabel('User ID')
                            .setPlaceholder('e.g. 1234567890')
                            .setStyle(TextInputStyle.Short)
                            .setMinLength(15)
                            .setMaxLength(25)
                            .setRequired(true)
                    ));
                await interaction.showModal(modal);
                return true;
            }

            // ── Blocked words management ──────────────────────────────
            if (interaction.isButton() && action === 'words') {
                const cfg = cm.getGuildConfig(guildId);
                const list = cfg.blockedWords || [];
                const body = list.length
                    ? list.slice(0, 50).map(w => `> \`${w}\``).join('\n')
                    : '_No blocked words yet._';
                const card = new ContainerBuilder()
                    .setAccentColor(0xED4245)
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                        `## <:Shield:1521227694677692467> Blocked Words\n` +
                        `Confessions containing these phrases are silently rejected.\n\n${body}`
                    ))
                    .addActionRowComponents(
                        new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setCustomId(`${SETUP_PREFIX}_wordedit`)
                                .setLabel('Edit Word List')
                                .setEmoji('<:Editalt:1521227921673556019>')
                                .setStyle(ButtonStyle.Primary),
                            new ButtonBuilder()
                                .setCustomId(`${SETUP_PREFIX}_wordclear`)
                                .setLabel('Clear All')
                                .setEmoji('<:Trash:1521227750420254820>')
                                .setStyle(ButtonStyle.Secondary)
                                .setDisabled(!list.length)
                        )
                    );
                await interaction.reply({
                    components: [card],
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
                });
                return true;
            }
            if (interaction.isButton() && action === 'wordedit') {
                const cfg = cm.getGuildConfig(guildId);
                const modal = new ModalBuilder()
                    .setCustomId(`${SETUP_PREFIX}_modal_wordedit`)
                    .setTitle('Blocked Words List')
                    .addComponents(new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('words')
                            .setLabel('One word per line')
                            .setStyle(TextInputStyle.Paragraph)
                            .setValue((cfg.blockedWords || []).join('\n').slice(0, 4000))
                            .setMaxLength(4000)
                            .setRequired(false)
                    ));
                await interaction.showModal(modal);
                return true;
            }
            if (interaction.isButton() && action === 'wordclear') {
                const cfg = cm.getGuildConfig(guildId);
                cfg.blockedWords = [];
                cm.saveGuildConfig(guildId, cfg);
                await interaction.update({
                    content: '<:Checkedbox:1521227734943269077> Blocked-words list cleared.',
                    components: []
                });
                return true;
            }

            // ── Lookup by ID ──────────────────────────────────────────
            if (interaction.isButton() && action === 'lookup') {
                const modal = new ModalBuilder()
                    .setCustomId(`${SETUP_PREFIX}_modal_lookup`)
                    .setTitle('Lookup Confession by ID')
                    .addComponents(new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('confession_id')
                            .setLabel('Confession ID')
                            .setStyle(TextInputStyle.Short)
                            .setMinLength(4)
                            .setMaxLength(16)
                            .setRequired(true)
                    ));
                await interaction.showModal(modal);
                return true;
            }

            // ── Refresh / clear log / reset ───────────────────────────
            if (interaction.isButton() && action === 'refresh') {
                await refreshPanel(interaction);
                return true;
            }
            if (interaction.isButton() && action === 'clearlog') {
                const confirmRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`${SETUP_PREFIX}_clearlogconfirm`)
                        .setLabel('Yes, clear log')
                        .setEmoji('<:Trash:1521227750420254820>')
                        .setStyle(ButtonStyle.Danger),
                    new ButtonBuilder()
                        .setCustomId(`${SETUP_PREFIX}_clearlogcancel`)
                        .setLabel('Cancel')
                        .setStyle(ButtonStyle.Secondary)
                );
                await interaction.reply({
                    components: [new ContainerBuilder()
                        .addTextDisplayComponents(new TextDisplayBuilder().setContent('<:Cancel:1521227723916181644> Clear-log will delete every author/text record. Confessions already posted in your channel are not affected.\nContinue?'))
                        .addActionRowComponents(confirmRow)],
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
                });
                return true;
            }
            if (interaction.isButton() && action === 'clearlogconfirm') {
                const cfg = cm.getGuildConfig(guildId);
                cfg.log = {};
                cfg.count = 0;
                cm.saveGuildConfig(guildId, cfg);
                await interaction.update({
                    content: '<:Checkedbox:1521227734943269077> Log cleared.',
                    components: []
                });
                return true;
            }
            if (interaction.isButton() && action === 'clearlogcancel') {
                await interaction.update({
                    content: '<:Checkedbox:1521227734943269077> Cancelled.',
                    components: []
                });
                return true;
            }

            if (interaction.isButton() && action === 'reset') {
                const confirmRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`${SETUP_PREFIX}_resetconfirm`)
                        .setLabel('Yes, reset')
                        .setEmoji('<:Trash:1521227750420254820>')
                        .setStyle(ButtonStyle.Danger),
                    new ButtonBuilder()
                        .setCustomId(`${SETUP_PREFIX}_resetcancel`)
                        .setLabel('Cancel')
                        .setStyle(ButtonStyle.Secondary)
                );
                await interaction.reply({
                    components: [new ContainerBuilder()
                        .addTextDisplayComponents(new TextDisplayBuilder().setContent('<:Cancel:1521227723916181644> Reset clears channels, toggles, bans, and blocked words. The confession log is preserved.\nContinue?'))
                        .addActionRowComponents(confirmRow)],
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
                });
                return true;
            }
            if (interaction.isButton() && action === 'resetconfirm') {
                const all = cm.loadAll();
                const preserveLog = all[guildId]?.log || {};
                const preserveCount = all[guildId]?.count || 0;
                all[guildId] = { ...cm.getDefaultGuildConfig(), log: preserveLog, count: preserveCount };
                cm.saveAll(all);
                await interaction.update({
                    content: '<:Checkedbox:1521227734943269077> Settings reset. Confession log preserved.',
                    components: []
                });
                return true;
            }
            if (interaction.isButton() && action === 'resetcancel') {
                await interaction.update({
                    content: '<:Checkedbox:1521227734943269077> Cancelled.',
                    components: []
                });
                return true;
            }

            // ── Modal submits ─────────────────────────────────────────
            if (interaction.isModalSubmit() && action === 'modal_banadd') {
                const userId = interaction.fields.getTextInputValue('user_id').trim();
                if (!/^\d{15,25}$/.test(userId)) {
                    await interaction.reply({ content: '<:Cancel:1521227723916181644> Invalid user ID.', flags: MessageFlags.Ephemeral });
                    return true;
                }
                const cfg = cm.getGuildConfig(guildId);
                if (!cfg.bannedUserIds.includes(userId)) cfg.bannedUserIds.push(userId);
                cm.saveGuildConfig(guildId, cfg);
                await interaction.reply({
                    content: `<:Checkedbox:1521227734943269077> <@${userId}> banned from confessions.`,
                    flags: MessageFlags.Ephemeral,
                    allowedMentions: { parse: [] }
                });
                return true;
            }
            if (interaction.isModalSubmit() && action === 'modal_banremove') {
                const userId = interaction.fields.getTextInputValue('user_id').trim();
                const cfg = cm.getGuildConfig(guildId);
                cfg.bannedUserIds = (cfg.bannedUserIds || []).filter(id => id !== userId);
                cm.saveGuildConfig(guildId, cfg);
                await interaction.reply({
                    content: `<:Checkedbox:1521227734943269077> <@${userId}> unbanned.`,
                    flags: MessageFlags.Ephemeral,
                    allowedMentions: { parse: [] }
                });
                return true;
            }
            if (interaction.isModalSubmit() && action === 'modal_wordedit') {
                const raw = interaction.fields.getTextInputValue('words') || '';
                const words = raw.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 200);
                const cfg = cm.getGuildConfig(guildId);
                cfg.blockedWords = words;
                cm.saveGuildConfig(guildId, cfg);
                await interaction.reply({
                    content: `<:Checkedbox:1521227734943269077> Blocked-words list updated (\`${words.length}\` entries).`,
                    flags: MessageFlags.Ephemeral
                });
                return true;
            }
            if (interaction.isModalSubmit() && action === 'modal_lookup') {
                const confId = interaction.fields.getTextInputValue('confession_id').trim().toUpperCase();
                const cfg = cm.getGuildConfig(guildId);
                const e = cfg.log?.[confId];
                if (!e) {
                    await interaction.reply({
                        content: `<:Cancel:1521227723916181644> No confession found with ID \`${confId}\`.`,
                        flags: MessageFlags.Ephemeral
                    });
                    return true;
                }
                const card = new ContainerBuilder()
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                        `## <:Bookopen:1521227911137595605> Confession Log\n\n` +
                        `**ID:** \`${confId}\`\n` +
                        `**Mode:** \`${e.mode || 'anonymous'}\`\n` +
                        `**Author:** <@${e.userId}> (\`${e.userId}\`)\n` +
                        `**Number:** ${cm.formatNumber(e.number || 0)}\n` +
                        `**Posted:** <t:${Math.floor(e.timestamp / 1000)}:R>\n\n` +
                        `> ${(e.text || '').slice(0, 1500).replace(/\n/g, '\n> ')}\n\n` +
                        `-# Visible only to moderators.`
                    ));
                await interaction.reply({
                    components: [card],
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                    allowedMentions: { parse: [] }
                });
                return true;
            }
        } catch (err) {
            require('../../utils/logger-styled').error('[confession-setup] handler error:', err);
            const msg = `<:Cancel:1521227723916181644> Something went wrong: ${err.message || err}`;
            if (interaction.deferred || interaction.replied) {
                await interaction.followUp({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => {});
            } else {
                await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => {});
            }
            return true;
        }

        return false;
    }
};
