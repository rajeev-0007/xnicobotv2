'use strict';

const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const jsonStore = require('../../utils/jsonStore');

function buildVotePanel(client, userId) {
    const clientId = process.env.CLIENT_ID || client.user.id;
    const voteLink = `https://top.gg/bot/${clientId}/vote`;
    const supportUrl = process.env.SUPPORT_SERVER || 'https://discord.gg/Zs35X7Umak';

    // Check if user has active vote perks
    const userVotes = jsonStore.has('user-votes') ? jsonStore.read('user-votes') : {};
    const userData = userVotes[userId];
    const now = Date.now();
    const hasActivePerks = userData?.nextVoteAvailable && now < userData.nextVoteAvailable;
    const streak = userData?.streak || 0;
    const total = userData?.totalVotes || 0;

    let content = `# Thank You\n\n`;
    content += `> You've just voted for **${client.user.username}** on top.gg and gained some exclusive perks for you!\n`;
    content += `> • **No-Prefix** Access For **12 Hours**\n`;
    content += `> • Bypass to **Vote Lock** on Commands\n`;

    if (hasActivePerks) {
        const expiresTs = Math.floor(userData.nextVoteAvailable / 1000);
        content += `\n-# Your perks are active! Expires <t:${expiresTs}:R>`;
    } else if (total > 0) {
        content += `\n-# Your perks have expired. Vote again to regain them!`;
    } else {
        content += `\n-# Vote now to activate these perks!`;
    }

    if (streak > 0) {
        content += ` • Streak: ${streak}`;
    }

    const container = new ContainerBuilder()
        .setAccentColor(0x5865F2)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setLabel('Vote Now')
            .setURL(voteLink)
            .setStyle(ButtonStyle.Link)
            .setEmoji('<:topgg:1521228219066482790>'),
        new ButtonBuilder()
            .setLabel('Support Server')
            .setURL(supportUrl)
            .setStyle(ButtonStyle.Link)
            .setEmoji('<:Inforect:1521228008285929532>')
    );

    container.addActionRowComponents(row);
    return container;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('vote')
        .setDescription('Vote for the bot and get exclusive perks'),
    prefix: 'vote',
    description: 'Vote for the bot and get exclusive perks (no-prefix, vote lock bypass)',
    usage: 'vote',
    category: 'basic',
    dmAllowed: true,

    async execute(interaction) {
        const container = buildVotePanel(interaction.client, interaction.user.id);
        return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    },

    async executePrefix(message) {
        const container = buildVotePanel(message.client, message.author.id);
        return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    },
};
