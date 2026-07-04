'use strict';

const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, SeparatorBuilder, SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const funUI = require('../../utils/funUI');

// Subreddits for different meme categories
const SUBREDDITS = {
    english: ['memes', 'dankmemes', 'me_irl', 'wholesomememes', 'ProgrammerHumor', 'meme'],
    hindi: ['IndianMeyMeys', 'SaimanSays', 'IndianDankMemes', 'desimemes'],
    anime: ['Animemes', 'animememes', 'goodanimemes'],
    gaming: ['gaming', 'gamingmemes', 'pcmasterrace'],
    dark: ['darkhumor', 'offensivejokes'],
};

async function fetchMeme(category = 'english') {
    const subs = SUBREDDITS[category] || SUBREDDITS.english;
    const sub = subs[Math.floor(Math.random() * subs.length)];

    try {
        const res = await fetch(`https://meme-api.com/gimme/${sub}`, { signal: AbortSignal.timeout(6000) });
        if (res.ok) {
            const data = await res.json();
            if (data.url && !data.nsfw) return data;
        }
    } catch {}

    // Fallback: try Reddit JSON directly
    try {
        const res = await fetch(`https://www.reddit.com/r/${sub}/hot.json?limit=50`, {
            headers: { 'User-Agent': 'xNicoBot/2.0' },
            signal: AbortSignal.timeout(6000)
        });
        if (res.ok) {
            const json = await res.json();
            const posts = json.data?.children?.filter(p =>
                p.data.post_hint === 'image' && !p.data.over_18 && p.data.url
            ) || [];
            if (posts.length > 0) {
                const post = posts[Math.floor(Math.random() * posts.length)].data;
                return { title: post.title, url: post.url, subreddit: post.subreddit, ups: post.ups, author: post.author };
            }
        }
    } catch {}

    return null;
}

function buildMemeContainer(meme, category) {
    const container = new ContainerBuilder().setAccentColor(0xFF4500);

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `### ${meme.title || 'Random Meme'}\n-# r/${meme.subreddit || 'memes'} · ${category}`
        )
    );

    if (meme.url) {
        container.addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(meme.url))
        );
    }

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`-# 👍 ${(meme.ups || 0).toLocaleString()} · by u/${meme.author || 'unknown'}`)
    );

    return container;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('meme')
        .setDescription('Get a random meme from Reddit')
        .addStringOption(opt => opt
            .setName('category')
            .setDescription('Meme category')
            .addChoices(
                { name: '🌍 English', value: 'english' },
                { name: '🇮🇳 Hindi', value: 'hindi' },
                { name: '🎌 Anime', value: 'anime' },
                { name: '🎮 Gaming', value: 'gaming' },
            )
            .setRequired(false)),

    prefix: 'meme',
    description: 'Get a random meme from Reddit',
    usage: 'meme [english|hindi|anime|gaming]',
    category: 'fun',
    aliases: ['randommeme'],

    async execute(interaction) {
        await interaction.deferReply();
        const category = interaction.options.getString('category') || 'english';
        const meme = await fetchMeme(category);

        if (!meme) {
            return interaction.editReply(funUI.payload(funUI.err(interaction.guild?.id, 'Meme Unavailable', 'Failed to fetch a meme. Please try again!')));
        }

        const container = buildMemeContainer(meme, category);
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`meme_next_${category}`).setLabel('Next Meme').setEmoji('<:History:1521227863079256278>').setStyle(ButtonStyle.Primary)
        );
        await interaction.editReply({ components: [container.addActionRowComponents(row)], flags: MessageFlags.IsComponentsV2 });
    },

    async executePrefix(message, args) {
        const category = args[0]?.toLowerCase() || 'english';
        const validCat = SUBREDDITS[category] ? category : 'english';
        const meme = await fetchMeme(validCat);

        if (!meme) {
            return message.reply(funUI.payload(funUI.err(message.guild?.id, 'Meme Unavailable', 'Failed to fetch a meme. Please try again!')));
        }

        const container = buildMemeContainer(meme, validCat);
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`meme_next_${validCat}`).setLabel('Next Meme').setEmoji('<:History:1521227863079256278>').setStyle(ButtonStyle.Primary)
        );
        await message.reply({ components: [container.addActionRowComponents(row)], flags: MessageFlags.IsComponentsV2 });
    },

    async handleButton(interaction) {
        if (!interaction.customId.startsWith('meme_next_')) return false;
        const category = interaction.customId.replace('meme_next_', '');
        await interaction.deferUpdate();
        const meme = await fetchMeme(category);
        if (!meme) return interaction.editReply(funUI.payload(funUI.err(interaction.guild?.id, 'Meme Unavailable', 'Failed to fetch a meme. Please try again!')));
        const container = buildMemeContainer(meme, category);
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`meme_next_${category}`).setLabel('Next Meme').setEmoji('<:History:1521227863079256278>').setStyle(ButtonStyle.Primary)
        );
        await interaction.editReply({ components: [container.addActionRowComponents(row)], flags: MessageFlags.IsComponentsV2 });
        return true;
    }
};
