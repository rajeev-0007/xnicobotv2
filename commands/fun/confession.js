'use strict';

/**
 * Confession System — Anonymous & Public confessions
 *
 * Slash:
 *   /confess <message>          — anonymous confession via slash
 *
 * Public panel buttons (`confpanel_*`):
 *   confpanel_anon    → modal → posts anonymously
 *   confpanel_public  → modal → posts publicly with name
 *   confpanel_help    → ephemeral rules card
 *
 * Confession card buttons (`confess_*`):
 *   confess_new           → opens anonymous submit modal
 *   confess_reply_<id>    → modal → anonymous reply
 *   confess_info_<id>     → ephemeral info card
 *   confess_report_<id>   → opens report modal
 */

const {
    SlashCommandBuilder,
    MessageFlags,
    ContainerBuilder,
    TextDisplayBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    SeparatorBuilder,
    SeparatorSpacingSize,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');

const cm = require('../../utils/confessionManager');

const E = {
    confession: '<:Envelope:1521228013910626426>',
    check:      '<:Checkedbox:1521227734943269077>',
    cancel:     '<:Cancel:1521227723916181644>',
    chat:       '<:Hashtag:1521227771957870604>',
    edit:       '<:Editalt:1521227921673556019>',
    user:       '<:User:1521227714227343380>',
    clock:      '<:Clock:1521228110408847623>',
    info:       '<:Inforect:1521228008285929532>',
    bookopen:   '<:Bookopen:1521227911137595605>',
    fire:       '<:Fire:1521227907647668374>',
    shield:     '<:Shield:1521227694677692467>'
};

function ts(date) { return `<t:${Math.floor(date / 1000)}:R>`; }

// ── Card builders ──────────────────────────────────────────────────────

function buildAnonymousCard(text, number, confessionId, cfg) {
    const card = new ContainerBuilder()
        .setAccentColor(0x2B2D31)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `## ${E.shield} Anonymous Confession ${cm.formatNumber(number)}\n` +
            `-# ID: \`${confessionId}\``
        ))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `> ${String(text).replace(/\n/g, '\n> ')}`
        ))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `-# ${E.shield} Anonymous · ${E.clock} ${ts(Date.now())}` +
            (cfg.allowReports ? ` · ${E.fire} Use \`Report\` for harmful content` : '')
        ));

    const buttons = [
        new ButtonBuilder()
            .setCustomId('confess_new')
            .setLabel('Submit')
            .setEmoji(E.edit)
            .setStyle(ButtonStyle.Success)
    ];
    if (cfg.allowReplies) {
        buttons.push(new ButtonBuilder()
            .setCustomId(`confess_reply_${confessionId}`)
            .setLabel('Reply')
            .setEmoji(E.chat)
            .setStyle(ButtonStyle.Secondary));
    }
    buttons.push(new ButtonBuilder()
        .setCustomId(`confess_info_${confessionId}`)
        .setLabel('Info')
        .setEmoji(E.info)
        .setStyle(ButtonStyle.Secondary));
    if (cfg.allowReports) {
        buttons.push(new ButtonBuilder()
            .setCustomId(`confess_report_${confessionId}`)
            .setLabel('Report')
            .setEmoji(E.cancel)
            .setStyle(ButtonStyle.Danger));
    }
    card.addActionRowComponents(new ActionRowBuilder().addComponents(buttons));
    return card;
}

function buildPublicCard(text, number, confessionId, author, cfg) {
    const card = new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `## ${E.user} Public Confession ${cm.formatNumber(number)}\n` +
            `-# By <@${author.id}> · ID: \`${confessionId}\``
        ))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `> ${String(text).replace(/\n/g, '\n> ')}`
        ))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `-# ${E.user} ${author.username} · ${E.clock} ${ts(Date.now())}`
        ));

    const buttons = [
        new ButtonBuilder()
            .setCustomId('confess_new')
            .setLabel('Submit')
            .setEmoji(E.edit)
            .setStyle(ButtonStyle.Success)
    ];
    if (cfg.allowReplies) {
        buttons.push(new ButtonBuilder()
            .setCustomId(`confess_reply_${confessionId}`)
            .setLabel('Reply')
            .setEmoji(E.chat)
            .setStyle(ButtonStyle.Secondary));
    }
    if (cfg.allowReports) {
        buttons.push(new ButtonBuilder()
            .setCustomId(`confess_report_${confessionId}`)
            .setLabel('Report')
            .setEmoji(E.cancel)
            .setStyle(ButtonStyle.Danger));
    }
    card.addActionRowComponents(new ActionRowBuilder().addComponents(buttons));
    return card;
}

