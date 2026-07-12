'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { createContainer, addTextDisplay, addSeparator, SeparatorSpacingSize } = require('../../utils/componentHelpers');
const animeManager = require('../../utils/animeManager');

async function handleDropRates(reply, guildId) {
    const totalWeight = Object.values(animeManager.RARITIES).reduce((sum, r) => sum + r.weight, 0);

    const lines = Object.entries(animeManager.RARITIES).reverse().map(([key, rarity]) => {
        const percent = ((rarity.weight / totalWeight) * 100).toFixed(1);
        const charCount = animeManager.CHARACTERS.filter(c => c.rarity === key).length;
        const bar = '█'.repeat(Math.max(1, Math.round(parseFloat(percent) / 5))) + '░'.repeat(Math.max(0, 10 - Math.round(parseFloat(percent) / 5)));
        return `> ${rarity.emoji} **${rarity.name}** — ${percent}% \`[${bar}]\`\n>  └ ${charCount} characters • Value: 💰 ${rarity.value.toLocaleString()}`;
    });

    const container = createContainer(0xCAD7E6);
    addTextDisplay(container, [
        `## 🎰 Drop Rates & Rarity Info`,
        '',
        lines.join('\n'),
    ].join('\n'));

    addSeparator(container, SeparatorSpacingSize.Small);

    addTextDisplay(container, [
        `### 📋 System Info`,
        `> 🎲 **Single Roll:** ${animeManager.ROLL_COST} coins`,
        `> 🎲 **Multi Roll (x${animeManager.MULTI_ROLL_COUNT}):** ${animeManager.MULTI_ROLL_COST} coins (10% discount)`,
        `> 🎟️ **Free Rolls:** ${animeManager.DAILY_FREE_ROLLS}/day (via \`adaily\`)`,
        `> 🔥 **Vote Bonus:** +${animeManager.VOTE_BONUS_ROLLS} rolls per vote when daily rolls run out`,
        `> ⏱️ **Cooldown:** ${animeManager.ROLL_COOLDOWN / 1000}s between rolls`,
        `> 🛡️ **Pity:** Multi-roll guarantees at least 1 Rare+`,
        `> 💰 **Sell Value:** 50% of card's base value`,
        '',
        `-# Total characters in pool: ${animeManager.CHARACTERS.length}`,
    ].join('\n'));

    return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('adroprates')
        .setDescription('View anime gacha drop rates and rarity info'),
    prefix: 'adroprates',
    description: 'View anime gacha drop rates, rarity info, and costs',
    usage: 'adroprates',
    aliases: ['arates', 'droprates', 'animerates'],
    category: 'anime',

    async executePrefix(message) {
        return handleDropRates(message.reply.bind(message), message.guild?.id);
    },

    async execute(interaction) {
        return handleDropRates(interaction.reply.bind(interaction), interaction.guild?.id);
    },
};
