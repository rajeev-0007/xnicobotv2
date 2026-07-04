'use strict';

/**
 * animeDrops.js — Automated "character drop" system (Mudae/Karuta style).
 *
 * When enabled for a guild, the bot periodically drops a random anime
 * character card in the configured channel as message activity flows.
 * The first user to click **Claim** adds the character to their collection
 * for free. Creates an addictive "be online to catch rares" loop.
 *
 * Config store: `anime_drops_config` → { [guildId]: { enabled, channelId } }
 * Runtime cooldown/threshold tracked in memory.
 */

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder } = require('discord.js');
const { db } = require('./database');
const animeManager = require('./animeManager');
const animeCard = require('./animeCardCanvas');

const CFG_KEY = 'anime_drops_config';

// Drop tuning
const MSG_THRESHOLD = 25;      // messages in a channel before a drop is eligible
const DROP_CHANCE = 0.35;      // chance once threshold hit
const CHANNEL_COOLDOWN = 8 * 60 * 1000; // min 8 min between drops per channel
const CLAIM_WINDOW = 60 * 1000; // 60s to claim

// Runtime state
const _msgCounts = new Map();   // channelId -> count since last drop
const _lastDrop = new Map();    // channelId -> timestamp
const _activeDrops = new Map(); // messageId -> { charId, claimed }

async function loadConfig() { return (await db.get(CFG_KEY)) || {}; }
async function saveConfig(cfg) { await db.set(CFG_KEY, cfg); }

async function getGuildConfig(guildId) {
    const cfg = await loadConfig();
    return cfg[guildId] || null;
}

async function setGuildConfig(guildId, patch) {
    const cfg = await loadConfig();
    cfg[guildId] = { ...(cfg[guildId] || {}), ...patch };
    await saveConfig(cfg);
    return cfg[guildId];
}

async function disableGuild(guildId) {
    const cfg = await loadConfig();
    if (cfg[guildId]) { cfg[guildId].enabled = false; await saveConfig(cfg); }
}

/**
 * Called from messageCreate. Non-blocking; fires a drop when eligible.
 */
async function onMessage(message) {
    try {
        if (!message.guild || message.author.bot) return;
        const gConf = await getGuildConfig(message.guild.id);
        if (!gConf || !gConf.enabled) return;

        // Restrict to configured channel if set
        if (gConf.channelId && gConf.channelId !== message.channel.id) return;

        const chId = message.channel.id;
        const now = Date.now();

        // Cooldown gate
        if (now - (_lastDrop.get(chId) || 0) < CHANNEL_COOLDOWN) return;

        const count = (_msgCounts.get(chId) || 0) + 1;
        _msgCounts.set(chId, count);
        if (count < MSG_THRESHOLD) return;

        // Eligible — roll the dice
        if (Math.random() > DROP_CHANCE) return;

        _msgCounts.set(chId, 0);
        _lastDrop.set(chId, now);

        await dropCharacter(message.channel);
    } catch { /* never break messageCreate */ }
}

async function dropCharacter(channel) {
    await animeManager.ensurePool();
    const character = animeManager.rollCharacter();
    const rarity = animeManager.RARITIES[character.rarity];

    const buffer = await animeCard.renderCard(character, {});
    const attachment = new AttachmentBuilder(buffer, { name: 'drop.png' });

    const container = new ContainerBuilder().setAccentColor(rarity.color);
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `## <:Present:1521228115655917659> A wild **${character.name}** appeared!\n` +
        `> ${rarity.emoji} **${rarity.name}** • from *${character.anime}*\n` +
        `-# First to click **Claim** keeps it! (${CLAIM_WINDOW / 1000}s)`
    ));

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('adrop_claim').setLabel('Claim').setEmoji('<:Present:1521228115655917659>').setStyle(ButtonStyle.Success)
    );

    const msg = await channel.send({ components: [container, row], files: [attachment], flags: MessageFlags.IsComponentsV2 }).catch(() => null);
    if (!msg) return;

    _activeDrops.set(msg.id, { charId: character.id, claimed: false });

    // Auto-expire
    setTimeout(async () => {
        const drop = _activeDrops.get(msg.id);
        if (drop && !drop.claimed) {
            _activeDrops.delete(msg.id);
            const expired = new ContainerBuilder().setAccentColor(0x95A5A6);
            expired.addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `## <:Clock:1521228110408847623> Unclaimed\n> **${character.name}** escaped! Nobody claimed it in time.`
            ));
            await msg.edit({ components: [expired], files: [], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }
    }, CLAIM_WINDOW + 500);
}

/**
 * Handle the Claim button. Returns true if handled.
 */
async function handleClaim(interaction) {
    if (interaction.customId !== 'adrop_claim') return false;

    const drop = _activeDrops.get(interaction.message.id);
    if (!drop || drop.claimed) {
        await interaction.reply({ content: '<:Cancel:1521227723916181644> This drop was already claimed or expired.', flags: MessageFlags.Ephemeral }).catch(() => {});
        return true;
    }

    drop.claimed = true;
    _activeDrops.set(interaction.message.id, drop);

    await animeManager.ensurePool();
    const character = animeManager.getCharacters().find(c => c.id === drop.charId);
    if (!character) {
        await interaction.reply({ content: '<:Cancel:1521227723916181644> Character data unavailable.', flags: MessageFlags.Ephemeral }).catch(() => {});
        return true;
    }

    const animeData = animeManager.loadAnimeData();
    const playerData = animeManager.getPlayerData(animeData, interaction.user.id);
    const isDup = animeManager.addToCollection(playerData, character);
    animeManager.saveAnimeData();

    const rarity = animeManager.RARITIES[character.rarity];
    const claimed = new ContainerBuilder().setAccentColor(0x57F287);
    claimed.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `## <:Checkedbox:1521227734943269077> Claimed by ${interaction.user}!\n` +
        `> ${rarity.emoji} **${character.name}** — *${character.anime}*${isDup ? ' *(duplicate)*' : ''}\n` +
        `-# Added to their collection • \`acollection\``
    ));
    await interaction.update({ components: [claimed], files: [], flags: MessageFlags.IsComponentsV2 }).catch(async () => {
        await interaction.reply({ content: `<:Checkedbox:1521227734943269077> You claimed **${character.name}**!`, flags: MessageFlags.Ephemeral }).catch(() => {});
    });
    _activeDrops.delete(interaction.message.id);
    return true;
}

module.exports = {
    onMessage,
    handleClaim,
    dropCharacter,
    getGuildConfig,
    setGuildConfig,
    disableGuild,
};
