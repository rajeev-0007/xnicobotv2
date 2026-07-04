'use strict';

/**
 * marry — Propose marriage to another user.
 *
 * Slash and prefix entry points share the same `proposeMarriage`
 * pipeline. The slash variant is deferred up-front because the
 * proposal flow waits up to 30 seconds for a response.
 *
 * State is stored in the `marriages` json store as a symmetric
 * map: { [userId]: { partner, date } } for both members of the couple.
 */

const {
    SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, MessageFlags,
} = require('discord.js');
const jsonStore = require('../../utils/jsonStore');
const { resolveUser } = require('../../utils/resolveUser');
const ui = require('../../utils/socialUI');

const TIMEOUT = 30_000;

function loadMarriages() {
    if (!jsonStore.has('marriages')) return {};
    try { return jsonStore.read('marriages') || {}; } catch { return {}; }
}

/** Themed panel with a custom emoji + title + body (neutral accent, synced). */
function panel(guildId, emoji, title, body) {
    const ctr = new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${emoji} ${title}\n\n${body}`));
    return ui.applyStyle(ctr, guildId);
}

/**
 * Wraps both interaction and message reply paths behind a single call surface.
 */
function makeReplyer(context, isInteraction) {
    return async (payload) => {
        if (isInteraction) {
            if (!context._marryEditedOnce) {
                context._marryEditedOnce = true;
                return context.editReply(payload).catch(() => null);
            }
            return context.channel.send(payload).catch(() => null);
        }
        return context.reply(payload).catch(() => null);
    };
}

async function proposeMarriage(context, user, isInteraction) {
    const author  = isInteraction ? context.user : context.author;
    const channel = context.channel;
    const gid     = context.guild?.id;
    const reply   = makeReplyer(context, isInteraction);

    if (user.id === author.id) {
        return reply(ui.payload(ui.err(gid, "Can't Marry Yourself", 'You cannot marry yourself!')));
    }
    if (user.bot) {
        return reply(ui.payload(ui.err(gid, "Can't Marry Bots", 'You cannot marry a bot!')));
    }

    const config = loadMarriages();

    if (config[author.id]) {
        return reply(ui.payload(ui.err(gid, 'Already Married', 'You are already married! Use `divorce` to end your current marriage first.')));
    }
    if (config[user.id]) {
        return reply(ui.payload(ui.err(gid, 'User Already Married', `${user.username} is already married to someone else.`)));
    }

    // Send the proposal prompt and wait for a reply from the proposed-to user.
    await reply({
        ...ui.payload(panel(gid, ui.E.ring, 'Marriage Proposal',
            `**${author.username}** is proposing to **${user.username}**!\n\n` +
            `<@${user.id}>, do you accept? Type **yes** or **no** within 30 seconds.`)),
        allowedMentions: { users: [user.id] },
    });

    const filter = m =>
        m.author.id === user.id &&
        ['yes', 'no'].includes(m.content.trim().toLowerCase());

    const collected = await channel.awaitMessages({
        filter, max: 1, time: TIMEOUT, errors: ['time'],
    }).catch(() => null);

    if (!collected || collected.first().content.trim().toLowerCase() === 'no') {
        const timedOut = !collected;
        return channel.send(ui.payload(panel(gid, ui.E.broken, `Proposal ${timedOut ? 'Expired' : 'Rejected'}`,
            timedOut
                ? `**${user.username}** didn't respond in time.`
                : `**${user.username}** turned **${author.username}** down.`))).catch(() => null);
    }

    // Re-load to avoid race with a parallel proposal.
    const fresh = loadMarriages();
    if (fresh[author.id] || fresh[user.id]) {
        return channel.send(ui.payload(ui.err(gid, 'Marriage Conflict', 'One of you got married while waiting. Please try again.'))).catch(() => null);
    }

    const now = Date.now();
    fresh[author.id] = { partner: user.id,   date: now };
    fresh[user.id]   = { partner: author.id, date: now };
    jsonStore.write('marriages', fresh);

    return channel.send(ui.payload(panel(gid, ui.E.couple, 'Just Married!',
        `**${author.username}** and **${user.username}** are now married!\n\n` +
        `${ui.E.gift} Congratulations to the happy couple!`))).catch(() => null);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('marry')
        .setDescription('Propose marriage to another user')
        .addUserOption(opt =>
            opt.setName('user')
                .setDescription('The user to propose to')
                .setRequired(true)),

    prefix: 'marry',
    description: 'Propose marriage to another user',
    usage: 'marry <@user>',
    category: 'social',
    aliases: ['propose'],

    async execute(interaction) {
        if (!interaction.deferred && !interaction.replied) {
            await interaction.deferReply().catch(() => {});
        }
        const user = interaction.options.getUser('user');
        await proposeMarriage(interaction, user, true);
    },

    async executePrefix(message, args) {
        const user = await resolveUser(message, args);
        if (!user) {
            return message.reply(ui.payload(ui.err(message.guild?.id, 'Missing User', 'Please mention someone to propose to!', 'Usage: `marry @user`'))).catch(() => null);
        }
        await proposeMarriage(message, user, false);
    },
};
