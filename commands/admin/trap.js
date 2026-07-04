'use strict';

const {
    SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ChannelType,
    ContainerBuilder, TextDisplayBuilder,
} = require('discord.js');
const { buildErrorResponse, buildPermissionDenied, COLORS } = require('../../utils/responseBuilder');
const trap = require('../../utils/trapManager');

const E = {
    ok: '<:Checkedbox:1521227734943269077>',
    arrow: '<:Caretright:1521227704953864202>',
    shield: '<:Shield:1521227694677692467>',
    trash: '<:Trash:1521227750420254820>',
    info: '<:Inforect:1521228008285929532>',
};

function panel(title, body, color = COLORS.SUCCESS) {
    return new ContainerBuilder().setAccentColor(color)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${title}\n\n${body}`));
}

function statusBody(cfg) {
    const chans = (cfg.channels || []).map(c => `<#${c}>`).join(', ') || '*none*';
    const action = (cfg.durationDays > trap.MAX_TIMEOUT_DAYS) ? `**Ban** (>${trap.MAX_TIMEOUT_DAYS}d)` : `**Timeout ${cfg.durationDays}d**`;
    return `${E.arrow} **Enabled:** ${cfg.enabled ? 'Yes' : 'No'}\n` +
        `${E.arrow} **Trap channels:** ${chans}\n` +
        `${E.arrow} **Punishment:** ${action}\n` +
        `${E.arrow} **Delete message:** ${cfg.deleteMessage !== false ? 'Yes' : 'No'}\n` +
        `${E.arrow} **Exempt roles:** ${(cfg.exemptRoles || []).map(r => `<@&${r}>`).join(', ') || '*none*'}\n` +
        `${E.arrow} **Log channel:** ${cfg.logChannel ? `<#${cfg.logChannel}>` : '*none*'}\n\n` +
        `-# Staff, admins, the owner & exempt roles are never punished. Discord caps timeouts at ${trap.MAX_TIMEOUT_DAYS}d — longer durations ban instead.`;
}

