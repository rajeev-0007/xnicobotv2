'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { formatCoins, formatCoinsShort , coinIcon, formatCoinsAmount } = require('../../utils/currencyHelper');
const { createContainer, addTextDisplay, addSeparator, formatNumber, SeparatorSpacingSize } = require('../../utils/componentHelpers');
const economyManager = require('../../utils/economyManager');
const jsonStore = require('../../utils/jsonStore');
const { EMOJIS } = require('../../utils/economyEmojis');

const STOCKS = {
  DRPH: { name: 'DragonPharm Inc.',  emoji: '🐉', basePrice: 120 },
  MOON: { name: 'MoonBase Corp.',    emoji: '🌕', basePrice: 75  },
  ZAPP: { name: 'Zapp Energy Ltd.',  emoji: '⚡', basePrice: 200 },
  GRND: { name: 'Grindstone Co.',   emoji: '⚙', basePrice: 50  },
  LXRY: { name: 'Luxoria Holdings', emoji: '<:Sketch:1521228025365004471>', basePrice: 350 },
};

function loadStockPrices() {
  const data = jsonStore.read('stocks') || {};
  const now = Date.now();
  const HOUR = 60 * 60 * 1000;

  if (!data.lastUpdated || now - data.lastUpdated > HOUR) {
    const prices = {};
    for (const [ticker, info] of Object.entries(STOCKS)) {
      const prev = (data.prices || {})[ticker] || info.basePrice;
      const change = (Math.random() * 0.20 - 0.10);
      prices[ticker] = Math.max(1, Math.round(prev * (1 + change)));
    }
    data.prices = prices;
    data.lastUpdated = now;
    jsonStore.write('stocks', data);
  }

  return data.prices;
}

function getPriceTrend(current, base) {
  if (current >= base * 1.05) return '📈';
  if (current <= base * 0.95) return '📉';
  return '➡️';
}

