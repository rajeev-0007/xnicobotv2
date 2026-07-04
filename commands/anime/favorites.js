'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { createContainer, addTextDisplay } = require('../../utils/componentHelpers');
const animeManager = require('../../utils/animeManager');

const MAX_FAVORITES = 5;

async function handleFavorites(reply, user, guildId, action = 'view', characterName = null) {
    const animeData = animeManager.loadAnimeData();
    const playerData = animeManager.getPlayerData(animeData, user.id);

    if (action === 'add') {
        if (!characterName) {
            const container = createContainer(0xED4245);
            addTextDisplay(container, `## ❌ Error\nPlease specify a character name.`);
            return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const char = animeManager.findCharacter(characterName);
        if (!char) {
            const container = createContainer(0xED4245);
            addTextDisplay(container, `## ❌ Not Found\nCharacter "${characterName}" not found.`);
            return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (!animeManager.hasCharacter(playerData, char.id)) {
            const container = createContainer(0xED4245);
            addTextDisplay(container, `## ❌ Not Owned\nYou need to own **${char.name}** to add them as a favorite.`);
            return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (playerData.favorites.includes(char.id)) {
            const container = createContainer(0xFEE75C);
            addTextDisplay(container, `## ⚠️ Already Favorited\n**${char.name}** is already in your favorites.`);
            return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (playerData.favorites.length >= MAX_FAVORITES) {
            const container = createContainer(0xED4245);
            addTextDisplay(container, `## ❌ Favorites Full\nYou can only have **${MAX_FAVORITES}** favorites. Remove one first.`);
            return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        playerData.favorites.push(char.id);
        animeManager.saveAnimeData();

        const rarity = animeManager.RARITIES[char.rarity];
        const container = createContainer(0x57F287);
        addTextDisplay(container, [
            `## ✅ Favorite Added`,
            '',
            `${rarity.emoji} **${char.name}** is now one of your favorites!`,
            '',
            `-# Favorites: ${playerData.favorites.length}/${MAX_FAVORITES}`,
        ].join('\n'));
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    if (action === 'remove') {
        if (!characterName) {
            const container = createContainer(0xED4245);
            addTextDisplay(container, `## ❌ Error\nPlease specify a character name.`);
            return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const char = animeManager.findCharacter(characterName);
        if (!char) {
            const container = createContainer(0xED4245);
            addTextDisplay(container, `## ❌ Not Found\nCharacter "${characterName}" not found.`);
            return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const idx = playerData.favorites.indexOf(char.id);
        if (idx === -1) {
            const container = createContainer(0xFEE75C);
            addTextDisplay(container, `## ⚠️ Not a Favorite\n**${char.name}** is not in your favorites.`);
            return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        playerData.favorites.splice(idx, 1);
        animeManager.saveAnimeData();

        const container = createContainer(0x57F287);
        addTextDisplay(container, `## ✅ Removed\n**${char.name}** removed from your favorites.`);
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    // View favorites
    if (playerData.favorites.length === 0) {
        const container = createContainer(0xCAD7E6);
        addTextDisplay(container, [
            `## 💜 Your Favorites`,
            '',
            `> You haven't set any favorites yet!`,
            '',
            `-# Use \`afavorites add <character>\` to showcase your best cards`,
        ].join('\n'));
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    const lines = playerData.favorites.map((charId, i) => {
        const char = animeManager.CHARACTERS.find(c => c.id === charId);
        if (!char) return null;
        const rarity = animeManager.RARITIES[char.rarity];
        return `**${i + 1}.** ${rarity.emoji} **${char.name}** — *${char.anime}*`;
    }).filter(Boolean);

    const container = createContainer(0x9B59B6);
    addTextDisplay(container, [
        `## 💜 ${user.username}'s Favorites`,
        '',
        lines.join('\n'),
        '',
        `-# ${playerData.favorites.length}/${MAX_FAVORITES} slots • These show on your anime profile`,
    ].join('\n'));
    return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('afavorites')
        .setDescription('Manage your favorite anime characters')
        .addSubcommand(sub => sub.setName('view').setDescription('View your favorites'))
        .addSubcommand(sub => sub.setName('add').setDescription('Add to favorites')
            .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(true)))
        .addSubcommand(sub => sub.setName('remove').setDescription('Remove from favorites')
            .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(true))),
    prefix: 'afavorites',
    description: 'Manage your favorite anime characters (showcased on profile)',
    usage: 'afavorites [add|remove] [character]',
    aliases: ['afav', 'favs', 'animefav'],
    category: 'anime',

    async executePrefix(message, args) {
        let action = 'view';
        let characterName = null;

        if (args[0] && ['add', 'remove', 'del', 'delete'].includes(args[0].toLowerCase())) {
            action = args[0].toLowerCase() === 'add' ? 'add' : 'remove';
            characterName = args.slice(1).join(' ');
        }

        return handleFavorites(message.reply.bind(message), message.author, message.guild?.id, action, characterName);
    },

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const characterName = interaction.options?.getString('character') || null;
        return handleFavorites(interaction.reply.bind(interaction), interaction.user, interaction.guild?.id, sub, characterName);
    },
};
