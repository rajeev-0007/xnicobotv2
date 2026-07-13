'use strict';

const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits, ContainerBuilder, TextDisplayBuilder } = require('discord.js');
const { buildSuccessResponse, buildErrorResponse, buildPermissionDenied } = require('../../utils/responseBuilder');
const jsonStore = require('../../utils/jsonStore');

function readWarnings() {
    if (!jsonStore.has('warnings')) return {};
    try { return jsonStore.read('warnings') || {}; } catch { return {}; }
}

function guildWarnStats(guildWarns) {
    const users = Object.keys(guildWarns).filter(uid => Array.isArray(guildWarns[uid]) && guildWarns[uid].length > 0);
    const total = users.reduce((s, uid) => s + guildWarns[uid].length, 0);
    return { users: users.length, total };
}

function confirmCard(title, lines) {
    return new ContainerBuilder()
        .setAccentColor(0xFEE75C)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `## <:Infotriangle:1521227710381428926> ${title}\n\n${lines.join('\n')}\n\n-# Type \`yes\` to confirm or \`no\` to cancel (15s)`
        ));
}

/**
 * Shared handler for both slash and prefix.
 * @param {'user'|'server'} scope
 */
async function handleClear(reply, channel, authorId, guild, scope, target) {
    const gid = guild.id;
    const warnings = readWarnings();
    const guildWarns = warnings[gid] || {};

    // ── Entire server ──
    if (scope === 'server') {
        const { users, total } = guildWarnStats(guildWarns);
        if (total === 0) {
            return reply({ components: [buildErrorResponse('No Warnings Found', 'This server has no warnings to clear.')], flags: MessageFlags.IsComponentsV2 });
        }

        await reply({
            components: [confirmCard('Clear ALL Server Warnings?', [
                `> **Members with warnings:** \`${users}\``,
                `> **Total warnings:** \`${total}\``,
                `> This wipes **every** member's warnings in **${guild.name}**.`,
            ])],
            flags: MessageFlags.IsComponentsV2,
        });

        const filter = m => m.author.id === authorId && ['yes', 'no', 'y', 'n'].includes(m.content.toLowerCase().trim());
        try {
            const collected = await channel.awaitMessages({ filter, max: 1, time: 15000, errors: ['time'] });
            const ans = collected.first().content.toLowerCase().trim();
            if (ans === 'yes' || ans === 'y') {
                delete warnings[gid];
                jsonStore.write('warnings', warnings);
                return channel.send({
                    components: [buildSuccessResponse('Server Warnings Cleared', 'All warnings have been removed.', {
                        'Members Affected': `${users}`,
                        'Warnings Removed': `${total}`,
                        'Cleared By': `${guild.members.cache.get(authorId)?.user?.username || 'Staff'}`,
                    }, true)],
                    flags: MessageFlags.IsComponentsV2,
                });
            }
            return channel.send({ components: [buildErrorResponse('Cancelled', 'No warnings were cleared.')], flags: MessageFlags.IsComponentsV2 });
        } catch {
            return channel.send({ components: [buildErrorResponse('Timed Out', 'No warnings were cleared.')], flags: MessageFlags.IsComponentsV2 });
        }
    }

    // ── Single user ──
    const list = Array.isArray(guildWarns[target.id]) ? guildWarns[target.id] : [];
    if (list.length === 0) {
        return reply({ components: [buildErrorResponse('No Warnings Found', `**${target.username}** has no warnings to clear.`)], flags: MessageFlags.IsComponentsV2 });
    }
    const count = list.length;
    delete warnings[gid][target.id];
    jsonStore.write('warnings', warnings);

    return reply({
        components: [buildSuccessResponse('Warnings Cleared', 'Successfully cleared this user\'s warnings.', {
            'User': `${target.username}`,
            'Warnings Cleared': `${count}`,
            'Cleared By': `${guild.members.cache.get(authorId)?.user?.username || 'Staff'}`,
        }, true)],
        flags: MessageFlags.IsComponentsV2,
    });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('clearwarnings')
        .setDescription('Clear warnings for a user, or all warnings in the server')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addUserOption(o => o.setName('user').setDescription('User to clear (omit + enable "all" for the whole server)').setRequired(false))
        .addBooleanOption(o => o.setName('all').setDescription('Clear EVERY member\'s warnings in this server').setRequired(false)),
    prefix: 'clearwarnings',
    description: 'Clear warnings for a user, or all warnings in the server',
    usage: 'clearwarnings <@user | all>',
    category: 'admin',
    aliases: ['clearwarns', 'delwarnings'],

    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            return interaction.reply({ components: [buildPermissionDenied('Moderate Members')], flags: MessageFlags.IsComponentsV2 });
        }
        const target = interaction.options.getUser('user');
        const all = interaction.options.getBoolean('all');

        if (!target && !all) {
            return interaction.reply({ components: [buildErrorResponse('Choose a Target', 'Pick a **user** to clear, or enable **all** to clear the entire server.')], flags: MessageFlags.IsComponentsV2 });
        }

        return handleClear(
            interaction.reply.bind(interaction),
            interaction.channel,
            interaction.user.id,
            interaction.guild,
            (all && !target) ? 'server' : 'user',
            target,
        );
    },

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            return message.reply({ components: [buildPermissionDenied('Moderate Members')], flags: MessageFlags.IsComponentsV2 });
        }

        const target = message.mentions.users.first();
        const wantsAll = args.some(a => ['all', 'server', 'everyone'].includes(a.toLowerCase()));

        if (!target && !wantsAll) {
            return message.reply({
                components: [buildErrorResponse('Choose a Target', 'Usage: `clearwarnings @user` to clear one member, or `clearwarnings all` to clear the whole server.')],
                flags: MessageFlags.IsComponentsV2,
            });
        }

        return handleClear(
            message.reply.bind(message),
            message.channel,
            message.author.id,
            message.guild,
            (wantsAll && !target) ? 'server' : 'user',
            target,
        );
    },
};
