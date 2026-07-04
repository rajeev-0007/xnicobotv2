'use strict';

const { createContainer, addTextDisplay, addSeparator, formatNumber, MessageFlags, SeparatorSpacingSize } = require('../../utils/componentHelpers');
const { formatCoins, formatCoinsShort , coinIcon, formatCoinsAmount } = require('../../utils/currencyHelper');
const economyManager = require('../../utils/economyManager');
const { gamblingGuard } = require('../../utils/economyGuards');

const SYMBOLS = ['🍒', '🍋', '🍊', '🍇', '<:Sketch:1521228025365004471>', '7️⃣', '🌟'];
const SYMBOL_NAMES = ['cherry', 'lemon', 'orange', 'grape', 'diamond', 'seven', 'star'];
const WEIGHTS = [25, 20, 18, 15, 10, 8, 4];

const PAYOUTS = {
  '🍒🍒🍒': 3,
  '🍋🍋🍋': 4,
  '🍊🍊🍊': 5,
  '🍇🍇🍇': 7,
  '<:Sketch:1521228025365004471><:Sketch:1521228025365004471><:Sketch:1521228025365004471>': 15,
  '7️⃣7️⃣7️⃣': 30,
  '🌟🌟🌟': 100,
};

const PARTIAL_PAYOUT = 1.5;

const MIN_BET = 100;
const MAX_BET = 2_000_000;
const COOLDOWN = 5_000;
const cooldowns = new Map();

function spinReel() {
  const totalWeight = WEIGHTS.reduce((a, b) => a + b, 0);
  let roll = Math.random() * totalWeight;
  for (let i = 0; i < SYMBOLS.length; i++) {
    roll -= WEIGHTS[i];
    if (roll <= 0) return { emoji: SYMBOLS[i], name: SYMBOL_NAMES[i] };
  }
  return { emoji: SYMBOLS[0], name: SYMBOL_NAMES[0] };
}

function getMultiplier(reelEmojis) {
  const key = reelEmojis.join('');
  if (PAYOUTS[key]) return PAYOUTS[key];

  if (reelEmojis[0] === reelEmojis[1] || reelEmojis[1] === reelEmojis[2] || reelEmojis[0] === reelEmojis[2]) {
    return PARTIAL_PAYOUT;
  }

  return 0;
}

