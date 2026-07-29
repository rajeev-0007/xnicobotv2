'use strict';

/**
 * /redeemserverkey — activate SERVER premium for every member of this guild.
 *
 * Counterpart to /redeemkey (user premium). Six other files already advertise
 * this command (premium.js, helpCategories.js, responseBuilder.js and
 * premiumManager's redeemKey error path), so its name and behaviour are fixed
 * by those references.
 *
 * Gating:
 *   - Guild only. A server key is meaningless in DMs.
 *   - Requires the INVOKER to have Manage Server. Anyone able to see a key
 *     should not be able to bind it to a server they don't administrate.
 *     (utils/permissionHandler's map is for the BOT's permissions, so the user
 *     check has to live here.)
 *   - The key itself is validated and atomically claimed in premiumManager.
 */

const {
    SlashCommandBuilder,
    ContainerBuilder,
    TextDisplayBuilder,
    MessageFlags,
    PermissionFlagsBits,
} = require('discord.js');
const { buildErrorResponse, buildSuccessResponse, COLORS } = require('../../utils/responseBuilder');
const premiumManager = require('../../utils/premiumManager');
const jsonStore = require('../../utils/jsonStore');

const E = {
    key: '<:Key:1521228000467878111>',
    check: '<:Checkedbox:1521227734943269077>',
    cancel: '<:Cancel:1521227723916181644>',
    present: '<:Present:1521228115655917659>',
    timer: '<:Timer:1521227971590095070>',
    book: '<:Bookopen:1521227911137595605>',
    server: '<:Server:1521228371051413546>',
    user: '<:User:1521227714227343380>',
    crown: '<:Crown:1521227739988889764>',
};

function buildUsageContainer() {
    const content =
        `# ${E.key} Redeem Server Premium Key\n\n` +
        `**Usage:** \`redeemserverkey <key>\`\n\n` +
        `### Description\n` +
        `> Activates **server premium** — every member of this server gets\n` +
        `> access to premium features, no individual keys needed.\n\n` +
        `**Example:**\n` +
        `\`redeemserverkey ABCD-1234-EFGH-5678\`\n\n` +
        `-# Requires **Manage Server**. For a personal key, use \`redeemkey\` instead.`;

    return new ContainerBuilder()
        .setAccentColor(COLORS.INFO)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
}

function buildResultContainer({ keyCode, guild, result, activatedBy }) {
    let content = `# ${E.present} Server Premium Activated!\n\n`;
    content += `${E.check} Successfully redeemed key: \`${keyCode}\`\n`;
    content += `${E.server} **Server:** ${guild.name}\n`;
    content += `${E.user} **Activated by:** ${activatedBy}\n`;

    if (result.expiresAt) {
        content += `${E.timer} **Duration:** ${result.duration} day${result.duration === 1 ? '' : 's'}\n`;
        content += `${E.book} **Expires:** <t:${Math.floor(new Date(result.expiresAt).getTime() / 1000)}:F> ` +
            `(<t:${Math.floor(new Date(result.expiresAt).getTime() / 1000)}:R>)\n`;
    } else {
        content += `${E.timer} **Duration:** Permanent\n`;
    }

    content += `\n> ${E.crown} Every member of this server now has premium access.\n`;
    content += `-# Check anytime with \`premium\`.`;

    return new ContainerBuilder()
        .setAccentColor(COLORS.SUCCESS)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
}

/**
 * Shared guard + redemption path for both entry points.
 * @returns {Promise<{components: any[], ephemeral: boolean}>}
 */
async function runRedemption({ guild, member, user, keyCode }) {
    if (!guild) {
        return {
            components: [buildErrorResponse(
                'Server Only',
                'Server keys must be redeemed **inside the server** you want to upgrade.',
                'Run this command in the target server, or use `redeemkey` for a personal key.'
            )],
            ephemeral: true,
        };
    }

    // User-side authorization. Bot owners bypass so they can assist customers.
    const { isOwner } = require('../../utils/helpers');
    const hasManageGuild = member?.permissions?.has?.(PermissionFlagsBits.ManageGuild);
    if (!hasManageGuild && !isOwner(user.id)) {
        return {
            components: [buildErrorResponse(
                'Missing Permission',
                'You need the **Manage Server** permission to activate server premium.',
                'Ask a server admin to run this command, or use `redeemkey` to activate premium for yourself.'
            )],
            ephemeral: true,
        };
    }

    if (!keyCode) {
        return { components: [buildUsageContainer()], ephemeral: true };
    }

    const code = String(keyCode).trim().toUpperCase();

    // Pull the freshest key data so a key generated on the dashboard (a
    // different process) is visible immediately rather than after the sync
    // interval. Mirrors what redeemkey.js does.
    try {
        if (typeof jsonStore.smartRefresh === 'function') await jsonStore.smartRefresh();
        else if (typeof jsonStore.refresh === 'function') await jsonStore.refresh();
    } catch { /* stale-cache read is still attempted below */ }

    const result = await premiumManager.redeemServerKey(guild.id, user.id, code);

    if (!result.success) {
        return {
            components: [buildErrorResponse('Redemption Failed', result.message)],
            ephemeral: true,
        };
    }

    return {
        components: [buildResultContainer({
            keyCode: code,
            guild,
            result,
            activatedBy: user.username,
        })],
        ephemeral: false, // success is worth announcing to the server
    };
}

module.exports = {
    name: 'redeemserverkey',
    prefix: 'redeemserverkey',
    description: 'Redeem a server premium key to unlock premium for everyone in this server',
    usage: 'redeemserverkey <key>',
    category: 'utility',
    aliases: ['redeemserver', 'activateserverkey', 'serverredeem'],

    data: new SlashCommandBuilder()
        .setName('redeemserverkey')
        .setDescription('Redeem a server premium key to unlock premium for everyone in this server')
        .addStringOption(o => o
            .setName('key')
            .setDescription('The server premium key to redeem')
            .setRequired(true))
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(interaction) {
        try {
            const { components, ephemeral } = await runRedemption({
                guild: interaction.guild,
                member: interaction.member,
                user: interaction.user,
                keyCode: interaction.options.getString('key'),
            });

            return interaction.reply({
                components,
                flags: ephemeral
                    ? (MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral)
                    : MessageFlags.IsComponentsV2,
            });
        } catch (error) {
            console.error('[RedeemServerKey] Error:', error);
            return interaction.reply({
                components: [buildErrorResponse('Error', 'An error occurred while redeeming the key. Please try again.')],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            }).catch(() => {});
        }
    },

    async executePrefix(message, args) {
        try {
            // Delete the invocation immediately so the key isn't left in chat
            // history. Same protection redeemkey.js applies.
            if (args[0] && message.deletable) message.delete().catch(() => {});

            const { components } = await runRedemption({
                guild: message.guild,
                member: message.member,
                user: message.author,
                keyCode: args[0],
            });

            // Prefix mode can't send ephemerals. The message carrying the key
            // has already been deleted, and none of these responses echo the
            // key back except the success container (where the key is spent).
            return message.channel.send({ components, flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('[RedeemServerKey] Error:', error);
            return message.channel.send({
                components: [buildErrorResponse('Error', 'An error occurred while redeeming the key. Please try again.')],
                flags: MessageFlags.IsComponentsV2,
            }).catch(() => {});
        }
    },
};
