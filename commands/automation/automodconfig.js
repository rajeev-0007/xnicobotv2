const {
    SlashCommandBuilder,
    ContainerBuilder,
    TextDisplayBuilder,
    MessageFlags,
    PermissionFlagsBits,
    SeparatorBuilder,
    SeparatorSpacingSize,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');
const { THEME, formatCheck, createFooterText } = require('../../utils/theme');
const { buildErrorResponse, buildExpiredPanel } = require('../../utils/responseBuilder');
const trust = require('../../utils/trustManager');

const jsonStore = require('../../utils/jsonStore');

function loadAutomod() {
    try {
        if (!jsonStore.has('automod')) return {};
        return jsonStore.read('automod');
    } catch { return {}; }
}

const MODULES = [
    { key: 'badWords', label: 'Bad Words', emoji: '<:Commentblock:1521227898101432331>', desc: 'Block custom bad-word list' },
    { key: 'spam', label: 'Spam', emoji: '<:Editalt:1521227921673556019>', desc: 'Rate-limit repeated messages' },
    { key: 'links', label: 'Links', emoji: '<:Attach:1521228039135170722>', desc: 'Block external links' },
    { key: 'invites', label: 'Invites', emoji: '<:Envelopeopen:1521228083049271540>', desc: 'Block Discord invites' },
    { key: 'massMention', label: 'Mass Mention', emoji: '<:Bullhorn:1521227936575914016>', desc: 'Limit mass @mentions' },
    { key: 'caps', label: 'Caps Lock', emoji: '<:Bookcheck:1521228089726730351>', desc: 'Block excessive CAPS' },
    { key: 'profanity', label: 'Profanity', emoji: '<:Commentblock:1521227898101432331>', desc: 'AI-based profanity filter' },
    { key: 'sexualContent', label: 'Sexual Content', emoji: '<:Commentblock:1521227898101432331>', desc: 'Block explicit content' },
    { key: 'slurs', label: 'Slurs', emoji: '<:dnd:1521228070701502486>', desc: 'Block hateful slurs' }
];

function buildAutomodPanel(guild, cfg, expanded = false, btnPrefix = 'amc') {
    const headerText = `# ${THEME.EMOJIS.SHIELD} Automod Configuration\n-# Module overview for **${guild.name}**`;

    const enabled = cfg?.enabled;
    const statusText = enabled
        ? `${THEME.EMOJIS.SUCCESS} **Automod:** Active`
        : `${THEME.EMOJIS.OFFLINE} **Automod:** Inactive`;

    // Module grid
    let grid = '### <:Document:1521227875016114266> Modules\n';
    let activeCount = 0;
    for (const m of MODULES) {
        const mod = cfg?.[m.key];
        const on = mod?.enabled;
        if (on) activeCount++;
        grid += `${formatCheck(on)} ${m.emoji} **${m.label}** — ${m.desc}\n`;
    }

    // Extra details for modules with thresholds
    let details = '### <:Settings:1521227767780343879> Thresholds & Actions\n';

    const spam = cfg?.spam;
    details += `**Spam:** Max \`${spam?.maxMessages || 5}\` msgs / \`${spam?.interval ? (spam.interval / 1000) + 's' : '5s'}\` • Action: \`${spam?.action || 'delete'}\`\n`;

    const mm = cfg?.massMention;
    details += `**Mentions:** Max \`${mm?.maxMentions || 5}\` • Action: \`${mm?.action || 'delete'}\`\n`;

    const caps = cfg?.caps;
    details += `**Caps:** Threshold \`${caps?.percentage || 70}%\` / min \`${caps?.minLength || 10}\` chars • Action: \`${caps?.action || 'delete'}\`\n`;

    const links = cfg?.links;
    const hasLongWhitelist = links?.whitelist?.length > 5;
    if (links?.whitelist?.length) {
        if (expanded || !hasLongWhitelist) {
            details += `**Link Whitelist:** ${links.whitelist.map(l => `\`${l}\``).join(', ')}\n`;
        } else {
            details += `**Link Whitelist:** ${links.whitelist.slice(0, 5).map(l => `\`${l}\``).join(', ')} +${links.whitelist.length - 5} more\n`;
        }
    }

    const bw = cfg?.badWords;
    const hasLongBadWords = bw?.words?.length > 5;
    if (bw?.words?.length) {
        if (expanded || !hasLongBadWords) {
            const preview = bw.words.map(w => `\`${w}\``).join(', ');
            details += `**Bad Words:** ${preview}\n`;
        } else {
            const preview = bw.words.slice(0, 5).map(w => `\`${w}\``).join(', ');
            details += `**Bad Words:** ${preview} +${bw.words.length - 5} more\n`;
        }
    }

    // Settings
    let settings = '### <:Settings:1521227767780343879> Global Settings\n';
    const ignoredRoles = cfg?.ignoredRoles?.length || 0;
    const ignoredChannels = cfg?.ignoredChannels?.length || 0;
    settings += `<:Caretright:1521227704953864202> **Ignored Roles:** \`${ignoredRoles}\` • **Ignored Channels:** \`${ignoredChannels}\`\n`;
    settings += `<:Caretright:1521227704953864202> **Bypass Role:** ${cfg?.bypassRoleId ? `<@&${cfg.bypassRoleId}>` : '`None`'}\n`;
    settings += `<:Caretright:1521227704953864202> **Log Channel:** ${cfg?.logChannel ? `<#${cfg.logChannel}>` : '`Not Set`'}`;

    const summary = `-# ${THEME.EMOJIS.SHIELD} ${activeCount}/${MODULES.length} modules active • ${ignoredRoles} ignored roles • ${ignoredChannels} ignored channels`;

    const container = new ContainerBuilder()
        .setAccentColor(enabled ? 0x57F287 : 0xED4245)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(headerText))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(statusText))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(grid))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(details))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(settings))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(summary));

    // Show expand/collapse button if there are long lists
    const needsExpand = hasLongWhitelist || hasLongBadWords;
    if (needsExpand) {
        container.addActionRowComponents(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`${btnPrefix}_toggle`)
                    .setLabel(expanded ? '▲ Collapse Lists' : '▼ Show Full Lists')
                    .setStyle(expanded ? ButtonStyle.Secondary : ButtonStyle.Primary)
            )
        );
    }

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(createFooterText()));

    return { container, needsExpand };
}

