'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { buildExpiredPanel } = require('../../utils/responseBuilder');
const ui = require('../../utils/webhookUI');

module.exports = {
    data: null,
    prefix: 'webhook-delete',
    description: 'Delete a webhook from the server with confirmation',
    usage: 'webhook-delete <webhook ID>',
    category: 'webhook',
    aliases: ['wh-delete', 'deletewebhook'],
    permissions: ['ManageWebhooks'],

    async executePrefix(message, args) {
        const gid = message.guild.id;

        const permErr = ui.requireManageWebhooks(message.member, gid);
        if (permErr) return message.reply(ui.payload(permErr));

        const webhookId = args[0];
        if (!webhookId) {
            return message.reply(ui.payload(ui.errorPanel(gid, 'Invalid Usage',
                'Provide a webhook ID.', 'Usage: `webhook-delete <ID>` • use `webhook-list` to find IDs.')));
        }

        const { webhooks, error } = await ui.fetchWebhooks(message.guild);
        if (error) return message.reply(ui.payload(error));

        const webhook = webhooks.get(webhookId);
        if (!webhook) {
            return message.reply(ui.payload(ui.errorPanel(gid, 'Not Found',
                `No webhook with ID \`${webhookId}\` exists.`, 'Use `webhook-list` to see available webhooks.')));
        }

        const uid = message.author.id;
        const confirm = ui.confirmDeleteView({ webhook, guild: message.guild, uid, ns: 'whd' });
        const sent = await message.reply(ui.payload(confirm));
        const collector = sent.createMessageComponentCollector({ time: ui.TIMEOUTS.CONFIRM });

        collector.on('collect', async (i) => {
            if (i.user.id !== uid) {
                return i.reply({ content: `${ui.E.no} Only the command invoker can use this.`, flags: MessageFlags.Ephemeral });
            }
            const action = i.customId.split(':')[1];
            collector.stop('handled');

            if (action === 'cancelDel') {
                return i.update(ui.payload(ui.infoPanel(gid, 'Cancelled', `**${webhook.name}** is safe — deletion cancelled.`)));
            }

            try {
                const fresh = await message.guild.fetchWebhooks();
                const wh = fresh.get(webhookId);
                if (!wh) {
                    return i.update(ui.payload(ui.errorPanel(gid, 'Already Deleted', 'This webhook no longer exists.')));
                }
                const name = wh.name;
                await wh.delete(`Deleted by ${i.user.username}`);
                return i.update(ui.payload(ui.successPanel(gid, 'Webhook Deleted',
                    `Deleted **${name}** • ${ui.E.id} \`${webhookId}\``)));
            } catch (err) {
                console.error('Error deleting webhook:', err);
                return i.update(ui.payload(ui.errorPanel(gid, 'Failed', 'Could not delete webhook. Please try again.')));
            }
        });

        collector.on('end', (_, reason) => {
            if (reason === 'handled') return;
            sent.edit(ui.payload(ui.applyStyle(buildExpiredPanel('webhook-delete', `**${webhook.name}** was not deleted.`), gid))).catch(() => {});
        });
    }
};
