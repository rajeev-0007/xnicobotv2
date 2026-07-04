const { PermissionFlagsBits, SlashCommandBuilder, MessageFlags } = require('discord.js');
const { buildModerationResponse, buildErrorResponse, buildPermissionDenied, buildInvalidUsage } = require('../../utils/responseBuilder');
const { confirmAction } = require('../../utils/confirmAction');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('hackban')
        .setDescription('Ban a user by their ID (even if they are not in the server)')
        .addStringOption(option =>
            option.setName('userid')
                .setDescription('The ID of the user to ban')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for the ban')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

    prefix: 'hackban',
    description: 'Ban a user by their ID (even if they are not in the server)',
    usage: 'hackban <user_id> [reason]',
    category: 'admin',

    async execute(interaction) {
        const userId = interaction.options.getString('userid');
        const reason = interaction.options.getString('reason') || 'No reason provided';

        if (!/^\d{17,19}$/.test(userId)) {
            const container = buildErrorResponse(
                'Invalid User ID',
                'Please provide a valid Discord user ID (17-19 digit number).',
                'You can get a user ID by enabling Developer Mode and right-clicking a user.'
            );
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        if (userId === interaction.user.id) {
            const container = buildErrorResponse('Cannot Ban Yourself', 'You cannot ban yourself.');
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        if (userId === interaction.client.user.id) {
            const container = buildErrorResponse('Cannot Ban Me', 'You cannot ban me.');
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        try {
            const bans = await interaction.guild.bans.fetch();
            if (bans.has(userId)) {
                const container = buildErrorResponse(
                    'User Already Banned',
                    'This user is already banned from this server.'
                );
                return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }

            // ── Confirmation prompt ──
            const { confirmed, button } = await confirmAction(interaction, false, {
                title: 'Confirm Hackban',
                description: `Are you sure you want to **ban** the user with ID \`${userId}\`?\n\nThis bans them even if they are not in the server.\n\n**Reason:** ${reason}`,
                confirmLabel: 'Hackban User',
            });
            if (!confirmed) return;

            await interaction.guild.members.ban(userId, { reason: `${reason} | Hackbanned by ${interaction.user.username}` });
            
            let user;
            try {
                user = await interaction.client.users.fetch(userId);
            } catch (e) {
                user = { username: 'Unknown User', id: userId };
            }
            
            const container = buildModerationResponse(
                'ban',
                `${user.username || 'Unknown'} (${userId})`,
                `${interaction.user.username}`,
                `${reason} (Hackban)`
            );
            
            await button.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            const container = buildErrorResponse(
                'Hackban Failed',
                'Failed to hackban the user.',
                `Error: ${error.message}`
            );
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }
        }
    },
    
    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.BanMembers)) {
            const container = buildPermissionDenied('Ban Members');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const userId = args[0];
        if (!userId) {
            const container = buildInvalidUsage(
                'hackban',
                '-hackban <user_id> [reason]',
                ['-hackban 123456789012345678', '-hackban 123456789012345678 Raiding']
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (!/^\d{17,19}$/.test(userId)) {
            const container = buildErrorResponse(
                'Invalid User ID',
                'Please provide a valid Discord user ID (17-19 digit number).'
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (userId === message.author.id) {
            const container = buildErrorResponse('Cannot Ban Yourself', 'You cannot ban yourself.');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (userId === message.client.user.id) {
            const container = buildErrorResponse('Cannot Ban Me', 'You cannot ban me.');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const reason = args.slice(1).join(' ') || 'No reason provided';

        try {
            const bans = await message.guild.bans.fetch();
            if (bans.has(userId)) {
                const container = buildErrorResponse(
                    'User Already Banned',
                    'This user is already banned from this server.'
                );
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            // ── Confirmation prompt ──
            const { confirmed, button } = await confirmAction(message, true, {
                title: 'Confirm Hackban',
                description: `Are you sure you want to **ban** the user with ID \`${userId}\`?\n\nThis bans them even if they are not in the server.\n\n**Reason:** ${reason}`,
                confirmLabel: 'Hackban User',
            });
            if (!confirmed) return;

            await message.guild.members.ban(userId, { reason: `${reason} | Hackbanned by ${message.author.username}` });
            
            let user;
            try {
                user = await message.client.users.fetch(userId);
            } catch (e) {
                user = { username: 'Unknown User', id: userId };
            }
            
            const container = buildModerationResponse(
                'ban',
                `${user.username || 'Unknown'} (${userId})`,
                `${message.author.username}`,
                `${reason} (Hackban)`
            );
            
            await button.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('Hackban Error:', error);
            const container = buildErrorResponse(
                'Hackban Failed',
                'Failed to hackban the user.',
                `Error: ${error.message}`
            );
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
