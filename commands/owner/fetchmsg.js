const { isOwner } = require('../../utils/helpers');
const { MessageFlags, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MediaGalleryBuilder, MediaGalleryItemBuilder } = require('discord.js');

module.exports = {
    name: 'fetchmsg',
    prefix: 'fetchmsg',
    aliases: ['getmsg', 'fetchmessage', 'msgfetch'],
    description: 'Fetch and display any message by its ID',
    usage: 'fetchmsg <messageID> [channelID]',
    category: 'owner',
    ownerOnly: true,

    async executePrefix(message, args) {
        if (!isOwner(message.author.id)) return;
        if (!args[0]) return message.reply(require('../../utils/ownerUI').errReply('Missing Argument', 'Provide a message ID.', { hint: 'Usage: `fetchmsg <messageID> [channelID]`' }));
        await this.fetchMessage(message, message.client, args[0], args[1]);
    },

    async fetchMessage(context, client, messageId, channelId) {
        let msg = null;
        let channel = null;

        if (channelId) {
            channel = client.channels.cache.get(channelId);
            if (!channel) {
                const reply = '<:Cancel:1521227723916181644> Channel not found.';
                return context.editReply ? context.editReply({ content: reply }) : context.reply(reply);
            }
            try { msg = await channel.messages.fetch(messageId); } catch {}
        } else {
            // Search across all text channels
            for (const ch of client.channels.cache.values()) {
                if (!ch.isTextBased?.() || ch.isDMBased?.()) continue;
                try {
                    msg = await ch.messages.fetch(messageId);
                    channel = ch;
                    if (msg) break;
                } catch { continue; }
            }
        }

        if (!msg) {
            const reply = '<:Cancel:1521227723916181644> Message not found. Make sure the ID is correct and the bot has access.';
            return context.editReply ? context.editReply({ content: reply }) : context.reply(reply);
        }

        const content = msg.content || '*No text content*';
        const truncated = content.length > 1500 ? content.substring(0, 1500) + '...' : content;
        const attachments = msg.attachments.map(a => a.url);
        const embeds = msg.embeds.length;
        const components = msg.components.length;

        const container = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `### <:Document:1521227875016114266> Fetched Message\n` +
                    `**Author:** ${msg.author.username} (\`${msg.author.id}\`)\n` +
                    `**Channel:** <#${channel.id}> (\`${channel.id}\`)\n` +
                    `**Server:** ${channel.guild?.name || 'DM'}\n` +
                    `**Sent:** <t:${Math.floor(msg.createdTimestamp / 1000)}:F>\n` +
                    (msg.editedTimestamp ? `**Edited:** <t:${Math.floor(msg.editedTimestamp / 1000)}:R>\n` : '') +
                    `**Attachments:** ${attachments.length} · **Embeds:** ${embeds} · **Components:** ${components}`
                )
            )
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`### <:Hashtag:1521227771957870604> Content\n${truncated}`)
            );

        // Show first image attachment if any
        const imageAttachment = msg.attachments.find(a => a.contentType?.startsWith('image/'));
        if (imageAttachment) {
            container.addMediaGalleryComponents(
                new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(imageAttachment.url))
            );
        }

        if (attachments.length > 0) {
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`-# Attachments: ${attachments.map((u, i) => `[File ${i + 1}](${u})`).join(' · ')}`)
            );
        }

        const opts = { components: [container], flags: MessageFlags.IsComponentsV2 };
        return context.editReply ? context.editReply(opts) : context.reply(opts);
    }
};
