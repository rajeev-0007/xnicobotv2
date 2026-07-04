const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize } = require('discord.js');
const { THEME, formatCheck, createFooterText, createStatusBadge } = require('../theme');

const jsonStore = require('../jsonStore');
const log = require('../logger-styled');

const PROTECTION_KEYS = ['banProtection', 'kickProtection', 'channelDelete', 'channelCreate', 'roleDelete', 'roleCreate', 'webhookCreate', 'botAdd'];

const PROTECTION_LABELS = {
    banProtection: 'Ban Protection',
    kickProtection: 'Kick Protection',
    channelDelete: 'Channel Delete',
    channelCreate: 'Channel Create',
    roleDelete: 'Role Delete',
    roleCreate: 'Role Create',
    webhookCreate: 'Webhook Protection',
    botAdd: 'Bot Add Protection'
};

const PROTECTION_EMOJIS = {
    banProtection: '<:banhammer:1521227777083314529>',
    kickProtection: '<:Userblock:1521227822641975366>',
    channelDelete: '<:Trash:1521227750420254820>',
    channelCreate: '<:Add:1521227828199293152>',
    roleDelete: '<:Trash:1521227750420254820>',
    roleCreate: '<:Add:1521227828199293152>',
    webhookCreate: '<:Bookmark:1521227835526742066>',
    botAdd: '<:bots:1521227848101396610>'
};

const PUNISHMENT_LABELS = {
    remove_roles: 'Strip Roles',
    kick: 'Kick',
    ban: 'Ban',
    timeout: 'Timeout',
    kick_bot: 'Kick Bot',
    kick_both: 'Kick Bot & User',
    ban_bot: 'Ban Bot'
};

const AVAILABLE_PUNISHMENTS = {
    banProtection: ['remove_roles', 'kick', 'ban', 'timeout'],
    kickProtection: ['remove_roles', 'kick', 'ban', 'timeout'],
    channelDelete: ['remove_roles', 'kick', 'ban', 'timeout'],
    channelCreate: ['remove_roles', 'kick', 'ban', 'timeout'],
    roleDelete: ['remove_roles', 'kick', 'ban', 'timeout'],
    roleCreate: ['remove_roles', 'kick', 'ban', 'timeout'],
    webhookCreate: ['remove_roles', 'kick', 'ban', 'timeout'],
    botAdd: ['kick_bot', 'kick_both', 'ban_bot']
};

function loadConfig() {
    if (!jsonStore.has('antinuke')) {
        jsonStore.write('antinuke', {});
        return {};
    }
    return jsonStore.read('antinuke');
}

function saveConfig(config) {
    jsonStore.write('antinuke', config);
    if (global.updateAntinukeCache && global.reloadAntinukeCache) {
        global.reloadAntinukeCache(config);
    }
}

function getDefaultConfig() {
    return {
        enabled: false,
        banProtection: { enabled: false, limit: 3, timeWindow: 60000, action: 'remove_roles' },
        kickProtection: { enabled: false, limit: 3, timeWindow: 60000, action: 'remove_roles' },
        channelDelete: { enabled: false, limit: 2, timeWindow: 60000, action: 'remove_roles' },
        channelCreate: { enabled: false, limit: 3, timeWindow: 60000, action: 'remove_roles' },
        roleDelete: { enabled: false, limit: 2, timeWindow: 60000, action: 'remove_roles' },
        roleCreate: { enabled: false, limit: 3, timeWindow: 60000, action: 'remove_roles' },
        webhookCreate: { enabled: false, limit: 2, timeWindow: 60000, action: 'remove_roles' },
        botAdd: { enabled: false, action: 'kick_bot' },
        whitelistedUsers: [],
        bypassRoleId: null,
        logChannel: null,
        // ── Power mode flags ──
        zeroTolerance: false,     // punish on the FIRST destructive action
        instantQuarantine: false, // strip the offender's roles immediately on detection
        autoRestore: false        // recreate channels/roles a nuker deletes
    };
}

function formatTimeWindow(ms) {
    const seconds = ms / 1000;
    if (seconds >= 60) return `${seconds / 60}m`;
    return `${seconds}s`;
}

