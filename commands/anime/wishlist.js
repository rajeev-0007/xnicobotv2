'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { createContainer, addTextDisplay } = require('../../utils/componentHelpers');
const animeManager = require('../../utils/animeManager');

const MAX_WISHLIST = 10;

async function handleWishlist(reply, user, guildId, action = 'view', characterName = null) {
    const animeData = animeManager.loadAnimeData();
    const playerData = animeManager.getPlayerData(animeData, user.id);

    if (action === 'add') {
        if (!characterName) {
            const container = createContainer(0xED4245);
            addTextDisplay(container, `## ❌ Error\nPlease specify a character name to add.`);
            return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const char = animeManager.findCharacter(characterName);
        if (!char) {
            const container = createContainer(0xED4245);
            addTextDisplay(container, `## ❌ Not Found\nCharacter "${characterName}" not found. Use \`acharlist\` to see all characters.`);
            return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (playerData.wishlist.includes(char.id)) {
            const container = createContainer(0xFEE75C);
            addTextDisplay(container, `## ⚠️ Already Added\n**${char.name}** is already on your wishlist.`);
            return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (playerData.wishlist.length >= MAX_WISHLIST) {
            const container = createContainer(0xED4245);
            addTextDisplay(container, `## ❌ Wishlist Full\nYou can only have **${MAX_WISHLIST}** characters on your wishlist. Remove one first.`);
            return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        playerData.wishlist.push(char.id);
        animeManager.saveAnimeData();

        const rarity = animeManager.RARITIES[char.rarity];
        const container = createContainer(0x57F287);
        addTextDisplay(container, [
            `## ✅ Wishlist Updated`,
            '',
            `Added ${rarity.emoji} **${char.name}** (*${char.anime}*) to your wishlist.`,
            '',
            `-# Wishlist: ${playerData.wishlist.length}/${MAX_WISHLIST} • You'll be notified when you roll this character!`,
        ].join('\n'));
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    if (action === 'remove') {
        if (!characterName) {
            const container = createContainer(0xED4245);
            addTextDisplay(container, `## ❌ Error\nPlease specify a character name to remove.`);
            return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const char = animeManager.findCharacter(characterName);
        if (!char) {
            const container = createContainer(0xED4245);
            addTextDisplay(container, `## ❌ Not Found\nCharacter "${characterName}" not found.`);
            return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const idx = playerData.wishlist.indexOf(char.id);
        if (idx === -1) {
            const container = createContainer(0xFEE75C);
            addTextDisplay(container, `## ⚠️ Not on Wishlist\n**${char.name}** is not on your wishlist.`);
            return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        playerData.wishlist.splice(idx, 1);
        animeManager.saveAnimeData();

        const container = createContainer(0x57F287);
        addTextDisplay(container, `## ✅ Removed\n**${char.name}** removed from your wishlist.`);
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    // View wishlist
    if (playerData.wishlist.length === 0) {
        const container = createContainer(0xCAD7E6);
        addTextDisplay(container, [
            `## ⭐ Your Wishlist`,
            '',
            `> Your wishlist is empty!`,
            '',
            `-# Use \`awishlist add <character>\` to add characters you want`,
        ].join('\n'));
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    const lines = playerData.wishlist.map(charId => {
        const char = animeManager.CHARACTERS.find(c => c.id === charId);
        if (!char) return null;
        const rarity = animeManager.RARITIES[char.rarity];
        const owned = animeManager.hasCharacter(playerData, charId) ? ' ✅' : '';
        return `${rarity.emoji} **${char.name}** — *${char.anime}*${owned}`;
    }).filter(Boolean);

    const container = createContainer(0xF1C40F);
    addTextDisplay(container, [
        `## ⭐ Your Wishlist`,
        '',
        lines.join('\n'),
        '',
        `-# ${playerData.wishlist.length}/${MAX_WISHLIST} slots used • ✅ = already owned`,
    ].join('\n'));
    return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('awishlist')
        .setDescription('Manage your anime character wishlist')
        .addSubcommand(sub => sub.setName('view').setDescription('View your wishlist'))
        .addSubcommand(sub => sub.setName('add').setDescription('Add a character to your wishlist')
            .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(true)))
        .addSubcommand(sub => sub.setName('remove').setDescription('Remove a character from your wishlist')
            .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(true))),
    prefix: 'awishlist',
    description: 'Manage your anime character wishlist (add/remove/view)',
    usage: 'awishlist [add|remove] [character]',
    aliases: ['awl', 'animewishlist'],
    category: 'anime',

    async executePrefix(message, args) {
        let action = 'view';
        let characterName = null;

        if (args[0] && ['add', 'remove', 'del', 'delete'].includes(args[0].toLowerCase())) {
            action = args[0].toLowerCase() === 'add' ? 'add' : 'remove';
            characterName = args.slice(1).join(' ');
        } else if (args.length > 0) {
            // Treat as view or add depending on context
            action = 'view';
        }

        return handleWishlist(message.reply.bind(message), message.author, message.guild?.id, action, characterName);
    },

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const characterName = interaction.options?.getString('character') || null;
        return handleWishlist(interaction.reply.bind(interaction), interaction.user, interaction.guild?.id, sub, characterName);
    },
};
