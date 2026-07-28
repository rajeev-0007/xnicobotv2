const {
    SlashCommandBuilder,
    ContainerBuilder,
    TextDisplayBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
    PermissionFlagsBits,
    SeparatorBuilder,
    SeparatorSpacingSize
} = require('discord.js');
const { loadConfig, saveConfig } = require('../../utils/panels/antinukePanel');
const { THEME, formatCheck } = require('../../utils/theme');
const { buildErrorResponse } = require('../../utils/responseBuilder');
const trust = require('../../utils/trustManager');
const { checkAndExpire } = require('../../utils/panelExpiration');

/** Super Threat Mode: maximum lockdown, action → ban */
const SUPER_THREAT_LIMITS = {
    banProtection:  { limit: 1, timeWindow: 30000, action: 'ban' },
    kickProtection: { limit: 1, timeWindow: 30000, action: 'ban' },
    channelDelete:  { limit: 1, timeWindow: 30000, action: 'ban' },
    channelCreate:  { limit: 1, timeWindow: 30000, action: 'ban' },
    roleDelete:     { limit: 1, timeWindow: 30000, action: 'ban' },
    roleCreate:     { limit: 1, timeWindow: 30000, action: 'ban' },
    webhookCreate:  { limit: 1, timeWindow: 30000, action: 'ban' },
    botAdd:         { action: 'kick_bot' }
};

function buildSuperThreatPanel(guildConfig, guildName) {
    const isActive = guildConfig.superThreatMode || false;

    const headerText = `# <:Shield:1521227694677692467> Super Threat Mode\n-# Maximum lockdown for **${guildName}**`;

    const statusText = isActive
        ? `<:Toggleon:1521227758011809964> **SUPER THREAT MODE ACTIVE**\nZero tolerance — all protections at maximum, action: \`ban\``
        : `${THEME.EMOJIS.SUCCESS} **Super Threat Mode Inactive**\nNormal protection limits are active`;

    const descText = `### <:Infotriangle:1521227710381428926> What Super Threat Mode Does\n` +
        `<:Caretright:1521227704953864202> Sets **all protection limits** to \`1\`\n` +
        `<:Caretright:1521227704953864202> Sets **all time windows** to \`30 seconds\`\n` +
        `<:Caretright:1521227704953864202> Sets **all actions** to \`ban\`\n` +
        `<:Caretright:1521227704953864202> **Force-enables** all protections + antinuke system\n` +
        `<:Caretright:1521227704953864202> Bot add action stays as \`kick_bot\`\n\n` +
        `-# <:Infotriangle:1521227710381428926> Your original limits are saved and restored when you disable this mode`;

    const currentText = isActive
        ? `### <:Document:1521227875016114266> Current Overrides\n` +
          Object.entries(SUPER_THREAT_LIMITS).map(([key, val]) => {
              const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
              return val.limit !== undefined
                  ? `${formatCheck(true)} **${label}** — Limit: \`${val.limit}\` • Window: \`${val.timeWindow / 1000}s\` • Action: \`${val.action}\``
                  : `${formatCheck(true)} **${label}** — Action: \`${val.action}\``;
          }).join('\n')
        : '';

    const toggleButton = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('superthreat_toggle')
                .setLabel(isActive ? 'Disable Super Threat Mode' : 'Enable Super Threat Mode')
                .setStyle(isActive ? ButtonStyle.Success : ButtonStyle.Danger)
                .setEmoji(isActive ? '<:Toggleon:1521227758011809964>' : '<:Toggleoff:1521227763816595559>')
        );

    const container = new ContainerBuilder()
        .setAccentColor(isActive ? 0xED4245 : 0x57F287);

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(headerText));
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(statusText));
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(descText));
    if (currentText) {
        container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(currentText));
    }
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    container.addActionRowComponents(toggleButton);
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

    return container;
}

