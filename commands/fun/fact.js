'use strict';

const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');

const FALLBACK_FACTS = [
    "Honey never spoils. Archaeologists have found 3000-year-old honey that's still edible!",
    "Octopuses have three hearts and blue blood.",
    "A group of flamingos is called a 'flamboyance'.",
    "The shortest war in history lasted 38 minutes (Britain vs Zanzibar, 1896).",
    "Bananas are berries, but strawberries aren't.",
];

async function fetchFact() {
    // Try uselessfacts API
    try {
        const res = await fetch('https://uselessfacts.jsph.pl/api/v2/facts/random?language=en', { signal: AbortSignal.timeout(5000) });
        if (res.ok) {
            const data = await res.json();
            if (data.text) return data.text;
        }
    } catch {}

    // Try API Ninjas facts
    try {
        const res = await fetch('https://api.api-ninjas.com/v1/facts?limit=1', {
            headers: { 'X-Api-Key': process.env.API_NINJAS_KEY || '' },
            signal: AbortSignal.timeout(5000)
        });
        if (res.ok) {
            const data = await res.json();
            if (data[0]?.fact) return data[0].fact;
        }
    } catch {}

    return FALLBACK_FACTS[Math.floor(Math.random() * FALLBACK_FACTS.length)];
}

function buildFactContainer(fact) {
    return new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `## <:Bookopen:1521227911137595605> Random Fact\n\n> ${fact}\n\n-# Source: uselessfacts.jsph.pl`
        ));
}

module.exports = {
    data: new SlashCommandBuilder().setName('fact').setDescription('Get a random interesting fact'),
    prefix: 'fact',
    description: 'Get a random interesting fact',
    usage: 'fact',
    category: 'fun',
    aliases: ['facts', 'funfact', 'randomfact'],

    async execute(interaction) {
        await interaction.deferReply();
        const fact = await fetchFact();
        const container = buildFactContainer(fact);
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('fact_next').setLabel('Another').setEmoji('<:History:1521227863079256278>').setStyle(ButtonStyle.Primary)
        );
        await interaction.editReply({ components: [container.addActionRowComponents(row)], flags: MessageFlags.IsComponentsV2 });
    },

    async executePrefix(message, args) {
        const fact = await fetchFact();
        const container = buildFactContainer(fact);
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('fact_next').setLabel('Another').setEmoji('<:History:1521227863079256278>').setStyle(ButtonStyle.Primary)
        );
        await message.reply({ components: [container.addActionRowComponents(row)], flags: MessageFlags.IsComponentsV2 });
    },

    async handleButton(interaction) {
        if (interaction.customId !== 'fact_next') return false;
        await interaction.deferUpdate();
        const fact = await fetchFact();
        const container = buildFactContainer(fact);
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('fact_next').setLabel('Another').setEmoji('<:History:1521227863079256278>').setStyle(ButtonStyle.Primary)
        );
        await interaction.editReply({ components: [container.addActionRowComponents(row)], flags: MessageFlags.IsComponentsV2 });
        return true;
    }
};
