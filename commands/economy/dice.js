'use strict';

const { createContainer, addTextDisplay, addSeparator, formatNumber, MessageFlags, SeparatorSpacingSize } = require('../../utils/componentHelpers');
const { formatCoins, formatCoinsShort , coinIcon, formatCoinsAmount } = require('../../utils/currencyHelper');
const { parseBet, getBalance, MAX_BET } = require('../../utils/betHelper');
const { gamblingGuard } = require('../../utils/economyGuards');
const { resolveUser } = require('../../utils/resolveUser');
const { deductBet, settle } = require('../../utils/betGameHelper');

const COOLDOWN = 5_000;
const cooldowns = new Map();

const DICE_FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function randomFace() {
    return DICE_FACES[Math.floor(Math.random() * 6)];
}

async function handleDice(replyFn, editFn, userId, args, opponent, guildId) {
    const now = Date.now();

    if (cooldowns.get(userId) > now) {
        const left = Math.ceil((cooldowns.get(userId) - now) / 1000);
        const c = createContainer(0xCAD7E6);
        addTextDisplay(c, `<:Clock:1521228110408847623> Wait **${left}s** before rolling again.`);
        return replyFn({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    const balance = getBalance(userId);
    const betResult = parseBet(args[0], balance);

    if (!betResult.valid) {
        const container = createContainer(0xCAD7E6);
        addTextDisplay(container, [
            `# <:Gamepad:1521228035213230090> Dice Roll`,
            '',
            `**Usage:** \`dice <amount> [@opponent]\``,
            `**Max Bet:** ${formatNumber(MAX_BET)}`,
            '',
            `Roll against the bot or challenge another player!`,
            `Higher roll wins. Ties = push (no loss).`,
            '',
            `**Examples:**`,
            `\`dice 500\` — Roll vs bot`,
            `\`dice 1000 @user\` — Challenge a player`,
            `\`dice all\` — Bet everything (up to 100k)`,
        ].join('\n'));
        return replyFn({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    const bet = betResult.amount;
    cooldowns.set(userId, now + COOLDOWN);

    /* ═══ Pre-roll outcome — animation is purely cosmetic ═══ */
    const playerRoll = Math.floor(Math.random() * 6) + 1;
    const opponentRoll = Math.floor(Math.random() * 6) + 1;
    const opponentName = opponent ? `<@${opponent.id}>` : '🤖 Bot';

    let won = false, tie = false;
    if (playerRoll > opponentRoll) won = true;
    else if (playerRoll < opponentRoll) won = false;
    else { won = false; tie = true; }

    /* ═══ Animation: roll both dice through 4 random faces ═══ */
    function buildRollFrame(yourFace, oppFace, status) {
        const c = createContainer(0xCAD7E6);
        addTextDisplay(c, [
            `# <:Gamepad:1521228035213230090> Dice Roll`,
            '',
            `> Bet: ${formatCoins(bet, guildId)}`,
            '',
            `### You: ${yourFace}  vs  ${opponentName}: ${oppFace}`,
            '',
            status,
        ].join('\n'));
        return c;
    }

    let messageHandle = null;
    if (typeof editFn === 'function') {
        await editFn({
            components: [buildRollFrame(randomFace(), randomFace(), `<:Sandwatch:1521228272426418367> *Rolling…*`)],
            flags: MessageFlags.IsComponentsV2,
        });
        messageHandle = { edit: editFn };
    } else {
        const sent = await replyFn({
            components: [buildRollFrame(randomFace(), randomFace(), `<:Sandwatch:1521228272426418367> *Rolling…*`)],
            flags: MessageFlags.IsComponentsV2,
        });
        messageHandle = sent && typeof sent.edit === 'function' ? sent : null;
    }

    if (messageHandle) {
        try {
            await sleep(280);
            await messageHandle.edit({
                components: [buildRollFrame(randomFace(), randomFace(), `<:Sandwatch:1521228272426418367> *Rolling…*`)],
                flags: MessageFlags.IsComponentsV2,
            });
            await sleep(280);
            await messageHandle.edit({
                components: [buildRollFrame(randomFace(), randomFace(), `<:Sandwatch:1521228272426418367> *Slowing down…*`)],
                flags: MessageFlags.IsComponentsV2,
            });
            await sleep(380);
        } catch (err) {
            console.warn('[DICE] animation frame failed:', err?.message || err);
        }
    }

    /* ═══ Settle bet ═══ */
    let userData, actualPayout = bet;
    if (tie) {
        const economyManager = require('../../utils/economyManager');
        const economy = economyManager.loadEconomy();
        ({ userData } = economyManager.getUser(economy, userId));
    } else {
        deductBet(userId, bet);
        const result = settle(userId, bet, won ? bet * 2 : 0);
        userData = result.userData;
        actualPayout = result.payout;
    }

    const container = createContainer(won ? 0x57F287 : (tie ? 0xFEE75C : 0xED4245));

    addTextDisplay(container, [
        `# <:Gamepad:1521228035213230090> Dice Roll`,
        '',
        `### You: ${DICE_FACES[playerRoll - 1]} **${playerRoll}**`,
        `### ${opponentName}: ${DICE_FACES[opponentRoll - 1]} **${opponentRoll}**`,
    ].join('\n'));

    addSeparator(container, SeparatorSpacingSize.Small);

    if (tie) {
        addTextDisplay(container, `🤝 **Tie!** No coins lost.\n\n${coinIcon(guildId)} **Balance:** ${formatCoinsAmount(userData.coins, guildId)}`);
    } else if (won) {
        const winLine = `<:Checkedbox:1521227734943269077> **You won ${formatCoins(actualPayout - bet, guildId)}!**`;
        const bonusNote = actualPayout > bet * 2
            ? `\n-# Medal bonus added **+${formatCoinsAmount(actualPayout - bet * 2, guildId)}** to your win.`
            : '';
        addTextDisplay(container, `${winLine}${bonusNote}\n\n${coinIcon(guildId)} **Balance:** ${formatCoinsAmount(userData.coins, guildId)}`);
    } else {
        addTextDisplay(container, `<:Cancel:1521227723916181644> **You lost ${formatCoins(bet, guildId)}**\n\n${coinIcon(guildId)} **Balance:** ${formatCoinsAmount(userData.coins, guildId)}`);
    }

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
        .setName('dice')
        .setDescription('Roll dice against the bot or another player')
        .addStringOption(o => o.setName('amount').setDescription('Bet amount (max 100k) or "all"').setRequired(true))
        .addUserOption(o => o.setName('opponent').setDescription('Challenge a player (optional, bot plays if empty)')),

    prefix: 'dice',
    description: 'Roll dice — higher roll wins (max 100k bet)',
    usage: 'dice <amount> [@opponent]',
    category: 'economy',
    aliases: ['diceroll'],

    async execute(interaction) {
        if (await gamblingGuard(interaction)) return;
        const amount = interaction.options.getString('amount');
        const opponent = interaction.options.getUser('opponent');
        if (!interaction.deferred && !interaction.replied) {
            await interaction.deferReply().catch(() => {});
        }
        const editFn = (payload) => interaction.editReply(payload);
        await handleDice(editFn, editFn, interaction.user.id, [amount], opponent, interaction.guild?.id);
    },

    async executePrefix(message, args) {
        if (await gamblingGuard(message)) return;
        const opponent = await resolveUser(message, args);
        const replyFn = (payload) => message.reply(payload);
        await handleDice(replyFn, null, message.author.id, [args[0]], opponent, message.guild?.id);
    }
};
