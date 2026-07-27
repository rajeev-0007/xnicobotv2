'use strict';

/**
 * restart.js — prefix-only.
 * Flushes jsonStore and exits with code 1 so a process manager
 * (pm2/replit/nodemon/systemd) can restart the bot.
 */

const { isOwner } = require('../../utils/helpers');
const jsonStore = require('../../utils/jsonStore');
const { MessageFlags, ContainerBuilder, TextDisplayBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const log = require('../../utils/logger');
const { buildErrorResponse } = require('../../utils/responseBuilder');

function getActivePlayers(client) {
    const lm = client.lavalinkManager;
    if (!lm?.players?.size) return [];
    return [...lm.players.values()]
        .filter(p => p.playing || p.paused)
        .map(p => {
            const guild = client.guilds.cache.get(p.guildId);
            const track = p.queue?.current;
            return {
                guild: guild?.name || p.guildId,
                track: track?.info?.title || 'Unknown',
                paused: p.paused
            };
        });
}

function formatPlayerInfo(activePlayers) {
    if (!activePlayers.length) return '\n> No active music sessions.';
    let info = `\n> **⚠️ ${activePlayers.length} active music session(s):**`;
    for (const p of activePlayers) {
        info += `\n> • **${p.guild}** — ${p.track}${p.paused ? ' (paused)' : ''}`;
    }
    return info;
}

module.exports = {
    name: 'restart',
    prefix: 'restart',
    aliases: ['reboot'],
    description: 'Owner-only: restart the bot process',
    usage: 'restart',
    category: 'owner',
    ownerOnly: true,

    async executePrefix(message) {
        if (!isOwner(message.author.id)) {
            return message.reply({ components: [buildErrorResponse('Owner Only', 'This command is only available to the bot owner.')], flags: MessageFlags.IsComponentsV2 });
        }

        const activePlayers = getActivePlayers(message.client);
        const playerInfo = formatPlayerInfo(activePlayers);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('confirm_restart')
                .setLabel('Restart')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('cancel_restart')
                .setLabel('Cancel')
                .setStyle(ButtonStyle.Secondary)
        );

        const container = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `# ⚠️ Restart Confirmation\n\nAre you sure you want to restart the bot?${playerInfo}`
            ))
            .addActionRowComponents(row);

        const replyMessage = await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });

        const collector = replyMessage.createMessageComponentCollector({
            filter: i => i.user.id === message.author.id,
            time: 30000,
            max: 1
        });

        collector.on('collect', async i => {
            if (i.customId === 'cancel_restart') {
                const cancelContainer = new ContainerBuilder()
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                        `# ❌ Restart Cancelled\n\nThe bot restart was cancelled.`
                    ));
                await i.update({ components: [cancelContainer], flags: MessageFlags.IsComponentsV2 });
                return;
            }

            if (i.customId === 'confirm_restart') {
                if (activePlayers.length) {
                    log.warning?.(`Restart initiated with ${activePlayers.length} active player(s): ${activePlayers.map(p => `${p.guild} → ${p.track}`).join(', ')}`);
                }

                const confirmContainer = new ContainerBuilder()
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                        `# <:Refresh:1521227946441052420> Restarting Bot\n\n**Status:** Flushing database and restarting...\n**Expected downtime:** 5-10 seconds`
                    ));

                await i.update({ components: [confirmContainer], flags: MessageFlags.IsComponentsV2 });

                try { await jsonStore.flush(); } catch { }
                setTimeout(() => process.exit(1), 1000);
            }
        });

        collector.on('end', async (collected, reason) => {
            if (reason === 'time' && collected.size === 0) {
                const timeoutContainer = new ContainerBuilder()
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                        `# ⏱️ Restart Cancelled\n\nConfirmation timed out.`
                    ));
                await replyMessage.edit({ components: [timeoutContainer], flags: MessageFlags.IsComponentsV2 }).catch(() => { });
            }
        });
    }
};
