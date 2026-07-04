'use strict';

const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } = require('discord.js');
const ui = require('../../utils/gamesUI');

// Truth or Dare API
async function fetchTruthOrDare(type = 'truth', rating = 'pg13') {
    try {
        const res = await fetch(`https://api.truthordarebot.xyz/v1/${type}?rating=${rating}`, { signal: AbortSignal.timeout(5000) });
        if (res.ok) {
            const data = await res.json();
            return data.question || data.dare || null;
        }
    } catch {}

    // Fallback: local questions
    if (type === 'truth') {
        const truths = [
            "What's the most embarrassing thing you've done in public?",
            "What's a secret you've never told anyone?",
            "What's the last lie you told?",
            "What's your biggest fear?",
            "What's the most childish thing you still do?",
            "Have you ever cheated on a test?",
            "What's the worst thing you've ever said to someone?",
            "What's your guilty pleasure?",
            "What's the most embarrassing thing on your phone?",
            "If you could be invisible for a day, what would you do?",
            "What's the weirdest dream you've ever had?",
            "What's the most trouble you've been in?",
            "Who was your first crush?",
            "What's the longest you've gone without showering?",
            "What's the most embarrassing song on your playlist?",
        ];
        return truths[Math.floor(Math.random() * truths.length)];
    } else {
        const dares = [
            "Send a message to your crush right now",
            "Do 20 pushups right now",
            "Change your Discord status to something embarrassing for 1 hour",
            "Send a voice message singing your favorite song",
            "Let someone else type a message from your account",
            "Post a selfie in the chat",
            "Speak in an accent for the next 5 minutes",
            "Send the last photo in your camera roll",
            "Do your best impression of another server member",
            "Type with your eyes closed for the next 3 messages",
            "Change your nickname to something the group chooses",
            "Send a compliment to the last person who messaged you",
            "Share your screen time report",
            "React to every message for the next 2 minutes",
            "Tell a joke and if nobody laughs, you lose",
        ];
        return dares[Math.floor(Math.random() * dares.length)];
    }
}

function buildToDContainer(guildId, type, question, user) {
    const isTruth = type === 'truth';
    const emoji = isTruth ? '<:Inforect:1521228008285929532>' : '<:Fire:1521227907647668374>';
    const color = isTruth ? 0x5865F2 : 0xED4245;
    const label = isTruth ? 'Truth' : 'Dare';

    const container = new ContainerBuilder()
        .setAccentColor(color)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `# ${emoji} ${label}\n-# Asked by **${user.username}**`
        ))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `${ui.E.bullet} ${question}`
        ));

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('tod_truth').setLabel('Truth').setEmoji('<:Inforect:1521228008285929532>').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('tod_dare').setLabel('Dare').setEmoji('<:Fire:1521227907647668374>').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('tod_random').setLabel('Random').setEmoji('<:Gamepad:1521228035213230090>').setStyle(ButtonStyle.Secondary)
    );
    container.addActionRowComponents(row);

    return ui.applyStyle(container, guildId);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('truthdare')
        .setDescription('Play Truth or Dare')
        .addStringOption(opt => opt
            .setName('type')
            .setDescription('Truth or Dare?')
            .addChoices(
                { name: '💙 Truth', value: 'truth' },
                { name: '<:Fire:1521227907647668374> Dare', value: 'dare' },
                { name: '🎲 Random', value: 'random' }
            )
            .setRequired(false)),

    prefix: 'truthdare',
    description: 'Play Truth or Dare',
    usage: 'truthdare [truth|dare]',
    category: 'games',
    aliases: ['truthordare', 'tod', 'truth', 'dare'],

    async execute(interaction) {
        let type = interaction.options.getString('type') || 'random';
        if (type === 'random') type = Math.random() > 0.5 ? 'truth' : 'dare';

        const question = await fetchTruthOrDare(type);
        const container = buildToDContainer(interaction.guild?.id, type, question, interaction.user);
        await interaction.reply(ui.payload(container));
    },

    async executePrefix(message, args) {
        let type = args[0]?.toLowerCase() || 'random';
        if (!['truth', 'dare'].includes(type)) type = Math.random() > 0.5 ? 'truth' : 'dare';

        const question = await fetchTruthOrDare(type);
        const container = buildToDContainer(message.guild?.id, type, question, message.author);
        await message.reply(ui.payload(container));
    },

    async handleButton(interaction) {
        if (!interaction.customId.startsWith('tod_')) return false;
        let type = interaction.customId.replace('tod_', '');
        if (type === 'random') type = Math.random() > 0.5 ? 'truth' : 'dare';

        const question = await fetchTruthOrDare(type);
        const container = buildToDContainer(interaction.guild?.id, type, question, interaction.user);
        await interaction.update(ui.payload(container));
        return true;
    }
};
