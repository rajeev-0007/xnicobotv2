const {
    SlashCommandBuilder,
    ContainerBuilder,
    TextDisplayBuilder,
    MessageFlags,
    PermissionFlagsBits,
    SeparatorBuilder,
    SeparatorSpacingSize
} = require('discord.js');
const { loadConfig: loadAntinuke } = require('../../utils/panels/antinukePanel');
const { THEME, formatCheck } = require('../../utils/theme');
const { } = require('../../utils/responseBuilder');
const trust = require('../../utils/trustManager');

const jsonStore = require('../../utils/jsonStore');

function loadAntiraid() {
    try {
        if (!jsonStore.has('antiraid')) return {};
        return jsonStore.read('antiraid');
    } catch { return {}; }
}

function buildConfigPanel(guild, an, ar) {
    const headerText = `# ${THEME.EMOJIS.SHIELD} Security Configuration\n-# Overview for **${guild.name}**`;

    // --- Antinuke ---
    const anStatus = an?.enabled
        ? `${THEME.EMOJIS.SUCCESS} **Anti-Nuke:** Active`
        : `${THEME.EMOJIS.OFFLINE} **Anti-Nuke:** Inactive`;

    // Derived from utils/antinukeSchema so this overview lists every protection
    // the engine supports, rather than a stale hand-written subset.
    const { PROTECTION_KEYS: _anKeys, PROTECTIONS: _anDefs } = require('../../utils/antinukeSchema');
    const protections = _anKeys.map(key => ({ key, label: _anDefs[key].label }));

    let anGrid = '### <:Shield:1521227694677692467> Anti-Nuke Limits\n';
    for (const p of protections) {
        const prot = an?.[p.key];
        const s = formatCheck(prot?.enabled);
        anGrid += p.key === 'botAdd'
            ? `${s} **${p.label}** → \`${prot?.action || 'kick_bot'}\`\n`
            : `${s} **${p.label}** — Limit: \`${prot?.limit || '—'}\` • Window: \`${prot?.timeWindow ? (prot.timeWindow / 1000) + 's' : '—'}\` • Action: \`${prot?.action || 'remove_roles'}\`\n`;
    }

    const anSettings = `<:Caretright:1521227704953864202> **Whitelisted Users:** \`${an?.whitelistedUsers?.length || 0}\`\n` +
        `<:Caretright:1521227704953864202> **Bypass Role:** ${an?.bypassRoleId ? `<@&${an.bypassRoleId}>` : '`None`'}\n` +
        `<:Caretright:1521227704953864202> **Log Channel:** ${an?.logChannel ? `<#${an.logChannel}>` : '`Not Set`'}`;

    // --- Antiraid ---
    const arStatus = ar?.enabled
        ? `${THEME.EMOJIS.SUCCESS} **Anti-Raid:** Active`
        : `${THEME.EMOJIS.OFFLINE} **Anti-Raid:** Inactive`;

    const jr = ar?.joinRate, aa = ar?.accountAge, al = ar?.autoLockdown, sp = ar?.suspiciousPatterns;
    const arGrid = `### <:Infotriangle:1521227710381428926> Anti-Raid Limits\n` +
        `${formatCheck(jr?.enabled)} <:Userplus:1521227719621218477> **Join Rate** — \`${jr?.limit || '—'}\` joins / \`${jr?.timeWindow ? (jr.timeWindow / 1000) + 's' : '—'}\` → \`${jr?.action || 'kick'}\`\n` +
        `${formatCheck(aa?.enabled)} <:Alarm:1521227869047750689> **Account Age** — Min: \`${aa?.minDays || '—'}\` days → \`${aa?.action || 'kick'}\`\n` +
        `${formatCheck(al?.enabled)} <:Lock:1521227892770734120> **Auto Lockdown** — After \`${al?.threshold || '—'}\` violations → \`${al?.duration ? (al.duration / 60000) + 'min' : '—'}\`\n` +
        `${formatCheck(sp?.enabled)} <:Commentblock:1521227898101432331> **Suspicious Patterns** → \`${sp?.action || 'kick'}\``;

    const arSettings = `<:Caretright:1521227704953864202> **Whitelisted Roles:** \`${ar?.whitelistedRoles?.length || 0}\`\n` +
        `<:Caretright:1521227704953864202> **Bypass Role:** ${ar?.bypassRoleId ? `<@&${ar.bypassRoleId}>` : '`None`'}\n` +
        `<:Caretright:1521227704953864202> **Log Channel:** ${ar?.logChannel ? `<#${ar.logChannel}>` : '`Not Set`'}`;

    // --- Threat Modes ---
    const tm = an?.threatMode || false, stm = an?.superThreatMode || false;
    const threatText = `### <:Infotriangle:1521227710381428926> Threat Modes\n` +
        `${formatCheck(tm)} **Threat Mode** — Stricter limits, faster response\n` +
        `${formatCheck(stm)} **Super Threat Mode** — Maximum lockdown, zero tolerance`;

    // --- Summary ---
    const anActive = protections.filter(p => an?.[p.key]?.enabled).length;
    const arActive = [jr?.enabled, aa?.enabled, al?.enabled, sp?.enabled].filter(Boolean).length;
    const summary = `-# ${THEME.EMOJIS.SHIELD} Anti-Nuke: ${anActive}/8 active • Anti-Raid: ${arActive}/4 active • Threat: ${tm ? 'ON' : 'OFF'} • Super: ${stm ? 'ON' : 'OFF'}`;

    const container = new ContainerBuilder()
        .setAccentColor(an?.enabled || ar?.enabled ? 0x57F287 : 0xED4245)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(headerText))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(anStatus))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(anGrid))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(anSettings))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(arStatus))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(arGrid))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(arSettings))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(threatText))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(summary))
;

    return container;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('config')
        .setDescription('Show guild\'s anti nuke limit configuration')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    prefix: 'config',
    description: 'Show guild\'s anti nuke limit configuration',
    usage: 'config',
    category: 'admin',
    aliases: ['securityconfig', 'antinukeconfig'],

    async execute(interaction) {
        if (!trust.isServerOwner(interaction.guild, interaction.user.id)) {
            return interaction.reply({ content: '<:Cancel:1521227723916181644> Only the **server owner** can view security configuration.', flags: MessageFlags.Ephemeral });
        }
        const gid = interaction.guild.id;
        await interaction.reply({
            components: [buildConfigPanel(interaction.guild, loadAntinuke()[gid] || {}, loadAntiraid()[gid] || {})],
            flags: MessageFlags.IsComponentsV2
        });
    },

    async executePrefix(message) {
        if (!trust.isServerOwner(message.guild, message.author.id)) {
            return message.reply('<:Cancel:1521227723916181644> Only the **server owner** can view security configuration.');
        }
        const gid = message.guild.id;
        await message.reply({
            components: [buildConfigPanel(message.guild, loadAntinuke()[gid] || {}, loadAntiraid()[gid] || {})],
            flags: MessageFlags.IsComponentsV2
        });
    }
};
