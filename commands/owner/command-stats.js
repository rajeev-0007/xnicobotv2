const { isOwner } = require('../../utils/helpers');
const { MessageFlags, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize } = require('discord.js');
const { paginate, setupPaginationCollector } = require('../../utils/pagination');
const { COLORS, EMOJIS } = require('../../utils/responseBuilder');

const jsonStore = require('../../utils/jsonStore');

function loadStats() {
    try {
        if (jsonStore.has('command-stats')) {
            return jsonStore.read('command-stats');
        }
    } catch {}
    return { commands: {}, totalExecutions: 0, lastReset: Date.now() };
}

function saveStats(data) {
    jsonStore.write('command-stats', data);
}

function trackCommand(commandName, userId, guildId) {
    const stats = loadStats();
    if (!stats.commands) stats.commands = {};
    if (!stats.commands[commandName]) {
        stats.commands[commandName] = { uses: 0, lastUsed: null, users: {}, guilds: {} };
    }

    stats.commands[commandName].uses++;
    stats.commands[commandName].lastUsed = Date.now();

    if (!stats.commands[commandName].users[userId]) stats.commands[commandName].users[userId] = 0;
    stats.commands[commandName].users[userId]++;

    if (guildId) {
        if (!stats.commands[commandName].guilds[guildId]) stats.commands[commandName].guilds[guildId] = 0;
        stats.commands[commandName].guilds[guildId]++;
    }

    stats.totalExecutions = (stats.totalExecutions || 0) + 1;
    saveStats(stats);
}

function buildCommandStatsDisplay(stats, client, filter) {
    const commands = Object.entries(stats.commands || {});

    if (commands.length === 0) {
        const container = new ContainerBuilder()
            .setAccentColor(COLORS.INFO)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `# <:Invoice:1521227903956811836> Command Statistics\n\n` +
                `${EMOJIS.WARNING} No command usage data recorded yet.\n\n` +
                `-# Commands will be tracked as they are used.`
            ))
            .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        return { components: [container], flags: MessageFlags.IsComponentsV2 };
    }

    let sorted;
    switch (filter) {
        case 'recent':
            sorted = commands.sort((a, b) => (b[1].lastUsed || 0) - (a[1].lastUsed || 0));
            break;
        case 'least':
            sorted = commands.sort((a, b) => a[1].uses - b[1].uses);
            break;
        default:
            sorted = commands.sort((a, b) => b[1].uses - a[1].uses);
    }

    const totalUses = stats.totalExecutions || sorted.reduce((acc, [, d]) => acc + d.uses, 0);
    const uniqueCommands = sorted.length;
    const topCommand = sorted[0] ? sorted[0][0] : 'None';
    const resetDate = stats.lastReset ? `<t:${Math.floor(stats.lastReset / 1000)}:R>` : 'Never';

    const lines = sorted.map(([name, data], i) => {
        const percentage = totalUses > 0 ? ((data.uses / totalUses) * 100).toFixed(1) : '0.0';
        const lastUsed = data.lastUsed ? `<t:${Math.floor(data.lastUsed / 1000)}:R>` : 'Never';
        const uniqueUsers = Object.keys(data.users || {}).length;
        const uniqueGuilds = Object.keys(data.guilds || {}).length;
        return `**${i + 1}.** \`${name}\` — **${data.uses.toLocaleString()}** uses (**${percentage}%**)\n> <:User:1521227714227343380> ${uniqueUsers} users • <:Home:1521228339736482056> ${uniqueGuilds} guilds • <:Alarm:1521227869047750689> ${lastUsed}`;
    });

    return paginate({
        header: `# <:Invoice:1521227903956811836> Command Statistics\n` +
            `-# **${totalUses.toLocaleString()}** total executions • **${uniqueCommands}** unique commands\n\n` +
            `### <:Star:1521227981685526568> Overview\n` +
            `> <:Caretright:1521227704953864202> **Top Command:** \`${topCommand}\`\n` +
            `> <:Caretright:1521227704953864202> **Tracking Since:** ${resetDate}\n` +
            `> <:Caretright:1521227704953864202> **Filter:** \`${filter || 'most-used'}\``,
        lines,
        perPage: 10,
        accentColor: COLORS.INFO });
}

