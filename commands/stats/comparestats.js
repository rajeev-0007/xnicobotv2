'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getGuildMember } = require('../../utils/database');
const ui = require('../../utils/statsUI');

function formatVoiceTime(seconds) {
    const s = Number(seconds) || 0;
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${h}h ${m}m`;
}

function winnerLine(label, leftName, leftValue, rightName, rightValue, isVoice = false) {
    const fmt = (v) => isVoice ? formatVoiceTime(v) : v.toLocaleString();
    if (leftValue === rightValue) return `**${label}:** Tie (${fmt(leftValue)})`;
    return leftValue > rightValue
        ? `**${label}:** ${leftName} wins (${fmt(leftValue)} vs ${fmt(rightValue)})`
        : `**${label}:** ${rightName} wins (${fmt(rightValue)} vs ${fmt(leftValue)})`;
}

async function buildCompareContainer(guild, userA, userB) {
    const [aData, bData] = await Promise.all([
        getGuildMember(guild.id, userA.id).catch(() => null),
        getGuildMember(guild.id, userB.id).catch(() => null),
    ]);

    const a = {
        messages: Number(aData?.analytics?.totalMessages || 0),
        voice: Number(aData?.analytics?.voiceTime || 0),
        xp: Number(aData?.leveling?.xp || 0),
        commands: Number(aData?.leveling?.commandsUsed || 0),
    };
    const b = {
        messages: Number(bData?.analytics?.totalMessages || 0),
        voice: Number(bData?.analytics?.voiceTime || 0),
        xp: Number(bData?.leveling?.xp || 0),
        commands: Number(bData?.leveling?.commandsUsed || 0),
    };

    const statBlock = (u, s) => ui.block(`${ui.E.user} ${u.username}`, ui.rows({
        Messages: `\`${s.messages.toLocaleString()}\``,
        Voice: `\`${formatVoiceTime(s.voice)}\``,
        XP: `\`${s.xp.toLocaleString()}\``,
        Commands: `\`${s.commands.toLocaleString()}\``,
    }));

    const winners = ui.block(`${ui.E.award} Winners`, ui.rows([
        winnerLine('Messages', userA.username, a.messages, userB.username, b.messages),
        winnerLine('Voice Time', userA.username, a.voice, userB.username, b.voice, true),
        winnerLine('XP', userA.username, a.xp, userB.username, b.xp),
        winnerLine('Commands Used', userA.username, a.commands, userB.username, b.commands),
    ]));

    return ui.card({
        guildId: guild.id,
        title: `${ui.E.info} Compare Stats`,
        subtitle: `**${userA.username}** vs **${userB.username}**`,
        blocks: [statBlock(userA, a), statBlock(userB, b), winners],
    });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('comparestats')
        .setDescription('Compare tracked activity stats between two users')
        .addUserOption(o => o.setName('user1').setDescription('First user').setRequired(true))
        .addUserOption(o => o.setName('user2').setDescription('Second user').setRequired(true)),

    prefix: 'comparestats',
    aliases: ['compareactivity', 'statcompare'],
    description: 'Compare tracked activity stats between two users',
    usage: 'comparestats @user1 @user2',
    category: 'stats',

    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const user1 = interaction.options.getUser('user1');
        const user2 = interaction.options.getUser('user2');

        if (user1.id === user2.id) {
            return interaction.editReply(ui.payload(ui.err(interaction.guild.id, 'Same User', 'Pick two different users to compare.')));
        }

        try {
            const container = await buildCompareContainer(interaction.guild, user1, user2);
            await interaction.editReply(ui.payload(container));
        } catch (error) {
            console.error('comparestats error:', error);
            await interaction.editReply(ui.payload(ui.err(interaction.guild.id, 'Failed', 'Failed to compare user stats.')));
        }
    },

    async executePrefix(message, args) {
        const gid = message.guild.id;
        // Resolve two users from mentions or IDs
        let user1 = message.mentions.users.first();
        let user2 = message.mentions.users.size >= 2 ? [...message.mentions.users.values()][1] : null;

        // Fallback: parse IDs from args
        if (!user1 && args[0]) {
            const id = args[0].replace(/[<@!>]/g, '');
            if (/^\d{17,20}$/.test(id)) user1 = await message.client.users.fetch(id).catch(() => null);
        }
        if (!user2 && args[1]) {
            const id = args[1].replace(/[<@!>]/g, '');
            if (/^\d{17,20}$/.test(id)) user2 = await message.client.users.fetch(id).catch(() => null);
        }

        if (!user1 || !user2) {
            return message.reply(ui.payload(ui.err(gid, 'Missing Users', 'Mention two users to compare.', 'Example: `comparestats @user1 @user2`')));
        }

        if (user1.id === user2.id) {
            return message.reply(ui.payload(ui.err(gid, 'Same User', 'Pick two different users to compare.')));
        }

        try {
            const container = await buildCompareContainer(message.guild, user1, user2);
            await message.reply(ui.payload(container));
        } catch (error) {
            console.error('comparestats prefix error:', error);
            await message.reply(ui.payload(ui.err(gid, 'Failed', 'Failed to compare user stats.')));
        }
    }
};
