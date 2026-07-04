'use strict';

const { MessageFlags } = require('discord.js');
const { buildExpiredPanel } = require('../../utils/responseBuilder');
const ui = require('../../utils/webhookUI');

const NS = 'wh';

module.exports = {
    data: null,
    prefix: 'webhook-list',
    description: 'List all webhooks in the server with interactive management',
    usage: 'webhook-list',
    category: 'webhook',
    aliases: ['wh-list', 'listwebhooks', 'wh-manage', 'webhooks'],
    permissions: ['ManageWebhooks'],

    async executePrefix(message) {
        const gid = message.guild.id;

        const permErr = ui.requireManageWebhooks(message.member, gid);
        if (permErr) return message.reply(ui.payload(permErr));

        const { webhooks, error } = await ui.fetchWebhooks(message.guild);
        if (error) return message.reply(ui.payload(error));

        if (webhooks.size === 0) {
            return message.reply(ui.payload(ui.errorPanel(gid, 'No Webhooks',
                'No webhooks found in this server.', 'Use `webhook-create` to make one.')));
        }

        const uid = message.author.id;
        let page = 0;

        const { container } = ui.listView({ webhooks, guild: message.guild, page, uid, ns: NS });
        const sent = await message.reply(ui.payload(container));
        const collector = sent.createMessageComponentCollector({ time: ui.TIMEOUTS.PANEL });

        const showList = async (i) => {
            const wh = await message.guild.fetchWebhooks();
            if (wh.size === 0) {
                return i.update(ui.payload(ui.errorPanel(gid, 'No Webhooks', 'All webhooks have been deleted.')));
            }
            const { container: c, page: pg } = ui.listView({ webhooks: wh, guild: message.guild, page, uid, ns: NS });
            page = pg;
            return i.update(ui.payload(c));
        };

        collector.on('collect', async (i) => {
            if (i.user.id !== uid) {
                return i.reply({ content: `${ui.E.no} Only the command invoker can use these controls.`, flags: MessageFlags.Ephemeral });
            }
            const parts = i.customId.split(':');
            const action = parts[1];
            const whId = parts[3];

            try {
                if (action === 'prev') { page = Math.max(0, page - 1); return showList(i); }
                if (action === 'next') { page += 1; return showList(i); }
                if (action === 'refresh' || action === 'back') { return showList(i); }

                if (action === 'select' && i.isStringSelectMenu()) {
                    const webhooks = await message.guild.fetchWebhooks();
                    const wh = webhooks.get(i.values[0]);
                    if (!wh) return showList(i);
                    return i.update(ui.payload(ui.detailView({ webhook: wh, guild: message.guild, uid, ns: NS, showBack: true })));
                }

                // Actions targeting a specific webhook
                const webhooks = await message.guild.fetchWebhooks();
                const wh = webhooks.get(whId);

                if (action === 'rename') {
                    if (!wh) return i.update(ui.payload(ui.errorPanel(gid, 'Webhook Deleted', 'This webhook no longer exists.')));
                    return i.showModal(ui.renameModal(uid, whId));
                }
                if (action === 'send') {
                    if (!wh) return i.update(ui.payload(ui.errorPanel(gid, 'Webhook Deleted', 'This webhook no longer exists.')));
                    return i.showModal(ui.sendModal(uid, whId));
                }
                if (action === 'del') {
                    if (!wh) return showList(i);
                    return i.update(ui.payload(ui.confirmDeleteView({ webhook: wh, guild: message.guild, uid, ns: NS })));
                }
                if (action === 'cancelDel') {
                    if (!wh) return showList(i);
                    return i.update(ui.payload(ui.detailView({ webhook: wh, guild: message.guild, uid, ns: NS, showBack: true })));
                }
                if (action === 'confirmDel') {
                    if (!wh) return showList(i);
                    const name = wh.name;
                    await wh.delete(`Deleted by ${i.user.username} via webhook-list`);
                    const remaining = await message.guild.fetchWebhooks();
                    if (remaining.size === 0) {
                        return i.update(ui.payload(ui.successPanel(gid, 'Webhook Deleted', `Deleted **${name}**. No webhooks left.`)));
                    }
                    page = 0;
                    const { container: c } = ui.listView({ webhooks: remaining, guild: message.guild, page, uid, ns: NS });
                    return i.update(ui.payload(c));
                }
            } catch (err) {
                console.error('Webhook list interaction error:', err);
                if (!i.replied && !i.deferred) {
                    await i.reply({ content: `${ui.E.no} An error occurred.`, flags: MessageFlags.Ephemeral }).catch(() => {});
                }
            }
        });

        collector.on('end', () => {
            sent.edit(ui.payload(ui.applyStyle(buildExpiredPanel('webhook-list'), gid))).catch(() => {});
        });
    }
};
