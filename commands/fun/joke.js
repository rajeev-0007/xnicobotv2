'use strict';

const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');

// Fallback jokes if API fails
const FALLBACK_JOKES = [
    { setup: "Why don't scientists trust atoms?", punchline: "Because they make up everything!" },
    { setup: "What do you call a bear with no teeth?", punchline: "A gummy bear!" },
    { setup: "Why did the scarecrow win an award?", punchline: "He was outstanding in his field!" },
    { setup: "What do you call a fake noodle?", punchline: "An impasta!" },
    { setup: "Why don't eggs tell jokes?", punchline: "They'd crack each other up!" },
];

async function fetchJoke() {
    // Try JokeAPI (free, no key)
    try {
        const res = await fetch('https://v2.jokeapi.dev/joke/Any?blacklistFlags=nsfw,racist,sexist&type=twopart', { signal: AbortSignal.timeout(5000) });
        if (res.ok) {
            const data = await res.json();
            if (data.setup && data.delivery) return { setup: data.setup, punchline: data.delivery };
        }
    } catch {}

    // Try Official Joke API
    try {
        const res = await fetch('https://official-joke-api.appspot.com/random_joke', { signal: AbortSignal.timeout(5000) });
        if (res.ok) {
            const data = await res.json();
            if (data.setup && data.punchline) return data;
        }
    } catch {}

    // Fallback
    return FALLBACK_JOKES[Math.floor(Math.random() * FALLBACK_JOKES.length)];
}

function buildJokeContainer(joke) {
    return new ContainerBuilder()
        .setAccentColor(0xFEE75C)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `## <:Gamepad:1521228035213230090> Random Joke\n\n**${joke.setup}**\n\n||${joke.punchline}||\n\n-# Click the spoiler to reveal the punchline`
        ));
}

module.exports = {
    data: new SlashCommandBuilder().setName('joke').setDescription('Get a random joke'),
    prefix: 'joke',
    description: 'Get a random joke from the internet',
    usage: 'joke',
    category: 'fun',
    aliases: ['jokes', 'funny'],

    async execute(interaction) {
        await interaction.deferReply();
        const joke = await fetchJoke();
        const container = buildJokeContainer(joke);
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('joke_next').setLabel('Another').setEmoji('<:History:1521227863079256278>').setStyle(ButtonStyle.Primary)
        );
        await interaction.editReply({ components: [container.addActionRowComponents(row)], flags: MessageFlags.IsComponentsV2 });
    },

    async executePrefix(message, args) {
        const joke = await fetchJoke();
        const container = buildJokeContainer(joke);
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('joke_next').setLabel('Another').setEmoji('<:History:1521227863079256278>').setStyle(ButtonStyle.Primary)
        );
        await message.reply({ components: [container.addActionRowComponents(row)], flags: MessageFlags.IsComponentsV2 });
    },

    async handleButton(interaction) {
        if (interaction.customId !== 'joke_next') return false;
        await interaction.deferUpdate();
        const joke = await fetchJoke();
        const container = buildJokeContainer(joke);
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('joke_next').setLabel('Another').setEmoji('<:History:1521227863079256278>').setStyle(ButtonStyle.Primary)
        );
        await interaction.editReply({ components: [container.addActionRowComponents(row)], flags: MessageFlags.IsComponentsV2 });
        return true;
    }
};
