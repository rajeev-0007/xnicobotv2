const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { buildPermissionDenied, buildInvalidUsage, buildErrorResponse } = require('../../utils/responseBuilder');
const { paginate, setupPaginationCollector } = require('../../utils/pagination');
const { createContainer, addTextDisplay, addSeparator } = require('../../utils/componentHelpers');

const jsonStore = require('../../utils/jsonStore');
function getUserLogs(guildId, userId) {
    let config = {};

    if (jsonStore.has('modlogs')) {
        config = jsonStore.read('modlogs');
    }

    const guildLogs = config[guildId] || {};
    return guildLogs[userId] || [];
}

async function sendModHistory(replyTarget, user, guildId, callerId) {
    const logs = getUserLogs(guildId, user.id);

    if (logs.length === 0) {
        const container = createContainer(0xCAD7E6);
        addTextDisplay(container, `# <:Checkedbox:1521227734943269077> Clean Record\n\n**${user.username}** has no moderation history!`);
        addSeparator(container);
        return replyTarget.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    const allLines = logs.slice().reverse().map((log, i) => {
        const num = logs.length - i;
        return `**${num}.** ${log.action}\n> *Reason:* ${log.reason || 'No reason'}\n> *By:* ${log.moderator} — <t:${Math.floor(log.timestamp / 1000)}:R>`;
    });

    const result = paginate({
        header: `# <:Bookopen:1521227911137595605> Moderation History — ${user.username}\n-# ${logs.length} total infraction${logs.length !== 1 ? 's' : ''}`,
        lines: allLines,
        perPage: 5,
        accentColor: 0xCAD7E6 });

    const reply = await replyTarget.reply(result);
    setupPaginationCollector(reply, result._pageData, callerId);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('modhistory')
        .setDescription('View moderation history of a user')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to check')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    prefix: 'modhistory',
    description: 'View moderation history of a user',
    usage: 'modhistory <@user>',
    category: 'admin',

    async execute(interaction) {
        try {
            const user = interaction.options.getUser('user');
            await sendModHistory(interaction, user, interaction.guild.id, interaction.user.id);
        } catch (error) {
            console.error('[ModHistory] Error:', error);
            const container = buildErrorResponse('Error', 'An error occurred while executing this command.', error.message);
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }
    },

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            const container = buildPermissionDenied('Moderate Members');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const user = message.mentions.users.first();
        if (!user) {
            const container = buildInvalidUsage('modhistory', '-modhistory @user', ['-modhistory @User']);
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        try {
            await sendModHistory(message, user, message.guild.id, message.author.id);
        } catch (error) {
            console.error('[ModHistory] Error:', error);
            const container = buildErrorResponse('Error', 'An error occurred while executing this command.', error.message);
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
