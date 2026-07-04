'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { buildQueueContainer } = require('../../utils/musicPanel');
const { musicError, replyMusic } = require('../../utils/musicResponse');

async function run(target, lavalinkManager, page) {
    const player  = lavalinkManager.getPlayer(target.guild.id);
    const isSlash = typeof target.isRepliable === 'function';

    if (!player || !player.queue?.current) {
        return replyMusic(target, musicError('No Music Playing', 'There is no music currently playing.', 'Use `/play <song>` to start playback.'), { ephemeral: isSlash });
    }

    const safePage = Math.max(0, (Number.isFinite(page) ? page : 1) - 1);
    return replyMusic(target, buildQueueContainer(player, safePage));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('queue')
        .setDescription('Display the current music queue')
        .addIntegerOption(o => o.setName('page').setDescription('Page number').setMinValue(1).setRequired(false)),

    prefix: 'queue',
    description: 'Display the current music queue',
    usage: 'queue [page]',
    category: 'music',
    aliases: ['q'],

    async execute(interaction, lavalinkManager) {
        const page = interaction.options.getInteger('page') || 1;
        return run(interaction, lavalinkManager, page);
    },
    async executePrefix(message, args, lavalinkManager) {
        const page = parseInt(args[0]) || 1;
        return run(message, lavalinkManager, page);
    },
};
