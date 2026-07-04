const { isOwner } = require('../../utils/helpers');
const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } = require('discord.js');
const jsonStore = require('../../utils/jsonStore');

const VALID_KEYS = [
    'defaultPrefix', 'maintenanceMode', 'maintenanceMessage',
    'maxGuilds', 'developerMode', 'commandCooldown',
    'embedColor', 'supportServer', 'voteLink'
];

function getDefaults() {
    return {
        defaultPrefix: process.env.PREFIX || '-',
        maintenanceMode: false,
        maintenanceMessage: 'Bot is currently under maintenance. Please try again later.',
        globalAnnouncement: null,
        maxGuilds: 1000,
        developerMode: false,
        autoRestart: true,
        commandCooldown: 3000,
        embedColor: '#0099ff',
        supportServer: null,
        voteLink: process.env.VOTE_LINK || null
    };
}

function loadConfig() {
    const data = jsonStore.read('globalconfig');
    if (!data || Object.keys(data).length === 0) {
        const defaults = getDefaults();
        jsonStore.write('globalconfig', defaults);
        return defaults;
    }
    return data;
}

function saveConfig(config) {
    jsonStore.write('globalconfig', config);
}

module.exports = {
    name: 'globalconfig',
    prefix: 'globalconfig',
    aliases: ['gconfig', 'gcfg'],
    description: 'View or modify global bot settings',
    usage: 'globalconfig [view|set <key> <value>|reset]',
    category: 'owner',
    ownerOnly: true,

    async executePrefix(message, args) {
        if (!isOwner(message.author.id)) {
            return message.reply(require('../../utils/ownerUI').ownerOnly());
        }

        const action = (args[0] || 'view').toLowerCase();
        const key    = args[1];
        const value  = args.slice(2).join(' ');

        try {
            const config = loadConfig();

            if (action === 'view') {
                const container = new ContainerBuilder()
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(`# <:Settings:1521227767780343879> Global Bot Configuration`)
                    )
                    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(
                            `**Default Prefix:** \`${config.defaultPrefix}\`\n` +
                            `**Maintenance Mode:** ${config.maintenanceMode ? '<:Toggleon:1521227758011809964> Enabled' : '<:Toggleoff:1521227763816595559> Disabled'}\n` +
                            `**Developer Mode:** ${config.developerMode ? '<:Toggleon:1521227758011809964> Enabled' : '<:Toggleoff:1521227763816595559> Disabled'}\n` +
                            `**Max Guilds:** ${config.maxGuilds}\n` +
                            `**Command Cooldown:** ${config.commandCooldown}ms\n` +
                            `**Embed Color:** ${config.embedColor}\n\n` +
                            `**Maintenance Message:** ${String(config.maintenanceMessage || '').substring(0, 100)}\n` +
                            `**Support Server:** ${config.supportServer || 'Not set'}\n` +
                            `**Vote Link:** ${config.voteLink || 'Not set'}\n\n` +
                            `*Use \`globalconfig set <key> <value>\` to modify*`
                        )
                    );
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            if (action === 'set') {
                if (!key || value === '') {
                    return message.reply(require('../../utils/ownerUI').errReply('Invalid Usage', 'Usage: `globalconfig set <key> <value>`'));
                }
                if (!VALID_KEYS.includes(key)) {
                    return message.reply(require('../../utils/ownerUI').errReply('Invalid Key', `Invalid key. Valid keys: ${VALID_KEYS.join(', ')}`));
                }

                let parsedValue = value;
                if (key === 'maintenanceMode' || key === 'developerMode') {
                    parsedValue = ['true', '1', 'on', 'yes', 'enable'].includes(value.toLowerCase());
                } else if (key === 'maxGuilds' || key === 'commandCooldown') {
                    parsedValue = parseInt(value, 10);
                    if (!Number.isFinite(parsedValue) || parsedValue < 0) {
                        return message.reply(require('../../utils/ownerUI').errReply('Invalid Value', 'Value must be a non-negative number.'));
                    }
                } else if (key === 'embedColor') {
                    if (!/^#?[0-9a-fA-F]{6}$/.test(value)) {
                        return message.reply(require('../../utils/ownerUI').errReply('Invalid Color', 'Embed color must be a 6-digit hex (e.g. `#0099ff`).'));
                    }
                    parsedValue = value.startsWith('#') ? value : `#${value}`;
                }

                config[key] = parsedValue;
                saveConfig(config);
                return message.reply(`<:Checkedbox:1521227734943269077> Set **${key}** to \`${parsedValue}\``);
            }

            if (action === 'reset') {
                // Replace stored config with defaults rather than deleting a non-existent file.
                const defaults = getDefaults();
                saveConfig(defaults);
                return message.reply('<:Checkedbox:1521227734943269077> Global configuration reset to defaults.');
            }

            return message.reply(require('../../utils/ownerUI').errReply('Invalid Action', 'Invalid action. Use `view`, `set`, or `reset`.'));
        } catch (error) {
            return message.reply(require('../../utils/ownerUI').errReply('Error', `Error managing global config: ${error.message}`));
        }
    }
};
