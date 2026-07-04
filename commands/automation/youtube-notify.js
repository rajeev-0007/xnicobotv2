'use strict';

/**
 * youtube-notify.js — Shortcut into the YouTube tab of the unified
 * social notification hub.
 *
 * The full UI, persistence, and polling logic live in:
 *   - commands/automation/social-notify.js (panels + interactions)
 *   - utils/socialNotifyPoller.js          (RSS polling + livestream detection)
 *
 * Keeping a single source of truth eliminates the drift bugs we had
 * before, where the standalone YouTube panel and the YouTube tab on the
 * social hub wrote to the same store but rendered different state.
 *
 * © Rajeev (Rexzy) — xNico
 */

const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');

const socialNotify = require('./social-notify');
const { buildPermissionDenied } = require('../../utils/responseBuilder');

async function openYouTubePanel(replyTarget, guildId, isInteraction) {
    const config = socialNotify.loadConfig();
    if (!config[guildId]) {
        config[guildId] = socialNotify.getDefaultGuildConfig();
        socialNotify.saveConfig(config);
    }
    const panel = socialNotify.buildYouTubePanel(config[guildId]);
    const flags = isInteraction
        ? MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
        : MessageFlags.IsComponentsV2;
    await replyTarget.reply({ components: [panel], flags });
}

module.exports = {
    category: 'automation',
    data: new SlashCommandBuilder()
        .setName('youtube-notify')
        .setDescription('Configure YouTube upload & livestream notifications')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    aliases: ['youtubenotify', 'ytnotify'],

    async execute(interaction) {
        await openYouTubePanel(interaction, interaction.guild.id, true);
    },

    async executePrefix(message) {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return message.reply({ components: [buildPermissionDenied('Manage Server')], flags: MessageFlags.IsComponentsV2 });
        }
        await openYouTubePanel(message, message.guild.id, false);
    },

    // Expose the social-notify interaction handler. The existing
    // routing in index.js dispatches `social_*` IDs to social-notify,
    // which already covers our buttons. This export is here so
    // callers wiring `youtube-notify` directly still work.
    handleInteraction: socialNotify.handleInteraction,
};
