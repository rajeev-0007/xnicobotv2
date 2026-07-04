const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { COLORS } = require('../../utils/responseBuilder');
const trust = require('../../utils/trustManager');
const jsonStore = require('../../utils/jsonStore');

function loadConfig() {
    if (!jsonStore.has('nightmode')) {
        jsonStore.write('nightmode', {});
        return {};
    }
    return jsonStore.read('nightmode');
}

function saveConfig(config) {
    jsonStore.write('nightmode', config);
}

function getDefault() {
    return {
        enabled: false,
        activatedAt: null,
        activatedBy: null,
        disabledChannels: [],
        savedPermissions: {}
    };
}

function buildPanel(guildConfig, guildName) {
    const statusEmoji = guildConfig.enabled
        ? '<:Toggleon:1521227758011809964>'
        : '<:Toggleoff:1521227763816595559>';
    const statusText = guildConfig.enabled
        ? '**Active** — Server is in night mode'
        : '**Inactive** — Server is operating normally';

    let activatedInfo = '';
    if (guildConfig.enabled && guildConfig.activatedAt) {
        activatedInfo = `\n-# Activated <t:${Math.floor(new Date(guildConfig.activatedAt).getTime() / 1000)}:R> by <@${guildConfig.activatedBy}>`;
    }

    const content =
        `# <:Shield:1521227694677692467> Night Mode\n` +
        `-# Server lockdown for **${guildName}**\n\n` +
        `${statusEmoji} ${statusText}${activatedInfo}\n\n` +
        `### <:Document:1521227875016114266> What Night Mode Does\n` +
        `<:Caretright:1521227704953864202> Revokes \`Send Messages\` for \`@everyone\` in all channels\n` +
        `<:Caretright:1521227704953864202> Prevents new messages from being sent server-wide\n` +
        `<:Caretright:1521227704953864202> Saves current permissions for restoration on disable\n` +
        `<:Caretright:1521227704953864202> Staff with \`Manage Messages\` can still communicate\n\n` +
        `### <:Lightningalt:1521227851796447472> Commands\n` +
        `<:Caretright:1521227704953864202> \`nightmode enable\` — Lock the server down\n` +
        `<:Caretright:1521227704953864202> \`nightmode disable\` — Restore normal permissions\n\n` +
        `-# <:Infotriangle:1521227710381428926> Use during raids or off-hours to prevent damage`;

    const container = new ContainerBuilder()
        .setAccentColor(guildConfig.enabled ? 0xED4245 : 0x57F287);
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
    return container;
}

