'use strict';

const {
    ContainerBuilder, TextDisplayBuilder, ActionRowBuilder,
    ButtonBuilder, ButtonStyle, SeparatorBuilder, SeparatorSpacingSize, MessageFlags
} = require('discord.js');
const { buildExpiredPanel } = require('../../utils/responseBuilder');
const ui = require('../../utils/webhookUI');

module.exports = {
    data: null,
    prefix: 'webhook-rename',
    description: 'Rename a webhook (inline or via modal)',
    usage: 'webhook-rename <webhook ID> [new name]',
    category: 'webhook',
    aliases: ['wh-rename', 'renamewebhook'],
    permissions: ['ManageWebhooks'],

    async executePrefix(message, args) {
        const gid = message.guild.id;

        const permErr = ui.requireManageWebhooks(message.member, gid);
        if (permErr) return message.reply(ui.payload(permErr));

        const webhookId = args[0];
        if (!webhookId) {
            return message.reply(ui.payload(ui.errorPanel(gid, 'Invalid Usage',
                '`webhook-rename <ID> <new name>` — rename inline\n`webhook-rename <ID>` — open a rename modal',
                'Use `webhook-list` to see all webhooks.')));
        }

        const { webhooks, error } = await ui.fetchWebhooks(message.guild);
        if (error) return message.reply(ui.payload(error));

        const webhook = webhooks.get(webhookId);
        if (!webhook) {
            return message.reply(ui.payload(ui.errorPanel(gid, 'Not Found',
                `No webhook with ID \`${webhookId}\` exists.`, 'Use `webhook-list` to see available webhooks.')));
        }

        const newName = args.slice(1).join(' ');
        const uid = message.author.id;
        const sid = `${uid}_${Date.now().toString(36)}`;

        /* ── INLINE RENAME ── */
        if (newName) {
            if (newName.length > 80) {
                return message.reply(ui.payload(ui.errorPanel(gid, 'Name Too Long', 'Webhook name must be 80 characters or fewer.')));
            }

            const confirm = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${ui.E.edit} Confirm Rename`))
                .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(ui.rows(
                    `**Current:** ${webhook.name}`,
                    `**New:** ${newName}`,
                    `**ID:** \`${webhook.id}\``
                )))
                .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
            confirm.addActionRowComponents(new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`whr:confirm:${sid}`).setEmoji(ui.E.ok).setLabel('Confirm').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`whr:cancel:${sid}`).setEmoji(ui.E.no).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
            ));
            ui.applyStyle(confirm, gid);

            const sent = await message.reply(ui.payload(confirm));
            const collector = sent.createMessageComponentCollector({ time: ui.TIMEOUTS.CONFIRM });

            collector.on('collect', async (i) => {
                if (i.user.id !== uid) {
                    return i.reply({ content: `${ui.E.no} Only the command invoker can use this.`, flags: MessageFlags.Ephemeral });
                }
                const action = i.customId.split(':')[1];
                collector.stop('handled');

                if (action === 'cancel') {
                    return i.update(ui.payload(ui.infoPanel(gid, 'Cancelled', 'Webhook rename was cancelled.')));
                }
                try {
                    const fresh = await message.guild.fetchWebhooks();
                    const wh = fresh.get(webhookId);
                    if (!wh) return i.update(ui.payload(ui.errorPanel(gid, 'Not Found', 'Webhook no longer exists.')));
                    const oldName = wh.name;
                    await wh.edit({ name: newName, reason: `Renamed by ${i.user.username}` });
                    return i.update(ui.payload(ui.successPanel(gid, 'Webhook Renamed', `**${oldName}** → **${newName}**`)));
                } catch (err) {
                    console.error('Error renaming webhook:', err);
                    return i.update(ui.payload(ui.errorPanel(gid, 'Failed', `Could not rename webhook.\n> ${err.message}`)));
                }
            });

            collector.on('end', (_, reason) => {
                if (reason === 'handled') return;
                sent.edit(ui.payload(ui.applyStyle(buildExpiredPanel('webhook-rename', 'Webhook was not renamed.'), gid))).catch(() => {});
            });
            return;
        }

        /* ── MODAL MODE ── */
        const ch = message.guild.channels.cache.get(webhook.channelId);
        const prompt = ui.infoPanel(gid, `${ui.E.edit} Rename Webhook`,
            `### ${ui.E.gear} Current\n` +
            ui.rows(
                `**Name:** ${webhook.name}`,
                `**Channel:** ${ch ? `<#${ch.id}>` : '*Unknown*'}`,
                `**ID:** \`${webhook.id}\``
            ) +
            `\n\n-# Click below to enter a new name.`,
            [new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`whr:modal:${sid}:${webhookId}`).setEmoji(ui.E.edit).setLabel('Enter New Name').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`whr:cancel:${sid}`).setEmoji(ui.E.no).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
            )]
        );

        const sent = await message.reply(ui.payload(prompt));
        const collector = sent.createMessageComponentCollector({ time: ui.TIMEOUTS.FOLLOW });

        collector.on('collect', async (i) => {
            if (i.user.id !== uid) {
                return i.reply({ content: `${ui.E.no} Only the command invoker can use this.`, flags: MessageFlags.Ephemeral });
            }
            const parts = i.customId.split(':');
            const action = parts[1];

            if (action === 'cancel') {
                collector.stop('cancelled');
                return i.update(ui.payload(ui.infoPanel(gid, 'Cancelled', 'Rename cancelled.')));
            }
            if (action === 'modal') {
                return i.showModal(ui.renameModal(uid, parts[3]));
            }
        });

        collector.on('end', (_, reason) => {
            if (reason === 'cancelled') return;
            sent.edit(ui.payload(ui.applyStyle(buildExpiredPanel('webhook-rename'), gid))).catch(() => {});
        });
    },

    /* ── MODAL HANDLER (routed from index.js for wh_modal_rename) ── */
    async handleModalSubmit(interaction) {
        const parts = interaction.customId.split(':');
        const uid = parts[1];
        const whId = parts[2];
        const gid = interaction.guild?.id;

        if (interaction.user.id !== uid) {
            return interaction.reply({ content: `${ui.E.no} This modal is not for you.`, flags: MessageFlags.Ephemeral });
        }

        const newName = interaction.fields.getTextInputValue('new_name').trim();
        if (!newName || newName.length > 80) {
            return interaction.reply(ui.payload(ui.errorPanel(gid, 'Invalid Name', 'Name must be 1-80 characters.')));
        }

        const { webhooks, error } = await ui.fetchWebhooks(interaction.guild);
        if (error) return interaction.reply(ui.payload(error));

        const webhook = webhooks.get(whId);
        if (!webhook) {
            return interaction.reply(ui.payload(ui.errorPanel(gid, 'Not Found', 'Webhook no longer exists.')));
        }

        try {
            const oldName = webhook.name;
            await webhook.edit({ name: newName, reason: `Renamed by ${interaction.user.username}` });
            return interaction.reply(ui.payload(ui.successPanel(gid, 'Webhook Renamed', `**${oldName}** → **${newName}** • ${ui.E.id} \`${whId}\``)));
        } catch (err) {
            console.error('Error renaming webhook via modal:', err);
            return interaction.reply(ui.payload(ui.errorPanel(gid, 'Failed', `Could not rename webhook.\n> ${err.message}`)));
        }
    }
};
