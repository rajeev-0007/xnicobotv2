'use strict';

const { MessageFlags } = require('discord.js');
const { createContainer, addTextDisplay, addSeparator, formatNumber, SeparatorSpacingSize } = require('../../utils/componentHelpers');
const economyManager = require('../../utils/economyManager');
const { getEconomySettings, formatCoins, formatCoinsShort , coinIcon, formatCoinsAmount } = require('../../utils/currencyHelper');
const { robGuard } = require('../../utils/economyGuards');
const { resolveUser } = require('../../utils/resolveUser');
const COOLDOWN = 60 * 1000;

module.exports = {
    data: new (require('discord.js').SlashCommandBuilder)()
        .setName('rob')
        .setDescription('Attempt to steal coins from another user')
        .addUserOption(o => o.setName('user').setDescription('User to rob').setRequired(true)),
    prefix: 'rob',
    description: 'Attempt to steal coins from another user',
    usage: 'rob <@user>',
    category: 'economy',
    aliases: [],

    async executePrefix(message, args) {
        const guildId = message.guild?.id;
        // Honour the per-guild "Rob enabled" toggle from the dashboard.
        if (await robGuard(message)) return;
        const cfg = getEconomySettings(message.guild?.id);

        const target = await resolveUser(message, args);

        if (!target) {
            const container = createContainer(0xCAD7E6);
            addTextDisplay(container, [
                `# ${coinIcon(guildId)} Rob Command`,
                '',
                `**Usage:** \`rob @user\``,
                '',
                `Attempt to rob another user.`,
                '',
                `• 50% success chance`,
                `• Target must have **100+ coins**`,
                `• Cooldown: 1 minute`,
            ].join('\n'));
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (target.id === message.author.id) {
            const c = createContainer(0xED4245);
            addTextDisplay(c, '<:Cancel:1521227723916181644> You cannot rob yourself!');
            return message.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
        }
        if (target.bot) {
            const c = createContainer(0xED4245);
            addTextDisplay(c, '<:Cancel:1521227723916181644> You cannot rob bots!');
            return message.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
        }

        const economy = economyManager.loadEconomy();
        const { userData: robber } = economyManager.getUser(economy, message.author.id);
        const { userData: victim } = economyManager.getUser(economy, target.id);
        victim.boosts = victim.boosts || {};
        robber.boosts = robber.boosts || {};

        const now = Date.now();
        if (now - robber.lastRob < COOLDOWN) {
            const left = Math.ceil((COOLDOWN - (now - robber.lastRob)) / 1000);
            const c = createContainer(0xCAD7E6);
            addTextDisplay(c, `<:Clock:1521228110408847623> You must wait **${left}s** before robbing again.`);
            return message.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
        }

        if (victim.coins < 100) {
            const c = createContainer(0xED4245);
            addTextDisplay(c, '<:Cancel:1521227723916181644> This user doesn\'t have enough coins to rob!');
            return message.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
        }

        // Honour the victim's `shield` boost — buying a Shield Token
        // (use shield) sets `victim.boosts.shield` to a 24h expiry.
        // Without this the paid protection did nothing.
        const shieldUntil = Number(victim.boosts?.shield || 0);
        if (shieldUntil > now) {
            const left = shieldUntil - now;
            const hrs  = Math.floor(left / 3_600_000);
            const mins = Math.floor((left % 3_600_000) / 60_000);
            const c = createContainer(0xFEE75C);
            addTextDisplay(c, [
                `# <:Shield:1521227694677692467> Target Protected`,
                '',
                `**${target.username}** has an active **Shield Token** — their coins are immune for **${hrs > 0 ? `${hrs}h ` : ''}${mins}m**.`,
                '',
                `-# Shields are bought from the shop with \`buy shield\` and used with \`use shield\`.`,
            ].join('\n'));
            return message.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
        }

        robber.lastRob = now;

        // robChance is 0..100 from the dashboard; legacy default is 50.
        const success = Math.random() * 100 < cfg.robChance;

        if (success) {
            const maxSteal = Math.floor(victim.coins * 0.3);
            const amount = Math.min(maxSteal, Math.max(50, Math.floor(Math.random() * maxSteal)));

            victim.coins -= amount;
            robber.coins += amount;

            economyManager.saveEconomy(economy);

            const container = createContainer(0xCAD7E6);
            addTextDisplay(container, [
                `# ${coinIcon(guildId)} Robbery Successful!`,
                '',
                `<:Checkedbox:1521227734943269077> You stole **${formatCoins(amount, guildId)}** from **${target.username}**!`,
                '',
                `${coinIcon(guildId)} **Your Balance:** ${formatCoinsAmount(robber.coins, guildId)}`,
                '',
                `-# Cooldown: 1 minute`,
            ].join('\n'));
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const fine = Math.min(200, Math.floor(robber.coins * 0.3));
        robber.coins = Math.max(0, robber.coins - fine);

        economyManager.saveEconomy(economy);

        const container = createContainer(0xED4245);
        addTextDisplay(container, [
            `# ${coinIcon(guildId)} Robbery Failed!`,
            '',
            `<:Cancel:1521227723916181644> You got caught!`,
            '',
            `${coinIcon(guildId)} **Fine:** ${formatCoinsAmount(fine, guildId)}`,
            `${coinIcon(guildId)} **Your Balance:** ${formatCoinsAmount(robber.coins, guildId)}`,
            '',
            `-# Cooldown: 1 minute`,
        ].join('\n'));
        return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    },

    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
        const target = interaction.options.getUser('user');
        const fakeMessage = {
            author: interaction.user,
            guild: interaction.guild,
            mentions: { users: { first: () => target } },
            reply: (opts) => interaction.editReply(opts),
        };
        return module.exports.executePrefix(fakeMessage);
    },
};