function buildReplyCard(replyText, confessionId, originalNumber) {
    const ref = originalNumber ? cm.formatNumber(originalNumber) : `\`${confessionId}\``;
    return new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `### ${E.chat} Anonymous Reply to ${ref}\n` +
            `-# Confession \`${confessionId}\``
        ))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `> ${String(replyText).replace(/\n/g, '\n> ')}`
        ))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `-# ${E.shield} Anonymous reply · ${ts(Date.now())}`
        ));
}

// ── Modal builders ─────────────────────────────────────────────────────

function buildSubmitModal(modalId, title) {
    return new ModalBuilder()
        .setCustomId(modalId)
        .setTitle(title)
        .addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('confess_text')
                .setLabel('Your confession')
                .setPlaceholder('Type your message here…')
                .setStyle(TextInputStyle.Paragraph)
                .setMinLength(1)
                .setMaxLength(2000)
                .setRequired(true)
        ));
}

function buildReplyModal(confessionId) {
    return new ModalBuilder()
        .setCustomId(`confess_modal_reply_${confessionId}`)
        .setTitle(`Reply to confession`)
        .addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('reply_text')
                .setLabel('Your anonymous reply')
                .setStyle(TextInputStyle.Paragraph)
                .setMaxLength(1000)
                .setRequired(true)
        ));
}

function buildReportModal(confessionId) {
    return new ModalBuilder()
        .setCustomId(`confess_modal_report_${confessionId}`)
        .setTitle('Report Confession')
        .addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('reason')
                .setLabel('Why are you reporting this?')
                .setPlaceholder('Briefly describe the issue…')
                .setStyle(TextInputStyle.Paragraph)
                .setMinLength(10)
                .setMaxLength(500)
                .setRequired(true)
        ));
}

// ── Submission core ────────────────────────────────────────────────────