function buildSingleCommandStats(stats, commandName) {
    const data = stats.commands?.[commandName];

    if (!data) {
        const container = new ContainerBuilder()
            .setAccentColor(COLORS.ERROR)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `# ${EMOJIS.ERROR} Command Not Found\n\n` +
                `No usage data found for \`${commandName}\`.\n` +
                `-# The command may not have been used yet or doesn't exist.`
            ));
        return { components: [container], flags: MessageFlags.IsComponentsV2 };
    }

    const lastUsed = data.lastUsed ? `<t:${Math.floor(data.lastUsed / 1000)}:f>` : 'Never';
    const uniqueUsers = Object.keys(data.users || {}).length;
    const uniqueGuilds = Object.keys(data.guilds || {}).length;

    const topUsers = Object.entries(data.users || {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([id, count], i) => `> **${i + 1}.** <@${id}> — **${count}** uses`)
        .join('\n');

    const topGuilds = Object.entries(data.guilds || {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([id, count], i) => `> **${i + 1}.** \`${id}\` — **${count}** uses`)
        .join('\n');

    let content = `# <:Invoice:1521227903956811836> Stats for \`${commandName}\`\n\n`;
    content += `### <:Document:1521227875016114266> Usage Info\n`;
    content += `> <:Caretright:1521227704953864202> **Total Uses:** ${data.uses.toLocaleString()}\n`;
    content += `> <:Caretright:1521227704953864202> **Last Used:** ${lastUsed}\n`;
    content += `> <:Caretright:1521227704953864202> **Unique Users:** ${uniqueUsers}\n`;
    content += `> <:Caretright:1521227704953864202> **Unique Guilds:** ${uniqueGuilds}\n`;

    if (topUsers) {
        content += `\n### <:User:1521227714227343380> Top Users\n${topUsers}\n`;
    }

    if (topGuilds) {
        content += `\n### <:Home:1521228339736482056> Top Guilds\n${topGuilds}\n`;
    }

    const container = new ContainerBuilder()
        .setAccentColor(COLORS.INFO)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
;
    return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

module.exports = {
    name: 'command-stats',
    prefix: 'command-stats',
    aliases: ['cmdstats', 'commandstats', 'cs'],
    description: 'View command usage statistics',
    usage: 'command-stats [command] [--filter most|least|recent] [--reset]',
    category: 'owner',
    ownerOnly: true,

    trackCommand,
    loadStats,
    saveStats,

    async executePrefix(message, args) {
        if (!isOwner(message.author.id)) {
            return message.reply(`${EMOJIS.ERROR} This command is only available to the bot owner!`);
        }

        if (args[0] === '--reset' || args[0] === 'reset') {
            saveStats({ commands: {}, totalExecutions: 0, lastReset: Date.now() });
            const container = new ContainerBuilder()
                .setAccentColor(COLORS.SUCCESS)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# ${EMOJIS.SUCCESS} Statistics Reset\n\nAll command usage statistics have been cleared.`
                ))
                .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const stats = loadStats();
        let filter = 'most';
        let commandName = null;

        for (let i = 0; i < args.length; i++) {
            if (args[i] === '--filter' && args[i + 1]) {
                filter = args[++i];
            } else {
                commandName = args[i];
            }
        }

        if (commandName) {
            const result = buildSingleCommandStats(stats, commandName);
            return message.reply(result);
        }

        const result = buildCommandStatsDisplay(stats, message.client, filter);
        const reply = await message.reply(result);
        if (result._pageData) setupPaginationCollector(reply, result._pageData, message.author.id);
    }
};
