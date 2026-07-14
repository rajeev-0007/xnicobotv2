'use strict';

const {
    SlashCommandBuilder, MessageFlags, AttachmentBuilder,
    MediaGalleryBuilder, MediaGalleryItemBuilder,
    ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');
const { createCanvas } = require('@napi-rs/canvas');
const { createContainer, addTextDisplay } = require('../../utils/componentHelpers');
const { drawRoundedRect, truncateText } = require('../../utils/canvasDesign');
const { registerAllFonts, getFontHelpers } = require('../../utils/fontRegistry');
const animeManager = require('../../utils/animeManager');
const { EMOJIS: AE } = require('../../utils/animeEmojis');
const economyManager = require('../../utils/economyManager');
const imageCache = require('../../utils/imageCache');
const cooldowns = require('../../utils/animeCooldowns');
const combat = require('../../utils/animeCombat');

try { registerAllFonts(); } catch {}

const WIN_REWARD = 120;
const CHALLENGE_TIMEOUT = 60_000;

/** Strongest owned character, factoring in its equipped weapon. */
function strongestCard(playerData) {
    combat.ensureCombatState(playerData);
    let best = null, bestVal = -1, bestWeapon = null;
    const seen = new Set();
    for (const entry of playerData.collection) {
        if (seen.has(entry.charId)) continue;
        seen.add(entry.charId);
        const char = animeManager.getCharacters().find(c => c.id === entry.charId);
        if (!char) continue;
        const weapon = combat.getEquippedWeapon(playerData, char.id);
        const val = combat.battlePower(char, weapon);
        if (val > bestVal) { bestVal = val; best = char; bestWeapon = weapon; }
    }
    return best ? { char: best, weapon: bestWeapon } : null;
}

async function renderVs(a, b, winnerSide) {
    const fh = getFontHelpers('Inter');
    const W = 620, H = 380;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0f1116'; ctx.fillRect(0, 0, W, H);

    const drawSide = async (fighter, x, isWinner) => {
        const char = fighter.char;
        const iw = 240, ih = 230, iy = 34;
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
        ctx.fillText(truncateText(ctx, char.name, iw), x + iw / 2, iy + ih + 28);

        const rarity = animeManager.RARITIES[char.rarity];
        ctx.fillStyle = '#' + (rarity.color || 0x8b949e).toString(16).padStart(6, '0');
        ctx.font = fh.getSemiBoldFont(12);
        ctx.fillText(`${rarity.name.toUpperCase()}${fighter.weapon ? ' · ' + fighter.weapon.name : ''}`, x + iw / 2, iy + ih + 48);

        const ab = combat.getAbility(char);
        ctx.fillStyle = '#8b949e'; ctx.font = fh.getFont(11);
        ctx.fillText(truncateText(ctx, ab.name, iw), x + iw / 2, iy + ih + 66);

        if (isWinner) { ctx.fillStyle = '#57F287'; ctx.font = fh.getBoldFont(13); ctx.fillText('WINNER', x + iw / 2, iy + 22); }
        ctx.textAlign = 'left';
    };

    await drawSide(a, 20, winnerSide === 'a');
    await drawSide(b, W - 260, winnerSide === 'b');

    ctx.fillStyle = '#E74C3C'; ctx.font = fh.getBoldFont(40); ctx.textAlign = 'center';
    ctx.fillText('VS', W / 2, H / 2 - 10);
    ctx.textAlign = 'left';
    return canvas.toBuffer('image/png');
}

/** Resolve the accepted battle: simulate, reward winner, render the card. */
async function resolveBattle(author, opponent) {
    const animeData = animeManager.loadAnimeData();
    const aData = animeManager.getPlayerData(animeData, author.id);
    const bData = animeManager.getPlayerData(animeData, opponent.id);

    const aPick = strongestCard(aData);
    const bPick = strongestCard(bData);
    if (!aPick) return { error: `${author.username} has no cards to battle with.` };
    if (!bPick) return { error: `${opponent.username} has no cards to battle with.` };

    const result = combat.simulate(
        { char: aPick.char, weapon: aPick.weapon, name: author.username },
        { char: bPick.char, weapon: bPick.weapon, name: opponent.username },
    );
    const winnerSide = result.winner === 'A' ? 'a' : 'b';
    const winner = winnerSide === 'a' ? author : opponent;

    // Reward winner
    const economy = economyManager.loadEconomy();
    const { userData } = economyManager.getUser(economy, winner.id);
    userData.coins += WIN_REWARD;
    economyManager.saveEconomy(economy);

    // Stamp challenger cooldown now that a real battle happened.
    cooldowns.set(aData, 'abattle');
    animeManager.saveAnimeData();

    const buffer = await renderVs(
        { char: aPick.char, weapon: aPick.weapon },
        { char: bPick.char, weapon: bPick.weapon },
        winnerSide,
    );

    const c = createContainer(winnerSide === 'a' ? 0x57F287 : 0xED4245);
    addTextDisplay(c, [
        `## ${AE.fire} Card Battle Result`,
        `> ${author.username}'s **${aPick.char.name}** ${aPick.weapon ? `(${aPick.weapon.emoji})` : ''} vs ${opponent.username}'s **${bPick.char.name}** ${bPick.weapon ? `(${bPick.weapon.emoji})` : ''}`,
        `> ${combat.getAbility(aPick.char).emoji} ${combat.getAbility(aPick.char).name}  ⚔  ${combat.getAbility(bPick.char).emoji} ${combat.getAbility(bPick.char).name}`,
        '',
        `> ${AE.trophy} **Winner:** ${winner.username}  (+${WIN_REWARD} ${AE.money})`,
        `-# Remaining HP — ${author.username}: ${result.aHp} · ${opponent.username}: ${result.bHp}`,
    ].join('\n'));
    c.addMediaGalleryComponents(
        new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://battle.png'))
    );
    return { container: c, files: [new AttachmentBuilder(buffer, { name: 'battle.png' })] };
}

async function handleBattle(reply, author, opponent, guildId) {
    await animeManager.ensurePool();
    if (!opponent || opponent.bot || opponent.id === author.id) {
        const c = createContainer(0xED4245);
        addTextDisplay(c, `## ${AE.cancel} Invalid Opponent\nMention a real user to battle: \`abattle @user\``);
        return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    const animeData = animeManager.loadAnimeData();
    const aData = animeManager.getPlayerData(animeData, author.id);
    const bData = animeManager.getPlayerData(animeData, opponent.id);

    // Challenger cooldown
    const cd = cooldowns.check(aData, 'abattle');
    if (!cd.ok) {
        const c = createContainer(0xED4245);
        addTextDisplay(c, `## ${AE.clock} Battle Cooldown\n> Try \`abattle\` again in **${cooldowns.fmt(cd.remaining)}**.`);
        return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }
    if (!strongestCard(aData)) {
        const c = createContainer(0xED4245);
        addTextDisplay(c, `## ${AE.cancel} No Cards\nYou need cards to battle. Use \`aroll\`.`);
        return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }
    if (!strongestCard(bData)) {
        const c = createContainer(0xED4245);
        addTextDisplay(c, `## ${AE.cancel} No Cards\n**${opponent.username}** has no cards yet.`);
        return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    // ── Challenge with Accept / Deny ──
    const challenge = createContainer(0x5865F2);
    addTextDisplay(challenge, [
        `## ${AE.fire} Battle Challenge`,
        `> ${author} challenges ${opponent} to an anime card battle!`,
        '',
        `> <@${opponent.id}>, do you accept?`,
        `-# Winner earns ${AE.money} ${WIN_REWARD} coins • Expires in ${CHALLENGE_TIMEOUT / 1000}s`,
    ].join('\n'));
    challenge.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('abt_accept').setLabel('Accept').setEmoji(AE.check).setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('abt_deny').setLabel('Deny').setEmoji(AE.cancel).setStyle(ButtonStyle.Danger),
    ));

    const message = await reply({ content: `<@${opponent.id}>`, components: [challenge], flags: MessageFlags.IsComponentsV2 });
    if (!message || typeof message.createMessageComponentCollector !== 'function') return message;

    const collector = message.createMessageComponentCollector({
        filter: (i) => i.customId === 'abt_accept' || i.customId === 'abt_deny',
        time: CHALLENGE_TIMEOUT,
    });

    let settled = false;
    collector.on('collect', async (i) => {
        // Only the challenged opponent may respond.
        if (i.user.id !== opponent.id) {
            return i.reply({ content: `${AE.cancel} Only <@${opponent.id}> can respond to this challenge.`, flags: MessageFlags.Ephemeral }).catch(() => {});
        }
        if (i.customId === 'abt_deny') {
            settled = true;
            collector.stop('denied');
            const c = createContainer(0x99AAB5);
            addTextDisplay(c, `## ${AE.cancel} Challenge Declined\n> ${opponent.username} declined the battle.`);
            return i.update({ content: null, components: [c], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }
        // Accept → resolve
        settled = true;
        collector.stop('accepted');
        await i.deferUpdate().catch(() => {});
        const res = await resolveBattle(author, opponent);
        if (res.error) {
            const c = createContainer(0xED4245);
            addTextDisplay(c, `## ${AE.cancel} Battle Cancelled\n> ${res.error}`);
            return i.editReply({ content: null, components: [c], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }
        await i.editReply({ content: null, components: [res.container], files: res.files, flags: MessageFlags.IsComponentsV2 }).catch(() => {});
    });

    collector.on('end', async (_c, reason) => {
        if (settled) return;
        const c = createContainer(0x99AAB5);
        addTextDisplay(c, `## ${AE.clock} Challenge Expired\n> ${opponent.username} didn't respond in time.`);
        await message.edit({ content: null, components: [c], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
    });

    return message;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('abattle')
        .setDescription('Challenge another user to an anime card battle')
        .addUserOption(o => o.setName('user').setDescription('Opponent').setRequired(true)),
    prefix: 'abattle',
    description: 'Challenge another user to an anime card battle (accept/deny)',
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
        return handleBattle(
            async (payload) => { await interaction.editReply(payload); return interaction.fetchReply(); },
            interaction.user, opponent, interaction.guild?.id
        );
    },
};
