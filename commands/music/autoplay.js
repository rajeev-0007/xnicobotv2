'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { preflightPlayer, musicSuccess, replyMusic } = require('../../utils/musicResponse');

async function run(target, lavalinkManager) {
    const player = lavalinkManager.getPlayer(target.guild.id);

    const pre = preflightPlayer({ player, member: target.member });
    if (!pre.ok) return replyMusic(target, pre.container, { ephemeral: pre.ephemeral });

    const map = target.client.autoplayStatus = target.client.autoplayStatus || new Map();
    const current = map.get(target.guild.id) || false;
    const next = !current;
    map.set(target.guild.id, next);

    return replyMusic(target, musicSuccess(
        `Autoplay ${next ? 'Enabled' : 'Disabled'}`,
        next
            ? 'Related tracks will be queued automatically when the queue ends.'
            : 'Autoplay is now off.',
    ));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('autoplay')
        .setDescription('Toggle autoplay (queue related tracks when the queue ends)'),

    prefix: 'autoplay',
    description: 'Toggle autoplay',
    usage: 'autoplay',
    category: 'music',
    aliases: ['ap', 'auto'],

    async execute(interaction, lavalinkManager)         { return run(interaction, lavalinkManager); },
    async executePrefix(message, _args, lavalinkManager){ return run(message,     lavalinkManager); },

    getAutoplayStatus(guildId, client) {
        return !!(client?.autoplayStatus && client.autoplayStatus.get(guildId));
    },
};
