'use strict';

const { SlashCommandBuilder, MessageFlags, AttachmentBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder } = require('discord.js');
const { createCanvas } = require('@napi-rs/canvas');
const { createContainer, addTextDisplay } = require('../../utils/componentHelpers');
const { drawRoundedRect, truncateText } = require('../../utils/canvasDesign');
const { registerAllFonts, getFontHelpers } = require('../../utils/fontRegistry');
const animeManager = require('../../utils/animeManager');
const economyManager = require('../../utils/economyManager');
const imageCache = require('../../utils/imageCache');

try { registerAllFonts(); } catch {}

const WIN_REWARD = 120;

function strongestCard(playerData) {
    let best = null, bestVal = -1;
    const seen = new Set();
    for (const entry of playerData.collection) {
        if (seen.has(entry.charId)) continue;
        seen.add(entry.charId);
        const char = animeManager.getCharacters().find(c => c.id === entry.charId);
        if (!char) continue;
        const val = animeManager.RARITIES[char.rarity].value + (char.favourites || 0) / 100;
        if (val > bestVal) { bestVal = val; best = char; }
    }
    return best;
}

function power(char) {
    return animeManager.RARITIES[char.rarity].value + (char.favourites || 0) / 50;
}

async function renderVs(a, b, winnerSide) {
    const fh = getFontHelpers('Inter');
    const W = 620, H = 360;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0f1116'; ctx.fillRect(0, 0, W, H);

    const drawSide = async (char, x, isWinner) => {
        const iw = 240, ih = 240, iy = 40;
        let img = null;
        try { img = await imageCache.loadWithCache(char.image, 6000); } catch {}
        if (img) {
            ctx.save(); drawRoundedRect(ctx, x, iy, iw, ih, 12); ctx.clip();
            const scale = Math.max(iw / img.width, ih / img.height);
            const dw = img.width * scale, dh = img.height * scale;
            ctx.drawImage(img, x + (iw - dw) / 2, iy + (ih - dh) / 2, dw, dh);
            ctx.restore();
        } else { drawRoundedRect(ctx, x, iy, iw, ih, 12); ctx.fillStyle = '#1a1d24'; ctx.fill(); }
        const col = isWinner ? '#57F287' : '#8b949e';
        ctx.strokeStyle = col; ctx.lineWidth = isWinner ? 4 : 2;
        drawRoundedRect(ctx, x, iy, iw, ih, 12); ctx.stroke();
        ctx.fillStyle = '#e6edf3'; ctx.font = fh.getBoldFont(18); ctx.textAlign = 'center';
        ctx.fillText(truncateText(ctx, char.name, iw), x + iw / 2, iy + ih + 30);
        ctx.fillStyle = animeManager.RARITIES[char.rarity].color ? '#' + animeManager.RARITIES[char.rarity].color.toString(16) : '#8b949e';
        ctx.font = fh.getSemiBoldFont(12);
        ctx.fillText(animeManager.RARITIES[char.rarity].name.toUpperCase(), x + iw / 2, iy + ih + 50);
        if (isWinner) { ctx.fillStyle = '#57F287'; ctx.font = fh.getBoldFont(13); ctx.fillText('WINNER', x + iw / 2, iy + 24); }
        ctx.textAlign = 'left';
    };

    await drawSide(a, 20, winnerSide === 'a');
    await drawSide(b, W - 260, winnerSide === 'b');

    ctx.fillStyle = '#E74C3C'; ctx.font = fh.getBoldFont(40); ctx.textAlign = 'center';
    ctx.fillText('VS', W / 2, H / 2 + 10);
    ctx.textAlign = 'left';
    return canvas.toBuffer('image/png');
}

async function handleBattle(reply, author, opponent, guildId) {
    await animeManager.ensurePool();
    if (!opponent || opponent.bot || opponent.id === author.id) {
        const c = createContainer(0xED4245);
        addTextDisplay(c, `## <:Cancel:1521227723916181644> Invalid Opponent\nMention a real user to battle: \`abattle @user\``);
        return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    const animeData = animeManager.loadAnimeData();
    const aData = animeManager.getPlayerData(animeData, author.id);
    const bData = animeManager.getPlayerData(animeData, opponent.id);

    const aCard = strongestCard(aData);
    const bCard = strongestCard(bData);
    if (!aCard) { const c = createContainer(0xED4245); addTextDisplay(c, `## <:Cancel:1521227723916181644> No Cards\nYou need cards to battle. Use \`aroll\`.`); return reply({ components: [c], flags: MessageFlags.IsComponentsV2 }); }
    if (!bCard) { const c = createContainer(0xED4245); addTextDisplay(c, `## <:Cancel:1521227723916181644> No Cards\n**${opponent.username}** has no cards yet.`); return reply({ components: [c], flags: MessageFlags.IsComponentsV2 }); }

    // Weighted random outcome based on power
    const pa = power(aCard) * (0.6 + Math.random() * 0.8);
    const pb = power(bCard) * (0.6 + Math.random() * 0.8);
    const winnerSide = pa >= pb ? 'a' : 'b';
    const winner = winnerSide === 'a' ? author : opponent;

    // Reward winner
    const economy = economyManager.loadEconomy();
    const { userData } = economyManager.getUser(economy, winner.id);
    userData.coins += WIN_REWARD;
    economyManager.saveEconomy(economy);

    const buffer = await renderVs(aCard, bCard, winnerSide);
    const c = createContainer(winnerSide === 'a' ? 0x57F287 : 0xED4245);
    addTextDisplay(c, [
        `## ⚔️ Card Battle`,
        `> ${author.username}'s **${aCard.name}** vs ${opponent.username}'s **${bCard.name}**`,
        `> 🏆 **Winner:** ${winner.username}  (+${WIN_REWARD} 💰)`,
        `-# Outcome weighted by rarity & popularity`,
    ].join('\n'));
    c.addMediaGalleryComponents(
        new MediaGalleryBuilder().addItems(
            new MediaGalleryItemBuilder().setURL('attachment://battle.png')
        )
    );
    return reply({ components: [c], files: [new AttachmentBuilder(buffer, { name: 'battle.png' })], flags: MessageFlags.IsComponentsV2 });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('abattle')
        .setDescription('Battle your strongest anime card against another user')
        .addUserOption(o => o.setName('user').setDescription('Opponent').setRequired(true)),
    prefix: 'abattle',
    description: 'Battle your strongest anime card against another user',
    usage: 'abattle <@user>',
    aliases: ['cardbattle', 'animebattle'],
    category: 'anime',

    async executePrefix(message, args) {
        const opponent = message.mentions.users.first();
        await message.channel.sendTyping().catch(() => {});
        return handleBattle(message.reply.bind(message), message.author, opponent, message.guild?.id);
    },

    async execute(interaction) {
        const opponent = interaction.options.getUser('user');
        await interaction.deferReply();
        return handleBattle((p) => interaction.editReply(p), interaction.user, opponent, interaction.guild?.id);
    },
};