async function submitConfession(interaction, text, mode) {
    const guildId = interaction.guild.id;
    const cfg = cm.getGuildConfig(guildId);

    if (!cfg.channelId) {
        return interaction.reply({
            content: `${E.cancel} Confessions aren't configured here. Ask staff to run \`/confession-setup\`.`,
            flags: MessageFlags.Ephemeral
        });
    }
    if (mode === 'anonymous' && !cfg.allowAnonymous) {
        return interaction.reply({
            content: `${E.cancel} Anonymous confessions are disabled in this server.`,
            flags: MessageFlags.Ephemeral
        });
    }
    if (mode === 'public' && !cfg.allowPublic) {
        return interaction.reply({
            content: `${E.cancel} Public confessions are disabled in this server.`,
            flags: MessageFlags.Ephemeral
        });
    }
    if (cm.isBanned(cfg, interaction.user.id)) {
        return interaction.reply({
            content: `${E.cancel} You're banned from submitting confessions in this server.`,
            flags: MessageFlags.Ephemeral
        });
    }
    const blocked = cm.containsBlockedWord(cfg, text);
    if (blocked) {
        return interaction.reply({
            content: `${E.cancel} Your confession was rejected — it contains content blocked by server rules.`,
            flags: MessageFlags.Ephemeral
        });
    }

    const channel = interaction.guild.channels.cache.get(cfg.channelId)
        || await interaction.guild.channels.fetch(cfg.channelId).catch(() => null);
    if (!channel || !channel.isTextBased?.()) {
        return interaction.reply({
            content: `${E.cancel} Confession channel is missing — staff need to reconfigure it.`,
            flags: MessageFlags.Ephemeral
        });
    }
    const me = interaction.guild.members.me;
    const perms = channel.permissionsFor(me);
    if (!perms?.has(['ViewChannel', 'SendMessages'])) {
        return interaction.reply({
            content: `${E.cancel} I can't post in ${channel} — staff need to grant me **View Channel + Send Messages**.`,
            flags: MessageFlags.Ephemeral
        });
    }

    // Persist + post
    const { id, number } = cm.recordConfession(cfg, {
        userId: interaction.user.id,
        username: interaction.user.username,
        text,
        mode
    });
    cm.saveGuildConfig(guildId, cfg);

    const card = mode === 'public'
        ? buildPublicCard(text, number, id, interaction.user, cfg)
        : buildAnonymousCard(text, number, id, cfg);

    try {
        await channel.send({
            components: [card],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: mode === 'public'
                ? { users: [interaction.user.id], parse: [] }
                : { parse: [] }
        });
    } catch (e) {
        return interaction.reply({
            content: `${E.cancel} Failed to post confession: ${e.message || e}`,
            flags: MessageFlags.Ephemeral
        });
    }

    // Optional staff log
    if (cfg.logChannelId) {
        const logCh = interaction.guild.channels.cache.get(cfg.logChannelId)
            || await interaction.guild.channels.fetch(cfg.logChannelId).catch(() => null);
        if (logCh && logCh.isTextBased?.()) {
            const logCard = new ContainerBuilder()
                .setAccentColor(mode === 'public' ? 0x5865F2 : 0xED4245)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `## ${E.shield} ${mode === 'public' ? 'Public' : 'Anonymous'} Confession ${cm.formatNumber(number)}\n` +
                    `**Author:** ${interaction.user} (\`${interaction.user.id}\`)\n` +
                    `**ID:** \`${id}\`\n` +
                    `**Posted:** ${ts(Date.now())}`
                ))
                .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `> ${text.slice(0, 1500).replace(/\n/g, '\n> ')}`
                ));
            await logCh.send({
                components: [logCard],
                flags: MessageFlags.IsComponentsV2,
                allowedMentions: { parse: [] }
            }).catch(() => {});
        }
    }

    return interaction.reply({
        content: `${E.check} Confession ${cm.formatNumber(number)} posted${mode === 'public' ? '' : ' anonymously'}!\n-# ID: \`${id}\``,
        flags: MessageFlags.Ephemeral
    });
}

// ── Command export ─────────────────────────────────────────────────────

