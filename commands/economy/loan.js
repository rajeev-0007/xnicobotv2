'use strict';

/**
 * /loan — Borrow + repay system with a reputation tier ladder.
 *
 * Flow
 * ────
 *   /loan status              View active loans + your tier
 *   /loan take <amount>       Borrow up to your tier's max
 *   /loan repay [amount|all]  Repay; clean repays move you up tiers
 *
 * Tiers (utils/loanTier.js):
 *   • New Borrower (default) ── 50k max  / 10%/day
 *   • Reliable     (3+ clean) ── 100k max / 9%/day
 *   • Trusted      (7+ clean) ── 250k max / 8%/day
 *   • VIP Borrower (15+ clean) ── 500k max / 7%/day
 *
 * `economyManager.addLoan` now stamps the per-loan interest from the
 * caller's tier, so a Trusted borrower's loan accrues at 8% even if
 * they later regress — the originally-quoted rate is honored.
 */

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { formatCoins, formatCoinsShort, coinIcon, formatCoinsAmount } = require('../../utils/currencyHelper');
const { createContainer, addTextDisplay, formatNumber, addSeparator, SeparatorSpacingSize } = require('../../utils/componentHelpers');
const economyManager = require('../../utils/economyManager');
const { EMOJIS } = require('../../utils/economyEmojis');
const { getLoanTier, getNextTier } = require('../../utils/loanTier');

