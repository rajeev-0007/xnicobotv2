const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { buildSuccessResponse, buildErrorResponse, buildPermissionDenied, buildUserNotFound, buildInvalidUsage, buildModerationResponse } = require('../../utils/responseBuilder');

function formatDuration(minutes) {
    if (minutes < 60) return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours < 24) {
        if (mins === 0) return `${hours} hour${hours !== 1 ? 's' : ''}`;
        return `${hours}h ${mins}m`;
    }
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    if (remainingHours === 0) return `${days} day${days !== 1 ? 's' : ''}`;
    return `${days}d ${remainingHours}h`;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('mute')
        .setDescription('Timeout a member (mute them temporarily)')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to mute')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('duration')
                .setDescription('Duration in minutes (max 28 days)')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(40320))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for muting')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    
    prefix: 'mute',
    description: 'Timeout a member (mute them temporarily)',
    usage: 'mute <@user> <duration_minutes> [reason]',
    category: 'admin',
    aliases: ['m', 'silence', 'stfu'],
    
    async execute(interaction) {
        const user = interaction.options.getUser('user');
        const duration = interaction.options.getInteger('duration');
        const reason = interaction.options.getString('reason') || 'No reason provided';
        
        let member;
        try {
            member = await interaction.guild.members.fetch(user.id);
        } catch (e) {
            const container = buildUserNotFound(user.username);
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        if (!member) {
            const container = buildUserNotFound(user.username);
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        if (user.id === interaction.user.id) {
            const container = buildErrorResponse('Cannot Mute Yourself', 'You cannot mute yourself.');
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        if (user.id === interaction.client.user.id) {
            const container = buildErrorResponse('Cannot Mute Me', 'You cannot mute me.');
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        if (user.id === interaction.guild.ownerId) {
            const container = buildErrorResponse('Cannot Mute Owner', 'You cannot mute the server owner.');
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        if (!member.moderatable) {
            const container = buildErrorResponse(
                'Cannot Mute User',
                'I cannot mute this user. They may have a higher role than me or have special permissions.',
                'Make sure my role is above the user\'s highest role.'
            );
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        try {
            const endTime = Date.now() + (duration * 60 * 1000);
            await member.timeout(duration * 60 * 1000, `${reason} | Muted by ${interaction.user.username}`);
            
            const container = buildModerationResponse(
                'mute',
                `${user.username} (${user.id})`,
                `${interaction.user.username}`,
                reason,
                formatDuration(duration)
            );
            
            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('Mute Error:', error);
            const container = buildErrorResponse(
                'Mute Failed',
                'Failed to mute the user.',
                `Error: ${error.message}`
            );
            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }
    },

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            const container = buildPermissionDenied('Moderate Members');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const member = message.mentions.members.first();
        if (!member) {
            const container = buildInvalidUsage(
                'mute',
                '-mute @user <minutes> [reason]',
                ['-mute @User 10 Spamming', '-mute @Troll 60 Being disruptive']
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const duration = parseInt(args[1]);
        if (isNaN(duration) || duration < 1 || duration > 40320) {
            const container = buildErrorResponse(
                'Invalid Duration',
                'Please provide a valid duration between 1 and 40320 minutes (28 days).',
                'Example: `-mute @user 60 reason` for a 1-hour mute'
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const reason = args.slice(2).join(' ') || 'No reason provided';

        if (member.id === message.author.id) {
            const container = buildErrorResponse('Cannot Mute Yourself', 'You cannot mute yourself.');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (member.id === message.client.user.id) {
            const container = buildErrorResponse('Cannot Mute Me', 'You cannot mute me.');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (member.id === message.guild.ownerId) {
            const container = buildErrorResponse('Cannot Mute Owner', 'You cannot mute the server owner.');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (!member.moderatable) {
            const container = buildErrorResponse(
                'Cannot Mute User',
                'I cannot mute this user. They may have a higher role than me.',
                'Ensure my role is positioned above the target user\'s role.'
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        try {
            await member.timeout(duration * 60 * 1000, `${reason} | Muted by ${message.author.username}`);
            
            const container = buildModerationResponse(
                'mute',
                `${member.user.username} (${member.id})`,
                `${message.author.username}`,
                reason,
                formatDuration(duration)
            );
            
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('Mute Error:', error);
            const container = buildErrorResponse(
                'Mute Failed',
                'Failed to mute the user.',
                `Error: ${error.message}`
            );
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