async function handleSlots(reply, userId, args, guildId, editFn) {
  const now = Date.now();

  if (cooldowns.get(userId) > now) {
    const left = Math.ceil((cooldowns.get(userId) - now) / 1000);
    const c = createContainer(0xCAD7E6);
    addTextDisplay(c, `<:Clock:1521228110408847623> Wait **${left}s** before spinning again.`);
    return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
  }

  const economy = economyManager.loadEconomy();
  const { userData } = economyManager.getUser(economy, userId);

  const betInput = args[0]?.toLowerCase();
  let bet;
  if (betInput === 'all') {
    bet = Math.min(MAX_BET, userData.coins);
  } else {
    bet = parseInt(betInput, 10);
  }

  if (!bet || isNaN(bet) || bet < MIN_BET) {
    const container = createContainer(0xCAD7E6);
    addTextDisplay(container, [
      `# <:Gamepad:1521228035213230090> Slot Machine`,
      '',
      `**Usage:** \`slots <amount>\``,
      `**Min Bet:** ${formatNumber(MIN_BET)}`,
      `**Max Bet:** ${formatNumber(MAX_BET)}`,
      '',
      `**Payouts:**`,
      `🍒🍒🍒 → 3x | 🍋🍋🍋 → 4x | 🍊🍊🍊 → 5x`,
      `🍇🍇🍇 → 7x | <:Sketch:1521228025365004471><:Sketch:1521228025365004471><:Sketch:1521228025365004471> → 15x | 7️⃣7️⃣7️⃣ → 30x`,
      `🌟🌟🌟 → **100x JACKPOT!**`,
      `2 matching → 1.5x`,
      '',
      `**Examples:** \`slots 5000\` · \`slots all\``,
    ].join('\n'));
    return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
  }

  if (bet > MAX_BET) {
    const c = createContainer(0xED4245);
    addTextDisplay(c, `<:Cancel:1521227723916181644> Maximum bet is **${formatCoins(MAX_BET, guildId)}**.`);
    return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
  }
  if (bet > userData.coins) {
    const c = createContainer(0xED4245);
    addTextDisplay(c, `<:Cancel:1521227723916181644> Not enough coins. Balance: **${formatNumber(userData.coins)}**`);
    return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
  }

  cooldowns.set(userId, now + COOLDOWN);

  // ── Determine the final result up front ──
  // We pre-roll the result so all the "spinning" frames are pure UI
  // animation — the outcome is sealed before the first frame renders.
  // This avoids any chance of the animation desyncing from what the
  // economy actually credits.
  const slotsBonus = Number(userData.bonuses?.slots) || 0;
  let spinResults = [spinReel(), spinReel(), spinReel()];
  let reelEmojis = spinResults.map(r => r.emoji);
  let multiplier = getMultiplier(reelEmojis);
  let rerolled = false;
  if (multiplier === 0 && slotsBonus > 0 && Math.random() < slotsBonus) {
    spinResults = [spinReel(), spinReel(), spinReel()];
    reelEmojis = spinResults.map(r => r.emoji);
    multiplier = getMultiplier(reelEmojis);
    rerolled = true;
  }

  /* ═══ Animation: 3 frames with progressive reveals ═══
     Frame 0: all three reels spinning (random symbols)
     Frame 1: reel 1 locks in, reels 2 + 3 still spinning
     Frame 2: reels 1 + 2 locked, reel 3 still spinning
     Frame 3: all reels locked → final result
     Each frame is ~600ms apart, total ~1.8s of "spin" before reveal. */
  function buildAnimFrame(displayedReels, statusText, color = 0xCAD7E6) {
    const c = createContainer(color);
    addTextDisplay(c, [
      `# <:Gamepad:1521228035213230090> Slot Machine`,
      '',
      `> Bet: **${formatCoins(bet, guildId)}**`,
      '',
      `## ${displayedReels.join('  |  ')}`,
      '',
      statusText,
    ].join('\n'));
    return c;
  }

  // Frame 0 — initial reply, all three spinning
  const spinPlaceholder = () => SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
  const frame0 = buildAnimFrame(
    [spinPlaceholder(), spinPlaceholder(), spinPlaceholder()],
    `<:Sandwatch:1521228272426418367> *Reels spinning…*`,
  );

  // We need an "edit" handle to roll through subsequent frames.
  // The slash path provides one via interaction.editReply, the prefix
  // path needs us to capture the reply message and edit it.
  let messageHandle = null;
  if (typeof editFn === 'function') {
    // Slash path: caller already deferred or sent. Use the editFn for
    // every subsequent frame (Frame 0 also gets edited in via editFn).
    await editFn({ components: [frame0], flags: MessageFlags.IsComponentsV2 });
    messageHandle = { edit: (payload) => editFn(payload) };
  } else {
    const sent = await reply({ components: [frame0], flags: MessageFlags.IsComponentsV2 });
    messageHandle = sent && typeof sent.edit === 'function' ? sent : null;
  }

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // Animation cadence — fast enough to feel snappy, slow enough to
  // read as a real spin. Total ~1.5s before reveal.
  if (messageHandle) {
    try {
      await sleep(450);
      await messageHandle.edit({
        components: [buildAnimFrame(
          [reelEmojis[0], spinPlaceholder(), spinPlaceholder()],
          `<:Sandwatch:1521228272426418367> *Reel 1 locked — ${reelEmojis[0]}*`,
        )],
        flags: MessageFlags.IsComponentsV2,
      });

      await sleep(450);
      await messageHandle.edit({
        components: [buildAnimFrame(
          [reelEmojis[0], reelEmojis[1], spinPlaceholder()],
          `<:Sandwatch:1521228272426418367> *Reel 2 locked — ${reelEmojis[1]}*`,
        )],
        flags: MessageFlags.IsComponentsV2,
      });

      await sleep(550);
    } catch (err) {
      // If any animation frame fails (rate limit / network blip),
      // fall through to the final result frame — the user always
      // sees the outcome and economy reflects it.
      console.warn('[SLOTS] animation frame failed, jumping to result:', err?.message || err);
    }
  }

  /* ═══ Settle the bet using the shared helper so the Medal
         bonuses.gamble bonus actually applies on wins. ═══ */
  const winningsBase = Math.floor(bet * multiplier);
  const isJackpot = reelEmojis[0] === '🌟' && reelEmojis[1] === '🌟' && reelEmojis[2] === '🌟';

  // Re-load economy in case the animation took a beat — guarantees
  // we credit/debit against the latest balance.
  const economy2 = economyManager.loadEconomy();
  const { userData: ud } = economyManager.getUser(economy2, userId);

  // Deduct + settle pattern matching the rest of the bet games. We
  // use the shared helper so Medal bonuses fire and totalGambled /
  // totalWon / totalLost stay consistent with /economystats.
  const { deductBet, settle } = require('../../utils/betGameHelper');
  deductBet(userId, bet);
  const { userData: postUser, payout: actualPayout } = settle(userId, bet, winningsBase);

  const won = actualPayout > bet;
  const profit = actualPayout - bet;
  const finalColor = won ? (isJackpot ? 0xfbbf24 : 0x22c55e) : 0xED4245;

  /* ═══ Final reveal frame ═══ */
  const resultLines = [];
  if (won) {
    resultLines.push(
      `<:Checkedbox:1521227734943269077> **${isJackpot ? '🌟 JACKPOT! ' : ''}Won ${formatCoins(profit, guildId)}!** *(${multiplier}x)*`,
    );
    if (actualPayout > winningsBase) {
      resultLines.push(`-# 🥇 Medal bonus added **+${formatCoins(actualPayout - winningsBase, guildId)}** to your win.`);
    }
  } else {
    resultLines.push(`<:Cancel:1521227723916181644> **Lost ${formatCoins(bet, guildId)}**`);
  }
  if (rerolled) {
    resultLines.push(`-# 🌟 Star Booster activated a free re-spin.`);
  }
  resultLines.push(
    '',
    `${coinIcon(guildId)} **Balance:** ${formatCoinsAmount(postUser.coins, guildId)}`,
    '',
    `-# ${won ? 'Spin again for more wins!' : 'Better luck next spin!'}`,
  );

  const finalContainer = createContainer(finalColor);
  addTextDisplay(finalContainer, [
    `# <:Gamepad:1521228035213230090> Slot Machine`,
    '',
    `> Bet: **${formatCoins(bet, guildId)}**`,
    '',
    `## ${reelEmojis.join('  |  ')}`,
  ].join('\n'));
  addSeparator(finalContainer, SeparatorSpacingSize.Small);
  addTextDisplay(finalContainer, resultLines.join('\n'));

  if (messageHandle) {
    try {
      return await messageHandle.edit({
        components: [finalContainer],
        flags: MessageFlags.IsComponentsV2,
      });
    } catch {
      // Last-resort fallback — try to send a new follow-up if the
      // edit pipeline is gone.
      return reply({ components: [finalContainer], flags: MessageFlags.IsComponentsV2 });
    }
  }
  return reply({ components: [finalContainer], flags: MessageFlags.IsComponentsV2 });
}

module.exports = {
  data: new (require('discord.js').SlashCommandBuilder)()
    .setName('slots')
    .setDescription('Play the slot machine')
    .addStringOption(o => o.setName('amount').setDescription('Amount to bet or "all"').setRequired(true)),
  prefix: 'slots',
  aliases: ['slot'],
  category: 'economy',
  description: 'Play the slot machine',

  async executePrefix(message, args) {
    if (await gamblingGuard(message)) return;
    // For prefix we need the *sent message* so we can edit it across
    // animation frames. The reply helper returns the sent message.
    const replyFn = (payload) => message.reply(payload);
    return handleSlots(replyFn, message.author.id, args, message.guild?.id, null);
  },

  async execute(interaction) {
    if (await gamblingGuard(interaction)) return;
    const amount = interaction.options?.getString('amount') || interaction.options?.getInteger('amount');
    // Defer first so animation frames can edit the same response.
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply().catch(() => {});
    }
    const editFn = (payload) => interaction.editReply(payload);
    return handleSlots(
      editFn,
      interaction.user.id,
      amount ? [String(amount)] : [],
      interaction.guild?.id,
      editFn,
    );
  }
};
