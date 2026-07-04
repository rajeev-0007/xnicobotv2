'use strict';

/**
 * purge-mass.js — Owner-only: bulk-delete recent messages in the
 * current channel, optionally filtered to a specific user. Uses
 * Discord's bulkDelete API for messages newer than 14 days.
 */

const { isOwner } = require('../../utils/helpers');
const { ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');

const MAX = 1000;       // hard cap to avoid hammering the API
const BATCH = 100;      // bulkDelete max
const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

module.exports = {
    name: 'purge-mass',
    prefix: 'purge-mass',
    aliases: ['masspurge', 'purgealot'],
    description: 'Owner-only: bulk delete up to 1000 recent messages',
    usage: 'purge-mass <count> [@user]',
    category: 'owner',
    ownerOnly: true,

    async executePrefix(message, args) {
        if (!isOwner(message.author.id)) {
            return message.reply(require('../../utils/ownerUI').ownerOnly());
        }
        if (!message.guild) {
            return message.reply(require('../../utils/ownerUI').errReply('Not In A Server', 'Run this in a server channel.'));
        }

        const count = parseInt(args[0], 10);
        if (!Number.isFinite(count) || count < 1) {
            return message.reply(require('../../utils/ownerUI').errReply('Missing Count', 'Provide a count.', { hint: 'Usage: `purge-mass <count> [@user]`' }));
        }
        const target = Math.min(count, MAX);
        const filterUser = message.mentions.users.first();

        const status = await message.reply(`<:Lightning:1521227915537285150> Purging up to **${target}** messages…`);
        let deleted = 0;
        let lastId = message.id;
        const cutoff = Date.now() - FOURTEEN_DAYS_MS;

        while (deleted < target) {
            const limit = Math.min(BATCH, target - deleted);
            const fetched = await message.channel.messages.fetch({ limit, before: lastId }).catch(() => null);
            if (!fetched || fetched.size === 0) break;

            const eligible = fetched.filter(m =>
                m.createdTimestamp > cutoff &&
                (!filterUser || m.author.id === filterUser.id)
            );

            if (eligible.size > 0) {
                try {
                    const result = await message.channel.bulkDelete(eligible, true);
                    deleted += result.size;
                } catch {
                    // Fallback: delete individually
                    for (const m of eligible.values()) {
                        try { await m.delete(); deleted++; } catch {}
                    }
                }
            }

            lastId = fetched.last()?.id;
            if (!lastId) break;
        }

        const container = new ContainerBuilder()
            .setAccentColor(0x57F287)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `# <:Trash:1521227750420254820> Purge Complete\n\n` +
                `> **Deleted:** ${deleted}\n` +
                (filterUser ? `> **Filter:** ${filterUser.tag}\n` : '') +
                `-# Messages older than 14 days cannot be bulk-deleted.`
            ));

        await status.edit({ content: null, components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
    }
};
