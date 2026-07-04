const {
    SlashCommandBuilder,
    ContainerBuilder,
    TextDisplayBuilder,
    SectionBuilder,
    ThumbnailBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags
} = require('discord.js');

const jsonStore = require('../../utils/jsonStore');
const ui = require('../../utils/basicUI');

function loadUserVotes() {
    return jsonStore.has('user-votes') ? jsonStore.read('user-votes') : {};
}

function saveUserVotes(data) {
    jsonStore.write('user-votes', data);
}

function getStreakEmoji(streak) {
    if (streak >= 30) return '<:Fire:1521227907647668374>';
    if (streak >= 14) return '<:Lightning:1521227915537285150>';
    if (streak >= 7) return '<:Sketch:1521228025365004471>';
    if (streak >= 3) return '<:Star:1521227981685526568>';
    return '<:Checkedbox:1521227734943269077>';
}

function getStreakTitle(streak) {
    if (streak >= 30) return ' — *LEGENDARY!*';
    if (streak >= 14) return ' — *EPIC!*';
    if (streak >= 7) return ' — *AMAZING!*';
    if (streak >= 3) return ' — *GREAT!*';
    return '';
}

function buildVoteStatsPanel(user, userData, clientId) {
    const now = Date.now();
    const hasVoted = userData && userData.totalVotes > 0;
    const nextVoteTs = userData?.nextVoteAvailable || 0;
    const canVoteNow = !nextVoteTs || now >= nextVoteTs;
    const remindersOn = userData?.remindersEnabled === true;

    const voteLink = `https://top.gg/bot/${clientId}/vote`;

    const section = new SectionBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `# <:Fire:1521227907647668374> Vote Statistics\n` +
                `-# Showing stats for **${user.globalName || user.username}**`
            )
        )
        .setThumbnailAccessory(
            new ThumbnailBuilder({ media: { url: user.displayAvatarURL({ size: 256 }) } })
        );

    let statsContent = '';

    if (!hasVoted) {
        statsContent += `### <:Infotriangle:1521227710381428926> No Votes Yet\n`;
        statsContent += `You haven't voted for **xNico** yet. Every vote helps us grow!\n\n`;
        statsContent += `### <:Present:1521228115655917659> Rewards for Voting\n`;
        statsContent += `• <:Fire:1521227907647668374> Build a daily voting streak\n`;
        statsContent += `• <:Award:1521228119640375336> Earn the exclusive **Voter** badge on your profile\n`;
        statsContent += `• <:Heart:1521228100652765247> Help the bot reach more servers\n\n`;
        statsContent += `-# Click below to cast your first vote!`;
    } else {
        const streak = userData.streak || 0;
        const total = userData.totalVotes || 0;
        const lastVoteTs = Math.floor((userData.lastVote || 0) / 1000);
        const firstVoteTs = Math.floor((userData.firstVote || userData.lastVote || 0) / 1000);

        statsContent += `### <:Fire:1521227907647668374> Current Streak\n`;
        statsContent += `${getStreakEmoji(streak)} **${streak}** vote${streak !== 1 ? 's' : ''} in a row${getStreakTitle(streak)}\n\n`;

        statsContent += `### <:Lightning:1521227915537285150> All-Time Votes\n`;
        statsContent += `**${total}** total vote${total !== 1 ? 's' : ''}\n\n`;

        statsContent += `### <:Clock:1521228110408847623> Vote Timestamps\n`;
        statsContent += `**First vote:** <t:${firstVoteTs}:D>\n`;
        statsContent += `**Last vote:** <t:${lastVoteTs}:R>\n\n`;

        statsContent += `### <:Checkedbox:1521227734943269077> Next Vote\n`;
        if (canVoteNow) {
            statsContent += `<:Checkedbox:1521227734943269077> **You can vote right now!**\n\n`;
        } else {
            const ts = Math.floor(nextVoteTs / 1000);
            statsContent += `Available <t:${ts}:R> · <t:${ts}:t>\n\n`;
        }

        statsContent += `### <:Notificationon:1521227730304106680> Vote Reminder\n`;
        statsContent += remindersOn
            ? `<:Checkedbox:1521227734943269077> Reminders are **ON** — I'll DM you when you can vote again.`
            : `<:Cancel:1521227723916181644> Reminders are **OFF** — toggle below to get notified.`;
    }

    const container = new ContainerBuilder()
        .setAccentColor(hasVoted ? 0xCAD7E6 : 0x95A5A6)
        .addSectionComponents(section)
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(statsContent))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))

    const voteRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setLabel(canVoteNow ? 'Vote Now on Top.gg' : 'Vote on Top.gg')
            .setURL(voteLink)
            .setStyle(ButtonStyle.Link)
            .setEmoji('<:topgg:1521228219066482790>'),
        new ButtonBuilder()
            .setLabel('Vote on DBL')
            .setURL('https://discordbotlist.com/bots/xnico')
            .setStyle(ButtonStyle.Link)
            .setEmoji('<:Cursor:1521228147071127732>')
    );

    const reminderRow = hasVoted ? new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('voterem_toggle')
            .setLabel(remindersOn ? 'Disable Reminders' : 'Enable Reminders')
            .setStyle(remindersOn ? ButtonStyle.Danger : ButtonStyle.Success)
            .setEmoji(remindersOn ? '<:Toggleoff:1521227763816595559>' : '<:Toggleon:1521227758011809964>'),
        new ButtonBuilder()
            .setCustomId('voterem_refresh')
            .setLabel('Refresh')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('<:History:1521227863079256278>')
    ) : null;

    return { container, voteRow, reminderRow };
}

