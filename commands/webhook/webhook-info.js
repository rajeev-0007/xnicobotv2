'use strict';

const { MessageFlags } = require('discord.js');
const { buildExpiredPanel } = require('../../utils/responseBuilder');
const ui = require('../../utils/webhookUI');

const NS = 'whi';

module.exports = {
    data: null,
    prefix: 'webhook-info',
    description: 'Get detailed information about a webhook with quick actions',
    usage: 'webhook-info <webhook ID>',
    category: 'webhook',
    aliases: ['wh-info', 'webhookinfo'],
    permissions: ['ManageWebhooks'],

    async executePrefix(message, args) {
        const gid = message.guild.id;

        const permErr = ui.requireManageWebhooks(message.member, gid);
        if (permErr) return message.reply(ui.payload(permErr));

        const webhookId = args[0];
        if (!webhookId) {
            return message.reply(ui.payload(ui.errorPanel(gid, 'Invalid Usage',
                'Usage: `webhook-info <ID>`', 'Use `webhook-list` to see all webhooks.')));
        }

        const { webhooks, error } = await ui.fetchWebhooks(message.guild);
        if (error) return message.reply(ui.payload(error));

        const webhook = webhooks.get(webhookId);
        if (!webhook) {
            return message.reply(ui.payload(ui.errorPanel(gid, 'Not Found',
                `No webhook with ID \`${webhookId}\` exists.`, 'Use `webhook-list` to see available webhooks.')));
        }

        const uid = message.author.id;
        const view = ui.detailView({ webhook, guild: message.guild, uid, ns: NS });
        const sent = await message.reply(ui.payload(view));
        this._collect(sent, message, uid);
    },

    _collect(sent, message, uid) {
        const gid = message.guild.id;
        const collector = sent.createMessageComponentCollector({ time: ui.TIMEOUTS.PANEL });

        collector.on('collect', async (i) => {
            if (i.user.id !== uid) {
                return i.reply({ content: `${ui.E.no} Only the command invoker can use these controls.`, flags: MessageFlags.Ephemeral });
            }
            const [, action, , whId] = i.customId.split(':');

            try {
                const webhooks = await message.guild.fetchWebhooks();
                const wh = webhooks.get(whId);

                if (action !== 'send' && action !== 'rename' && !wh) {
                    return i.update(ui.payload(ui.errorPanel(gid, 'Webhook Deleted', 'This webhook no longer exists.')));
                }

                if (action === 'refresh') {
                    return i.update(ui.payload(ui.detailView({ webhook: wh, guild: message.guild, uid, ns: NS })));
                }
                if (action === 'del') {
                    return i.update(ui.payload(ui.confirmDeleteView({ webhook: wh, guild: message.guild, uid, ns: NS })));
                }
                if (action === 'cancelDel') {
                    return i.update(ui.payload(ui.detailView({ webhook: wh, guild: message.guild, uid, ns: NS })));
                }
                if (action === 'confirmDel') {
                    const name = wh.name;
                    await wh.delete(`Deleted by ${i.user.username}`);
                    collector.stop('deleted');
                    return i.update(ui.payload(ui.successPanel(gid, 'Webhook Deleted', `Deleted **${name}** • ${ui.E.id} \`${whId}\`.`)));
                }
                if (action === 'rename') {
                    return i.showModal(ui.renameModal(uid, whId));
                }
                if (action === 'send') {
                    return i.showModal(ui.sendModal(uid, whId));
                }
            } catch (err) {
                console.error('Webhook info interaction error:', err);
                if (!i.replied && !i.deferred) {
                    await i.reply({ content: `${ui.E.no} An error occurred.`, flags: MessageFlags.Ephemeral }).catch(() => {});
                }
            }
        });

        collector.on('end', (_, reason) => {
            if (reason === 'deleted') return;
            sent.edit(ui.payload(ui.applyStyle(buildExpiredPanel('webhook-info'), gid))).catch(() => {});
        });
    }
};