async function handleLoan(reply, userId, subcommand, amount, guildId) {
  const economy = economyManager.loadEconomy();
  const { userData } = economyManager.getUser(economy, userId);
  const tier = getLoanTier(userData);
  const nextTier = getNextTier(userData);

  /* ── STATUS ── */
  if (!subcommand || subcommand === 'status') {
    const loans = Array.isArray(userData.loans) ? userData.loans.filter(l => !l.cleared) : [];
    const c = createContainer(0xCAD7E6);

    const tierBlock = [
      `### ${tier.emoji} ${tier.label}`,
      `> **Single-loan max:** ${formatCoins(tier.maxLoan, guildId)}`,
      `> **Total debt cap:** ${formatCoins(tier.maxDebt, guildId)}`,
      `> **Interest rate:** ${(tier.interest * 100).toFixed(0)}% / day`,
      `> **Repaid clean:** ${tier.score}/${nextTier ? nextTier.minScore : '∞'}${nextTier ? ` *(unlock ${nextTier.label} at ${nextTier.minScore})*` : ''}`,
    ].join('\n');

    if (loans.length === 0) {
      addTextDisplay(c, [
        `# <:Invoice:1521227903956811836> Loan Office`,
        '',
        `You have no outstanding loans.`,
        '',
        tierBlock,
        '',
        `**Commands**`,
        `\`/loan take <amount>\` — Borrow coins`,
        `\`/loan repay <amount|all>\` — Repay your loan(s)`,
      ].join('\n'));
    } else {
      const lines = loans.map((l, i) => {
        const days = Math.max(0, Math.floor((Date.now() - (l.takenAt || Date.now())) / 86400000));
        const rate = Number(l.interest) || tier.interest;
        const owed = Math.floor((l.amount || 0) * Math.pow(1 + rate, days));
        const accrued = owed - (l.amount || 0);
        return `> **#${i + 1}** ${formatNumber(l.amount)} principal · +${formatNumber(accrued)} interest *(${days}d @ ${(rate * 100).toFixed(0)}%)* · **${formatNumber(owed)} owed**`;
      });
      const totalOwed = loans.reduce((s, l) => {
        const days = Math.max(0, Math.floor((Date.now() - (l.takenAt || Date.now())) / 86400000));
        const rate = Number(l.interest) || tier.interest;
        return s + Math.floor((l.amount || 0) * Math.pow(1 + rate, days));
      }, 0);

      addTextDisplay(c, [
        `# <:Invoice:1521227903956811836> Your Loans`,
        '',
        ...lines,
        '',
        `${EMOJIS.invoice} **Total owed:** ${formatCoins(totalOwed, guildId)}`,
        '',
        tierBlock,
        '',
        `-# Pay within 5 days to count as a clean repay (helps tier up).`,
      ].join('\n'));
    }
    return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
  }

  /* ── TAKE ── */
  if (subcommand === 'take') {
    const loans = Array.isArray(userData.loans) ? userData.loans.filter(l => !l.cleared) : [];
    const totalOwed = loans.reduce((s, l) => s + (l.amount || 0), 0);

    if (loans.length >= 3) {
      const c = createContainer(0xED4245);
      addTextDisplay(c, `${EMOJIS.cancel} You already have **${loans.length}** active loans. Repay them first.`);
      return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    if (!amount || amount < 100 || amount > tier.maxLoan) {
      const c = createContainer(0xED4245);
      addTextDisplay(c, [
        `${EMOJIS.cancel} Enter an amount between **100** and **${formatCoins(tier.maxLoan, guildId)}**.`,
        `-# Your tier (**${tier.label}**) caps single loans at ${formatCoins(tier.maxLoan, guildId)}.`,
      ].join('\n'));
      return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    if (totalOwed + amount > tier.maxDebt) {
      const c = createContainer(0xED4245);
      addTextDisplay(c, [
        `${EMOJIS.cancel} Borrowing **${formatNumber(amount)}** would push your total debt past **${formatNumber(tier.maxDebt)}** (your tier limit).`,
        `-# Repay existing loans to free up room.`,
      ].join('\n'));
      return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    // Stamp the loan with the borrower's current tier interest, so
    // a Trusted loan keeps its 8% rate even if the borrower later
    // regresses to Reliable. addLoan accepts an interest override.
    economyManager.addLoan(economy, userId, amount, tier.interest);
    economyManager.saveEconomy(economy);

    const dayOwed = Math.floor(amount * (1 + tier.interest));
    const c = createContainer(0xCAD7E6);
    addTextDisplay(c, [
      `# <:Invoice:1521227903956811836> Loan Approved`,
      `-# ${tier.emoji} ${tier.label} tier · ${(tier.interest * 100).toFixed(0)}% daily`,
      '',
      `${coinIcon(guildId)} **Borrowed:** +${formatCoinsAmount(amount, guildId)}`,
      `📋 **After 1 day:** ${formatCoins(dayOwed, guildId)} owed`,
      '',
      `💳 **Wallet:** ${formatCoins(userData.coins, guildId)}`,
      '',
      `-# Repay within 5 days to count as a clean repay and climb tiers.`,
    ].join('\n'));
    return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
  }

  /* ── REPAY ── */
  if (subcommand === 'repay') {
    const loans = Array.isArray(userData.loans) ? userData.loans.filter(l => !l.cleared) : [];
    if (loans.length === 0) {
      const c = createContainer(0xED4245);
      addTextDisplay(c, `${EMOJIS.cancel} You have no active loans to repay!`);
      return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    // Sum compounding interest across ALL active loans using each
    // loan's stamped rate (so old Trusted loans don't suddenly cost
    // 10% if the user dropped a tier).
    const totalOwed = loans.reduce((acc, l) => {
      const days = Math.max(0, Math.floor((Date.now() - (l.takenAt || Date.now())) / 86400000));
      const rate = Number(l.interest) || tier.interest;
      return acc + Math.floor((l.amount || 0) * Math.pow(1 + rate, days));
    }, 0);
    const repayAmt = (!amount || amount < 0) ? totalOwed : Math.min(amount, totalOwed);

    if ((userData.coins || 0) < repayAmt) {
      const c = createContainer(0xED4245);
      addTextDisplay(c, `${EMOJIS.cancel} You need **${formatCoins(repayAmt, guildId)}** but only have **${formatNumber(userData.coins || 0)}**.`);
      return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    const result = economyManager.repayLoan(economy, userId, repayAmt);
    economyManager.saveEconomy(economy);

    const stillOwed = (Array.isArray(userData.loans) ? userData.loans.filter(l => !l.cleared) : [])
      .reduce((s, l) => s + (l.amount || 0), 0);

    // Did this repayment promote them to a new tier?
    const newTier = getLoanTier(userData);
    const promoted = newTier.id !== tier.id;

    const lines = [
      `# <:Checkedbox:1521227734943269077> Loan Repaid`,
      '',
      `${coinIcon(guildId)} **Paid:** ${formatCoinsAmount(result.paid || repayAmt, guildId)}`,
      result.cleared ? `${EMOJIS.check} All loans fully cleared!` : `${EMOJIS.invoice} **Still owed:** ${formatCoins(stillOwed, guildId)}`,
      `${coinIcon(guildId)} **Wallet:** ${formatCoinsAmount(userData.coins, guildId)}`,
    ];
    if (result.clearedCount > 0) {
      const lateNote = result.latePays > 0
        ? ` *(${result.latePays} late, **${result.clearedCount - result.latePays}** clean)*`
        : ` *(all clean)*`;
      lines.push('', `-# Reputation +${result.clearedCount}${lateNote} · Score: **${newTier.score}**`);
    }
    if (promoted) {
      lines.push(
        '',
        `### 🎉 Tier Up!`,
        `> ${tier.emoji} **${tier.label}** → ${newTier.emoji} **${newTier.label}**`,
        `> New limit: **${formatCoins(newTier.maxLoan, guildId)}** per loan · ${(newTier.interest * 100).toFixed(0)}% daily`,
      );
    }

    const c = createContainer(promoted ? 0xfbbf24 : 0xCAD7E6);
    addTextDisplay(c, lines.join('\n'));
    return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
  }

  const c = createContainer(0xED4245);
  addTextDisplay(c, `${EMOJIS.cancel} Unknown subcommand. Use \`take\`, \`repay\`, or \`status\`.`);
  return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
}

module.exports = {
    /**
     * Premium-gated feature. `premiumOnly` is read by the
     * command dispatcher in index.js — non-premium users get a
     * polite message instead of execution.
     */
    premiumOnly: true,

  data: new SlashCommandBuilder()
    .setName('loan')
    .setDescription('Take or repay a loan — limits scale with your repayment reputation')
    .addSubcommand(sub => sub.setName('status').setDescription('View your current loans and tier'))
    .addSubcommand(sub => sub.setName('take')
      .setDescription('Take a loan from the bank (limit scales with your tier)')
      .addIntegerOption(o => o.setName('amount').setDescription('Amount to borrow (100 to your tier max)').setRequired(true).setMinValue(100).setMaxValue(500_000)))
    .addSubcommand(sub => sub.setName('repay')
      .setDescription('Repay your loan')
      .addStringOption(o => o.setName('amount').setDescription('Amount to repay or "all"').setRequired(false))),
  prefix: 'loan',
  aliases: ['borrow'],
  category: 'economy',
  description: 'Take or repay a loan with daily compounding interest. Tier up to unlock larger loans.',
  usage: 'loan <status|take|repay> [amount]',

  async executePrefix(message, args) {
    const sub = args[0]?.toLowerCase() || 'status';
    const rawAmt = args[1];
    const amt = rawAmt === 'all' ? -1 : parseInt(rawAmt);
    return handleLoan(message.reply.bind(message), message.author.id, sub, isNaN(amt) ? null : amt, message.guild?.id);
  },

  async execute(interaction) {
    await interaction.deferReply();
    const sub = interaction.options.getSubcommand();
    let amt = null;
    if (sub === 'take') {
      amt = interaction.options.getInteger('amount');
    } else if (sub === 'repay') {
      const raw = interaction.options.getString('amount');
      amt = raw === 'all' ? -1 : (parseInt(raw) || -1);
    }
    return handleLoan(interaction.editReply.bind(interaction), interaction.user.id, sub, amt, interaction.guild?.id);
  },
};
