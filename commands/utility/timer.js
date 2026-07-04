const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags,
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder
} = require('discord.js');
const { buildErrorResponse, buildSuccessResponse } = require('../../utils/responseBuilder');

// Store active timers
const activeTimers = new Map();

module.exports = {
    name: 'timer',
    prefix: 'timer',
    description: 'Set a timer with notifications',
    usage: 'timer <duration> [reason]',
    category: 'utility',
    aliases: ['settimer', 'countdown', 'remind'],

    data: new SlashCommandBuilder()
        .setName('timer')
        .setDescription('Set a timer with notifications')
        .addSubcommand(sub => sub
            .setName('set')
            .setDescription('Set a new timer')
            .addStringOption(opt => opt
                .setName('duration')
                .setDescription('Duration (e.g., 5m, 1h, 30s, 2h30m)')
                .setRequired(true))
            .addStringOption(opt => opt
                .setName('reason')
                .setDescription('What is this timer for?')
                .setMaxLength(200))
            .addBooleanOption(opt => opt
                .setName('ping')
                .setDescription('Ping you when timer ends? (default: no)')
                .setRequired(false))
            .addRoleOption(opt => opt
                .setName('pingrole')
                .setDescription('Optional role to ping when timer ends')
                .setRequired(false)))
        .addSubcommand(sub => sub
            .setName('list')
            .setDescription('List your active timers'))
        .addSubcommand(sub => sub
            .setName('cancel')
            .setDescription('Cancel a timer')
            .addStringOption(opt => opt
                .setName('id')
                .setDescription('Timer ID to cancel')
                .setRequired(true))),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'set') {
            const duration = interaction.options.getString('duration');
            const reason = interaction.options.getString('reason') || 'No reason provided';
            const ping = interaction.options.getBoolean('ping') ?? false; // Default to false (no ping)
            const pingRole = interaction.options.getRole('pingrole');
            await handleSetTimer(interaction, duration, reason, ping, pingRole, false);
        } else if (subcommand === 'list') {
            await handleListTimers(interaction, false);
        } else if (subcommand === 'cancel') {
            const timerId = interaction.options.getString('id');
            await handleCancelTimer(interaction, timerId, false);
        }
    },

    async executePrefix(message, args) {
        if (!args[0]) {
            const container = buildErrorResponse(
                'Timer Command',
                'Please specify an action!',
                '**Usage:**\n`timer set <duration> [reason]`\n`timer set <duration> --ping [reason]`\n`timer set <duration> --role @Role [reason]`\n`timer list`\n`timer cancel <id>`\n\n**Examples:**\n`timer set 5m Pizza in oven` (no ping)\n`timer set 1h30m --ping Meeting break` (ping user)\n`timer set 10s --role @Moderators Alert` (ping role)'
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const action = args[0].toLowerCase();

        if (['set', 'add', 'create'].includes(action)) {
            if (!args[1]) {
                const container = buildErrorResponse('Missing Duration', 'Please specify a duration!', '**Example:** `timer set 5m Pizza in oven`\n**With ping:** `timer set 5m --ping Pizza in oven`\n**With role ping:** `timer set 5m --role @RoleName Pizza`');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }
            const duration = args[1];

            // Check for --ping or --role flags
            let ping = false; // Default to false (no ping)
            let pingRole = null;
            let reasonArgs = args.slice(2);

            if (reasonArgs.includes('--ping')) {
                ping = true;
                reasonArgs = reasonArgs.filter(arg => arg !== '--ping');
            }

            // Check for --role flag
            const roleIndex = reasonArgs.findIndex(arg => arg === '--role');
            if (roleIndex !== -1 && reasonArgs[roleIndex + 1]) {
                const roleArg = reasonArgs[roleIndex + 1];
                // Extract role ID from mention or use as-is
                const roleId = roleArg.match(/^<@&(\d+)>$/) ? roleArg.match(/^<@&(\d+)>$/)[1] : roleArg;
                const role = message.guild.roles.cache.get(roleId);
                if (role) {
                    pingRole = role;
                }
                reasonArgs.splice(roleIndex, 2); // Remove --role and the role mention
            }

            const reason = reasonArgs.join(' ') || 'No reason provided';
            await handleSetTimer(message, duration, reason, ping, pingRole, true);
        } else if (['list', 'view', 'show'].includes(action)) {
            await handleListTimers(message, true);
        } else if (['cancel', 'remove', 'delete', 'stop'].includes(action)) {
            if (!args[1]) {
                const container = buildErrorResponse('Missing Timer ID', 'Please specify a timer ID!', '**Example:** `timer cancel 1`');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }
            await handleCancelTimer(message, args[1], true);
        } else {
            const container = buildErrorResponse('Invalid Action', 'Unknown timer action!', '**Available:** `set`, `list`, `cancel`');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }
};

async function handleSetTimer(target, durationStr, reason, ping, pingRole, isPrefix) {
    const userId = isPrefix ? target.author.id : target.user.id;
    const channelId = target.channel?.id || target.channelId;
    const guildId = target.guild?.id || target.guildId;

    // Parse duration
    const milliseconds = parseDuration(durationStr);
    if (!milliseconds || milliseconds < 1000) {
        const container = buildErrorResponse(
            'Invalid Duration',
            'Could not parse the duration!',
            '**Valid formats:**\n`30s` - 30 seconds\n`5m` - 5 minutes\n`1h` - 1 hour\n`2h30m` - 2 hours 30 minutes\n`1d` - 1 day'
        );
        if (isPrefix) {
            return target.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
        return target.reply({ components: [container], flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
    }

    if (milliseconds > 7 * 24 * 60 * 60 * 1000) { // Max 7 days
        const container = buildErrorResponse('Duration Too Long', 'Maximum timer duration is 7 days!');
        if (isPrefix) {
            return target.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
        return target.reply({ components: [container], flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
    }

    // Generate timer ID
    const timerId = generateTimerId(userId);
    const endTime = Date.now() + milliseconds;
    const endTimestamp = Math.floor(endTime / 1000);

    // Success response - send first
    const durationFormatted = formatDuration(milliseconds);

    let pingText = '🔕 No';
    if (pingRole) {
        pingText = `🔔 Role: ${pingRole.name}`;
    } else if (ping) {
        pingText = '🔔 User';
    }

    const container = buildSuccessResponse(
        '⏰ Timer Set',
        `Your timer has been set!`,
        {
            'Timer ID': `\`${timerId}\``,
            'Duration': `**${durationFormatted}**`,
            'Ends': `<t:${endTimestamp}:R> (<t:${endTimestamp}:F>)`,
            'Reason': reason,
            'Ping': pingText
        }
    );
    container.setAccentColor(0x57F287);
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `-# This message will update when the timer ends in <#${channelId}>`
    ));

    let replyMessage;
    if (isPrefix) {
        replyMessage = await target.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    } else {
        replyMessage = await target.reply({ components: [container], flags: MessageFlags.IsComponentsV2, fetchReply: true });
    }

    // Create timer with message reference
    const timer = {
        id: timerId,
        userId,
        channelId,
        guildId,
        reason,
        endTime,
        duration: milliseconds,
        createdAt: Date.now(),
        ping: ping,
        pingRoleId: pingRole?.id || null,
        messageId: replyMessage.id,
        timeout: null
    };

    // Set timeout
    timer.timeout = setTimeout(async () => {
        await notifyTimerEnd(target.client || target.message?.client, timer);
        activeTimers.delete(`${userId}-${timerId}`);
    }, milliseconds);

    activeTimers.set(`${userId}-${timerId}`, timer);
}

async function handleListTimers(target, isPrefix) {
    const userId = isPrefix ? target.author.id : target.user.id;
    const userTimers = [];

    for (const [key, timer] of activeTimers.entries()) {
        if (timer.userId === userId) {
            userTimers.push(timer);
        }
    }

    if (userTimers.length === 0) {
        const container = buildErrorResponse('No Active Timers', 'You don\'t have any active timers!', 'Use `/timer set` to create one.');
        if (isPrefix) {
            return target.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
        return target.reply({ components: [container], flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
    }

    // Sort by end time
    userTimers.sort((a, b) => a.endTime - b.endTime);

    let timerList = '';
    for (const timer of userTimers) {
        const endTimestamp = Math.floor(timer.endTime / 1000);
        const remaining = timer.endTime - Date.now();
        let pingIcon = '🔕';
        if (timer.pingRoleId) {
            pingIcon = '🔔👥';
        } else if (timer.ping) {
            pingIcon = '🔔';
        }
        timerList += `**ID ${timer.id}** • Ends <t:${endTimestamp}:R> ${pingIcon}\n`;
        timerList += `> ${timer.reason}\n`;
        timerList += `> Channel: <#${timer.channelId}> • Remaining: ${formatDuration(remaining)}\n\n`;
    }

    const container = new ContainerBuilder()
        .setTitle(`⏰ Your Active Timers (${userTimers.length})`)
        .setDescription(timerList)
        .setAccentColor(0xBCF1E4);

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent('-# Use `/timer cancel <id>` to cancel a timer'));

    if (isPrefix) {
        return target.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
    return target.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
}

async function handleCancelTimer(target, timerId, isPrefix) {
    const userId = isPrefix ? target.author.id : target.user.id;
    const key = `${userId}-${timerId}`;
    const timer = activeTimers.get(key);

    if (!timer) {
        const container = buildErrorResponse('Timer Not Found', `No timer with ID \`${timerId}\` found!`, 'Use `/timer list` to see your active timers.');
        if (isPrefix) {
            return target.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
        return target.reply({ components: [container], flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
    }

    // Cancel timeout
    clearTimeout(timer.timeout);
    activeTimers.delete(key);

    const container = buildSuccessResponse(
        '🗑️ Timer Cancelled',
        `Timer **${timerId}** has been cancelled.`,
        { 'Reason': timer.reason }
    );
    container.setAccentColor(0xFEE75C);

    if (isPrefix) {
        return target.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
    return target.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
}

async function notifyTimerEnd(client, timer) {
    try {
        const channel = await client.channels.fetch(timer.channelId).catch(() => null);
        if (!channel?.isTextBased()) return;

        const durationFormatted = formatDuration(timer.duration);

        // Build the "Timer Ended" container
        const container = new ContainerBuilder()
            .setAccentColor(0x57F287)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `# ⏰ Timer Ended!\n\n` +
                `Your timer has finished!`
            ))
            .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));

        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `**⏱️ Duration:** ${durationFormatted}\n` +
            `**📝 Reason:** ${timer.reason}\n` +
            `**🕒 Started:** <t:${Math.floor(timer.createdAt / 1000)}:R> (<t:${Math.floor(timer.createdAt / 1000)}:f>)\n` +
            `**<:Checkedbox:1521227734943269077> Completed:** <t:${Math.floor(Date.now() / 1000)}:f>\n` +
            `**🔔 Timer ID:** \`${timer.id}\``
        ));

        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

        // Build ping content
        let pingContent = '';
        if (timer.pingRoleId) {
            // Ping role
            const guild = await client.guilds.fetch(timer.guildId).catch(() => null);
            const role = guild?.roles.cache.get(timer.pingRoleId);
            if (role) {
                pingContent = `<@&${timer.pingRoleId}>`;
            }
        } else if (timer.ping) {
            // Ping user
            pingContent = `<@${timer.userId}>`;
        }

        // Try to fetch and edit the message
        try {
            const msg = await channel.messages.fetch(timer.messageId).catch(() => null);
            if (msg && msg.editable) {
                await msg.edit({
                    content: pingContent || undefined,
                    components: [container],
                    flags: MessageFlags.IsComponentsV2
                });
            } else {
                console.error('[Timer] Message not found or not editable:', timer.messageId);
            }
        } catch (editError) {
            console.error('[Timer] Failed to edit timer message:', editError.message);
        }
    } catch (error) {
        console.error('[Timer] Failed to notify timer end:', error.message);
    }
}

function parseDuration(str) {
    const regex = /(\d+)\s*([smhd])/gi;
    let total = 0;
    let match;

    while ((match = regex.exec(str)) !== null) {
        const value = parseInt(match[1]);
        const unit = match[2].toLowerCase();

        switch (unit) {
            case 's': total += value * 1000; break;
            case 'm': total += value * 60 * 1000; break;
            case 'h': total += value * 60 * 60 * 1000; break;
            case 'd': total += value * 24 * 60 * 60 * 1000; break;
        }
    }

    return total;
}

function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
    if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
}

function generateTimerId(userId) {
    const userTimerCount = Array.from(activeTimers.keys())
        .filter(key => key.startsWith(`${userId}-`))
        .length;
    return (userTimerCount + 1).toString();
}

// Export for cleanup on shutdown
module.exports.cleanupTimers = function () {
    for (const [key, timer] of activeTimers.entries()) {
        clearTimeout(timer.timeout);
    }
    activeTimers.clear();
    console.log('[Timer] All timers cleaned up');
};

module.exports.getActiveTimersCount = function () {
    return activeTimers.size;
};