module.exports = {
    /**
     * Premium-gated feature. `premiumOnly` is read by the
     * command dispatcher in index.js — non-premium users get a
     * polite message instead of execution.
     */
    premiumOnly: true,

    name: 'nightmode',
    prefix: 'nightmode',
    description: 'Lock or unlock the server by revoking send-message permissions in all channels',
    usage: 'nightmode [enable|disable]',
    category: 'admin',
    aliases: ['nmode', 'lockserver'],
    prefixOnly: true,

    async executePrefix(message, args) {
        if (!trust.isServerOwner(message.guild, message.author.id)) {
            return message.reply(require('../../utils/adminUI').errReply('Not Allowed', 'Only the **server owner** or **extra owner** can use this command.'));
        }

        const config = loadConfig();
        const guildId = message.guild.id;
        if (!config[guildId]) config[guildId] = getDefault();
        const guildConfig = config[guildId];

        const sub = args[0]?.toLowerCase();

        if (!sub) {
            const panel = buildPanel(guildConfig, message.guild.name);
            return message.reply({ components: [panel], flags: MessageFlags.IsComponentsV2 });
        }

        if (sub === 'enable') {
            if (guildConfig.enabled) {
                return message.reply(require('../../utils/adminUI').errReply('Already Active', 'Night Mode is already **active**.', { hint: 'Use `nightmode disable` to restore.' }));
            }

            const statusMsg = await message.reply('<a:Loading:1521227993995940032> Enabling Night Mode — locking all channels...');

            const guild = message.guild;
            const everyoneRole = guild.roles.everyone;
            // Only target proper text-style channels — exclude voice
            // (which has separate Connect/Speak permissions) and threads
            // (whose perms are inherited from the parent and can't be
            // overwritten directly).
            const { ChannelType } = require('discord.js');
            const TEXT_TYPES = new Set([
                ChannelType.GuildText,
                ChannelType.GuildAnnouncement,
                ChannelType.GuildForum,
                ChannelType.GuildMedia,
            ]);
            const channels = guild.channels.cache.filter(c =>
                TEXT_TYPES.has(c.type) &&
                c.permissionsFor(guild.members.me)?.has(PermissionFlagsBits.ManageChannels)
            );

            const savedPerms = {};
            let locked = 0;

            for (const [channelId, channel] of channels) {
                try {
                    const overwrites = channel.permissionOverwrites.cache.get(everyoneRole.id);
                    savedPerms[channelId] = {
                        hadOverwrite: !!overwrites,
                        allow: overwrites?.allow?.bitfield?.toString() || '0',
                        deny: overwrites?.deny?.bitfield?.toString() || '0'
                    };

                    await channel.permissionOverwrites.edit(everyoneRole, {
                        SendMessages: false,
                        AddReactions: false,
                        CreatePublicThreads: false
                    }, { reason: `Night Mode enabled by ${message.author.tag}` });
                    locked++;
                } catch (err) {
                    // Skip channels we can't modify
                }
            }

            if (locked === 0) {
                try { await statusMsg.delete(); } catch {}
                return message.reply(require('../../utils/adminUI').errReply('Failed', 'Could not lock any channels. Make sure the bot has **Manage Channels** permission and its role is positioned above the channels.'));
            }

            guildConfig.enabled = true;
            guildConfig.activatedAt = new Date().toISOString();
            guildConfig.activatedBy = message.author.id;
            guildConfig.savedPermissions = savedPerms;
            saveConfig(config);

            const container = new ContainerBuilder()
                .setAccentColor(0xED4245)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# <:Shield:1521227694677692467> Night Mode Enabled\n\n` +
                    `<:Checkedbox:1521227734943269077> Locked **${locked}** channels\n` +
                    `<:Checkedbox:1521227734943269077> \`Send Messages\` revoked for @everyone\n` +
                    `<:Checkedbox:1521227734943269077> Permissions saved for restoration\n\n` +
                    `-# Use \`nightmode disable\` to restore all permissions`
                ));

            try {
                await statusMsg.edit({ content: null, components: [container], flags: MessageFlags.IsComponentsV2 });
            } catch {
                await message.channel.send({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }
            return;
        }

        if (sub === 'disable') {
            if (!guildConfig.enabled) {
                return message.reply(require('../../utils/adminUI').errReply('Not Active', 'Night Mode is not currently active.'));
            }

            const statusMsg = await message.reply('<a:Loading:1521227993995940032> Disabling Night Mode — restoring permissions...');

            const guild = message.guild;
            const everyoneRole = guild.roles.everyone;
            const savedPerms = guildConfig.savedPermissions || {};
            let restored = 0;

            for (const [channelId, perms] of Object.entries(savedPerms)) {
                try {
                    const channel = guild.channels.cache.get(channelId);
                    if (!channel) continue;

                    const allowBits = BigInt(perms.allow || '0');
                    const denyBits = BigInt(perms.deny || '0');

                    if (!perms.hadOverwrite) {
                        await channel.permissionOverwrites.delete(everyoneRole, 'Night Mode disabled — restoring original state (no prior overwrite)');
                    } else {
                        await channel.permissionOverwrites.set([
                            {
                                id: everyoneRole.id,
                                allow: allowBits,
                                deny: denyBits
                            },
                            ...channel.permissionOverwrites.cache
                                .filter(o => o.id !== everyoneRole.id)
                                .map(o => ({
                                    id: o.id,
                                    allow: o.allow.bitfield,
                                    deny: o.deny.bitfield
                                }))
                        ], `Night Mode disabled by ${message.author.tag}`);
                    }
                    restored++;
                } catch (err) {
                    // Skip channels we can't modify
                }
            }

            guildConfig.enabled = false;
            guildConfig.savedPermissions = {};
            guildConfig.activatedAt = null;
            guildConfig.activatedBy = null;
            saveConfig(config);

            const container = new ContainerBuilder()
                .setAccentColor(0x57F287)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# <:Checkedbox:1521227734943269077> Night Mode Disabled\n\n` +
                    `<:Checkedbox:1521227734943269077> Restored **${restored}** channels\n` +
                    `<:Checkedbox:1521227734943269077> Original permissions re-applied\n` +
                    `<:Checkedbox:1521227734943269077> Server is operating normally\n\n` +
                    `-# All channel permissions have been restored to their pre-lockdown state`
                ));

            try {
                await statusMsg.edit({ content: null, components: [container], flags: MessageFlags.IsComponentsV2 });
            } catch {
                await message.channel.send({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }
            return;
        }

        const panel = buildPanel(guildConfig, message.guild.name);
        return message.reply({ components: [panel], flags: MessageFlags.IsComponentsV2 });
    }
};