async function handleStocks(reply, userId, subcommand, ticker, amount, guildId) {
  const prices = loadStockPrices();

  /* ── VIEW ── */
  if (!subcommand || subcommand === 'view') {
    const economy = economyManager.loadEconomy();
    const { userData } = economyManager.getUser(economy, userId);
    const portfolio = userData.stockPortfolio || {};

    const marketLines = Object.entries(STOCKS).map(([t, info]) => {
      const price = prices[t] || info.basePrice;
      const trend = getPriceTrend(price, info.basePrice);
      const held = portfolio[t] || 0;
      return `> ${trend} **${t}** ${info.emoji} ${info.name}\n> Price: **${formatCoins(price, guildId)}**${held ? `  ·  Held: ${held}` : ''}`;
    });

    const portfolioValue = Object.entries(portfolio).reduce((sum, [t, qty]) => sum + (prices[t] || 0) * qty, 0);
    const portfolioLines = Object.entries(portfolio)
      .filter(([, qty]) => qty > 0)
      .map(([t, qty]) => {
        const val = (prices[t] || 0) * qty;
        return `> ${STOCKS[t]?.emoji || '<:transfer:1521228019824590948>'} **${t}** × ${qty} = ${formatCoins(val, guildId)}`;
      });

    const c = createContainer(0xCAD7E6);
    addTextDisplay(c, [
      `# <:transfer:1521228019824590948> Stock Market`,
      `-# Prices refresh every hour`,
      '',
      ...marketLines,
      '',
      portfolioLines.length > 0
        ? [`**Your Portfolio** (${formatCoins(portfolioValue, guildId)}):`, ...portfolioLines].join('\n')
        : `*You don't own any stocks. Use \`/stocks buy <ticker> <amount>\`.*`,
      '',
      `**Commands:** \`/stocks buy\` · \`/stocks sell\` · \`/stocks view\``,
    ].join('\n'));
    return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
  }

  if (!ticker || !STOCKS[ticker.toUpperCase()]) {
    const valid = Object.keys(STOCKS).join(', ');
    const c = createContainer(0xED4245);
    addTextDisplay(c, `${EMOJIS.cancel} Unknown ticker. Valid tickers: \`${valid}\``);
    return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
  }

  const t = ticker.toUpperCase();
  const price = prices[t] || STOCKS[t].basePrice;
  const qty = Math.max(1, amount || 1);

  const economy = economyManager.loadEconomy();
  const { userData } = economyManager.getUser(economy, userId);
  userData.stockPortfolio = userData.stockPortfolio || {};

  /* ── BUY ── */
  if (subcommand === 'buy') {
    const cost = price * qty;
    if ((userData.coins || 0) < cost) {
      const c = createContainer(0xED4245);
      addTextDisplay(c, `${EMOJIS.cancel} Not enough coins! Need **${formatNumber(cost)}** but you have **${formatNumber(userData.coins || 0)}**.`);
      return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    userData.coins -= cost;
    userData.stockPortfolio[t] = (userData.stockPortfolio[t] || 0) + qty;
    // NOTE: stocks are an investment, not gambling — incrementing
    // `totalGambled` here was contaminating the gambler achievement
    // and the /economystats "Total Gambled" line. Removed.

    economyManager.checkAllAchievements(economy, userId);
    economyManager.saveEconomy(economy);

    const c = createContainer(0xCAD7E6);
    addTextDisplay(c, [
      `# 📈 Stocks Purchased!`,
      '',
      `${STOCKS[t].emoji} **${qty}x ${t}** (${STOCKS[t].name}) bought for **${formatCoins(cost, guildId)}**`,
      `${coinIcon(guildId)} **Wallet:** ${formatCoinsAmount(userData.coins, guildId)}`,
      `<:Box:1521228152414666833> **You now hold:** ${userData.stockPortfolio[t]}x ${t}`,
    ].join('\n'));
    return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
  }

  /* ── SELL ── */
  if (subcommand === 'sell') {
    const held = userData.stockPortfolio[t] || 0;
    const sellQty = Math.min(qty, held);

    if (sellQty <= 0) {
      const c = createContainer(0xED4245);
      addTextDisplay(c, `${EMOJIS.cancel} You don't own any **${t}** stocks!`);
      return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    const earned = price * sellQty;
    userData.coins = (userData.coins || 0) + earned;
    userData.totalEarned = (userData.totalEarned || 0) + earned;
    userData.stockPortfolio[t] = held - sellQty;
    if (userData.stockPortfolio[t] <= 0) delete userData.stockPortfolio[t];

    economyManager.checkAllAchievements(economy, userId);
    economyManager.saveEconomy(economy);

    const c = createContainer(0xCAD7E6);
    addTextDisplay(c, [
      `# 📉 Stocks Sold!`,
      '',
      `${STOCKS[t].emoji} Sold **${sellQty}x ${t}** for **+${formatCoins(earned, guildId)}**`,
      `${coinIcon(guildId)} **Wallet:** ${formatCoinsAmount(userData.coins, guildId)}`,
      `<:Box:1521228152414666833> **Remaining:** ${userData.stockPortfolio[t] || 0}x ${t}`,
    ].join('\n'));
    return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stocks')
    .setDescription('Buy and sell fictional stocks — prices fluctuate every hour')
    .addSubcommand(sub => sub.setName('view').setDescription('View the stock market and your portfolio'))
    .addSubcommand(sub => sub.setName('buy')
      .setDescription('Buy stocks')
      .addStringOption(o => o.setName('ticker').setDescription('Stock ticker (DRPH, MOON, ZAPP, GRND, LXRY)').setRequired(true))
      .addIntegerOption(o => o.setName('amount').setDescription('Quantity to buy').setRequired(false).setMinValue(1).setMaxValue(1000)))
    .addSubcommand(sub => sub.setName('sell')
      .setDescription('Sell stocks from your portfolio')
      .addStringOption(o => o.setName('ticker').setDescription('Stock ticker').setRequired(true))
      .addIntegerOption(o => o.setName('amount').setDescription('Quantity to sell').setRequired(false).setMinValue(1).setMaxValue(1000))),
  prefix: 'stocks',
  aliases: ['stock'],
  category: 'economy',
  description: 'Buy and sell fictional stocks',
  usage: 'stocks <view|buy|sell> [ticker] [amount]',

  async executePrefix(message, args) {
    const sub = args[0]?.toLowerCase() || 'view';
    const ticker = args[1]?.toUpperCase();
    const amount = parseInt(args[2]);
    return handleStocks(message.reply.bind(message), message.author.id, sub, ticker, isNaN(amount) ? 1 : amount, message.guild?.id);
  },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const ticker = sub !== 'view' ? interaction.options.getString('ticker') : null;
    const amount = sub !== 'view' ? (interaction.options.getInteger('amount') || 1) : 1;
    return handleStocks(interaction.reply.bind(interaction), interaction.user.id, sub, ticker, amount, interaction.guild?.id);
  },
};
