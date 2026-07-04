'use strict';

/**
 * /statboard — thin alias that delegates to /leaderboard.
 *
 * Historically `statboard` and `leaderboard` were two near-duplicate
 * canvas commands. After moving the leaderboard renderer to a clean
 * Components V2 panel (see `commands/leveling/leaderboard.js`), this
 * file is now a small wrapper that:
 *   • keeps the legacy `statboard` / `slb` / `statlb` aliases working
 *   • limits the choices to activity stats (no economy view here, that
 *     stays exclusive to /leaderboard)
 *   • routes button presses through the leaderboard handler so users
 *     can switch stat types and scopes without re-running the command.
 */

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const leaderboard = require('../../commands/leveling/leaderboard');
const ui = require('../../utils/statsUI');

const VALID_STAT_TYPES = ['messages', 'voice', 'leveling', 'invites'];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('statboard')
        .setDescription('View activity stats leaderboard (messages, voice, XP, invites)')
        .addStringOption(o =>
            o.setName('type')
                .setDescription('Stat type to rank by')
                .setRequired(false)
                .addChoices(
                    { name: '💬 Messages',   value: 'messages' },
                    { name: '🔊 Voice Time', value: 'voice'    },
                    { name: '⚡ XP',          value: 'leveling' },
                    { name: '📨 Invites',    value: 'invites'  },
                )
        )
        .addStringOption(o =>
            o.setName('scope')
                .setDescription('Server or global rankings')
                .setRequired(false)
                .addChoices(
                    { name: '🏠 Server', value: 'server' },
                    { name: '🌍 Global', value: 'global' },
                )
        ),

    prefix: 'statboard',
    aliases: ['slb', 'statlb'],
    description: 'View activity stats leaderboard (messages, voice, XP, invites)',
    usage: 'statboard [messages|voice|leveling|invites] [server|global]',
    category: 'stats',

    async execute(interaction) {
        await interaction.deferReply();
        const rawType = interaction.options.getString('type') || 'messages';
        const type = VALID_STAT_TYPES.includes(rawType) ? rawType : 'messages';
        const scope = interaction.options.getString('scope') || 'server';
        try {
            const reply = await leaderboard.buildLeaderboardReply(interaction.client, interaction.guild, type, scope, 0, interaction.user.id);
            await interaction.editReply(reply);
        } catch (err) {
            console.error('[statboard] slash error:', err);
            await interaction.editReply(ui.payload(ui.err(interaction.guild.id, 'Failed', 'Failed to generate the leaderboard.'))).catch(() => {});
        }
    },

    async executePrefix(message, args) {
        const raw = (args[0] || '').toLowerCase();
        const type = VALID_STAT_TYPES.includes(raw) ? raw : 'messages';
        const scope = args[1]?.toLowerCase() === 'global' ? 'global' : 'server';
        try {
            const reply = await leaderboard.buildLeaderboardReply(message.client, message.guild, type, scope, 0, message.author.id);
            await message.reply(reply);
        } catch (err) {
            console.error('[statboard] prefix error:', err);
            await message.reply(ui.payload(ui.err(message.guild.id, 'Failed', 'Failed to generate the leaderboard.'))).catch(() => {});
        }
    },

    // Both /statboard and /leaderboard render through the same builder
    // and emit the same `ulb_*` button IDs, so we don't need a separate
    // button handler — `commands/leveling/leaderboard.js`'s handlers
    // pick up everything via the existing dispatcher in index.js.
};