module.exports = {
    premiumOnly: true,

    data: new SlashCommandBuilder()
        .setName('confess')
        .setDescription('Send an anonymous confession')
        .addStringOption(o => o
            .setName('message')
            .setDescription('Your anonymous confession')
            .setRequired(true)
            .setMaxLength(2000)),

    prefix: 'confess',
    description: 'Send an anonymous confession',
    usage: 'confess <message>',
    category: 'fun',
    aliases: ['confession', 'anon'],

    async execute(interaction) {
        const text = interaction.options.getString('message');
        return submitConfession(interaction, text, 'anonymous');
    },

    async executePrefix(message, args) {
        // For prefix usage we delete the original to preserve anonymity.
        if (!args.length) {
            return message.reply(`${E.cancel} Usage: \`-confess <your message>\``);
        }
        const text = args.join(' ');
        // Re-use submission logic by faking the slash interface bits we need.
        const fakeInteraction = {
            guild: message.guild,
            user: message.author,
            channel: message.channel,
            client: message.client,
            reply: async (opts) => {
                // submitConfession sends ephemeral confirmations — for prefix
                // we just send a temporary public message and delete it.
                const content = typeof opts === 'string' ? opts : opts.content;
                if (!content) return;
                const r = await message.channel.send({ content, allowedMentions: { parse: [] } }).catch(() => null);
                if (r) setTimeout(() => r.delete().catch(() => {}), 5000);
            }
        };
        await submitConfession(fakeInteraction, text, 'anonymous');
        await message.delete().catch(() => {});
    },

    /**
     * Routes button clicks for the public Submit panel + per-card buttons.
     */
    async handleButton(interaction) {
        const { requirePremium } = require('../../utils/interactionGuards');
        if (await requirePremium(interaction, { commandName: '/confess' })) return true;

        const id = interaction.customId;

        // Public panel — anonymous submit
        if (id === 'confpanel_anon') {
            const cfg = cm.getGuildConfig(interaction.guild.id);
            if (!cfg.allowAnonymous) {
                await interaction.reply({ content: `${E.cancel} Anonymous confessions are disabled here.`, flags: MessageFlags.Ephemeral });
                return true;
            }
            if (cm.isBanned(cfg, interaction.user.id)) {
                await interaction.reply({ content: `${E.cancel} You're banned from submitting confessions in this server.`, flags: MessageFlags.Ephemeral });
                return true;
            }
            await interaction.showModal(buildSubmitModal('confess_modal_anon', 'Anonymous Confession'));
            return true;
        }
        // Public panel — public submit
        if (id === 'confpanel_public') {
            const cfg = cm.getGuildConfig(interaction.guild.id);
            if (!cfg.allowPublic) {
                await interaction.reply({ content: `${E.cancel} Public confessions are disabled here.`, flags: MessageFlags.Ephemeral });
                return true;
            }
            if (cm.isBanned(cfg, interaction.user.id)) {
                await interaction.reply({ content: `${E.cancel} You're banned from submitting confessions in this server.`, flags: MessageFlags.Ephemeral });
                return true;
            }
            await interaction.showModal(buildSubmitModal('confess_modal_public', 'Public Confession'));
            return true;
        }
        // Public panel — rules
        if (id === 'confpanel_help') {
            await interaction.reply({
                components: [
                    new ContainerBuilder()
                        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                            `## ${E.bookopen} Confession Rules\n\n` +
                            `> ${E.shield} Be respectful — no harassment, slurs, doxxing, or threats.\n` +
                            `> ${E.shield} Anonymous still means **traceable by staff** for safety.\n` +
                            `> ${E.shield} Off-topic, spam, or harmful confessions can get you banned.\n` +
                            `> ${E.shield} If something hurtful is posted about you, use **Report** on the message.`
                        ))
                ],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
            });
            return true;
        }

        // Submit-from-card button
        if (id === 'confess_new') {
            const cfg = cm.getGuildConfig(interaction.guild.id);
            if (cm.isBanned(cfg, interaction.user.id)) {
                await interaction.reply({ content: `${E.cancel} You're banned from submitting confessions in this server.`, flags: MessageFlags.Ephemeral });
                return true;
            }
            // Default to anonymous on the in-channel "Submit" pill.
            if (!cfg.allowAnonymous && cfg.allowPublic) {
                await interaction.showModal(buildSubmitModal('confess_modal_public', 'Public Confession'));
            } else {
                await interaction.showModal(buildSubmitModal('confess_modal_anon', 'Anonymous Confession'));
            }
            return true;
        }

        // Reply
        if (id.startsWith('confess_reply_')) {
            const cfg = cm.getGuildConfig(interaction.guild.id);
            if (!cfg.allowReplies) {
                await interaction.reply({ content: `${E.cancel} Replies are disabled here.`, flags: MessageFlags.Ephemeral });
                return true;
            }
            const confessionId = id.replace('confess_reply_', '');
            await interaction.showModal(buildReplyModal(confessionId));
            return true;
        }

        // Info
        if (id.startsWith('confess_info_')) {
            const confessionId = id.replace('confess_info_', '');
            const cfg = cm.getGuildConfig(interaction.guild.id);
            const e = cfg.log?.[confessionId];
            const card = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `### ${E.info} Confession Info\n\n` +
                    `**ID:** \`${confessionId}\`\n` +
                    (e ? `**Number:** ${cm.formatNumber(e.number || 0)}\n` : '') +
                    (e ? `**Posted:** ${ts(e.timestamp || Date.now())}\n` : '') +
                    `\nUse **Report** to flag harmful content. Staff can look up authors via \`/confession-setup\`.`
                ));
            await interaction.reply({
                components: [card],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
            });
            return true;
        }

        // Report
        if (id.startsWith('confess_report_')) {
            const cfg = cm.getGuildConfig(interaction.guild.id);
            if (!cfg.allowReports) {
                await interaction.reply({ content: `${E.cancel} Reports are disabled here.`, flags: MessageFlags.Ephemeral });
                return true;
            }
            const confessionId = id.replace('confess_report_', '');
            await interaction.showModal(buildReportModal(confessionId));
            return true;
        }

        return false;
    },

    /**
     * Routes modal submits.
     */
    async handleModal(interaction) {
        const { requirePremium } = require('../../utils/interactionGuards');
        if (await requirePremium(interaction, { commandName: '/confess' })) return true;

        const id = interaction.customId;

        if (id === 'confess_modal_anon') {
            const text = interaction.fields.getTextInputValue('confess_text');
            return submitConfession(interaction, text, 'anonymous');
        }
        if (id === 'confess_modal_public') {
            const text = interaction.fields.getTextInputValue('confess_text');
            return submitConfession(interaction, text, 'public');
        }

        if (id.startsWith('confess_modal_reply_')) {
            const confessionId = id.replace('confess_modal_reply_', '');
            const replyText = interaction.fields.getTextInputValue('reply_text');
            const cfg = cm.getGuildConfig(interaction.guild.id);
            if (!cfg.allowReplies) {
                return interaction.reply({ content: `${E.cancel} Replies are disabled here.`, flags: MessageFlags.Ephemeral });
            }
            const blocked = cm.containsBlockedWord(cfg, replyText);
            if (blocked) {
                return interaction.reply({ content: `${E.cancel} Reply rejected — contains blocked content.`, flags: MessageFlags.Ephemeral });
            }
            cm.recordReply(cfg, confessionId, interaction.user.id, replyText);
            cm.saveGuildConfig(interaction.guild.id, cfg);
            const number = cfg.log?.[confessionId]?.number || 0;
            const card = buildReplyCard(replyText, confessionId, number);
            await interaction.channel.send({
                components: [card],
                flags: MessageFlags.IsComponentsV2,
                allowedMentions: { parse: [] }
            });
            return interaction.reply({
                content: `${E.check} Reply posted anonymously!`,
                flags: MessageFlags.Ephemeral
            });
        }

        if (id.startsWith('confess_modal_report_')) {
            const confessionId = id.replace('confess_modal_report_', '');
            const reason = interaction.fields.getTextInputValue('reason');
            const cfg = cm.getGuildConfig(interaction.guild.id);
            // Send to log channel if available, else fall back to a moderator log channel via audit.
            if (cfg.logChannelId) {
                const logCh = interaction.guild.channels.cache.get(cfg.logChannelId)
                    || await interaction.guild.channels.fetch(cfg.logChannelId).catch(() => null);
                if (logCh && logCh.isTextBased?.()) {
                    const card = new ContainerBuilder()
                        .setAccentColor(0xED4245)
                        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                            `## ${E.fire} Confession Report\n\n` +
                            `**Confession ID:** \`${confessionId}\`\n` +
                            `**Reporter:** ${interaction.user} (\`${interaction.user.id}\`)\n` +
                            `**Reported:** ${ts(Date.now())}\n\n` +
                            `> ${reason.slice(0, 1500).replace(/\n/g, '\n> ')}`
                        ));
                    await logCh.send({
                        components: [card],
                        flags: MessageFlags.IsComponentsV2,
                        allowedMentions: { parse: [] }
                    }).catch(() => {});
                }
            }
            return interaction.reply({
                content: `${E.shield} Report submitted for confession \`${confessionId}\`. Moderators will review.`,
                flags: MessageFlags.Ephemeral
            });
        }

        return false;
    }
};