function buildAntiNukePanel(guildConfig) {
    const enabledCount = PROTECTION_KEYS.filter(k => guildConfig[k]?.enabled).length;
    const whitelistCount = guildConfig.whitelistedUsers?.length || 0;
    const logChannel = guildConfig.logChannel ? `<#${guildConfig.logChannel}>` : '`Auto-create on enable`';
    const bypassRole = guildConfig.bypassRoleId ? `<@&${guildConfig.bypassRoleId}>` : '`None`';

    const isActive = guildConfig.enabled;
    const threatActive = guildConfig.threatMode || guildConfig.superThreatMode;
    const powerCount = [guildConfig.zeroTolerance, guildConfig.instantQuarantine, guildConfig.autoRestore].filter(Boolean).length;

    const headerText = `# <:Shield:1521227694677692467> Anti-Nuke Protection\n` +
        `-# Advanced server security engine — ultra-fast detection & response`;

    let statusLine;
    if (threatActive) {
        const mode = guildConfig.superThreatMode ? 'Super Threat' : 'Threat';
        statusLine = `<:Settingsadjust:1521228059779403786> **${mode} Mode Override** — Limits are locked`;
    } else if (isActive) {
        statusLine = `<:Shield:1521227694677692467> **System Armed** — \`${enabledCount}/8\` protections active`;
    } else {
        statusLine = `<:Infotriangle:1521227710381428926> **System Offline** — Your server is unprotected`;
    }

    let grid = '';
    for (const key of PROTECTION_KEYS) {
        const mod = guildConfig[key];
        const emoji = PROTECTION_EMOJIS[key];
        const label = PROTECTION_LABELS[key];
        const on = mod?.enabled;
        const action = PUNISHMENT_LABELS[mod?.action] || mod?.action || 'Strip Roles';
        const check = on ? '<:Toggleon:1521227758011809964>' : '<:Toggleoff:1521227763816595559>';

        if (key === 'botAdd') {
            grid += `${check} ${emoji} **${label}** → \`${action}\`\n`;
        } else {
            const limit = mod?.limit || 3;
            const tw = formatTimeWindow(mod?.timeWindow || 60000);
            grid += `${check} ${emoji} **${label}** — \`${limit}\` / \`${tw}\` → \`${action}\`\n`;
        }
    }

    const whitelistDisplay = whitelistCount > 0
        ? guildConfig.whitelistedUsers.slice(0, 5).map(id => `<@${id}>`).join(' ') + (whitelistCount > 5 ? ` **+${whitelistCount - 5}**` : '')
        : '`None`';

    const configText =
        `<:Document:1521227875016114266> **Log Channel:** ${logChannel}\n` +
        `<:Shield:1521227694677692467> **Bypass Role:** ${bypassRole}\n` +
        `<:Userplus:1521227719621218477> **Whitelisted:** ${whitelistDisplay}`;

    const selectMenu = new ActionRowBuilder()
        .addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('antinuke_protection_select')
                .setPlaceholder('Toggle Protection Modules')
                .setMinValues(1)
                .setMaxValues(8)
                .addOptions(
                    PROTECTION_KEYS.map(key => {
                        const mod = guildConfig[key];
                        const label = PROTECTION_LABELS[key];
                        const on = mod?.enabled;
                        const action = PUNISHMENT_LABELS[mod?.action] || 'Strip Roles';
                        const value = {
                            banProtection: 'ban', kickProtection: 'kick',
                            channelDelete: 'channel_delete', channelCreate: 'channel_create',
                            roleDelete: 'role_delete', roleCreate: 'role_create',
                            webhookCreate: 'webhook', botAdd: 'bot_add'
                        }[key];
                        const desc = key === 'botAdd'
                            ? `${on ? '✓ On' : '✗ Off'} • ${action}`
                            : `${on ? '✓ On' : '✗ Off'} • ${mod?.limit || 3}/${formatTimeWindow(mod?.timeWindow || 60000)} • ${action}`;
                        return { label, description: desc, value, emoji: PROTECTION_EMOJIS[key] };
                    })
                )
        );

    const actionSelect = new ActionRowBuilder()
        .addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('antinuke_action_select')
                .setPlaceholder('Change Punishment Per Module')
                .setMinValues(1)
                .setMaxValues(1)
                .addOptions([
                    { label: 'Ban → Strip Roles', value: 'banProtection:remove_roles' },
                    { label: 'Ban → Kick', value: 'banProtection:kick' },
                    { label: 'Ban → Ban', value: 'banProtection:ban' },
                    { label: 'Ban → Timeout', value: 'banProtection:timeout' },
                    { label: 'Kick → Strip Roles', value: 'kickProtection:remove_roles' },
                    { label: 'Kick → Kick', value: 'kickProtection:kick' },
                    { label: 'Kick → Ban', value: 'kickProtection:ban' },
                    { label: 'Kick → Timeout', value: 'kickProtection:timeout' },
                    { label: 'Channel → Strip Roles', value: 'channelDelete:remove_roles' },
                    { label: 'Channel → Kick', value: 'channelDelete:kick' },
                    { label: 'Channel → Ban', value: 'channelDelete:ban' },
                    { label: 'Role → Strip Roles', value: 'roleDelete:remove_roles' },
                    { label: 'Role → Kick', value: 'roleDelete:kick' },
                    { label: 'Role → Ban', value: 'roleDelete:ban' },
                    { label: 'Webhook → Strip Roles', value: 'webhookCreate:remove_roles' },
                    { label: 'Webhook → Kick', value: 'webhookCreate:kick' },
                    { label: 'Webhook → Ban', value: 'webhookCreate:ban' },
                    { label: 'Bot Add → Kick Bot', value: 'botAdd:kick_bot' },
                    { label: 'Bot Add → Kick Both', value: 'botAdd:kick_both' },
                    { label: 'Bot Add → Ban Bot', value: 'botAdd:ban_bot' },
                ])
        );

    const mainControls = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('antinuke_toggle')
                .setLabel(isActive ? 'Disable System' : 'Enable System')
                .setStyle(isActive ? ButtonStyle.Danger : ButtonStyle.Success)
                .setEmoji(isActive ? '<:Toggleoff:1521227763816595559>' : '<:Toggleon:1521227758011809964>'),
            new ButtonBuilder()
                .setCustomId('antinuke_enable_all')
                .setLabel('Enable All')
                .setStyle(ButtonStyle.Success)
                .setEmoji('<:Checkedbox:1521227734943269077>'),
            new ButtonBuilder()
                .setCustomId('antinuke_disable_all')
                .setLabel('Disable All')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('<:Cancel:1521227723916181644>'),
            new ButtonBuilder()
                .setCustomId('antinuke_power')
                .setLabel(powerCount === 3 ? 'Max Power: ON' : powerCount > 0 ? `Max Power: ${powerCount}/3` : 'Max Power')
                .setStyle(powerCount === 3 ? ButtonStyle.Danger : powerCount > 0 ? ButtonStyle.Primary : ButtonStyle.Secondary)
                .setEmoji('<:Lightning:1521227915537285150>')
        );

    const configControls = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('antinuke_whitelist')
                .setLabel('Whitelist')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('<:User:1521227714227343380>'),
            new ButtonBuilder()
                .setCustomId('antinuke_bypass_role')
                .setLabel('Bypass Role')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('<:Shield:1521227694677692467>'),
            new ButtonBuilder()
                .setCustomId('antinuke_logs')
                .setLabel('Log Channel')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('<:Document:1521227875016114266>'),
            new ButtonBuilder()
                .setCustomId('antinuke_settings')
                .setLabel('Limits & Time')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('<:Settings:1521227767780343879>'),
            new ButtonBuilder()
                .setCustomId('antinuke_default')
                .setLabel('Reset')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('<:History:1521227863079256278>')
        );

    const container = new ContainerBuilder()
        .setAccentColor(isActive ? 0x57F287 : 0xED4245);

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(headerText));
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(statusLine));
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`### <:Lightningalt:1521227851796447472> Protection Modules\n${grid}`));
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`### <:Settings:1521227767780343879> Configuration\n${configText}`));
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    container.addActionRowComponents(selectMenu);
    container.addActionRowComponents(actionSelect);
    container.addActionRowComponents(mainControls);
    container.addActionRowComponents(configControls);
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# xNico </>`));

    return container;
}

async function refreshAntiNukePanel(message, guildConfig) {
    const container = buildAntiNukePanel(guildConfig);

    try {
        await message.edit({ components: [container] });
        return { success: true };
    } catch (error) {
        log.error('Error refreshing antinuke panel:', error);
        return { success: false, error };
    }
}

module.exports = {
    loadConfig,
    saveConfig,
    getDefaultConfig,
    buildAntiNukePanel,
    refreshAntiNukePanel,
    PROTECTION_KEYS,
    PROTECTION_LABELS,
    PROTECTION_EMOJIS,
    PUNISHMENT_LABELS,
    AVAILABLE_PUNISHMENTS,
    formatTimeWindow
};
