'use strict';

const { PermissionFlagsBits, MessageFlags } = require('discord.js');
const { buildPermissionDenied } = require('../../utils/responseBuilder');
const { musicSuccess, musicError, replyMusic } = require('../../utils/musicResponse');
const log = require('../../utils/logger-styled');

const jsonStore = require('../../utils/jsonStore');

const STORE = 'musicpanel';
const CV2 = MessageFlags.IsComponentsV2;

function loadPanelConfig() {
    if (!jsonStore.has(STORE)) return {};
    return jsonStore.read(STORE) || {};
}
function savePanelConfig(config) { jsonStore.write(STORE, config); }

module.exports = {
    name: 'removepanel',
    prefix: 'removepanel',
    description: 'Remove the music panel from this server',
    usage: 'removepanel',
    category: 'music',
    aliases: ['rmpanel'],

    async executePrefix(message) {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return message.reply({ components: [buildPermissionDenied('Manage Channels')], flags: CV2 });
        }

        const config = loadPanelConfig();
        if (!config[message.guild.id]) {
            return replyMusic(message, musicError('No Panel', 'There is no music panel configured for this server.'));
        }

        try {
            const panelData = config[message.guild.id];
            const channel = message.guild.channels.cache.get(panelData.channelId);
            if (channel) {
                try { await channel.delete('Music panel removed by admin'); }
                catch (e) { log.error?.(`[removepanel] channel delete failed: ${e.message}`); }
            }

            delete config[message.guild.id];
            savePanelConfig(config);

            if (global.musicPanelCache) global.musicPanelCache.set(message.guild.id, false);
            if (global.musicPanelChannelCache) global.musicPanelChannelCache.delete(message.guild.id);

            return replyMusic(message, musicSuccess(
                'Music Panel Removed',
                'The music panel has been removed from this server.',
            ));
        } catch (err) {
            log.error?.(`[removepanel] Failed: ${err.message}`);
            return replyMusic(message, musicError(
                'Remove Failed',
                'Could not fully remove the music panel.',
                err.message || 'Check my permissions and try again.'
            ));
        }
    },
};
