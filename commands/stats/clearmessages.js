'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { getGuildMember, updateGuildMember } = require('../../utils/database');
const ui = require('../../utils/statsUI');
const jsonStore = require('../../utils/jsonStore');
const activityTracker = require('../../utils/activityTracker');

async function handleClear(reply, channel, authorId, guild, target, amount) {
    const gid = guild.id;

    // ── Case 1: Clear specific amount from a user ──
    if (target && amount && amount > 0) {
        const member = await getGuildMember(gid, target.id);
        const current = member?.analytics?.totalMessages || 0;
        const newTotal = Math.max(0, current - amount);
        await updateGuildMember(gid, target.id, { analytics: { ...member?.analytics, totalMessages: newTotal } });

        return reply(ui.payload(ui.card({
            guildId: gid,
            title: `${ui.E.ok} Messages Removed`,
            blocks: [ui.rows([
                `**User:** ${target.username}`,
                `**Removed:** \`-${amount.toLocaleString()}\``,
                `**New Total:** \`${newTotal.toLocaleString()}\``,
            ])],
        })));
    }

    // ── Case 2: Reset a specific user to 0 ──
    if (target) {
        const member = await getGuildMember(gid, target.id);
        const old = member?.analytics?.totalMessages || 0;

        if (old === 0) {
            return reply(ui.payload(ui.card({
                guildId: gid,
                title: `${ui.E.info} Nothing to Clear`,
                blocks: [`**${target.username}** already has \`0\` messages.`],
            })));
        }

        // Confirm
        const confirmContainer = ui.card({
            guildId: gid,
            title: `${ui.E.warn} Confirm Reset`,
            blocks: [ui.rows([
                `**User:** ${target.username}`,
                `**Current Messages:** \`${old.toLocaleString()}\``,
                `This will reset their count to \`0\`.`,
            ])],
            note: 'Type `yes` to confirm or `no` to cancel (15s)',
        });
        await reply(ui.payload(confirmContainer));

        const filter = m => m.author.id === authorId && ['yes', 'no', 'y', 'n'].includes(m.content.toLowerCase().trim());
        try {
            const collected = await channel.awaitMessages({ filter, max: 1, time: 15000, errors: ['time'] });
            const answer = collected.first().content.toLowerCase().trim();

            if (answer === 'yes' || answer === 'y') {
                const analytics = member?.analytics || {};
                analytics.totalMessages = 0;
                await updateGuildMember(gid, target.id, { analytics });
                // Also wipe the windowed activity data so they drop off the
                // daily/weekly/monthly + live leaderboards, not just the total.
                activityTracker.clearUser(gid, target.id);

                return channel.send(ui.payload(ui.card({
                    guildId: gid,
                    title: `${ui.E.ok} Messages Cleared`,
                    blocks: [ui.rows([
                        `**User:** ${target.username}`,
                        `Messages reset from \`${old.toLocaleString()}\` → \`0\``,
                        `Removed from all leaderboards (all-time, daily/weekly/monthly & live).`,
                    ])],
                })));
            } else {
                return channel.send(ui.payload(ui.card({ guildId: gid, title: `${ui.E.no} Cancelled`, blocks: ['No changes were made.'] })));
            }
        } catch {
            return channel.send(ui.payload(ui.card({ guildId: gid, title: `${ui.E.clock} Timed Out`, blocks: ['No changes were made.'] })));
        }
    }

    // ── Case 3: No user — ask if they want to clear the entire server ──
    const members = jsonStore.read('guild_members') || [];
    const guildMembers = members.filter(m => m.guild_id === gid && m.analytics?.totalMessages > 0);

    if (guildMembers.length === 0) {
        return reply(ui.payload(ui.card({
            guildId: gid,
            title: `${ui.E.info} Nothing to Clear`,
            blocks: ['No message data exists for this server.'],
        })));
    }

    const totalMsgs = guildMembers.reduce((s, m) => s + (m.analytics?.totalMessages || 0), 0);

    const confirmContainer = ui.card({
        guildId: gid,
        title: `${ui.E.warn} Clear Entire Server?`,
        blocks: [ui.rows([
            `**Server:** ${guild.name}`,
            `**Members with data:** \`${guildMembers.length}\``,
            `**Total messages tracked:** \`${totalMsgs.toLocaleString()}\``,
            `⚠️ This will reset **all** message counts to 0.`,
        ])],
        note: 'Type `yes` to confirm or `no` to cancel (15s)',
    });
    await reply(ui.payload(confirmContainer));

    const filter = m => m.author.id === authorId && ['yes', 'no', 'y', 'n'].includes(m.content.toLowerCase().trim());
    try {
        const collected = await channel.awaitMessages({ filter, max: 1, time: 15000, errors: ['time'] });
        const answer = collected.first().content.toLowerCase().trim();

        if (answer === 'yes' || answer === 'y') {
            let cleared = 0;
            for (const m of members) {
                if (m.guild_id === gid && m.analytics && m.analytics.totalMessages > 0) {
                    m.analytics.totalMessages = 0;
                    cleared++;
                }
            }
            jsonStore.write('guild_members', members);
            // Also wipe the windowed activity data for the whole guild so every
            // leaderboard (daily/weekly/monthly & live) resets too.
            activityTracker.clearGuild(gid);

            return channel.send(ui.payload(ui.card({
                guildId: gid,
                title: `${ui.E.ok} Server Messages Cleared`,
                blocks: [ui.rows([
                    `**Members reset:** \`${cleared}\``,
                    `All message counts set to \`0\` across every leaderboard.`,
                ])],
            })));
        } else {
            return channel.send(ui.payload(ui.card({ guildId: gid, title: `${ui.E.no} Cancelled`, blocks: ['No changes were made.'] })));
        }
    } catch {
        return channel.send(ui.payload(ui.card({ guildId: gid, title: `${ui.E.clock} Timed Out`, blocks: ['No changes were made.'] })));
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('clearmessages')
        .setDescription('Remove messages from a user or reset the entire server')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addUserOption(o => o.setName('user').setDescription('User to clear (omit for entire server)').setRequired(false))
        .addIntegerOption(o => o.setName('amount').setDescription('Amount to remove (omit to reset to 0)').setMinValue(1).setRequired(false)),
    prefix: 'clearmessages',
    description: 'Remove messages from a user or reset the entire server\'s message data',
    usage: 'clearmessages [@user] [amount]',
    aliases: ['clearmsgs', 'removemessages', 'removemsgs'],
    category: 'stats',

    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return interaction.reply(ui.payload(ui.err(interaction.guild.id, 'Permission Denied', 'You need **Manage Server** permission.')));
        }

        const target = interaction.options.getUser('user');
        const amount = interaction.options.getInteger('amount');

        return handleClear(
            interaction.reply.bind(interaction),
            interaction.channel,
            interaction.user.id,
            interaction.guild,
            target,
            amount
        );
    },

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return message.reply(ui.payload(ui.err(message.guild.id, 'Permission Denied', 'You need **Manage Server** permission.')));
        }

        const target = message.mentions.users.first();
        const amount = parseInt(args.find(a => /^\d+$/.test(a)));

        return handleClear(
            message.reply.bind(message),
            message.channel,
            message.author.id,
            message.guild,
            target,
            amount > 0 ? amount : null
        );
    },
};
