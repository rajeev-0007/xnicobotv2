'use strict';

const { createContainer, addTextDisplay, addSeparator, formatNumber, MessageFlags, SeparatorSpacingSize } = require('../../utils/componentHelpers');
const { formatCoins, formatCoinsShort , coinIcon, formatCoinsAmount } = require('../../utils/currencyHelper');
const { parseBet, getBalance, MAX_BET } = require('../../utils/betHelper');
const { gamblingGuard } = require('../../utils/economyGuards');
const { deductBet, settle } = require('../../utils/betGameHelper');

const COOLDOWN = 5_000;
const cooldowns = new Map();

const HEADS = '<:Money:1521228266957045900>';
const TAILS = '💿';
const FLIP_FRAMES = ['🪙', '⏺️', '🔘', '⚪', '⏺️', '🪙'];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function handleBetflip(replyFn, editFn, userId, args, guildId) {
    const now = Date.now();

    if (cooldowns.get(userId) > now) {
        const left = Math.ceil((cooldowns.get(userId) - now) / 1000);
        const c = createContainer(0xCAD7E6);
        addTextDisplay(c, `<:Clock:1521228110408847623> Wait **${left}s** before flipping again.`);
        return replyFn({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    const choice = args[0]?.toLowerCase();
    if (!choice || !['h', 't', 'heads', 'tails'].includes(choice)) {
        const container = createContainer(0xCAD7E6);
        addTextDisplay(container, [
            `# ${coinIcon(guildId)} Coinflip`,
            '',
            `**Usage:** \`coinflip <heads/tails> <amount>\``,
            '',
            `**Aliases:** \`h\` = heads, \`t\` = tails`,
            `**Max Bet:** ${formatNumber(MAX_BET)}`,
            '',
            `**Examples:**`,
            `\`coinflip h 1000\``,
            `\`coinflip tails 50k\``,
            `\`coinflip h all\``,
        ].join('\n'));
        return replyFn({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    const normalizedChoice = (choice === 'h' || choice === 'heads') ? 'heads' : 'tails';
    const balance = getBalance(userId);
    const betResult = parseBet(args[1], balance);

    if (!betResult.valid) {
        return replyFn(betResult.error);
    }

    const bet = betResult.amount;
    cooldowns.set(userId, now + COOLDOWN);

    /* ═══ Pre-roll the result so animation can never desync ═══ */
    const result = Math.random() < 0.5 ? 'heads' : 'tails';
    let won = normalizedChoice === result;

    // Star booster — same +5% per stack win-rate boost as slots,
    // applied as a single re-flip on loss. Capped to one retry.
    const economyManager = require('../../utils/economyManager');
    const economyPeek = economyManager.loadEconomy();
    const { userData: peekUser } = economyManager.getUser(economyPeek, userId);
    const slotsBonus = Number(peekUser.bonuses?.slots) || 0;
    let rerolledFlip = false;
    if (!won && slotsBonus > 0 && Math.random() < slotsBonus) {
        const second = Math.random() < 0.5 ? 'heads' : 'tails';
        if (normalizedChoice === second) {
            won = true;
            rerolledFlip = true;
        }
    }

    /* ═══ Animation: 4 frames cycling through the flip art ═══ */
    function buildFlipFrame(coinFace, status) {
        const c = createContainer(0xCAD7E6);
        addTextDisplay(c, [
            `# ${coinIcon(guildId)} Coinflip`,
            '',
            `> Pick: **${normalizedChoice.toUpperCase()}**`,
            `> Bet: ${formatCoins(bet, guildId)}`,
            '',
            `## ${coinFace}`,
            '',
            status,
        ].join('\n'));
        return c;
    }

    let messageHandle = null;
    if (typeof editFn === 'function') {
        await editFn({
            components: [buildFlipFrame(FLIP_FRAMES[0], `<:Sandwatch:1521228272426418367> *Flipping…*`)],
            flags: MessageFlags.IsComponentsV2,
        });
        messageHandle = { edit: editFn };
    } else {
        const sent = await replyFn({
            components: [buildFlipFrame(FLIP_FRAMES[0], `<:Sandwatch:1521228272426418367> *Flipping…*`)],
            flags: MessageFlags.IsComponentsV2,
        });
        messageHandle = sent && typeof sent.edit === 'function' ? sent : null;
    }

    if (messageHandle) {
        try {
            for (let i = 1; i < FLIP_FRAMES.length; i++) {
                await sleep(220);
                await messageHandle.edit({
                    components: [buildFlipFrame(FLIP_FRAMES[i], `<:Sandwatch:1521228272426418367> *Flipping…*`)],
                    flags: MessageFlags.IsComponentsV2,
                });
            }
            await sleep(300);
        } catch (err) {
            // Animation hiccup — fall through to settle so the user
            // always sees a final result.
            console.warn('[BETFLIP] animation frame failed:', err?.message || err);
        }
    }

    /* ═══ Settle bet — uses shared helper so Medal bonus applies ═══ */
    deductBet(userId, bet);
    const settleResult = settle(userId, bet, won ? bet * 2 : 0);
    const { userData } = settleResult;
    const actualPayout = settleResult.payout;

    const coinFace = result === 'heads' ? HEADS : TAILS;
    const container = createContainer(won ? 0x57F287 : 0xED4245);

    addTextDisplay(container, [
        `# ${coinIcon(guildId)} Coinflip`,
        '',
        `## ${coinFace} ${result.toUpperCase()}`,
        `> Your pick: **${normalizedChoice.toUpperCase()}**`,
    ].join('\n'));

    addSeparator(container, SeparatorSpacingSize.Small);

    const resultLines = [];
    if (won) {
        resultLines.push(`<:Checkedbox:1521227734943269077> **Won ${formatCoins(actualPayout - bet, guildId)}!**`);
        if (actualPayout > bet * 2) {
            resultLines.push(`-# 🥇 Medal bonus added **+${formatCoins(actualPayout - bet * 2, guildId)}** to your win.`);
        }
    } else {
        resultLines.push(`<:Cancel:1521227723916181644> **Lost ${formatCoins(bet, guildId)}**`);
    }

    if (rerolledFlip) {
        resultLines.push(`-# 🌟 Star Booster gave you a second flip — and you nailed it!`);
    }

    resultLines.push(
        '',
        `${coinIcon(guildId)} **Balance:** ${formatCoinsAmount(userData.coins, guildId)}`,
        '',
        `-# ${won ? 'Nice flip! Go again?' : 'Better luck next flip!'}`,
    );

    addTextDisplay(container, resultLines.join('\n'));

    if (messageHandle) {
        try {
            return await messageHandle.edit({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch {
            return replyFn({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }
    return replyFn({ components: [container], flags: MessageFlags.IsComponentsV2 });
}

module.exports = {
    data: new (require('discord.js').SlashCommandBuilder)()
        .setName('betflip')
        .setDescription('Flip a coin and bet on heads or tails')
        .addStringOption(o => o.setName('choice').setDescription('heads or tails').setRequired(true).addChoices({ name: 'Heads', value: 'heads' }, { name: 'Tails', value: 'tails' }))
        .addStringOption(o => o.setName('amount').setDescription('Bet amount (max 100k) or "all"').setRequired(true)),

    prefix: 'betflip',
    description: 'Flip a coin — bet on heads or tails (max 100k)',
    usage: 'betflip <heads/tails> <amount>',
    category: 'economy',
    aliases: ['coinflip', 'cf', 'flip'],

    async execute(interaction) {
        if (await gamblingGuard(interaction)) return;
        const choice = interaction.options.getString('choice');
        const amount = interaction.options.getString('amount');
        if (!interaction.deferred && !interaction.replied) {
            await interaction.deferReply().catch(() => {});
        }
        const editFn = (payload) => interaction.editReply(payload);
        await handleBetflip(editFn, editFn, interaction.user.id, [choice, amount], interaction.guild?.id);
    },

    async executePrefix(message, args) {
        if (await gamblingGuard(message)) return;
        const replyFn = (payload) => message.reply(payload);
        await handleBetflip(replyFn, null, message.author.id, args, message.guild?.id);
    }
};
