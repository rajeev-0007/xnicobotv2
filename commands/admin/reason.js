const { PermissionFlagsBits, MessageFlags } = require('discord.js');
const { buildSuccessResponse, buildErrorResponse, buildPermissionDenied, buildInvalidUsage } = require('../../utils/responseBuilder');

const jsonStore = require('../../utils/jsonStore');

function loadModlogs() {
    if (jsonStore.has('modlogs')) {
        return jsonStore.read('modlogs');
    }
    return {};
}

function saveModlogs(data) {
    jsonStore.write('modlogs', data);
}

module.exports = {
    prefix: 'reason',
    name: 'reason',
    description: 'Update the reason for a moderation case',
    usage: 'reason <@user> <case#> <new reason>',
    category: 'admin',
    aliases: ['editreason', 'casereason'],

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            const container = buildPermissionDenied('Moderate Members');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        try {
        const user = message.mentions.users.first();
        if (!user) {
            const container = buildInvalidUsage('reason', 'reason <@user> <case#> <new reason>', [
                'reason @User 1 Spamming in chat',
                'reason @User 3 Updated: Repeated offense'
            ]);
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        // Find the case number arg (skip mention)
        const nonMentionArgs = args.filter(a => !a.startsWith('<@'));
        const caseNumber = parseInt(nonMentionArgs[0]);

        if (!caseNumber || isNaN(caseNumber) || caseNumber < 1) {
            const container = buildErrorResponse(
                'Invalid Case Number',
                'Please provide a valid case number (positive integer).',
                'Use `modlogs @user` to see available case numbers.'
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const newReason = nonMentionArgs.slice(1).join(' ');

        if (!newReason) {
            const container = buildErrorResponse(
                'Missing Reason',
                'Please provide a new reason for the case.',
                'Example: `reason @User 1 Spamming in general chat`'
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const config = loadModlogs();
        const guildLogs = config[message.guild.id] || {};
        const userLogs = guildLogs[user.id] || [];

        if (userLogs.length === 0) {
            const container = buildErrorResponse(
                'No Cases Found',
                `**${user.username}** has no moderation cases in this server.`
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (caseNumber > userLogs.length) {
            const container = buildErrorResponse(
                'Invalid Case Number',
                `Case #${caseNumber} does not exist for **${user.username}**.`,
                `This user has **${userLogs.length}** case(s). Use a number between 1 and ${userLogs.length}.`
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const oldReason = userLogs[caseNumber - 1].reason || 'No reason provided';
        userLogs[caseNumber - 1].reason = newReason;
        guildLogs[user.id] = userLogs;
        config[message.guild.id] = guildLogs;

        saveModlogs(config);

        const container = buildSuccessResponse(
            'Case Reason Updated',
            `Successfully updated the reason for case **#${caseNumber}** of **${user.username}**.`,
            {
                'User': `${user.username}`,
                'Case': `#${caseNumber}`,
                'Old Reason': oldReason,
                'New Reason': newReason,
                'Updated By': `${message.author.username}`
            }
        );
        return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
        } catch (error) {
            console.error('[Reason] Error:', error);
            const container = buildErrorResponse('Error', 'An error occurred while executing this command.', error.message);
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
