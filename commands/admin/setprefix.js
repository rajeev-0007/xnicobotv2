const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { buildSuccessResponse, buildErrorResponse, buildPermissionDenied, buildInvalidUsage, COLORS } = require('../../utils/responseBuilder');

const jsonStore = require('../../utils/jsonStore');

function loadPrefixes() {
    if (jsonStore.has('prefixes')) {
        return jsonStore.read('prefixes');
    }
    return {};
}

function savePrefixes(data) {
    // Prefix changes are rare but important — persist immediately so a
    // restart inside the 30s debounce window can't silently revert the
    // server back to the default prefix.
    jsonStore.writeImmediate('prefixes', data).catch(() => {});
}

function syncBotCustomizePrefix(guildId, newPrefix) {
    try {
        let customConfig = {};
        if (jsonStore.has('bot-customize')) {
            customConfig = jsonStore.read('bot-customize');
        }
        if (customConfig[guildId]) {
            customConfig[guildId].prefix = newPrefix;
            jsonStore.writeImmediate('bot-customize', customConfig).catch(() => {});
        }
    } catch (e) {}
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setprefix')
        .setDescription('Set a custom prefix for this server')
        .addStringOption(opt => opt.setName('prefix').setDescription('New prefix (1-5 characters)').setRequired(true).setMaxLength(5).setMinLength(1)),
    prefix: 'setprefix',
    name: 'setprefix',
    description: 'Set a custom prefix for this server',
    usage: 'setprefix <new prefix>',
    category: 'admin',
    aliases: ['prefix', 'changeprefix', 'resetprefix'],

    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            const container = buildPermissionDenied('Administrator');
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        const newPrefix = interaction.options.getString('prefix').trim();

        const config = loadPrefixes();
        config[interaction.guild.id] = newPrefix;
        savePrefixes(config);
        syncBotCustomizePrefix(interaction.guild.id, newPrefix);

        const container = buildSuccessResponse(
            'Prefix Updated',
            `Server prefix has been changed to **${newPrefix}**`,
            {
                'New Prefix': `\`${newPrefix}\``,
                'Example': `\`${newPrefix}help\``,
                'Changed By': `${interaction.user.username}`
            },
            true
        );
        return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    },

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            const container = buildPermissionDenied('Administrator');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        try {
        const newPrefix = args[0];

        // Handle reset: -resetprefix or -setprefix reset
        const isResetAlias = message.content.trim().split(/ +/)[0].toLowerCase().endsWith('resetprefix');
        if (!newPrefix || newPrefix === 'reset' || isResetAlias) {
            if (newPrefix === 'reset' || isResetAlias) {
                const config = loadPrefixes();
                delete config[message.guild.id];
                savePrefixes(config);
                syncBotCustomizePrefix(message.guild.id, null);

                const container = buildSuccessResponse(
                    'Prefix Reset',
                    `Server prefix has been reset to the **default** prefix`,
                    {
                        'Prefix': `\`${process.env.PREFIX || '-'}\``,
                        'Reset By': `${message.author.username}`
                    },
                    true
                );
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            const container = buildInvalidUsage('setprefix', 'setprefix <new prefix>', [
                'setprefix !',
                'setprefix ?',
                'setprefix >>',
                'setprefix reset'
            ]);
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (newPrefix.length > 5) {
            const container = buildErrorResponse(
                'Invalid Prefix',
                'The prefix must be **5 characters or less**!',
                `Your input was ${newPrefix.length} characters long.`
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const config = loadPrefixes();
        config[message.guild.id] = newPrefix;
        savePrefixes(config);
        syncBotCustomizePrefix(message.guild.id, newPrefix);

        const container = buildSuccessResponse(
            'Prefix Updated',
            `Server prefix has been changed to **${newPrefix}**`,
            {
                'New Prefix': `\`${newPrefix}\``,
                'Example': `\`${newPrefix}help\``,
                'Changed By': `${message.author.username}`
            },
            true
        );
        return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
        } catch (error) {
            console.error('[SetPrefix] Error:', error);
            const container = buildErrorResponse('Error', 'An error occurred while executing this command.', error.message);
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