function setupExpandCollector(reply, guild, cfg, userId, btnPrefix) {
    let expanded = false;
    const collector = reply.createMessageComponentCollector({
        filter: i => i.customId === `${btnPrefix}_toggle` && i.user.id === userId,
        time: 120_000
    });

    collector.on('collect', async (i) => {
        expanded = !expanded;
        const { container } = buildAutomodPanel(guild, cfg, expanded, btnPrefix);
        await i.update({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
    });

    collector.on('end', async () => {
        try {
            await reply.edit({ components: [buildExpiredPanel('automodconfig')], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        } catch {}
    });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('automodconfig')
        .setDescription('Show guild\'s automod configuration')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    prefix: 'automodconfig',
    description: 'Show guild\'s automod configuration',
    usage: 'automodconfig',
    category: 'automation',
    aliases: ['amconfig', 'automodinfo'],

    async execute(interaction) {
        if (!trust.isServerOwner(interaction.guild, interaction.user.id)) {
            const container = buildErrorResponse('Permission Denied', 'Only the **server owner** can view automod configuration.');
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }
        const gid = interaction.guild.id;
        const cfg = loadAutomod()[gid] || {};
        const btnPrefix = `amc_${Date.now().toString(36)}`;
        const { container, needsExpand } = buildAutomodPanel(interaction.guild, cfg, false, btnPrefix);
        const reply = await interaction.reply({
            components: [container],
            flags: MessageFlags.IsComponentsV2,
            fetchReply: true
        });
        if (needsExpand) setupExpandCollector(reply, interaction.guild, cfg, interaction.user.id, btnPrefix);
    },

    async executePrefix(message) {
        if (!trust.isServerOwner(message.guild, message.author.id)) {
            const container = buildErrorResponse('Permission Denied', 'Only the **server owner** can view automod configuration.');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
        const gid = message.guild.id;
        const cfg = loadAutomod()[gid] || {};
        const btnPrefix = `amc_${Date.now().toString(36)}`;
        const { container, needsExpand } = buildAutomodPanel(message.guild, cfg, false, btnPrefix);
        const reply = await message.reply({
            components: [container],
            flags: MessageFlags.IsComponentsV2
        });
        if (needsExpand) setupExpandCollector(reply, message.guild, cfg, message.author.id, btnPrefix);
    }
};
