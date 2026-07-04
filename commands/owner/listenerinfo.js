'use strict';

/**
 * listenerinfo.js — Owner-only: show the listener count for every
 * registered Discord client event. Helps diagnose duplicate event
 * registration after hot-reloads.
 */

const { isOwner } = require('../../utils/helpers');
const { ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');

module.exports = {
    name: 'listenerinfo',
    prefix: 'listenerinfo',
    aliases: ['listeners', 'eventcount', 'evcount'],
    description: 'Owner-only: list every event with attached listeners',
    usage: 'listenerinfo [filter]',
    category: 'owner',
    ownerOnly: true,

    async executePrefix(message, args, lavalinkManager, client) {
        if (!isOwner(message.author.id)) {
            return message.reply(require('../../utils/ownerUI').ownerOnly());
        }

        const filter = (args[0] || '').toLowerCase();
        const events = client.eventNames();

        const rows = events
            .map(e => ({ name: String(e), count: client.listenerCount(e) }))
            .filter(e => !filter || e.name.toLowerCase().includes(filter))
            .sort((a, b) => b.count - a.count);

        if (rows.length === 0) {
            return message.reply(require('../../utils/ownerUI').errReply('No Matches', 'No matching events.'));
        }

        const lines = rows.map(({ name, count }) => `> \`${name}\` — **${count}** listener${count === 1 ? '' : 's'}`);

        // Discord text components have a 4000 char limit; truncate if needed.
        let body = `# <:Document:1521227875016114266> Client Event Listeners\n\n`;
        if (filter) body += `**Filter:** \`${filter}\`\n`;
        body += `**Events:** ${rows.length}\n\n`;
        for (const line of lines) {
            if (body.length + line.length > 3800) {
                body += `> *(…truncated)*`;
                break;
            }
            body += line + '\n';
        }

        const container = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(body));

        await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
};