module.exports = {
    /**
     * Premium-gated feature. `premiumOnly` is read by the
     * command dispatcher in index.js — non-premium users get a
     * polite message instead of execution.
     */
    premiumOnly: true,

    data: new SlashCommandBuilder()
        .setName('superthreatmode')
        .setDescription('Set guild\'s super threat mode — maximum lockdown')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    prefix: 'superthreatmode',
    description: 'Set guild\'s super threat mode — maximum lockdown',
    usage: 'superthreatmode',
    category: 'admin',
    aliases: ['superthreat', 'stm'],

    async execute(interaction) {
        if (!trust.isServerOwner(interaction.guild, interaction.user.id)) {
            return interaction.reply({ content: '<:Cancel:1521227723916181644> Only the **server owner** can toggle super threat mode.', flags: MessageFlags.Ephemeral });
        }
        try {
            const config = loadConfig();
            if (!config[interaction.guild.id]) config[interaction.guild.id] = { enabled: false };
            await interaction.reply({ components: [buildSuperThreatPanel(config[interaction.guild.id], interaction.guild.name)], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('[SuperThreatMode] Error:', error);
            const container = buildErrorResponse('Error', 'An error occurred while executing this command.', error.message);
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }
    },

    async executePrefix(message) {
        if (!trust.isServerOwner(message.guild, message.author.id)) {
            return message.reply('<:Cancel:1521227723916181644> Only the **server owner** can toggle super threat mode.');
        }
        try {
            const config = loadConfig();
            if (!config[message.guild.id]) config[message.guild.id] = { enabled: false };
            await message.reply({ components: [buildSuperThreatPanel(config[message.guild.id], message.guild.name)], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('[SuperThreatMode] Error:', error);
            const container = buildErrorResponse('Error', 'An error occurred while executing this command.', error.message);
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    },

    async handleInteraction(interaction) {
        if (interaction.customId !== 'superthreat_toggle') return false;
        // Re-validate server premium — the dispatcher only fires at
        // command entry, not on later panel button presses.
        const { requirePremium } = require('../../utils/interactionGuards');
        if (await requirePremium(interaction, { commandName: '/superthreatmode' })) return true;
        if (await checkAndExpire(interaction, 'config')) return true;
        if (!trust.isServerOwner(interaction.guild, interaction.user.id)) {
            await interaction.reply({ content: '<:Cancel:1521227723916181644> Only the **server owner** can use this panel.', flags: MessageFlags.Ephemeral });
            return true;
        }

        const config = loadConfig();
        const guildId = interaction.guild.id;
        if (!config[guildId]) config[guildId] = { enabled: false };
        const gc = config[guildId];

        const willEnable = !gc.superThreatMode;

        if (willEnable) {
            gc._savedLimits = {};
            gc._preSuperEnabled = gc.enabled; // save antinuke enabled state
            gc._savedStates = {
                zeroTolerance: !!gc.zeroTolerance,
                instantQuarantine: !!gc.instantQuarantine,
                autoRestore: !!gc.autoRestore
            };
            gc.zeroTolerance = true;
            gc.instantQuarantine = true;
            gc.autoRestore = true;

            for (const [key, overrides] of Object.entries(SUPER_THREAT_LIMITS)) {
                if (gc[key]) gc._savedLimits[key] = { ...gc[key] };
                if (!gc[key]) gc[key] = {};
                gc[key].enabled = true;
                if (overrides.limit !== undefined) gc[key].limit = overrides.limit;
                if (overrides.timeWindow !== undefined) gc[key].timeWindow = overrides.timeWindow;
                gc[key].action = overrides.action;
            }
            gc.enabled = true;
            gc.superThreatMode = true;
            if (gc.threatMode) gc.threatMode = false;
        } else {
            if (gc._savedLimits) {
                for (const [key, saved] of Object.entries(gc._savedLimits)) {
                    if (gc[key]) Object.assign(gc[key], saved);
                }
                delete gc._savedLimits;
            }
            if (gc._savedStates) {
                gc.zeroTolerance = gc._savedStates.zeroTolerance;
                gc.instantQuarantine = gc._savedStates.instantQuarantine;
                gc.autoRestore = gc._savedStates.autoRestore;
                delete gc._savedStates;
            }
            // Restore the original antinuke enabled state
            if (gc._preSuperEnabled !== undefined) {
                gc.enabled = gc._preSuperEnabled;
                delete gc._preSuperEnabled;
            }
            gc.superThreatMode = false;
        }

        saveConfig(config);
        await interaction.update({ components: [buildSuperThreatPanel(gc, interaction.guild.name)], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        return true;
    }
};
