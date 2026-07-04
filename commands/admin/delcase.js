const { PermissionFlagsBits, MessageFlags } = require('discord.js');
const { buildErrorResponse } = require('../../utils/responseBuilder');

const jsonStore = require('../../utils/jsonStore');
module.exports = {
    usage: 'delcase',
    category: 'admin',
    name: 'delcase',
    prefix: 'delcase',
    description: 'Delete a moderation case',
    async executePrefix(message, args) {
        if (!message.guild) return message.reply(require('../../utils/adminUI').errReply('Not In A Server', 'This command can only be used in a server.')).catch(() => {});
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply(require('../../utils/adminUI').errReply('Missing Permission', 'You need the **Administrator** permission.'));
        }

        try {
        const user = message.mentions.users.first();
        const caseNumber = parseInt(args[0]) || 1;

        if (!user) {
            return message.reply(require('../../utils/adminUI').errReply('Invalid Usage', 'Please mention a user and specify a case number.'));
        }

        let config = {};

        if (jsonStore.has('modlogs')) {
            config = jsonStore.read('modlogs');
        }

        const guildLogs = config[message.guild.id] || {};
        const userLogs = guildLogs[user.id] || [];

        if (caseNumber < 1 || caseNumber > userLogs.length) {
            return message.reply(require('../../utils/adminUI').errReply('Invalid Case', 'Invalid case number.'));
        }

        userLogs.splice(caseNumber - 1, 1);
        guildLogs[user.id] = userLogs;
        config[message.guild.id] = guildLogs;

        jsonStore.write('modlogs', config);

        await message.reply(`<:Checkedbox:1521227734943269077> Deleted case #${caseNumber} for **${user.username}**`);
        } catch (error) {
            console.error('[DelCase] Error:', error);
            const container = buildErrorResponse('Error', 'An error occurred while executing this command.', error.message);
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
