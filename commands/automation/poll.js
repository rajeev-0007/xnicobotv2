const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');

const jsonStore = require('../../utils/jsonStore');
const { buildErrorResponse, buildPermissionDenied, buildInvalidUsage } = require('../../utils/responseBuilder');

function loadConfig() {
    if (!jsonStore.has('polls')) {
        jsonStore.write('polls', {});
        return {};
    }
    const data = jsonStore.read('polls');
    // database.js may initialize this store as [] — polls needs {}
    if (Array.isArray(data)) {
        jsonStore.write('polls', {});
        return {};
    }
    return data;
}

function saveConfig(config) {
    jsonStore.write('polls', config);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('poll')
        .setDescription('Create interactive polls with buttons')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addStringOption(opt =>
            opt.setName('question')
                .setDescription('The poll question')
                .setRequired(true))
        .addStringOption(opt =>
            opt.setName('options')
                .setDescription('Poll options separated by | (e.g. Red | Blue | Green)')
                .setRequired(true))
        .addIntegerOption(opt =>
            opt.setName('duration')
                .setDescription('Duration in minutes (0 = no limit)')
                .setMinValue(0)
                .setMaxValue(10080)
                .setRequired(false)),

    category: 'automation',
    name: 'poll',
    prefix: 'poll',
    description: 'Create interactive polls with buttons',
    usage: 'poll <duration_mins> <question> | <option1> | <option2> | ...',
    permissions: [PermissionFlagsBits.ManageMessages],

    async execute(interaction) {
        const question = interaction.options.getString('question');
        const optionsRaw = interaction.options.getString('options');
        const duration = interaction.options.getInteger('duration') || 0;
        const options = optionsRaw.split('|').map(o => o.trim()).filter(o => o);

        if (options.length < 2) {
            return interaction.reply({ components: [buildErrorResponse('Not Enough Options', 'You need at least 2 options! Separate them with `|`.')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }
        if (options.length > 10) {
            return interaction.reply({ components: [buildErrorResponse('Too Many Options', 'Maximum 10 options allowed!')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        await createPoll(interaction, true, question, options, duration);
    },

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
            return message.reply({ components: [buildPermissionDenied('Manage Messages')], flags: MessageFlags.IsComponentsV2 });
        }

        const fullText = args.join(' ');
        
        if (!fullText.includes('|')) {
            return message.reply({ components: [buildInvalidUsage('poll', '-poll <mins> <question> | <option1> | <option2> | ...', ['-poll 60 Favorite color? | Red | Blue | Green'])], flags: MessageFlags.IsComponentsV2 });
        }
        
        const parts = fullText.split('|').map(p => p.trim());
        const firstPart = parts[0].split(' ');
        const duration = parseInt(firstPart[0]) || 0;
        const question = firstPart.slice(1).join(' ');
        const options = parts.slice(1).filter(o => o);
        
        if (!question || options.length < 2) {
            return message.reply({ components: [buildErrorResponse('Not Enough Options', 'You need a question and at least 2 options!', 'Example: `-poll 60 Favorite color? | Red | Blue | Green`')], flags: MessageFlags.IsComponentsV2 });
        }
        
        if (options.length > 10) {
            return message.reply({ components: [buildErrorResponse('Too Many Options', 'Maximum 10 options allowed!')], flags: MessageFlags.IsComponentsV2 });
        }

        await createPoll(message, false, question, options, duration);
    }
};

async function createPoll(context, isInteraction, question, options, duration) {
    const channel = context.channel;
    const authorId = isInteraction ? context.user.id : context.author.id;
    const authorName = isInteraction ? context.user.username : context.author.username;
    const client = context.client;
    const guildId = context.guild.id;
    
    const endTime = duration > 0 ? Date.now() + (duration * 60 * 1000) : null;
    const endTimestamp = endTime ? Math.floor(endTime / 1000) : null;
    
    const pollData = {
        question,
        options: options.map(opt => ({ text: opt, votes: [] })),
        channelId: channel.id,
        hostId: authorId,
        endTime,
        ended: false
    };
    
    const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
    const buttons = [];
    
    for (let i = 0; i < Math.min(options.length, 5); i++) {
        buttons.push(
            new ButtonBuilder()
                .setCustomId(`poll_vote_${i}`)
                .setLabel(options[i].slice(0, 80))
                .setStyle(ButtonStyle.Primary)
                .setEmoji(emojis[i])
        );
    }
    
    const row1 = new ActionRowBuilder().addComponents(...buttons);
    const rows = [row1];
    
    if (options.length > 5) {
        const buttons2 = [];
        for (let i = 5; i < Math.min(options.length, 10); i++) {
            buttons2.push(
                new ButtonBuilder()
                    .setCustomId(`poll_vote_${i}`)
                    .setLabel(options[i].slice(0, 80))
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji(emojis[i])
            );
        }
        rows.push(new ActionRowBuilder().addComponents(...buttons2));
    }
    
    const controlRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('poll_results')
                .setLabel('View Results')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('<:Lightning:1521227915537285150>'),
            new ButtonBuilder()
                .setCustomId('poll_end')
                .setLabel('End Poll')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('<:dnd:1521228070701502486>')
        );
    
    rows.push(controlRow);
    
    let content = `# <:Bookopen:1521227911137595605>${question}\n\n**Choose an option below:**\n\n`;
    options.forEach((opt, i) => {
        content += `${emojis[i]} ${opt}\n`;
    });
    
    if (endTimestamp) {
        content += `\n**Ends:** <t:${endTimestamp}:R> (<t:${endTimestamp}:F>)`;
    } else {
        content += `\n**No time limit**`;
    }
    
    content += `\n**Hosted by:** ${authorName}\n**Total Votes:** 0`;
    
    const container = new ContainerBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder()
                .setContent(content)
        );
    
    rows.forEach(row => container.addActionRowComponents(row));
    
    let pollMsg;
    try {
        if (isInteraction) {
            pollMsg = await context.reply({ components: [container], flags: MessageFlags.IsComponentsV2, fetchReply: true });
        } else {
            pollMsg = await channel.send({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    } catch (error) {
        console.error('[Poll] Send error:', error);
        const errorMsg = '<:Cancel:1521227723916181644> Failed to send poll. Check bot permissions in this channel.';
        if (isInteraction) {
            return context.reply({ content: errorMsg, flags: MessageFlags.Ephemeral }).catch(() => {});
        }
        return context.reply(errorMsg).catch(() => {});
    }
    
    const config = loadConfig();
    if (!config[guildId]) config[guildId] = {};
    
    config[guildId][pollMsg.id] = {
        ...pollData,
        messageId: pollMsg.id
    };
    
    saveConfig(config);
    
    if (duration > 0) {
        setTimeout(() => {
            endPoll(client, guildId, pollMsg.id);
        }, duration * 60 * 1000);
    }
    
    if (!isInteraction) {
        await context.reply(`<:Checkedbox:1521227734943269077> Poll created! ${duration > 0 ? `Ends in ${duration} minutes.` : 'No time limit.'}`);
    }
}

/**
 * Recover timed polls after bot restart.
 * Call this once during bot startup after jsonStore is ready.
 */
function recoverPollTimers(client) {
    const config = loadConfig();
    let recovered = 0;
    for (const guildId of Object.keys(config)) {
        for (const msgId of Object.keys(config[guildId])) {
            const poll = config[guildId][msgId];
            if (poll.ended || !poll.endTime) continue;
            const remaining = poll.endTime - Date.now();
            if (remaining <= 0) {
                // Poll already expired while bot was offline — end it now
                endPoll(client, guildId, msgId);
            } else {
                setTimeout(() => endPoll(client, guildId, msgId), remaining);
            }
            recovered++;
        }
    }
    if (recovered > 0) console.log(`[Poll] Recovered timers for ${recovered} active poll(s)`);
}

async function endPoll(client, guildId, messageId) {
    const config = loadConfig();
    const poll = config[guildId]?.[messageId];
    
    if (!poll || poll.ended) return;
    
    poll.ended = true;
    saveConfig(config);
    
    try {
        const channel = await client.channels.fetch(poll.channelId);
        const message = await channel.messages.fetch(messageId);
        
        const totalVotes = poll.options.reduce((sum, opt) => sum + opt.votes.length, 0);
        const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
        
        let resultsText = `# <:Bookopen:1521227911137595605>${poll.question}\n\n**POLL ENDED**\n\n**Results:**\n\n`;
        
        poll.options.forEach((opt, i) => {
            const percentage = totalVotes > 0 ? ((opt.votes.length / totalVotes) * 100).toFixed(1) : 0;
            const barLength = Math.round((opt.votes.length / Math.max(totalVotes, 1)) * 20);
            const bar = '█'.repeat(barLength) + '░'.repeat(20 - barLength);
            resultsText += `${emojis[i]} **${opt.text}**\n${bar} ${percentage}% (${opt.votes.length} votes)\n\n`;
        });
        
        resultsText += `**Total Votes:** ${totalVotes}\n**Hosted by:** <@${poll.hostId}>`;
        
        const container = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder()
                    .setContent(resultsText)
            );
        
        await message.edit({ components: [container], flags: MessageFlags.IsComponentsV2 });
    } catch (error) {
        console.error('Error ending poll:', error);
    }
}

module.exports.endPoll = endPoll;
module.exports.recoverPollTimers = recoverPollTimers;
