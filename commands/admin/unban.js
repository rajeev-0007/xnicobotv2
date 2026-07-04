const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { buildSuccessResponse, buildErrorResponse, buildPermissionDenied, buildInvalidUsage, buildModerationResponse } = require('../../utils/responseBuilder');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unban')
        .setDescription('Unban a user from the server')
        .addStringOption(option =>
            option.setName('user')
                .setDescription('The user ID or username#discriminator to unban')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for unbanning')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
    
    prefix: 'unban',
    description: 'Unban a user from the server',
    usage: 'unban <userID> [reason]',
    category: 'admin',
    
    async execute(interaction) {
        const userInput = interaction.options.getString('user');
        const reason = interaction.options.getString('reason') || 'No reason provided';

        try {
            // Try to find the ban first
            const bans = await interaction.guild.bans.fetch();
            let bannedUser = null;

            // Try by ID first
            if (/^\d{17,20}$/.test(userInput)) {
                const ban = bans.get(userInput);
                if (ban) bannedUser = ban.user;
            }

            // If not found by ID, try by username
            if (!bannedUser) {
                const ban = bans.find(b =>
                    b.user.username.toLowerCase() === userInput.toLowerCase()
                );
                if (ban) bannedUser = ban.user;
            }

            if (!bannedUser) {
                const container = buildErrorResponse(
                    'User Not Found',
                    'Could not find a banned user with that ID or username.',
                    'Use a valid user ID or username. Check the ban list with the audit log.'
                );
                return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }

            await interaction.guild.members.unban(bannedUser.id, `${reason} | Unbanned by ${interaction.user.username}`);

            const container = buildModerationResponse(
                'unban',
                `${bannedUser.username} (${bannedUser.id})`,
                `${interaction.user.username}`,
                reason
            );

            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('Unban Error:', error);
            const container = buildErrorResponse(
                'Unban Failed',
                'Failed to unban the user.',
                `Error: ${error.message}`
            );
            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }
    },

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.BanMembers)) {
            const container = buildPermissionDenied('Ban Members');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (!args[0]) {
            const container = buildInvalidUsage(
                'unban',
                '-unban <userID> [reason]',
                ['-unban 123456789012345678', '-unban 123456789012345678 Appealed']
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const userInput = args[0];
        const reason = args.slice(1).join(' ') || 'No reason provided';

        try {
            const bans = await message.guild.bans.fetch();
            let bannedUser = null;

            // Try by ID first
            if (/^\d{17,20}$/.test(userInput)) {
                const ban = bans.get(userInput);
                if (ban) bannedUser = ban.user;
            }

            // If not found by ID, try by username
            if (!bannedUser) {
                const ban = bans.find(b =>
                    b.user.username.toLowerCase() === userInput.toLowerCase()
                );
                if (ban) bannedUser = ban.user;
            }

            if (!bannedUser) {
                const container = buildErrorResponse(
                    'User Not Found',
                    'Could not find a banned user with that ID or username.',
                    'Use a valid user ID or username. Check the ban list with the audit log.'
                );
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            await message.guild.members.unban(bannedUser.id, `${reason} | Unbanned by ${message.author.username}`);

            const container = buildModerationResponse(
                'unban',
                `${bannedUser.username} (${bannedUser.id})`,
                `${message.author.username}`,
                reason
            );

            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('Unban Error:', error);
            const container = buildErrorResponse(
                'Unban Failed',
                'Failed to unban the user.',
                `Error: ${error.message}`
            );
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
