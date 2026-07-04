const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { buildErrorResponse } = require('../../utils/responseBuilder');
const { paginate, setupPaginationCollector } = require('../../utils/pagination');
const { createContainer, addTextDisplay, addSeparator } = require('../../utils/componentHelpers');

const jsonStore = require('../../utils/jsonStore');

function loadConfig() {
    if (!jsonStore.has('modlogs')) {
        jsonStore.write('modlogs', {});
        return {};
    }
    return jsonStore.read('modlogs');
}

async function sendCases(replyTarget, guildId, userId) {
    const config = loadConfig();
    const guildLogs = config[guildId] || {};
    const allCases = [];

    for (const uId in guildLogs) {
        for (const log of guildLogs[uId]) {
            allCases.push({ ...log, userId: uId });
        }
    }

    if (allCases.length === 0) {
        const container = createContainer(0xCAD7E6);
        addTextDisplay(container, `# <:Checkedbox:1521227734943269077> No Cases\n\nNo moderation cases found for this server.`);
        addSeparator(container);
        return replyTarget.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    const sortedCases = allCases.sort((a, b) => b.timestamp - a.timestamp);

    const allLines = sortedCases.map((log, i) =>
        `**Case ${i + 1}:** ${log.action}\n> **User:** <@${log.userId}>\n> **Moderator:** ${log.moderator}\n> **Reason:** ${log.reason || 'No reason'}\n> **Date:** <t:${Math.floor(log.timestamp / 1000)}:f>`
    );

    const result = paginate({
        header: `# <:Bookopen:1521227911137595605> Recent Moderation Cases\n-# ${allCases.length} total case${allCases.length !== 1 ? 's' : ''}`,
        lines: allLines,
        perPage: 5,
        accentColor: 0xCAD7E6 });

    const reply = await replyTarget.reply(result);
    setupPaginationCollector(reply, result._pageData, userId);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('cases')
        .setDescription('View all moderation cases')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    prefix: 'cases',
    description: 'View all moderation cases',
    usage: 'cases',
    category: 'admin',

    async execute(interaction) {
        try {
            await sendCases(interaction, interaction.guild.id, interaction.user.id);
        } catch (error) {
            console.error('[Cases] Error:', error);
            const container = buildErrorResponse('Error', 'An error occurred while executing this command.', error.message);
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }
    },

    async executePrefix(message) {
        if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            const container = createContainer(0xCAD7E6);
            addTextDisplay(container, `# <:Cancel:1521227723916181644> Permission Denied\n\nYou need the **Moderate Members** permission!`);
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        try {
            await sendCases(message, message.guild.id, message.author.id);
        } catch (error) {
            console.error('[Cases] Error:', error);
            const container = buildErrorResponse('Error', 'An error occurred while executing this command.', error.message);
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
