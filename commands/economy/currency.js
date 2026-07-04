const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize } = require('discord.js');
const jsonStore = require('../../utils/jsonStore');
const { getCurrency, getCurrencyName, formatCoins, formatCoinsShort, DEFAULT_CURRENCY, DEFAULT_CURRENCY_NAME } = require('../../utils/currencyHelper');
const { buildPermissionDenied, buildSuccessResponse } = require('../../utils/responseBuilder');

function loadSettings() {
    if (!jsonStore.has('economy-settings')) { jsonStore.write('economy-settings', {}); return {}; }
    return jsonStore.read('economy-settings');
}
function saveSettings(data) { jsonStore.write('economy-settings', data); }

module.exports = {
    /**
     * Premium-gated feature. `premiumOnly` is read by the
     * command dispatcher in index.js — non-premium users get a
     * polite message instead of execution.
     */
    premiumOnly: true,

    data: new SlashCommandBuilder()
        .setName('currency')
        .setDescription('Customize the server currency symbol and name')
        .addSubcommand(sub => sub
            .setName('set')
            .setDescription('Set a custom currency symbol and name')
            .addStringOption(o => o.setName('symbol').setDescription('Currency emoji/symbol (e.g. <:Sketch:1521228025365004471>, <:Money:1521228266957045900>, ⛃, $)').setRequired(true))
            .addStringOption(o => o.setName('name').setDescription('Currency name (e.g. gems, gold, credits)').setRequired(false)))
        .addSubcommand(sub => sub
            .setName('reset')
            .setDescription(`Reset currency to default (${DEFAULT_CURRENCY} ${DEFAULT_CURRENCY_NAME})`))
        .addSubcommand(sub => sub
            .setName('view')
            .setDescription('View current currency settings'))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    prefix: 'currency',
    description: 'Customize the server currency symbol and name',
    usage: 'currency <set|reset|view> [symbol] [name]',
    category: 'economy',
    aliases: ['setcurrency', 'currencystyle'],

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guild.id;

        if (sub === 'set') {
            const symbol = interaction.options.getString('symbol').trim().slice(0, 32);
            const name = (interaction.options.getString('name') || 'coins').trim().slice(0, 32).toLowerCase();

            const settings = loadSettings();
            if (!settings[guildId]) settings[guildId] = {};
            settings[guildId].currency = symbol;
            settings[guildId].currencyName = name;
            saveSettings(settings);

            const container = buildSuccessResponse('Currency Updated', `Your server now uses a custom currency style.`, {
                'Symbol': symbol,
                'Name': name,
                'Example': formatCoins(1500, guildId)
            });
            container.setAccentColor(0x57F287);
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (sub === 'reset') {
            const settings = loadSettings();
            if (settings[guildId]) {
                delete settings[guildId].currency;
                delete settings[guildId].currencyName;
                saveSettings(settings);
            }

            const container = buildSuccessResponse('Currency Reset', 'Currency has been reset to the default.', {
                'Symbol': DEFAULT_CURRENCY,
                'Name': DEFAULT_CURRENCY_NAME,
                'Example': `${DEFAULT_CURRENCY} 1,500 ${DEFAULT_CURRENCY_NAME}`
            });
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (sub === 'view') {
            const symbol = getCurrency(guildId);
            const name = getCurrencyName(guildId);
            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# <:Money:1521228266957045900> Currency Settings\n\n` +
                    `**Symbol:** ${symbol}\n` +
                    `**Name:** ${name}\n` +
                    `**Example:** ${formatCoins(2500, guildId)}\n\n` +
                    `-# Use \`/currency set\` to customize`
                ));
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    },

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return message.reply({ components: [buildPermissionDenied('Manage Server')], flags: MessageFlags.IsComponentsV2 });
        }

        const sub = (args[0] || '').toLowerCase();
        const guildId = message.guild.id;

        if (sub === 'set') {
            const symbol = (args[1] || '').trim().slice(0, 32);
            const name = (args[2] || 'coins').trim().slice(0, 32).toLowerCase();
            if (!symbol) {
                const container = new ContainerBuilder()
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                        `# <:Money:1521228266957045900> Currency Set\n\nUsage: \`-currency set <symbol> [name]\`\n\nExamples:\n> \`-currency set <:Sketch:1521228025365004471> gems\`\n> \`-currency set <:Money:1521228266957045900> gold\`\n> \`-currency set $ credits\``
                    ));
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            const settings = loadSettings();
            if (!settings[guildId]) settings[guildId] = {};
            settings[guildId].currency = symbol;
            settings[guildId].currencyName = name;
            saveSettings(settings);

            const container = buildSuccessResponse('Currency Updated', `Your server now uses a custom currency style.`, {
                'Symbol': symbol,
                'Name': name,
                'Example': formatCoins(1500, guildId)
            });
            container.setAccentColor(0x57F287);
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (sub === 'reset') {
            const settings = loadSettings();
            if (settings[guildId]) {
                delete settings[guildId].currency;
                delete settings[guildId].currencyName;
                saveSettings(settings);
            }
            const container = buildSuccessResponse('Currency Reset', `Currency has been reset to the default (${DEFAULT_CURRENCY} ${DEFAULT_CURRENCY_NAME}).`);
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        // Default: view
        const symbol = getCurrency(guildId);
        const name = getCurrencyName(guildId);
        const container = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `# <:Money:1521228266957045900> Currency Settings\n\n` +
                `**Symbol:** ${symbol}\n` +
                `**Name:** ${name}\n` +
                `**Example:** ${formatCoins(2500, guildId)}\n\n` +
                `### Commands\n` +
                `> \`-currency set <symbol> [name]\` — Set custom currency\n` +
                `> \`-currency reset\` — Reset to default\n` +
                `> \`-currency view\` — View current settings`
            ));
        return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
};
