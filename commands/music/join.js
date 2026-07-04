'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { preflightVoiceOnly, musicSuccess, musicError, replyMusic } = require('../../utils/musicResponse');

async function run(target, lavalinkManager) {
    const isSlash = typeof target.isRepliable === 'function';
    const member  = target.member;

    const voiceErr = preflightVoiceOnly(member);
    if (voiceErr) return replyMusic(target, voiceErr.container, { ephemeral: isSlash });

    if (!lavalinkManager.useable) {
        return replyMusic(target, musicError(
            'Music Unavailable',
            'No music servers are connected right now.',
            'Please try again in a moment.'
        ), { ephemeral: isSlash });
    }

    try {
        let player = lavalinkManager.getPlayer(target.guild.id);
        const desiredVc = member.voice.channel.id;

        if (player && player.voiceChannelId === desiredVc) {
            return replyMusic(target, musicError('Already Connected', "I'm already in your voice channel."), { ephemeral: isSlash });
        }
        if (player) {
            await player.destroy().catch(() => {});
        }

        player = await lavalinkManager.createPlayer({
            guildId: target.guild.id,
            voiceChannelId: desiredVc,
            textChannelId: target.channel.id,
            selfDeaf: true,
            selfMute: false,
            volume: 100,
        });
        await player.connect();

        return replyMusic(target, musicSuccess(
            'Joined Voice Channel',
            `Connected to **${member.voice.channel.name}**.`,
            'Ready to play music.'
        ));
    } catch (err) {
        return replyMusic(target, musicError(
            'Join Failed',
            'Could not join your voice channel.',
            err?.message || 'Check that I have permission to join and speak.'
        ), { ephemeral: isSlash });
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('join')
        .setDescription('Make the bot join your voice channel'),

    prefix: 'join',
    description: 'Make the bot join your voice channel',
    usage: 'join',
    category: 'music',
    aliases: ['j', 'come', 'summon'],

    async execute(interaction, lavalinkManager)         { return run(interaction, lavalinkManager); },
    async executePrefix(message, _args, lavalinkManager){ return run(message,     lavalinkManager); },
};
