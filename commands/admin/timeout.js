const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { buildSuccessResponse, buildErrorResponse, buildPermissionDenied, buildUserNotFound, buildInvalidUsage, buildModerationResponse } = require('../../utils/responseBuilder');

function parseDuration(input) {
    if (!input) return null;
    
    const match = input.match(/^(\d+)\s*(s|sec|second|seconds|m|min|minute|minutes|h|hr|hour|hours|d|day|days)?$/i);
    if (!match) {
        const num = parseInt(input);
        if (!isNaN(num) && num > 0) return num * 60 * 1000; // default to minutes
        return null;
    }
    
    const value = parseInt(match[1]);
    const unit = (match[2] || 'm').toLowerCase();
    
    let ms;
    if (unit.startsWith('s')) ms = value * 1000;
    else if (unit.startsWith('m')) ms = value * 60 * 1000;
    else if (unit.startsWith('h')) ms = value * 60 * 60 * 1000;
    else if (unit.startsWith('d')) ms = value * 24 * 60 * 60 * 1000;
    else ms = value * 60 * 1000;
    
    // Discord max timeout is 28 days
    const maxMs = 28 * 24 * 60 * 60 * 1000;
    if (ms > maxMs || ms < 1000) return null;
    
    return ms;
}

function formatMs(ms) {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds} second${seconds !== 1 ? 's' : ''}`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
    const hours = Math.floor(minutes / 60);
    const remainingMins = minutes % 60;
    if (hours < 24) {
        if (remainingMins === 0) return `${hours} hour${hours !== 1 ? 's' : ''}`;
        return `${hours}h ${remainingMins}m`;
    }
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    if (remainingHours === 0) return `${days} day${days !== 1 ? 's' : ''}`;
    return `${days}d ${remainingHours}h`;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('timeout')
        .setDescription('Timeout a member for a specified duration')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to timeout')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('duration')
                .setDescription('Duration (e.g. 10m, 1h, 2d, 30s)')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for the timeout')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    
    prefix: 'timeout',
    description: 'Timeout a member for a specified duration (supports s/m/h/d)',
    usage: 'timeout <@user> <duration> [reason]',
    category: 'admin',
    aliases: ['to'],
    
    async execute(interaction) {
        const user = interaction.options.getUser('user');
        const durationStr = interaction.options.getString('duration');
        const reason = interaction.options.getString('reason') || 'No reason provided';
        
        const durationMs = parseDuration(durationStr);
        if (!durationMs) {
            const container = buildErrorResponse(
                'Invalid Duration',
                'Please provide a valid duration.',
                'Examples: `30s`, `10m`, `1h`, `2d` (max 28 days)'
            );
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        let member;
        try {
            member = await interaction.guild.members.fetch(user.id);
        } catch (e) {
            const container = buildUserNotFound(user.username);
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        if (user.id === interaction.user.id) {
            const container = buildErrorResponse('Cannot Timeout Yourself', 'You cannot timeout yourself.');
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        if (user.id === interaction.client.user.id) {
            const container = buildErrorResponse('Cannot Timeout Me', 'You cannot timeout me.');
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        if (user.id === interaction.guild.ownerId) {
            const container = buildErrorResponse('Cannot Timeout Owner', 'You cannot timeout the server owner.');
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        if (!member.moderatable) {
            const container = buildErrorResponse(
                'Cannot Timeout User',
                'I cannot timeout this user. They may have a higher role than me or have special permissions.',
                'Make sure my role is above the user\'s highest role.'
            );
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        try {
            await member.timeout(durationMs, `${reason} | Timed out by ${interaction.user.username}`);
            
            const container = buildModerationResponse(
                'timeout',
                `${user.username} (${user.id})`,
                `${interaction.user.username}`,
                reason,
                formatMs(durationMs)
            );
            
            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('Timeout Error:', error);
            const container = buildErrorResponse(
                'Timeout Failed',
                'Failed to timeout the user.',
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
                'timeout',
                '-timeout @user <duration> [reason]',
                ['-timeout @User 10m Spamming', '-timeout @Troll 1h Being disruptive', '-timeout @User 2d Repeated violations']
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const durationMs = parseDuration(args[1]);
        if (!durationMs) {
            const container = buildErrorResponse(
                'Invalid Duration',
                'Please provide a valid duration.',
                'Examples: `30s`, `10m`, `1h`, `2d` (max 28 days)'
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const reason = args.slice(2).join(' ') || 'No reason provided';

        if (member.id === message.author.id) {
            const container = buildErrorResponse('Cannot Timeout Yourself', 'You cannot timeout yourself.');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (member.id === message.client.user.id) {
            const container = buildErrorResponse('Cannot Timeout Me', 'You cannot timeout me.');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (member.id === message.guild.ownerId) {
            const container = buildErrorResponse('Cannot Timeout Owner', 'You cannot timeout the server owner.');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (!member.moderatable) {
            const container = buildErrorResponse(
                'Cannot Timeout User',
                'I cannot timeout this user. They may have a higher role than me.',
                'Ensure my role is positioned above the target user\'s role.'
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        try {
            await member.timeout(durationMs, `${reason} | Timed out by ${message.author.username}`);
            
            const container = buildModerationResponse(
                'timeout',
                `${member.user.username} (${member.id})`,
                `${message.author.username}`,
                reason,
                formatMs(durationMs)
            );
            
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('Timeout Error:', error);
            const container = buildErrorResponse(
                'Timeout Failed',
                'Failed to timeout the user.',
                `Error: ${error.message}`
            );
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
