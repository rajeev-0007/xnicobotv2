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

/** Threat Mode: stricter limits, action → kick */
const THREAT_LIMITS = {
    banProtection:  { limit: 2, timeWindow: 30000, action: 'kick' },
    kickProtection: { limit: 2, timeWindow: 30000, action: 'kick' },
    channelDelete:  { limit: 1, timeWindow: 30000, action: 'kick' },
    channelCreate:  { limit: 2, timeWindow: 30000, action: 'kick' },
    roleDelete:     { limit: 1, timeWindow: 30000, action: 'kick' },
    roleCreate:     { limit: 2, timeWindow: 30000, action: 'kick' },
    webhookCreate:  { limit: 1, timeWindow: 30000, action: 'kick' },
    botAdd:         { action: 'kick_bot' }
};

function buildThreatPanel(guildConfig, guildName) {
    const isActive = guildConfig.threatMode || false;
    const superActive = guildConfig.superThreatMode || false;

    const headerText = `# <:Shield:1521227694677692467> Threat Mode\n-# Enhanced security for **${guildName}**`;

    let statusText;
    if (superActive) {
        statusText = `<:Cancel:1521227723916181644> **Super Threat Mode is active** — it overrides Threat Mode.\nDisable Super Threat Mode first to use Threat Mode.`;
    } else if (isActive) {
        statusText = `<:Toggleon:1521227758011809964> **THREAT MODE ACTIVE**\nStricter limits — faster response, action: \`kick\``;
    } else {
        statusText = `${THEME.EMOJIS.SUCCESS} **Threat Mode Inactive**\nNormal protection limits are active`;
    }

    const descText = `### <:Document:1521227875016114266> What Threat Mode Does\n` +
        `<:Caretright:1521227704953864202> Sets **protection limits** to \`1-2\`\n` +
        `<:Caretright:1521227704953864202> Sets **all time windows** to \`30 seconds\`\n` +
        `<:Caretright:1521227704953864202> Sets **all actions** to \`kick\`\n` +
        `<:Caretright:1521227704953864202> **Force-enables** all protections + antinuke system\n` +
        `<:Caretright:1521227704953864202> Bot add action stays as \`kick_bot\`\n\n` +
        `-# <:Lightbulbalt:1521227880703463675> For maximum lockdown, use \`superthreatmode\` instead (limits: 1, action: ban)`;

    const currentText = isActive
        ? `### <:Lightningalt:1521227851796447472> Current Overrides\n` +
          Object.entries(THREAT_LIMITS).map(([key, val]) => {
              const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
              return val.limit !== undefined
                  ? `${formatCheck(true)} **${label}** — Limit: \`${val.limit}\` • Window: \`${val.timeWindow / 1000}s\` • Action: \`${val.action}\``
                  : `${formatCheck(true)} **${label}** — Action: \`${val.action}\``;
          }).join('\n')
        : '';

    const comparisonText = `### <:History:1521227863079256278> Mode Comparison\n` +
        `| | Normal | Threat | Super Threat |\n` +
        `|---|---|---|---|\n` +
        `| Limits | 2-3 | 1-2 | 1 |\n` +
        `| Window | 60s | 30s | 30s |\n` +
        `| Action | remove_roles | kick | ban |`;

    const toggleButton = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('threat_toggle')
                .setLabel(isActive ? 'Disable Threat Mode' : 'Enable Threat Mode')
                .setStyle(isActive ? ButtonStyle.Success : ButtonStyle.Danger)
                .setEmoji(isActive ? '<:Toggleon:1521227758011809964>' : '<:Toggleoff:1521227763816595559>')
                .setDisabled(superActive)
        );

    const container = new ContainerBuilder()
        .setAccentColor(isActive ? 0xFEE75C : superActive ? 0xED4245 : 0x57F287);

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(headerText));
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(statusText));
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(descText));
    if (currentText) {
        container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(currentText));
    }
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(comparisonText));
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    container.addActionRowComponents(toggleButton);
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

    return container;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('threatmode')
        .setDescription('Set guild\'s threat mode — enhanced security')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    prefix: 'threatmode',
    description: 'Set guild\'s threat mode — enhanced security',
    usage: 'threatmode',
    category: 'admin',
    aliases: ['threat', 'tm'],

    async execute(interaction) {
        if (!trust.isServerOwner(interaction.guild, interaction.user.id)) {
            return interaction.reply({ content: '<:Cancel:1521227723916181644> Only the **server owner** can toggle threat mode.', flags: MessageFlags.Ephemeral });
        }
        try {
            const config = loadConfig();
            if (!config[interaction.guild.id]) config[interaction.guild.id] = { enabled: false };
            await interaction.reply({ components: [buildThreatPanel(config[interaction.guild.id], interaction.guild.name)], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('[ThreatMode] Error:', error);
            const container = buildErrorResponse('Error', 'An error occurred while executing this command.', error.message);
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }
    },

    async executePrefix(message) {
        if (!trust.isServerOwner(message.guild, message.author.id)) {
            return message.reply('<:Cancel:1521227723916181644> Only the **server owner** can toggle threat mode.');
        }
        try {
            const config = loadConfig();
            if (!config[message.guild.id]) config[message.guild.id] = { enabled: false };
            await message.reply({ components: [buildThreatPanel(config[message.guild.id], message.guild.name)], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('[ThreatMode] Error:', error);
            const container = buildErrorResponse('Error', 'An error occurred while executing this command.', error.message);
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    },

    async handleInteraction(interaction) {
        if (interaction.customId !== 'threat_toggle') return false;
        if (await checkAndExpire(interaction, 'config')) return true;
        if (!trust.isServerOwner(interaction.guild, interaction.user.id)) {
            await interaction.reply({ content: '<:Cancel:1521227723916181644> Only the **server owner** can use this panel.', flags: MessageFlags.Ephemeral });
            return true;
        }

        const config = loadConfig();
        const guildId = interaction.guild.id;
        if (!config[guildId]) config[guildId] = { enabled: false };
        const gc = config[guildId];

        if (gc.superThreatMode) {
            await interaction.reply({ content: '<:Toggleoff:1521227763816595559> **Super Threat Mode** is active. Disable it first before using Threat Mode.', flags: MessageFlags.Ephemeral });
            return true;
        }

        const willEnable = !gc.threatMode;

        if (willEnable) {
            gc._savedThreatLimits = {};
            gc._preThreatEnabled = gc.enabled; // save antinuke enabled state
            for (const [key, overrides] of Object.entries(THREAT_LIMITS)) {
                if (gc[key]) gc._savedThreatLimits[key] = { ...gc[key] };
                if (!gc[key]) gc[key] = {};
                gc[key].enabled = true;
                if (overrides.limit !== undefined) gc[key].limit = overrides.limit;
                if (overrides.timeWindow !== undefined) gc[key].timeWindow = overrides.timeWindow;
                gc[key].action = overrides.action;
            }
            gc.enabled = true;
            gc.threatMode = true;
        } else {
            if (gc._savedThreatLimits) {
                for (const [key, saved] of Object.entries(gc._savedThreatLimits)) {
                    if (gc[key]) Object.assign(gc[key], saved);
                }
                delete gc._savedThreatLimits;
            }
            // Restore the original antinuke enabled state
            if (gc._preThreatEnabled !== undefined) {
                gc.enabled = gc._preThreatEnabled;
                delete gc._preThreatEnabled;
            }
            gc.threatMode = false;
        }

        saveConfig(config);
        await interaction.update({ components: [buildThreatPanel(gc, interaction.guild.name)], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        return true;
    }
};
