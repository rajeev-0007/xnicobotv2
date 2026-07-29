'use strict';

/**
 * /leave-setup — opens the leave-message section of the welcomer panel.
 *
 * ═══ WHY THIS IS A THIN WRAPPER ═══
 * This command used to render its own leave panel, and it was broken in two
 * independent ways:
 *
 *  1. WRONG CONFIG SHAPE. It read flat fields — `guildConfig.leaveEnabled`,
 *     `guildConfig.leaveChannelId`, `guildConfig.leaveMessage` — but the
 *     welcomer schema (commands/automation/welcomer.js getDefaultConfig) and the
 *     runtime send path (index.js guildMemberRemove) both use a NESTED
 *     `leave: { enabled, channelId, content, … }` object. `leaveMessage` had
 *     three readers and zero writers anywhere in the repo. The panel therefore
 *     always reported "Disabled / Not set / default message" even for servers
 *     whose leave messages were fully configured and working.
 *
 *  2. DEAD BUTTONS. Of the four buttons it rendered, three
 *     (`leave_setup_channel`, `welcomer_leave_msg`, `welcomer_leave_toggle`)
 *     were only implemented in interactionHandlers' legacy fallback, which was
 *     unreachable because welcomer.js acknowledged the interaction before
 *     returning control to it.
 *
 * Both faults came from maintaining a second implementation of a panel the
 * welcomer already owns. Rather than fixing the copy, this now opens the real
 * one, so there is a single leave panel reading a single config shape.
 */

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { buildPermissionDenied } = require('../../utils/responseBuilder');

/** Build the leave panel from the welcomer's own (nested) config. */
function buildPanelFor(guildId) {
    const welcomer = require('./welcomer');
    const config = welcomer.loadConfig();
    const guildConfig = config[guildId] || {};
    // Seed the nested leave object so a never-configured guild still renders.
    const leaveConfig = guildConfig.leave || welcomer.getDefaultConfig().leave;
    return welcomer.buildLeaveContainer(leaveConfig);
}

module.exports = {
    category: 'automation',
    data: new SlashCommandBuilder()
        .setName('leave-setup')
        .setDescription('Interactive setup for the leave message system')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(interaction) {
        await interaction.reply({
            components: [buildPanelFor(interaction.guild.id)],
            flags: MessageFlags.IsComponentsV2,
        });
    },

    async executePrefix(message) {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return message.reply({
                components: [buildPermissionDenied('Manage Guild')],
                flags: MessageFlags.IsComponentsV2,
            });
        }
        await message.reply({
            components: [buildPanelFor(message.guild.id)],
            flags: MessageFlags.IsComponentsV2,
        });
    },
};
