'use strict';

const jsonStore = require('../../utils/jsonStore');
const { preflightPlayer, musicSuccess, musicError, replyMusic } = require('../../utils/musicResponse');

const STORE = 'musicpanel-247';

function load() {
    if (!jsonStore.has(STORE)) {
        jsonStore.write(STORE, {});
        return {};
    }
    return jsonStore.read(STORE) || {};
}

function save(data) { jsonStore.write(STORE, data); }

module.exports = {
    /**
     * Premium-gated. The command dispatcher in index.js reads
     * `premiumOnly` and shows the standard premium gate to free users.
     */
    premiumOnly: true,

    name: '247',
    prefix: '247',
    description: 'Toggle 24/7 mode — keep the bot in voice indefinitely',
    usage: '247',
    category: 'music',
    aliases: ['24/7', 'stay'],

    async executePrefix(message, _args, lavalinkManager) {
        const player  = lavalinkManager.getPlayer(message.guild.id);
        const isSlash = false;

        const config = load();
        const guildId = message.guild.id;
        const enabled = !!config[guildId]?.enabled;

        // Disabling: no need to be in VC, just flip the flag.
        if (enabled) {
            delete config[guildId];
            save(config);
            return replyMusic(message, musicSuccess(
                '24/7 Mode Disabled',
                'The bot will leave when the queue is empty or after inactivity.',
            ));
        }

        // Enabling: must be playing in a VC
        const pre = preflightPlayer({ player, member: message.member });
        if (!pre.ok) return replyMusic(message, pre.container, { ephemeral: pre.ephemeral });

        if (!message.member.voice?.channel) {
            return replyMusic(message, musicError('Voice Required', 'Join a voice channel first, then enable 24/7 mode.'), { ephemeral: isSlash });
        }

        config[guildId] = {
            enabled: true,
            voiceChannelId: message.member.voice.channel.id,
            textChannelId:  message.channel.id,
            enabledAt:      Date.now(),
        };
        save(config);

        return replyMusic(message, musicSuccess(
            '24/7 Mode Enabled',
            `The bot will stay in <#${message.member.voice.channel.id}> even when the queue is empty.`,
            'Run `-247` again to disable.'
        ));
    },
};