module.exports = {
    prefix: 'myvotes',
    aliases: ['mv', 'votestats', 'mystreak', 'votes'],
    description: 'Check your vote stats, streak, and manage vote reminders',
    usage: 'myvotes',
    category: 'basic',
    dmAllowed: true,

    data: new SlashCommandBuilder()
        .setName('myvotes')
        .setDescription('Check your vote stats, streak, and manage vote reminders')
        ,

    async execute(interaction) {
        try {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const userVotes = loadUserVotes();
            const userData = userVotes[interaction.user.id] || null;
            const clientId = process.env.CLIENT_ID || interaction.client.user.id;
            const { container, voteRow, reminderRow } = buildVoteStatsPanel(interaction.user, userData, clientId);
            const components = reminderRow
                ? [container, voteRow, reminderRow]
                : [container, voteRow];
            await interaction.editReply({ components, flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('[myvotes slash]', error);
            try { await interaction.editReply({ content: '<:Cancel:1521227723916181644> Failed to load your vote stats.' }); } catch { }
        }
    },

    async executePrefix(message) {
        try {
            const userVotes = loadUserVotes();
            const userData = userVotes[message.author.id] || null;
            const clientId = process.env.CLIENT_ID || message.client.user.id;
            const { container, voteRow, reminderRow } = buildVoteStatsPanel(message.author, userData, clientId);
            const components = reminderRow
                ? [container, voteRow, reminderRow]
                : [container, voteRow];
            await message.reply({ components, flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('[myvotes prefix]', error);
            await message.reply('<:Cancel:1521227723916181644> Failed to load your vote stats.').catch(() => { });
        }
    },

    async handleInteraction(interaction) {
        if (!interaction.isButton()) return false;
        const { customId, user } = interaction;
        if (!customId.startsWith('voterem_')) return false;

        const userVotes = loadUserVotes();
        if (!userVotes[user.id]) {
            await interaction.reply(ui.payload(ui.warn(interaction.guild?.id, 'No Votes Yet', "You haven't voted yet! Vote first to use reminders."), true));
            return true;
        }

        if (customId === 'voterem_toggle') {
            userVotes[user.id].remindersEnabled = !userVotes[user.id].remindersEnabled;
            saveUserVotes(userVotes);

            const isNowOn = userVotes[user.id].remindersEnabled;
            const clientId = process.env.CLIENT_ID || interaction.client.user.id;
            const { container, voteRow, reminderRow } = buildVoteStatsPanel(user, userVotes[user.id], clientId);
            const components = reminderRow ? [container, voteRow, reminderRow] : [container, voteRow];

            await interaction.update({ components, flags: MessageFlags.IsComponentsV2 });
            return true;
        }

        if (customId === 'voterem_refresh') {
            const clientId = process.env.CLIENT_ID || interaction.client.user.id;
            const { container, voteRow, reminderRow } = buildVoteStatsPanel(user, userVotes[user.id], clientId);
            const components = reminderRow ? [container, voteRow, reminderRow] : [container, voteRow];
            await interaction.update({ components, flags: MessageFlags.IsComponentsV2 });
            return true;
        }

        return false;
    }
};