function ensureCfg(guildId) {
    return trap.getConfig(guildId) || trap.saveConfig(guildId, trap.defaults());
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('trap')
        .setDescription('Honeypot trap channels — auto-punish compromised/spam accounts')
        .addSubcommand(s => s.setName('add').setDescription('Mark a channel as a trap')
            .addChannelOption(o => o.setName('channel').setDescription('Trap channel').addChannelTypes(ChannelType.GuildText).setRequired(true)))
        .addSubcommand(s => s.setName('remove').setDescription('Unmark a trap channel')
            .addChannelOption(o => o.setName('channel').setDescription('Channel').setRequired(true)))
        .addSubcommand(s => s.setName('duration').setDescription('Set punishment length in days (>28 = ban)')
            .addIntegerOption(o => o.setName('days').setDescription('e.g. 7 or 365').setMinValue(1).setMaxValue(3650).setRequired(true)))
        .addSubcommand(s => s.setName('exempt').setDescription('Add/remove an exempt role')
            .addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true)))
        .addSubcommand(s => s.setName('logchannel').setDescription('Set the trap log channel')
            .addChannelOption(o => o.setName('channel').setDescription('Log channel').addChannelTypes(ChannelType.GuildText)))
        .addSubcommand(s => s.setName('toggle').setDescription('Enable or disable the trap system'))
        .addSubcommand(s => s.setName('status').setDescription('Show trap configuration'))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    prefix: 'trap',
    aliases: ['honeypot', 'trapchannel'],
    description: 'Honeypot trap channels that auto-timeout/ban compromised spam accounts',
    usage: 'trap <add|remove|duration|exempt|logchannel|toggle|status> [#channel|days|@role]',
    category: 'admin',

    async execute(interaction) {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ components: [buildPermissionDenied('Administrator')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }
        await interaction.deferReply();
        const gid = interaction.guild.id;
        const sub = interaction.options.getSubcommand();
        const cfg = ensureCfg(gid);

        if (sub === 'add') {
            const ch = interaction.options.getChannel('channel');
            const channels = Array.from(new Set([...(cfg.channels || []), ch.id]));
            trap.saveConfig(gid, { channels, enabled: true });
            return interaction.editReply({ components: [panel(`${E.ok} Trap Added`, `${ch} is now a trap. Non-staff who post there get ${cfg.durationDays > trap.MAX_TIMEOUT_DAYS ? 'banned' : `timed out ${cfg.durationDays}d`}.\n\n-# Tip: name it something like \`#do-not-post\` and lock it visually.`)], flags: MessageFlags.IsComponentsV2 });
        }
        if (sub === 'remove') {
            const ch = interaction.options.getChannel('channel');
            trap.saveConfig(gid, { channels: (cfg.channels || []).filter(c => c !== ch.id) });
            return interaction.editReply({ components: [panel(`${E.trash} Trap Removed`, `${ch} is no longer a trap.`, COLORS.ERROR)], flags: MessageFlags.IsComponentsV2 });
        }
        if (sub === 'duration') {
            const days = interaction.options.getInteger('days');
            trap.saveConfig(gid, { durationDays: days });
            return interaction.editReply({ components: [panel(`${E.ok} Duration Set`, days > trap.MAX_TIMEOUT_DAYS ? `Offenders will be **banned** (Discord can't time out beyond ${trap.MAX_TIMEOUT_DAYS}d).` : `Offenders will be **timed out for ${days} day(s)**.`)], flags: MessageFlags.IsComponentsV2 });
        }
        if (sub === 'exempt') {
            const role = interaction.options.getRole('role');
            const has = (cfg.exemptRoles || []).includes(role.id);
            const exemptRoles = has ? cfg.exemptRoles.filter(r => r !== role.id) : [...(cfg.exemptRoles || []), role.id];
            trap.saveConfig(gid, { exemptRoles });
            return interaction.editReply({ components: [panel(`${E.ok} Exempt Roles Updated`, `${has ? 'Removed' : 'Added'} <@&${role.id}> ${has ? 'from' : 'to'} the exempt list.`)], flags: MessageFlags.IsComponentsV2 });
        }
        if (sub === 'logchannel') {
            const ch = interaction.options.getChannel('channel');
            trap.saveConfig(gid, { logChannel: ch ? ch.id : null });
            return interaction.editReply({ components: [panel(`${E.ok} Log Channel Set`, ch ? `Trap triggers will be logged to ${ch}.` : 'Trap logging disabled.')], flags: MessageFlags.IsComponentsV2 });
        }
        if (sub === 'toggle') {
            const enabled = !cfg.enabled;
            trap.saveConfig(gid, { enabled });
            return interaction.editReply({ components: [panel(`${E.shield} Trap ${enabled ? 'Enabled' : 'Disabled'}`, enabled ? 'The trap system is now active.' : 'The trap system is paused.', enabled ? COLORS.SUCCESS : COLORS.WARNING)], flags: MessageFlags.IsComponentsV2 });
        }
        // status
        return interaction.editReply({ components: [panel(`${E.shield} Trap System`, statusBody(cfg))], flags: MessageFlags.IsComponentsV2 });
    },

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply({ components: [buildPermissionDenied('Administrator')], flags: MessageFlags.IsComponentsV2 });
        }
        const gid = message.guild.id;
        const sub = (args[0] || 'status').toLowerCase();
        const cfg = ensureCfg(gid);
        const ch = message.mentions.channels.first();
        const role = message.mentions.roles.first();

        if (sub === 'add') {
            const target = ch || message.channel;
            const channels = Array.from(new Set([...(cfg.channels || []), target.id]));
            trap.saveConfig(gid, { channels, enabled: true });
            return message.reply({ components: [panel(`${E.ok} Trap Added`, `${target} is now a trap.`)], flags: MessageFlags.IsComponentsV2 });
        }
        if (sub === 'remove') {
            const target = ch || message.channel;
            trap.saveConfig(gid, { channels: (cfg.channels || []).filter(c => c !== target.id) });
            return message.reply({ components: [panel(`${E.trash} Trap Removed`, `${target} is no longer a trap.`, COLORS.ERROR)], flags: MessageFlags.IsComponentsV2 });
        }
        if (sub === 'duration') {
            const days = parseInt(args[1], 10);
            if (!days || days < 1) return message.reply({ components: [buildErrorResponse('Invalid Days', 'Provide a number of days, e.g. `trap duration 7` or `trap duration 365`.')], flags: MessageFlags.IsComponentsV2 });
            trap.saveConfig(gid, { durationDays: days });
            return message.reply({ components: [panel(`${E.ok} Duration Set`, days > trap.MAX_TIMEOUT_DAYS ? `Offenders will be **banned**.` : `Offenders will be **timed out ${days}d**.`)], flags: MessageFlags.IsComponentsV2 });
        }
        if (sub === 'exempt' && role) {
            const has = (cfg.exemptRoles || []).includes(role.id);
            trap.saveConfig(gid, { exemptRoles: has ? cfg.exemptRoles.filter(r => r !== role.id) : [...(cfg.exemptRoles || []), role.id] });
            return message.reply({ components: [panel(`${E.ok} Exempt Roles Updated`, `${has ? 'Removed' : 'Added'} <@&${role.id}>.`)], flags: MessageFlags.IsComponentsV2 });
        }
        if (sub === 'logchannel') {
            trap.saveConfig(gid, { logChannel: ch ? ch.id : null });
            return message.reply({ components: [panel(`${E.ok} Log Channel Set`, ch ? `Logging to ${ch}.` : 'Logging disabled.')], flags: MessageFlags.IsComponentsV2 });
        }
        if (sub === 'toggle') {
            const enabled = !cfg.enabled;
            trap.saveConfig(gid, { enabled });
            return message.reply({ components: [panel(`${E.shield} Trap ${enabled ? 'Enabled' : 'Disabled'}`, enabled ? 'Active.' : 'Paused.', enabled ? COLORS.SUCCESS : COLORS.WARNING)], flags: MessageFlags.IsComponentsV2 });
        }
        return message.reply({ components: [panel(`${E.shield} Trap System`, statusBody(cfg))], flags: MessageFlags.IsComponentsV2 });
    },
};
