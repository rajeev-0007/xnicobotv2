const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const { buildSuccessResponse, buildErrorResponse, buildPermissionDenied, buildInvalidUsage, buildUserNotFound } = require('../../utils/responseBuilder');

const jsonStore = require('../../utils/jsonStore');
module.exports = {
    data: null,
    prefix: 'clearwarnings',
    description: 'Clear all warnings for a user',
    usage: 'clearwarnings <@user>',
    category: 'admin',
    aliases: ['clearwarns', 'delwarnings'],

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            const container = buildPermissionDenied('Moderate Members');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const user = message.mentions.users.first();
        if (!user) {
            const container = buildInvalidUsage(
                'clearwarnings',
                '-clearwarnings @user',
                ['-clearwarnings @User', '-clearwarnings @JohnDoe']
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        
        if (!jsonStore.has('warnings')) {
            const container = buildErrorResponse(
                'No Warnings Found',
                `**${user.username}** has no warnings to clear.`
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        let warnings;
        try {
            warnings = jsonStore.read('warnings');
        } catch (e) {
            warnings = {};
        }
        
        if (!warnings[message.guild.id]?.[user.id] || warnings[message.guild.id][user.id].length === 0) {
            const container = buildErrorResponse(
                'No Warnings Found',
                `**${user.username}** has no warnings to clear.`
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const clearedCount = warnings[message.guild.id][user.id].length;
        delete warnings[message.guild.id][user.id];
        
        jsonStore.write('warnings', warnings);

        const container = buildSuccessResponse(
            'Warnings Cleared',
            `Successfully cleared all warnings for the user.`,
            {
                'User': `${user.username}`,
                'Warnings Cleared': `${clearedCount}`,
                'Cleared By': `${message.author.username}`
            },
            true
        );

        await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
};
