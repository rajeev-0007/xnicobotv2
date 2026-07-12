'use strict';

const { SlashCommandBuilder, MessageFlags, AttachmentBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder } = require('discord.js');
const { createCanvas } = require('@napi-rs/canvas');
const { createContainer, addTextDisplay } = require('../../utils/componentHelpers');
const animeManager = require('../../utils/animeManager');
const { EMOJIS: AE } = require('../../utils/animeEmojis');
const economyManager = require('../../utils/economyManager');
const imageCache = require('../../utils/imageCache');
const { registerAllFonts } = require('../../utils/fontRegistry');
const cooldowns = require('../../utils/animeCooldowns');

try { registerAllFonts(); } catch {}

const REWARD = 75;
const TIME = 20000;

function normalize(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Render the character image with an optional blur/silhouette for difficulty.
async function renderGuessImage(character, reveal = false) {
    const W = 340, H = 340;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0f1116'; ctx.fillRect(0, 0, W, H);

    let img = null;
    try { img = await imageCache.loadWithCache(character.image, 6000); } catch {}
    if (img) {
        const scale = Math.max(W / img.width, H / img.height);
        const dw = img.width * scale, dh = img.height * scale;
        ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
        if (!reveal) {
            // Darken to a silhouette-ish look
            ctx.fillStyle = 'rgba(0,0,0,0.72)';
            ctx.fillRect(0, 0, W, H);
        }
    }
    return canvas.toBuffer('image/png');
}

async function playGuess(context, user, channel, isInteraction, reply) {
    await animeManager.ensurePool();
    const chars = animeManager.getCharacters();
    if (!chars.length) {
        const c = createContainer(0xED4245);
        addTextDisplay(c, `## <:Cancel:1521227723916181644> Not Ready\nCharacter pool is still loading, try again shortly.`);
        return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    // Anti-abuse cooldown (starting a round counts).
    const animeData = animeManager.loadAnimeData();
    const playerData = animeManager.getPlayerData(animeData, user.id);
    const cd = cooldowns.check(playerData, 'aguess');
    if (!cd.ok) {
        const c = createContainer(0xED4245);
        addTextDisplay(c, `## ${AE.clock} Slow down!\n> Try \`aguess\` again in **${cooldowns.fmt(cd.remaining)}**.`);
        return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }
    cooldowns.set(playerData, 'aguess');
    animeManager.saveAnimeData();

    // Prefer more well-known characters for a fair guess
    const pool = chars.filter(c => ['mythic', 'legendary', 'epic', 'rare'].includes(c.rarity));
    const character = (pool.length ? pool : chars)[Math.floor(Math.random() * (pool.length ? pool.length : chars.length))];

    const buffer = await renderGuessImage(character, false);
    const c = createContainer(0x5865F2);
    addTextDisplay(c, [
        `## <:Search:1521228231263387738> Guess the Anime Character!`,
        `> Type the character's **name** in chat within **${TIME / 1000}s**.`,
        `-# Hint: from *${character.anime}* • Reward: ${AE.money} ${REWARD} coins`,
    ].join('\n'));
    c.addMediaGalleryComponents(
        new MediaGalleryBuilder().addItems(
            new MediaGalleryItemBuilder().setURL('attachment://guess.png')
        )
    );
    await reply({ components: [c], files: [new AttachmentBuilder(buffer, { name: 'guess.png' })], flags: MessageFlags.IsComponentsV2 });

    const target = normalize(character.name);
    const firstName = normalize(character.name.split(' ')[0]);
    const filter = m => m.author.id === user.id;

    try {
        const collected = await channel.awaitMessages({ filter, max: 5, time: TIME });
        
        if (collected.size === 0) {
            const revealBuf = await renderGuessImage(character, true);
            const timeout = createContainer(0xFEE75C);
            addTextDisplay(timeout, [`## <:Alarm:1521227869047750689> Time's Up!`, `> It was **${character.name}** — *${character.anime}*`].join('\n'));
            timeout.addMediaGalleryComponents(
                new MediaGalleryBuilder().addItems(
                    new MediaGalleryItemBuilder().setURL('attachment://reveal.png')
                )
            );
            return channel.send({ components: [timeout], files: [new AttachmentBuilder(revealBuf, { name: 'reveal.png' })], flags: MessageFlags.IsComponentsV2 });
        }

        let won = false;
        for (const m of collected.values()) {
            const g = normalize(m.content);
            if (g && (g === target || (firstName.length >= 4 && g === firstName) || (target.includes(g) && g.length >= 5))) { won = true; break; }
        }

        const revealBuf = await renderGuessImage(character, true);
        if (won) {
            const economy = economyManager.loadEconomy();
            const { userData } = economyManager.getUser(economy, user.id);
            userData.coins += REWARD;
            economyManager.saveEconomy(economy);
            const win = createContainer(0x57F287);
            addTextDisplay(win, [`## <:Checkedbox:1521227734943269077> Correct!`, `> It was **${character.name}** — *${character.anime}*`, `> ${AE.money} +${REWARD} coins`, `-# Use \`aroll\` to collect characters!`].join('\n'));
            win.addMediaGalleryComponents(
                new MediaGalleryBuilder().addItems(
                    new MediaGalleryItemBuilder().setURL('attachment://reveal.png')
                )
            );
            return channel.send({ components: [win], files: [new AttachmentBuilder(revealBuf, { name: 'reveal.png' })], flags: MessageFlags.IsComponentsV2 });
        } else {
            const lose = createContainer(0xED4245);
            addTextDisplay(lose, [`## <:Cancel:1521227723916181644> Not quite!`, `> It was **${character.name}** — *${character.anime}*`, `-# Better luck next time!`].join('\n'));
            lose.addMediaGalleryComponents(
                new MediaGalleryBuilder().addItems(
                    new MediaGalleryItemBuilder().setURL('attachment://reveal.png')
                )
            );
            return channel.send({ components: [lose], files: [new AttachmentBuilder(revealBuf, { name: 'reveal.png' })], flags: MessageFlags.IsComponentsV2 });
        }
    } catch {
        const revealBuf = await renderGuessImage(character, true);
        const timeout = createContainer(0xFEE75C);
        addTextDisplay(timeout, [`## <:Alarm:1521227869047750689> Time's Up!`, `> It was **${character.name}** — *${character.anime}*`].join('\n'));
        timeout.addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL('attachment://reveal.png')
            )
        );
        return channel.send({ components: [timeout], files: [new AttachmentBuilder(revealBuf, { name: 'reveal.png' })], flags: MessageFlags.IsComponentsV2 });
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('aguess')
        .setDescription('Guess the anime character from their image and earn coins!'),
    prefix: 'aguess',
    description: 'Guess the anime character from their image and earn coins!',
    usage: 'aguess',
    aliases: ['guesschar', 'ag'],
    category: 'anime',

    async execute(interaction) {
        await interaction.deferReply();
        return playGuess(interaction, interaction.user, interaction.channel, true, (p) => interaction.editReply(p));
    },

    async executePrefix(message) {
        return playGuess(message, message.author, message.channel, false, message.reply.bind(message));
    },
};
