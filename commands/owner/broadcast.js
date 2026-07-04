'use strict';

/**
 * broadcast.js — Owner-only: send a message to every guild's
 * announcement / system / first-writable channel. Use sparingly.
 */

const { isOwner } = require('../../utils/helpers');
const { ChannelType, ContainerBuilder, TextDisplayBuilder, MessageFlags, PermissionsBitField } = require('discord.js');

const CONFIRM_TIMEOUT_MS = 30_000;

function pickTargetChannel(guild) {
    const me = guild.members.me;
    if (!me) return null;

    const canSend = (ch) => {
        const perms = ch.permissionsFor?.(me);
        return perms?.has([PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ViewChannel]);
    };

    // 1. announcement channel
    let ch = guild.channels.cache.find(c => c.type === ChannelType.GuildAnnouncement && canSend(c));
    if (ch) return ch;
    // 2. system channel
    if (guild.systemChannel && canSend(guild.systemChannel)) return guild.systemChannel;
    // 3. named general/chat
    ch = guild.channels.cache.find(c => c.type === ChannelType.GuildText && /^(general|chat|main|lobby)$/i.test(c.name) && canSend(c));
    if (ch) return ch;
    // 4. first writable text
    return guild.channels.cache.find(c => c.type === ChannelType.GuildText && canSend(c)) || null;
}

module.exports = {
    name: 'broadcast',
    prefix: 'broadcast',
    aliases: ['announceall', 'castall'],
    description: 'Owner-only: broadcast a message to every guild',
    usage: 'broadcast <message>',
    category: 'owner',
    ownerOnly: true,

    async executePrefix(message, args, lavalinkManager, client) {
        if (!isOwner(message.author.id)) {
            return message.reply(require('../../utils/ownerUI').ownerOnly());
        }

        const text = args.join(' ').trim();
        if (!text) {
            return message.reply(require('../../utils/ownerUI').errReply('Missing Message', 'Provide a message.', { hint: 'Usage: `broadcast <message>`' }));
        }

        const totalGuilds = client.guilds.cache.size;
        const confirmMsg = await message.reply(
            `<:Inforect:1521228008285929532> About to broadcast to **${totalGuilds}** guild(s).\nReply with \`yes\` within ${CONFIRM_TIMEOUT_MS / 1000}s to confirm.`
        );

        try {
            const collected = await message.channel.awaitMessages({
                filter: m => m.author.id === message.author.id && m.content.toLowerCase() === 'yes',
                max: 1,
                time: CONFIRM_TIMEOUT_MS,
                errors: ['time']
            });
            if (!collected.size) throw new Error('timeout');
        } catch {
            return confirmMsg.edit('<:Cancel:1521227723916181644> Broadcast cancelled (no confirmation).').catch(() => {});
        }

        const status = await message.channel.send(`<:Lightning:1521227915537285150> Broadcasting to **${totalGuilds}** guild(s)…`);

        let sent = 0;
        let skipped = 0;
        const guildArr = [...client.guilds.cache.values()];

        // Send in small batches to be polite to the API.
        const BATCH = 10;
        for (let i = 0; i < guildArr.length; i += BATCH) {
            const batch = guildArr.slice(i, i + BATCH);
            await Promise.allSettled(batch.map(async guild => {
                const ch = pickTargetChannel(guild);
                if (!ch) { skipped++; return; }
                try {
                    await ch.send({ content: text, allowedMentions: { parse: [] } });
                    sent++;
                } catch {
                    skipped++;
                }
            }));
            // small delay between batches
            await new Promise(r => setTimeout(r, 750));
        }

        const result = new ContainerBuilder()
            .setAccentColor(0x57F287)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `# <:Checkedbox:1521227734943269077> Broadcast Complete\n\n` +
                `> Sent: **${sent}** / ${totalGuilds}\n` +
                `> Skipped: **${skipped}**\n\n` +
                `**Message preview:**\n\`\`\`\n${text.slice(0, 1500)}${text.length > 1500 ? '…' : ''}\n\`\`\``
            ));

        await status.edit({ content: null, components: [result], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
    }
};
