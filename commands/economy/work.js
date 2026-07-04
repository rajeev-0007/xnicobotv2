'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { createContainer, addTextDisplay, addSeparator, formatNumber, SeparatorSpacingSize } = require('../../utils/componentHelpers');
const economyManager = require('../../utils/economyManager');
const { getEconomySettings, rollReward, formatCoins, formatCoinsShort , coinIcon, formatCoinsAmount } = require('../../utils/currencyHelper');
const { applyIncomeTax, formatTaxFootnote } = require('../../utils/taxHelper');

const JOBS = [
    { name: 'Software Developer', emoji: '💻', messages: ['You built a new feature for a client', 'You fixed a critical bug', 'You deployed code to production'] },
    { name: 'Chef', emoji: '👨‍🍳', messages: ['You prepared a 5-star meal', 'You catered a private event', 'You created a new recipe'] },
    { name: 'Doctor', emoji: '⚕', messages: ['You saved a patient\'s life', 'You performed a successful surgery', 'You diagnosed a rare condition'] },
    { name: 'Teacher', emoji: '👨‍🏫', messages: ['You tutored students after class', 'You graded exams all evening', 'You prepared course materials'] },
    { name: 'Artist', emoji: '<:Palette:1521227950601539755>', messages: ['You completed a commissioned painting', 'You sold artwork at a gallery', 'You designed a brand logo'] },
    { name: 'Musician', emoji: '<:Music:1521228141543165982>', messages: ['You performed at a local venue', 'You produced a hit track', 'You gave music lessons'] },
    { name: 'Farmer', emoji: '🌾', messages: ['You harvested a full crop', 'You sold produce at the market', 'You tended the livestock'] },
    { name: 'Miner', emoji: '⛏', messages: ['You struck a vein of ore', 'You mined rare minerals', 'You cleared a new tunnel'] },
    { name: 'Fisherman', emoji: '🎣', messages: ['You caught a massive haul', 'You sold fresh fish at the dock', 'You navigated a storm successfully'] },
    { name: 'Astronaut', emoji: '🚀', messages: ['You completed a spacewalk', 'You ran experiments in orbit', 'You discovered a new asteroid'] }
];

const COOLDOWN = 60 * 60 * 1000;

function buildCooldownBar(elapsed, total, length = 20) {
    const progress = Math.min(Math.floor((elapsed / total) * length), length);
    return '█'.repeat(progress) + '░'.repeat(length - progress);
}

async function handleWork(reply, userId, guildId) {
    const cfg = getEconomySettings(guildId);
    const economy = economyManager.loadEconomy();
    const { userData: user } = economyManager.getUser(economy, userId);
    user.bonuses ||= { work: 0, daily: 0, gamble: 0, global: 0 };

    const now = Date.now();
    const elapsed = now - user.lastWork;

    if (elapsed < COOLDOWN) {
        const left = COOLDOWN - elapsed;
        const pct = Math.round((elapsed / COOLDOWN) * 100);

        const container = createContainer(0xCAD7E6);
        addTextDisplay(container, [
            `# <:Alarm:1521227869047750689> Work Cooldown`,
            '',
            `You're too tired to work right now.`,
            '',
            `> \`${buildCooldownBar(elapsed, COOLDOWN)}\` ${pct}%`,
            '',
            `<:Clock:1521228110408847623> **Ready in:** ${economyManager.formatTime(left)}`,
            `-# Take a break and come back soon!`,
        ].join('\n'));
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    const job = JOBS[Math.floor(Math.random() * JOBS.length)];
    const jobMessage = job.messages[Math.floor(Math.random() * job.messages.length)];
    // Pull range from dashboard config (falls back to legacy 100..300)
    const baseEarned = rollReward(cfg.workMin, cfg.workMax);

    const workBonus = Number(user.bonuses?.work) || 0;
    const bonusAmount = Math.floor(baseEarned * workBonus);

    const tipChance = Math.random();
    const tipAmount = tipChance < 0.15 ? Math.floor(Math.random() * 50) + 25 : 0;
    const grossEarned = baseEarned + bonusAmount + tipAmount;

    // Wealth tax — applies once total wealth (wallet+bank) ≥ 100k.
    const taxResult = applyIncomeTax(grossEarned, user);
    const totalEarned = taxResult.net;

    user.workCount = (user.workCount || 0) + 1;

    user.coins += totalEarned;
    // Track lifetime earnings on the user record (the local `totalEarned`
    // variable shadowed this — without the explicit write the field
    // never got persisted).
    user.totalEarned = (user.totalEarned || 0) + totalEarned;
    user.lastWork = now;
    economyManager.addXP(economy, userId, 5);
    economyManager.saveEconomy(economy);

    const container = createContainer(0xCAD7E6);

    let earningsText = `# ${job.emoji} Work Complete!\n\n`;
    earningsText += `> *${jobMessage}*\n\n`;
    earningsText += `### ${coinIcon(guildId)} Earnings\n`;
    earningsText += `> ${coinIcon(guildId)} **Base Pay:** ${formatCoinsAmount(baseEarned, guildId)}\n`;
    if (bonusAmount > 0) earningsText += `> <:Crown:1521227739988889764> **Work Bonus:** +${formatCoins(bonusAmount, guildId)}\n`;
    if (tipAmount > 0) earningsText += `> <:Sketch:1521228025365004471> **Tip Received:** +${formatCoinsAmount(tipAmount, guildId)}\n`;

    addTextDisplay(container, earningsText);
    addSeparator(container, SeparatorSpacingSize.Small);

    const summaryLines = [
        `> ${coinIcon(guildId)} **Total Earned:** ${formatCoinsAmount(totalEarned, guildId)}`,
        `> ${coinIcon(guildId)} **Balance:** ${formatCoinsAmount(user.coins, guildId)}`,
        `> 📋 **Shifts Completed:** ${formatNumber(user.workCount)}`,
    ];
    const taxLine = formatTaxFootnote(taxResult);
    if (taxLine) summaryLines.push('', taxLine);
    summaryLines.push('', `-# You can work again in 1 hour`);

    addTextDisplay(container, summaryLines.join('\n'));

    return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('work')
        .setDescription('Work to earn coins'),
    prefix: 'work',
    aliases: ['job'],
    category: 'economy',
    description: 'Work to earn coins',

    async execute(interaction) {
        return handleWork(interaction.reply.bind(interaction), interaction.user.id, interaction.guild?.id);
    },

    async executePrefix(message) {
        return handleWork(message.reply.bind(message), message.author.id, message.guild?.id);
    }
};
