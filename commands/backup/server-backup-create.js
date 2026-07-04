'use strict';

const {
    SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder,
    SeparatorBuilder, SeparatorSpacingSize,
    ActionRowBuilder, ButtonBuilder, ButtonStyle,
    PermissionFlagsBits, MessageFlags
} = require('discord.js');
const { createServerBackup } = require('../../utils/serverBackupManager');
const { buildExpiredPanel } = require('../../utils/responseBuilder');

const TIMEOUT = 60_000;

const OPTION_META = {
    roles:     { label: 'Roles',      emoji: '<:User:1521227714227343380>', desc: 'All roles & permissions' },
    channels:  { label: 'Channels',   emoji: '<:Edit:1521227886634205298>', desc: 'Categories, text & voice channels' },
    emojis:    { label: 'Emojis',     emoji: '😀', desc: 'Custom server emojis' },
    stickers:  { label: 'Stickers',   emoji: '<:Palette:1521227950601539755>', desc: 'Custom stickers' },
    messages:  { label: 'Messages',   emoji: '<:Hashtag:1521227771957870604>', desc: 'Full channel message history' },
    bans:      { label: 'Bans',       emoji: '<:banhammer:1521227777083314529>', desc: 'Banned users list' },
    settings:  { label: 'Settings',   emoji: '<:Settings:1521227767780343879>', desc: 'Server name, icon, banner, etc.' },
    botConfig: { label: 'Bot Config', emoji: '<:bots:1521227848101396610>', desc: 'Automod, antinuke, welcomer, leveling…' }
};
const OPTION_KEYS = Object.keys(OPTION_META);
const DEFAULTS = { roles: true, channels: true, emojis: true, stickers: true, messages: false, bans: false, settings: true, botConfig: true };

/* ─── Build the interactive options panel ─── */
function buildPanel(opts, uid, sid) {
    const on = '<:Checkedbox:1521227734943269077>';
    const off = '<:Cancel:1521227723916181644>';

    let lines = '';
    for (const k of OPTION_KEYS) {
        const m = OPTION_META[k];
        lines += `${opts[k] ? on : off} ${m.emoji} **${m.label}** — ${m.desc}\n`;
    }

    const ctr = new ContainerBuilder();
    ctr.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `# <:Box:1521228152414666833> Server Backup Options\n\nSelect what to include in your backup:\n\n${lines.trim()}\n\n-# Toggle items with the buttons below.`
    ));

    ctr.addActionRowComponents(new ActionRowBuilder().addComponents(
        ...['roles', 'channels', 'emojis', 'stickers'].map(k =>
            new ButtonBuilder()
                .setCustomId(`sbkc:t:${sid}:${k}`)
                .setEmoji(opts[k] ? '1521227734943269077' : '1521227723916181644')
                .setLabel(OPTION_META[k].label)
                .setStyle(opts[k] ? ButtonStyle.Success : ButtonStyle.Secondary)
        )
    ));

    ctr.addActionRowComponents(new ActionRowBuilder().addComponents(
        ...['messages', 'bans', 'settings', 'botConfig'].map(k =>
            new ButtonBuilder()
                .setCustomId(`sbkc:t:${sid}:${k}`)
                .setEmoji(opts[k] ? '1521227734943269077' : '1521227723916181644')
                .setLabel(OPTION_META[k].label)
                .setStyle(opts[k] ? ButtonStyle.Success : ButtonStyle.Secondary)
        )
    ));

    ctr.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`sbkc:all:${sid}`).setEmoji('<:Checkedbox:1521227734943269077>').setLabel('Select All').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`sbkc:none:${sid}`).setEmoji('<:Cancel:1521227723916181644>').setLabel('Deselect All').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`sbkc:confirm:${sid}`).setLabel('Create Backup').setEmoji('<:Box:1521228152414666833>').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`sbkc:cancel:${sid}`).setEmoji('<:Cancel:1521227723916181644>').setLabel('Cancel').setStyle(ButtonStyle.Danger)
    ));

    return ctr;
}

