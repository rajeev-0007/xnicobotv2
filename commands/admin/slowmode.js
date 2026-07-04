const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { buildSuccessResponse, buildErrorResponse, buildPermissionDenied, buildInvalidUsage } = require('../../utils/responseBuilder');

function formatDuration(seconds) {
    if (seconds === 0) return 'Disabled';
    if (seconds < 60) return `${seconds} second${seconds !== 1 ? 's' : ''}`;
    if (seconds < 3600) {
        const mins = Math.floor(seconds / 60);
        return `${mins} minute${mins !== 1 ? 's' : ''}`;
    }
    const hours = Math.floor(seconds / 3600);
    return `${hours} hour${hours !== 1 ? 's' : ''}`;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('slowmode')
        .setDescription('Set slowmode for the channel')
        .addIntegerOption(option =>
            option.setName('seconds')
                .setDescription('Slowmode duration in seconds (0 to disable, max 21600)')
                .setRequired(true)
                .setMinValue(0)
                .setMaxValue(21600))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    
    prefix: 'slowmode',
    description: 'Set slowmode for the channel',
    usage: 'slowmode <seconds>',
    category: 'admin',
    
    async execute(interaction) {
        const seconds = interaction.options.getInteger('seconds');

        try {
            await interaction.channel.setRateLimitPerUser(seconds);
            
            if (seconds === 0) {
                const container = buildSuccessResponse(
                    'Slowmode Disabled',
                    `Slowmode has been disabled for this channel.`,
                    {
                        'Channel': `${interaction.channel}`,
                        'Moderator': `${interaction.user.username}`
                    },
                    true
                );
                await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            } else {
                const container = buildSuccessResponse(
                    'Slowmode Enabled',
                    `Slowmode has been enabled for this channel.`,
                    {
                        'Duration': formatDuration(seconds),
                        'Channel': `${interaction.channel}`,
                        'Moderator': `${interaction.user.username}`
                    },
                    true
                );
                await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }
        } catch (error) {
            console.error('Slowmode Error:', error);
            const container = buildErrorResponse(
                'Failed to Set Slowmode',
                'An error occurred while setting slowmode.',
                `Error: ${error.message}`
            );
            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }
    },

    async executePrefix(message, args) {
        if (!message.guild) return message.reply('<:Cancel:1521227723916181644> This command can only be used in a server.').catch(() => {});
        if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
            const container = buildPermissionDenied('Manage Channels');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const seconds = parseInt(args[0]);
        if (!args[0] || isNaN(seconds) || seconds < 0 || seconds > 21600) {
            const container = buildInvalidUsage(
                'slowmode',
                '-slowmode <seconds>',
                ['-slowmode 5', '-slowmode 60', '-slowmode 0 (to disable)']
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        try {
            await message.channel.setRateLimitPerUser(seconds);
            
            if (seconds === 0) {
                const container = buildSuccessResponse(
                    'Slowmode Disabled',
                    `Slowmode has been disabled for this channel.`,
                    {
                        'Channel': `${message.channel}`,
                        'Moderator': `${message.author.username}`
                    },
                    true
                );
                await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            } else {
                const container = buildSuccessResponse(
                    'Slowmode Enabled',
                    `Slowmode has been enabled for this channel.`,
                    {
                        'Duration': formatDuration(seconds),
                        'Channel': `${message.channel}`,
                        'Moderator': `${message.author.username}`
                    },
                    true
                );
                await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }
        } catch (error) {
            console.error('Slowmode Error:', error);
            const container = buildErrorResponse(
                'Failed to Set Slowmode',
                'An error occurred while setting slowmode.',
                `Error: ${error.message}`
            );
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
