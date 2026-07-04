const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, SectionBuilder, ThumbnailBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } = require('discord.js');
const { buildErrorResponse, COLORS } = require('../../utils/responseBuilder');

const POPULAR_SYMBOLS = {
    'AAPL': 'Apple Inc.', 'GOOGL': 'Alphabet Inc.', 'MSFT': 'Microsoft Corp.',
    'AMZN': 'Amazon.com Inc.', 'TSLA': 'Tesla Inc.', 'META': 'Meta Platforms Inc.',
    'NVDA': 'NVIDIA Corp.', 'NFLX': 'Netflix Inc.', 'AMD': 'AMD Inc.',
    'DIS': 'Walt Disney Co.', 'BA': 'Boeing Co.', 'JPM': 'JPMorgan Chase',
    'V': 'Visa Inc.', 'PYPL': 'PayPal Holdings', 'INTC': 'Intel Corp.'
};

async function fetchStock(symbol) {
    // Yahoo Finance v8 chart endpoint (no API key needed)
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=5m`;
    const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (!res.ok) {
        if (res.status === 404) return null;
        throw new Error(`API returned ${res.status}`);
    }
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) return null;
    return result;
}

function buildStockContainer(data, symbol) {
    const meta = data.meta;
    const price = meta.regularMarketPrice;
    const prevClose = meta.chartPreviousClose || meta.previousClose;
    const change = price - prevClose;
    const changePercent = ((change / prevClose) * 100).toFixed(2);
    const isUp = change >= 0;
    const arrow = isUp ? '📈' : '📉';
    const sign = isUp ? '+' : '';
    const color = isUp ? COLORS.SUCCESS : COLORS.ERROR;

    const name = POPULAR_SYMBOLS[symbol.toUpperCase()] || meta.shortName || meta.symbol || symbol;

    const container = new ContainerBuilder().setAccentColor(color);

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `# ${arrow} ${symbol.toUpperCase()} — ${name}\n` +
            `### $${price.toFixed(2)} ${meta.currency || 'USD'}\n` +
            `> ${sign}${change.toFixed(2)} (${sign}${changePercent}%) today`
        )
    );

    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

    const high = meta.regularMarketDayHigh || meta.dayHigh;
    const low = meta.regularMarketDayLow || meta.dayLow;
    const volume = meta.regularMarketVolume;
    const fiftyTwo = meta.fiftyTwoWeekHigh && meta.fiftyTwoWeekLow;

    let details = `**Market Data**\n`;
    if (prevClose) details += `> Previous Close: **$${prevClose.toFixed(2)}**\n`;
    if (high) details += `> Day High: **$${high.toFixed(2)}**\n`;
    if (low) details += `> Day Low: **$${low.toFixed(2)}**\n`;
    if (volume) details += `> Volume: **${volume.toLocaleString()}**\n`;
    if (fiftyTwo) details += `> 52-Week: **$${meta.fiftyTwoWeekLow.toFixed(2)}** — **$${meta.fiftyTwoWeekHigh.toFixed(2)}**\n`;

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(details));

    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `-# ${meta.exchangeName || 'Market'} • ${meta.currency || 'USD'} • Data from Yahoo Finance`
        )
    );

    return container;
}

module.exports = {
    prefix: 'stockprice',
    description: 'Get real-time stock market data for a ticker symbol',
    usage: 'stockprice <symbol>',
    category: 'basic',
    aliases: ['stonk', 'stonks'],

    data: new SlashCommandBuilder()
        .setName('stockprice')
        .setDescription('Get real-time stock market data for a ticker symbol')
        .addStringOption(opt =>
            opt.setName('symbol')
                .setDescription('Stock ticker symbol (e.g. AAPL, TSLA)')
                .setRequired(true)
        ),

    async execute(interaction) {
        const symbol = interaction.options.getString('symbol').toUpperCase();
        await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
        try {
            const data = await fetchStock(symbol);
            if (!data) {
                const err = buildErrorResponse('Not Found', `No stock data found for **${symbol}**.`);
                return interaction.editReply({ components: [err], flags: MessageFlags.IsComponentsV2 });
            }
            const container = buildStockContainer(data, symbol);
            await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            const err = buildErrorResponse('Error', 'Failed to fetch stock data.', error.message);
            await interaction.editReply({ components: [err], flags: MessageFlags.IsComponentsV2 });
        }
    },

    async executePrefix(message, args) {
        if (!args[0]) {
            const err = buildErrorResponse('Missing Symbol', 'Please provide a stock ticker symbol.\nExample: `stocks AAPL`');
            return message.reply({ components: [err], flags: MessageFlags.IsComponentsV2 });
        }
        const symbol = args[0].toUpperCase();
        try {
            const data = await fetchStock(symbol);
            if (!data) {
                const err = buildErrorResponse('Not Found', `No stock data found for **${symbol}**.`);
                return message.reply({ components: [err], flags: MessageFlags.IsComponentsV2 });
            }
            const container = buildStockContainer(data, symbol);
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            const err = buildErrorResponse('Error', 'Failed to fetch stock data.', error.message);
            await message.reply({ components: [err], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