/* ─── Pretty result card ─── */
function buildResult(r) {
    const on = '<:Checkedbox:1521227734943269077>';
    const off = '<:Cancel:1521227723916181644>';
    const ctr = new ContainerBuilder();
    ctr.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `# <:Checkedbox:1521227734943269077> Server Backup Created\n\n` +
        `**Backup ID:** \`${r.backupId}\`\n**Secure Token:** \`${r.secureToken}\`\n\n` +
        `> <:Inforect:1521228008285929532> **Save both!** Token is needed for cross-server restores.`
    ));
    ctr.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));

    const s = r.stats;
    const lines = [];
    lines.push(`**<:Bookopen:1521227911137595605> Server:** ${r.serverName}`);
    if (s.roles > 0) lines.push(`**<:User:1521227714227343380> Roles:** ${s.roles}`);
    if (s.categories > 0) lines.push(`**<:Folderopen:1521227986966417642> Categories:** ${s.categories}`);
    if (s.channels > 0) lines.push(`**<:Edit:1521227886634205298> Channels:** ${s.channels}`);
    if (s.emojis > 0) lines.push(`**😀 Emojis:** ${s.emojis}`);
    if (s.stickers > 0) lines.push(`**<:Palette:1521227950601539755> Stickers:** ${s.stickers}`);
    if (s.bans > 0) lines.push(`**<:banhammer:1521227777083314529> Bans:** ${s.bans}`);
    if (s.botConfigs > 0) lines.push(`**<:bots:1521227848101396610> Bot Configs:** ${s.botConfigs}`);
    lines.push(`**<:Hashtag:1521227771957870604> Messages:** ${s.includesMessages ? `${on} ${s.messages.toLocaleString()} backed up` : `${off} Not included`}`);

    ctr.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
    return ctr;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('server-backup-create')
        .setDescription('Create a complete backup of the Discord server')
        .addBooleanOption(o => o.setName('roles').setDescription('Backup roles & permissions (default: true)'))
        .addBooleanOption(o => o.setName('channels').setDescription('Backup categories & channels (default: true)'))
        .addBooleanOption(o => o.setName('emojis').setDescription('Backup custom emojis (default: true)'))
        .addBooleanOption(o => o.setName('stickers').setDescription('Backup custom stickers (default: true)'))
        .addBooleanOption(o => o.setName('messages').setDescription('Backup ALL channel messages (default: false)'))
        .addBooleanOption(o => o.setName('bans').setDescription('Backup banned users list (default: false)'))
        .addBooleanOption(o => o.setName('settings').setDescription('Backup server settings/icon/banner (default: true)'))
        .addBooleanOption(o => o.setName('bot-config').setDescription('Backup bot configs: automod, antinuke, welcomer, etc. (default: true)'))
        .addIntegerOption(o => o.setName('message-limit').setDescription('Max messages per channel (0 = all, default: 0)').setMinValue(0).setMaxValue(10000))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    prefix: 'server-backup-create',
    description: 'Create a complete backup of the Discord server with selectable components',
    usage: 'server-backup-create',
    category: 'backup',
    aliases: ['sbk-create', 'sbackup-create'],
    permissions: ['Administrator'],

    /* ═══ Slash Command ═══ */
    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const opts = {
            roles: interaction.options.getBoolean('roles') ?? true,
            channels: interaction.options.getBoolean('channels') ?? true,
            emojis: interaction.options.getBoolean('emojis') ?? true,
            stickers: interaction.options.getBoolean('stickers') ?? true,
            messages: interaction.options.getBoolean('messages') ?? false,
            bans: interaction.options.getBoolean('bans') ?? false,
            settings: interaction.options.getBoolean('settings') ?? true,
            botConfig: interaction.options.getBoolean('bot-config') ?? true
        };
        const msgLimit = interaction.options.getInteger('message-limit') ?? 0;

        const selected = OPTION_KEYS.filter(k => opts[k]).map(k => OPTION_META[k].label).join(', ') || 'Nothing';
        const progress = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `# <:Lightning:1521227915537285150> Creating Server Backup…\n\nThis may take a few minutes${opts.messages ? ' (backing up all messages)' : ''}.\n\n` +
                `**Included:** ${selected}`
            ));
        await interaction.editReply({ components: [progress], flags: MessageFlags.IsComponentsV2 });

        try {
            const r = await createServerBackup(interaction.guild, interaction.user.id, {
                includeRoles: opts.roles,
                includeChannels: opts.channels,
                includeEmojis: opts.emojis,
                includeStickers: opts.stickers,
                includeMessages: opts.messages,
                messageLimit: msgLimit,
                includeBans: opts.bans,
                includeSettings: opts.settings,
                includeBotConfig: opts.botConfig
            });

            if (!r.success) {
                return interaction.editReply({ components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent('# <:Cancel:1521227723916181644> Backup Failed\n\nCould not create server backup.'))], flags: MessageFlags.IsComponentsV2 });
            }
            return interaction.editReply({ components: [buildResult(r)], flags: MessageFlags.IsComponentsV2 });
        } catch (err) {
            console.error('Error creating server backup:', err);
            return interaction.editReply({ components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Cancel:1521227723916181644> Error\n\n${err.message}`))], flags: MessageFlags.IsComponentsV2 });
        }
    },

    /* ═══ Prefix Command — interactive toggle panel ═══ */
    async executePrefix(message) {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply({ components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent('# <:Cancel:1521227723916181644> Missing Permission\n\nYou need **Administrator** permission.'))], flags: MessageFlags.IsComponentsV2 });
        }

        const uid = message.author.id;
        const sid = `${uid}_${Date.now().toString(36)}`;
        const opts = { ...DEFAULTS };

        const sent = await message.reply({ components: [buildPanel(opts, uid, sid)], flags: MessageFlags.IsComponentsV2 });
        const collector = sent.createMessageComponentCollector({ time: TIMEOUT });

        collector.on('collect', async (i) => {
            if (i.user.id !== uid) return i.reply({ content: '<:Cancel:1521227723916181644> Only the command invoker can use this.', flags: MessageFlags.Ephemeral });

            const parts = i.customId.split(':');
            const action = parts[1];

            /* Toggle individual option */
            if (action === 't') {
                const key = parts[3];
                if (OPTION_KEYS.includes(key)) opts[key] = !opts[key];
                return i.update({ components: [buildPanel(opts, uid, sid)], flags: MessageFlags.IsComponentsV2 });
            }

            /* Select all */
            if (action === 'all') {
                for (const k of OPTION_KEYS) opts[k] = true;
                return i.update({ components: [buildPanel(opts, uid, sid)], flags: MessageFlags.IsComponentsV2 });
            }

            /* Deselect all */
            if (action === 'none') {
                for (const k of OPTION_KEYS) opts[k] = false;
                return i.update({ components: [buildPanel(opts, uid, sid)], flags: MessageFlags.IsComponentsV2 });
            }

            /* Cancel */
            if (action === 'cancel') {
                collector.stop('handled');
                return i.update({ components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent('-# Cancelled. No backup was created.'))], flags: MessageFlags.IsComponentsV2 });
            }

            /* Confirm — create backup */
            if (action === 'confirm') {
                collector.stop('handled');

                const selected = OPTION_KEYS.filter(k => opts[k]).map(k => OPTION_META[k].label).join(', ') || 'Nothing';
                await i.update({ components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# <:Lightning:1521227915537285150> Creating Server Backup…\n\nThis may take a few minutes${opts.messages ? ' (backing up all messages)' : ''}.\n\n**Included:** ${selected}`
                ))], flags: MessageFlags.IsComponentsV2 });

                try {
                    const r = await createServerBackup(message.guild, uid, {
                        includeRoles: opts.roles,
                        includeChannels: opts.channels,
                        includeEmojis: opts.emojis,
                        includeStickers: opts.stickers,
                        includeMessages: opts.messages,
                        messageLimit: 0,
                        includeBans: opts.bans,
                        includeSettings: opts.settings,
                        includeBotConfig: opts.botConfig
                    });
                    if (!r.success) {
                        return sent.edit({ components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent('# <:Cancel:1521227723916181644> Backup Failed'))], flags: MessageFlags.IsComponentsV2 });
                    }
                    return sent.edit({ components: [buildResult(r)], flags: MessageFlags.IsComponentsV2 });
                } catch (err) {
                    console.error('Error creating server backup:', err);
                    return sent.edit({ components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Cancel:1521227723916181644> Error\n\n${err.message}`))], flags: MessageFlags.IsComponentsV2 });
                }
            }
        });

        collector.on('end', (_, reason) => {
            if (reason === 'handled') return;
            sent.edit({ components: [buildExpiredPanel('server-backup-create', 'No backup was created.')], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        });
    }
};
