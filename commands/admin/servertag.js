const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { buildErrorResponse, buildSuccessResponse, buildPermissionDenied, COLORS, EMOJIS } = require('../../utils/responseBuilder');

const jsonStore = require('../../utils/jsonStore');
const economyManager = require('../../utils/economyManager');
const { getRankEmoji } = require('../../utils/rankEmojis');

function loadConfig() {
    try {
        if (jsonStore.has('servertag')) return jsonStore.read('servertag');
    } catch {}
    return {};
}

function saveConfig(config) {
    jsonStore.write('servertag', config);
}

function loadTagUsers() {
    try {
        if (jsonStore.has('servertag-users')) return jsonStore.read('servertag-users');
    } catch {}
    return {};
}

function saveTagUsers(data) {
    jsonStore.write('servertag-users', data);
}

function trackTagEquip(guildId, userId) {
    const data = loadTagUsers();
    if (!data[guildId]) data[guildId] = {};
    if (!data[guildId][userId]) {
        data[guildId][userId] = {
            equippedAt: new Date().toISOString(),
            totalTime: 0,
            lastChecked: Date.now(),
            rewarded: false
        };
    }
    data[guildId][userId].equippedAt = new Date().toISOString();
    data[guildId][userId].lastChecked = Date.now();
    saveTagUsers(data);
    return data[guildId][userId];
}

function trackTagUnequip(guildId, userId) {
    const data = loadTagUsers();
    if (data[guildId]?.[userId]) {
        const elapsed = Date.now() - (data[guildId][userId].lastChecked || Date.now());
        data[guildId][userId].totalTime = (data[guildId][userId].totalTime || 0) + elapsed;
        data[guildId][userId].lastChecked = null;
        data[guildId][userId].equippedAt = null;
        saveTagUsers(data);
    }
}

function getTagLeaderboard(guildId) {
    const data = loadTagUsers();
    if (!data[guildId]) return [];
    return Object.entries(data[guildId])
        .map(([userId, info]) => {
            let totalTime = info.totalTime || 0;
            if (info.lastChecked && info.equippedAt) {
                totalTime += Date.now() - info.lastChecked;
            }
            return { userId, totalTime, equippedAt: info.equippedAt };
        })
        .filter(u => u.equippedAt || u.totalTime > 0)
        .sort((a, b) => b.totalTime - a.totalTime);
}

function formatDuration(ms) {
    if (ms <= 0) return '0m';
    const days = Math.floor(ms / 86400000);
    const hours = Math.floor((ms % 86400000) / 3600000);
    const mins = Math.floor((ms % 3600000) / 60000);
    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (mins > 0 || parts.length === 0) parts.push(`${mins}m`);
    return parts.join(' ');
}

module.exports = {
    prefix: 'servertag',
    description: 'Configure server tag system — reward users who add your server tag to their name',
    usage: 'servertag <set|remove|status|scan|reward|leaderboard> [tag] [role]',
    category: 'admin',
    aliases: ['tag', 'nametag', 'classtag'],
    permissions: ['ManageRoles'],
    loadConfig,
    saveConfig,
    loadTagUsers,
    saveTagUsers,
    trackTagEquip,
    trackTagUnequip,

    async executePrefix(message, args, lavalinkManager, client) {
        const sub = args[0]?.toLowerCase();

        // Leaderboard is available to everyone
        if (sub === 'leaderboard' || sub === 'lb' || sub === 'top') {
            const config = loadConfig();
            const guildConfig = config[message.guild.id];
            if (!guildConfig || !guildConfig.enabled) {
                const container = buildErrorResponse('Not Configured', 'Server tag is not set up in this server.');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            const lb = getTagLeaderboard(message.guild.id);
            if (lb.length === 0) {
                const container = buildErrorResponse('No Data', 'No members have equipped the server tag yet.');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            const top = lb.slice(0, 15);
            let content = `# ${EMOJIS.STAR} Server Tag Leaderboard\n\n`;
            content += `Tag: **${guildConfig.tag}**\n\n`;

            for (let i = 0; i < top.length; i++) {
                const prefix = getRankEmoji(i + 1);
                const member = message.guild.members.cache.get(top[i].userId);
                const name = member ? member.displayName : `<@${top[i].userId}>`;
                const active = top[i].equippedAt ? ' <:online:1521228065752088576>' : '';
                content += `${prefix} ${name} — ${formatDuration(top[i].totalTime)}${active}\n`;
            }

            content += `\n-# ${EMOJIS.INFO} Showing top ${top.length} of ${lb.length} members • <:online:1521228065752088576> = currently equipped`;

            const container = new ContainerBuilder()
                .setAccentColor(0xFEE75C)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
;

            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        // --- EQUIP (available to everyone) ---
        if (sub === 'equip' || sub === 'claim' || sub === 'join') {
            const config = loadConfig();
            const guildConfig = config[message.guild.id];

            if (!guildConfig || !guildConfig.enabled) {
                const container = buildErrorResponse('Not Configured', 'Server tag is not set up in this server yet.');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            const role = message.guild.roles.cache.get(guildConfig.roleId);
            if (!role) {
                const container = buildErrorResponse('Role Deleted', 'The reward role no longer exists. Please ask an admin to reconfigure.');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            const member = message.member;
            const currentName = member.nickname || member.user.displayName || member.user.username;
            const hasTag = currentName.toLowerCase().includes(guildConfig.tag.toLowerCase());

            // Already has the tag in name
            if (hasTag && member.roles.cache.has(role.id)) {
                const container = buildErrorResponse(
                    'Already Equipped',
                    `You already have the server tag **${guildConfig.tag}** in your name and the ${role} role!`,
                    `Use \`servertag unequip\` to remove it.`
                );
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            // Try to add the tag to their nickname
            const newNick = hasTag ? currentName : `${currentName} ${guildConfig.tag}`;

            if (newNick.length > 32) {
                const container = buildErrorResponse(
                    'Nickname Too Long',
                    `Adding the tag would make your nickname **${newNick.length}** characters (max 32).`,
                    `Shorten your current nickname first, then try again.`
                );
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            // Check bot permissions
            if (!message.guild.members.me.permissions.has(PermissionFlagsBits.ManageNicknames)) {
                const container = buildErrorResponse('Missing Permission', 'I need **Manage Nicknames** permission to set your nickname.');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            // Can't change server owner's nickname
            if (member.id === message.guild.ownerId) {
                const container = buildErrorResponse(
                    'Server Owner',
                    'I cannot change the server owner\'s nickname due to Discord limitations.',
                    `Please manually add **${guildConfig.tag}** to your name, then use \`servertag scan\` or wait for auto-detection.`
                );
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            // Can't change members with higher roles
            if (member.roles.highest.position >= message.guild.members.me.roles.highest.position) {
                const container = buildErrorResponse(
                    'Role Hierarchy',
                    'I cannot change your nickname because your highest role is above mine.',
                    `Please manually add **${guildConfig.tag}** to your name — the role will be assigned automatically.`
                );
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            try {
                // Set nickname with tag
                await member.setNickname(newNick, 'Server tag equipped via servertag equip');

                // Add role
                if (!member.roles.cache.has(role.id)) {
                    await member.roles.add(role, 'Server tag equipped');
                }

                // Track & reward
                const tagData = trackTagEquip(message.guild.id, member.id);
                let rewardText = '';

                if (!tagData.rewarded && (guildConfig.coinReward > 0 || guildConfig.xpReward > 0)) {
                    const economy = economyManager.loadEconomy();
                    const { userData } = economyManager.getUser(economy, member.id);

                    if (guildConfig.coinReward > 0) {
                        userData.coins = (userData.coins || 0) + guildConfig.coinReward;
                        rewardText += `**+${guildConfig.coinReward.toLocaleString()}** coins`;
                    }
                    if (guildConfig.xpReward > 0) {
                        economyManager.addXP(economy, member.id, guildConfig.xpReward);
                        rewardText += `${rewardText ? ' & ' : ''}**+${guildConfig.xpReward}** XP`;
                    }
                    economyManager.saveEconomy(economy);

                    // Mark as rewarded
                    const users = loadTagUsers();
                    if (users[message.guild.id]?.[member.id]) {
                        users[message.guild.id][member.id].rewarded = true;
                        saveTagUsers(users);
                    }
                }

                const details = {
                    'New Nickname': newNick,
                    'Role': `${role}`,
                    'Tag': guildConfig.tag
                };
                if (rewardText) details['Rewards'] = rewardText;

                const container = buildSuccessResponse(
                    'Server Tag Equipped! 🏷️',
                    `You are now repping **${message.guild.name}**! Thanks for your support!`,
                    details
                );
                container.setAccentColor(0x57F287);
                container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
                container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `-# Keep the tag in your name to keep the role${rewardText ? ' • Rewards are one-time' : ''} • Use \`servertag unequip\` to remove`
                ));

                // Channel announcement
                if (guildConfig.notifyChannel) {
                    const notifChannel = message.guild.channels.cache.get(guildConfig.notifyChannel);
                    if (notifChannel) {
                        const announceText = rewardText
                            ? `🏷️ ${member} equipped the server tag **${guildConfig.tag}** and received ${rewardText}!`
                            : `🏷️ ${member} equipped the server tag **${guildConfig.tag}**!`;
                        await notifChannel.send({ content: announceText }).catch(() => {});
                    }
                }

                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            } catch (error) {
                const container = buildErrorResponse(
                    'Failed to Equip',
                    'Something went wrong while setting your nickname or role.',
                    `Please manually add **${guildConfig.tag}** to your name — the role will be assigned automatically.`
                );
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }
        }

        // --- UNEQUIP (available to everyone) ---
        if (sub === 'unequip' || sub === 'leave' || sub === 'unclaim') {
            const config = loadConfig();
            const guildConfig = config[message.guild.id];

            if (!guildConfig || !guildConfig.enabled) {
                const container = buildErrorResponse('Not Configured', 'Server tag is not set up in this server.');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            const role = message.guild.roles.cache.get(guildConfig.roleId);
            const member = message.member;
            const currentName = member.nickname || member.user.displayName || member.user.username;
            const tagLower = guildConfig.tag.toLowerCase();

            if (!currentName.toLowerCase().includes(tagLower) && !member.roles.cache.has(role?.id)) {
                const container = buildErrorResponse(
                    'Not Equipped',
                    `You don't have the server tag **${guildConfig.tag}** in your name.`,
                    `Use \`servertag equip\` to add it.`
                );
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            // Can't change server owner's nickname
            if (member.id === message.guild.ownerId) {
                const container = buildErrorResponse(
                    'Server Owner',
                    'I cannot change the server owner\'s nickname due to Discord limitations.',
                    `Please manually remove **${guildConfig.tag}** from your name.`
                );
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            try {
                // Remove tag from nickname (case-insensitive replacement)
                const tagIdx = currentName.toLowerCase().indexOf(tagLower);
                let newNick = currentName;
                if (tagIdx !== -1) {
                    newNick = (currentName.substring(0, tagIdx) + currentName.substring(tagIdx + guildConfig.tag.length)).trim();
                    // Clean up double spaces
                    newNick = newNick.replace(/\s{2 }/g, ' ').trim();
                }

                // If nickname becomes empty or matches username, reset to null
                if (!newNick || newNick === member.user.username || newNick === member.user.displayName) {
                    newNick = null;
                }

                if (member.roles.highest.position < message.guild.members.me.roles.highest.position) {
                    await member.setNickname(newNick, 'Server tag unequipped via servertag unequip');
                }

                // Remove role
                if (role && member.roles.cache.has(role.id)) {
                    await member.roles.remove(role, 'Server tag unequipped');
                }

                // Track unequip
                trackTagUnequip(message.guild.id, member.id);

                const container = buildSuccessResponse(
                    'Server Tag Removed',
                    `The server tag **${guildConfig.tag}** has been removed from your name.`,
                    {
                        'New Nickname': newNick || member.user.displayName,
                        'Role': role ? `${role} removed` : 'N/A'
                    }
                );
                container.setAccentColor(COLORS.WARNING);
                container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
                container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# You can re-equip anytime with \`servertag equip\``));

                // Channel announcement
                if (guildConfig.notifyChannel) {
                    const notifChannel = message.guild.channels.cache.get(guildConfig.notifyChannel);
                    if (notifChannel) {
                        await notifChannel.send({
                            content: `🏷️ ${member} removed the server tag **${guildConfig.tag}** — role has been revoked.`
                        }).catch(() => {});
                    }
                }

                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            } catch (error) {
                const container = buildErrorResponse(
                    'Failed to Unequip',
                    'Something went wrong while updating your nickname or role.',
                    `Please manually remove **${guildConfig.tag}** from your name.`
                );
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }
        }

        // All other subcommands require ManageRoles
        if (!message.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
            const container = buildPermissionDenied('Manage Roles');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const config = loadConfig();
        const guildConfig = config[message.guild.id];

        // --- SET ---
        if (sub === 'set') {
            const tag = args[1];
            if (!tag) {
                const container = buildErrorResponse(
                    'Missing Tag',
                    'Please provide the tag text that users should add to their name.',
                    '**Example:** `servertag set .gg/myserver @TagRole`'
                );
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            const role = message.mentions.roles.first() || message.guild.roles.cache.get(args[2]);
            if (!role) {
                const container = buildErrorResponse(
                    'Missing Role',
                    'Please provide the role to reward users with.',
                    '**Example:** `servertag set .gg/myserver @TagRole`'
                );
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            if (role.position >= message.guild.members.me.roles.highest.position) {
                const container = buildErrorResponse(
                    'Role Hierarchy Error',
                    'I cannot assign a role that is higher than or equal to my highest role.',
                    'Move my role above the target role in Server Settings > Roles.'
                );
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            if (role.managed) {
                const container = buildErrorResponse('Managed Role', 'I cannot assign bot-managed or integration roles.');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            // Preserve existing reward settings if updating tag/role
            const existingRewards = guildConfig?.coinReward || 0;
            const existingXP = guildConfig?.xpReward || 0;
            const existingDM = guildConfig?.dmNotify ?? true;
            const existingNotifyChannel = guildConfig?.notifyChannel || null;

            config[message.guild.id] = {
                tag: tag,
                roleId: role.id,
                enabled: true,
                setBy: message.author.id,
                setAt: new Date().toISOString(),
                coinReward: existingRewards,
                xpReward: existingXP,
                dmNotify: existingDM,
                notifyChannel: existingNotifyChannel
            };
            saveConfig(config);

            const container = buildSuccessResponse(
                'Server Tag Configured',
                `Users who add **${tag}** to their display name or username will receive the reward role.`,
                {
                    'Tag': tag,
                    'Reward Role': `${role}`,
                    'Coin Reward': existingRewards > 0 ? `${existingRewards.toLocaleString()} coins` : 'None (use `servertag reward`)',
                    'XP Reward': existingXP > 0 ? `${existingXP} XP` : 'None',
                    'DM Notify': existingDM ? 'Enabled' : 'Disabled',
                    'Status': 'Enabled',
                    'Configured By': `<@${message.author.id}>`
                }
            );
            container.setAccentColor(0x57F287);
            container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Tip: Use \`servertag reward <coins> [xp]\` to set rewards • \`servertag scan\` to sync`));

            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        // --- REWARD ---
        if (sub === 'reward' || sub === 'rewards' || sub === 'setreward') {
            if (!guildConfig || !guildConfig.enabled) {
                const container = buildErrorResponse('Not Configured', 'Set up a server tag first with `servertag set <tag> @role`.');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            const coins = parseInt(args[1]);
            const xp = parseInt(args[2]) || 0;

            if (!args[1]) {
                // Show current reward settings
                let content = `# ${EMOJIS.GIFT} Server Tag Rewards\n\n`;
                content += `### Current Reward Settings\n`;
                content += `> **Coin Reward:** ${guildConfig.coinReward || 0} coins\n`;
                content += `> **XP Reward:** ${guildConfig.xpReward || 0} XP\n`;
                content += `> **DM Notify:** ${guildConfig.dmNotify !== false ? '<:Toggleon:1521227758011809964> Enabled' : '<:Toggleoff:1521227763816595559> Disabled'}\n`;
                content += `> **Notify Channel:** ${guildConfig.notifyChannel ? `<#${guildConfig.notifyChannel}>` : 'None'}\n\n`;
                content += `### Configure\n`;
                content += `> \`servertag reward <coins> [xp]\` — Set coin & XP rewards\n`;
                content += `> \`servertag reward off\` — Disable coin/XP rewards\n`;
                content += `> \`servertag notify on/off\` — Toggle DM notifications\n`;
                content += `> \`servertag channel #channel\` — Set announcement channel\n`;

                const container = new ContainerBuilder()
                    .setAccentColor(0xFEE75C)
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
;

                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            if (args[1].toLowerCase() === 'off' || args[1].toLowerCase() === 'disable') {
                config[message.guild.id].coinReward = 0;
                config[message.guild.id].xpReward = 0;
                saveConfig(config);

                const container = buildSuccessResponse(
                    'Rewards Disabled',
                    'Coin and XP rewards for equipping the server tag have been disabled.',
                    { 'Note': 'The role reward is still active. Use `servertag remove` to fully disable.' }
                );
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            if (isNaN(coins) || coins < 0 || coins > 1000000) {
                const container = buildErrorResponse('Invalid Amount', 'Coin reward must be between 0 and 1,000,000.', '**Example:** `servertag reward 500 10`');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            if (xp < 0 || xp > 10000) {
                const container = buildErrorResponse('Invalid XP', 'XP reward must be between 0 and 10,000.', '**Example:** `servertag reward 500 10`');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            config[message.guild.id].coinReward = coins;
            config[message.guild.id].xpReward = xp;
            saveConfig(config);

            const container = buildSuccessResponse(
                'Tag Rewards Updated',
                `Users will now receive rewards when they equip the server tag **${guildConfig.tag}**.`,
                {
                    'Coin Reward': `${coins.toLocaleString()} coins`,
                    'XP Reward': xp > 0 ? `${xp} XP` : 'None',
                    'Role': `<@&${guildConfig.roleId}>`,
                    'Note': 'Rewards are given once when a user first equips the tag'
                }
            );
            container.setAccentColor(0x57F287);

            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        // --- NOTIFY ---
        if (sub === 'notify' || sub === 'dm') {
            if (!guildConfig || !guildConfig.enabled) {
                const container = buildErrorResponse('Not Configured', 'Set up a server tag first with `servertag set <tag> @role`.');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            const toggle = args[1]?.toLowerCase();
            if (!toggle || !['on', 'off', 'enable', 'disable'].includes(toggle)) {
                const container = buildErrorResponse('Invalid Option', 'Use `servertag notify on` or `servertag notify off`.', `**Current:** ${guildConfig.dmNotify !== false ? 'Enabled' : 'Disabled'}`);
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            const enabled = toggle === 'on' || toggle === 'enable';
            config[message.guild.id].dmNotify = enabled;
            saveConfig(config);

            const container = buildSuccessResponse(
                `DM Notifications ${enabled ? 'Enabled' : 'Disabled'}`,
                enabled
                    ? 'Users will receive a DM when they equip the server tag, thanking them and showing their rewards.'
                    : 'Users will no longer receive DM notifications when equipping the tag.'
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        // --- CHANNEL ---
        if (sub === 'channel' || sub === 'log' || sub === 'announce') {
            if (!guildConfig || !guildConfig.enabled) {
                const container = buildErrorResponse('Not Configured', 'Set up a server tag first with `servertag set <tag> @role`.');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            if (args[1]?.toLowerCase() === 'off' || args[1]?.toLowerCase() === 'disable') {
                config[message.guild.id].notifyChannel = null;
                saveConfig(config);
                const container = buildSuccessResponse('Announce Channel Disabled', 'Tag equip/unequip announcements will no longer be sent to a channel.');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            const channel = message.mentions.channels.first() || message.guild.channels.cache.get(args[1]);
            if (!channel || !channel.isTextBased()) {
                const container = buildErrorResponse('Invalid Channel', 'Please mention a text channel or provide a channel ID.', '**Example:** `servertag channel #tag-logs`');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            config[message.guild.id].notifyChannel = channel.id;
            saveConfig(config);

            const container = buildSuccessResponse(
                'Announce Channel Set',
                `Tag equip/unequip events will be announced in ${channel}.`,
                { 'Channel': `${channel}`, 'Disable': '`servertag channel off`' }
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        // --- REMOVE ---
        if (sub === 'remove' || sub === 'disable' || sub === 'off') {
            if (!guildConfig) {
                const container = buildErrorResponse('Not Configured', 'Server tag is not set up in this server.');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            const oldTag = guildConfig.tag;
            const roleId = guildConfig.roleId;
            delete config[message.guild.id];
            saveConfig(config);

            // Remove role from all members who have it
            const role = message.guild.roles.cache.get(roleId);
            let removedCount = 0;
            if (role) {
                const membersWithRole = role.members;
                for (const [, member] of membersWithRole) {
                    try {
                        await member.roles.remove(role);
                        removedCount++;
                    } catch {}
                }
            }

            const container = buildSuccessResponse(
                'Server Tag Removed',
                `The server tag system has been disabled and the reward role has been removed from all members.`,
                {
                    'Previous Tag': oldTag,
                    'Role Removed From': `${removedCount} member(s)`
                }
            );
            container.setAccentColor(COLORS.ERROR);

            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        // --- SCAN ---
        if (sub === 'scan') {
            if (!guildConfig || !guildConfig.enabled) {
                const container = buildErrorResponse('Not Configured', 'Set up a server tag first with `servertag set <tag> @role`.');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            const role = message.guild.roles.cache.get(guildConfig.roleId);
            if (!role) {
                const container = buildErrorResponse('Role Deleted', 'The configured reward role no longer exists. Please set a new one.');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            // Show loading
            const loadingContainer = new ContainerBuilder()
                .setAccentColor(COLORS.WARNING)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# ${EMOJIS.LOADING} Scanning Members\n\n` +
                    `Checking all members for tag **${guildConfig.tag}**...\n` +
                    `-# This may take a moment for large servers`
                ));
            const msg = await message.reply({ components: [loadingContainer], flags: MessageFlags.IsComponentsV2 });

            await message.guild.members.fetch();

            let added = 0, removed = 0, alreadyHas = 0, skipped = 0;
            let coinsGiven = 0, xpGiven = 0;
            const tag = guildConfig.tag.toLowerCase();

            for (const [, member] of message.guild.members.cache) {
                if (member.user.bot) continue;

                const displayName = (member.nickname || member.user.displayName || member.user.username).toLowerCase();
                const username = member.user.username.toLowerCase();
                const hasTag = displayName.includes(tag) || username.includes(tag);
                const hasRole = member.roles.cache.has(role.id);

                try {
                    if (hasTag && !hasRole) {
                        await member.roles.add(role);
                        added++;

                        // Track and reward
                        const tagData = trackTagEquip(message.guild.id, member.id);
                        if (!tagData.rewarded && (guildConfig.coinReward > 0 || guildConfig.xpReward > 0)) {
                            const economy = economyManager.loadEconomy();
                            const { userData } = economyManager.getUser(economy, member.id);
                            if (guildConfig.coinReward > 0) {
                                userData.coins = (userData.coins || 0) + guildConfig.coinReward;
                                coinsGiven += guildConfig.coinReward;
                            }
                            if (guildConfig.xpReward > 0) {
                                economyManager.addXP(economy, member.id, guildConfig.xpReward);
                                xpGiven += guildConfig.xpReward;
                            }
                            economyManager.saveEconomy(economy);

                            // Mark as rewarded
                            const users = loadTagUsers();
                            if (users[message.guild.id]?.[member.id]) {
                                users[message.guild.id][member.id].rewarded = true;
                                saveTagUsers(users);
                            }
                        }
                    } else if (!hasTag && hasRole) {
                        await member.roles.remove(role);
                        trackTagUnequip(message.guild.id, member.id);
                        removed++;
                    } else if (hasTag && hasRole) {
                        trackTagEquip(message.guild.id, member.id);
                        alreadyHas++;
                    } else {
                        skipped++;
                    }
                } catch {
                    skipped++;
                }
            }

            const details = {
                'Role Added': `${added} member(s)`,
                'Role Removed': `${removed} member(s)`,
                'Already Had Tag': `${alreadyHas} member(s)`,
                'Skipped': `${skipped} member(s)`
            };
            if (coinsGiven > 0) details['Coins Distributed'] = `${coinsGiven.toLocaleString()} coins`;
            if (xpGiven > 0) details['XP Distributed'] = `${xpGiven.toLocaleString()} XP`;

            const resultContainer = buildSuccessResponse(
                'Scan Complete',
                `Finished scanning **${message.guild.memberCount}** members for tag **${guildConfig.tag}**.`,
                details
            );
            resultContainer.setAccentColor(0x57F287);

            return msg.edit({ components: [resultContainer], flags: MessageFlags.IsComponentsV2 });
        }

        // --- STATUS (default) ---
        if (!sub || sub === 'status' || sub === 'info') {
            if (!guildConfig) {
                let content = `# <:Shield:1521227694677692467> Server Tag System\n\n`;
                content += `Reward users who represent your server by adding a tag to their display name.\n\n`;
                content += `### How It Works\n`;
                content += `> **1.** Set a tag and reward role with \`servertag set\`\n`;
                content += `> **2.** Users can \`servertag equip\` to auto-add the tag to their name\n`;
                content += `> **3.** When they add the tag, they get the role + coin/XP rewards\n`;
                content += `> **4.** When they remove the tag, the role is automatically removed\n`;
                content += `> **5.** Users get DM notifications & channel announcements\n\n`;
                content += `### User Commands\n`;
                content += `> \`servertag equip\` — Add the tag to your name & claim rewards\n`;
                content += `> \`servertag unequip\` — Remove the tag from your name\n`;
                content += `> \`servertag leaderboard\` — View tag leaderboard\n\n`;
                content += `### Admin Commands\n`;
                content += `> \`servertag set <tag> @role\` — Configure tag and reward\n`;
                content += `> \`servertag reward <coins> [xp]\` — Set coin & XP rewards\n`;
                content += `> \`servertag notify on/off\` — Toggle DM notifications\n`;
                content += `> \`servertag channel #channel\` — Set announcement channel\n`;
                content += `> \`servertag scan\` — Scan all members and sync roles\n`;
                content += `> \`servertag remove\` — Disable and remove all tag roles\n`;
                content += `> \`servertag status\` — View current configuration\n\n`;
                content += `### Examples\n`;
                content += `> \`servertag set .gg/myserver @Repper\`\n`;
                content += `> \`servertag reward 500 10\`\n`;
                content += `> \`servertag equip\`\n`;
                content += `> \`servertag set ★ @VIP\``;

                const container = new ContainerBuilder()
                    .setAccentColor(COLORS.CYAN)
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
;

                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            const role = message.guild.roles.cache.get(guildConfig.roleId);
            const membersWithRole = role ? role.members.size : 0;
            const lb = getTagLeaderboard(message.guild.id);

            let content = `# <:Shield:1521227694677692467> Server Tag Configuration\n\n`;
            content += `### Current Setup\n`;
            content += `> **Tag:** ${guildConfig.tag}\n`;
            content += `> **Reward Role:** ${role ? role : 'Deleted'}\n`;
            content += `> **Status:** ${guildConfig.enabled ? '<:online:1521228065752088576> Enabled' : '<:Toggleoff:1521227763816595559> Disabled'}\n`;
            content += `> **Members with Role:** ${membersWithRole}\n`;
            content += `> **Configured By:** <@${guildConfig.setBy}>\n`;
            content += `> **Set At:** <t:${Math.floor(new Date(guildConfig.setAt).getTime() / 1000)}:R>\n\n`;
            content += `### Rewards\n`;
            content += `> **Coin Reward:** ${guildConfig.coinReward || 0} coins\n`;
            content += `> **XP Reward:** ${guildConfig.xpReward || 0} XP\n`;
            content += `> **DM Notify:** ${guildConfig.dmNotify !== false ? '<:online:1521228065752088576> On' : '<:Toggleoff:1521227763816595559> Off'}\n`;
            content += `> **Announce Channel:** ${guildConfig.notifyChannel ? `<#${guildConfig.notifyChannel}>` : 'None'}\n`;
            content += `> **Total Tag Users:** ${lb.length}\n\n`;
            content += `-# Use \`servertag equip\` to join • \`servertag scan\` to sync • \`servertag leaderboard\` for top users`;

            const container = new ContainerBuilder()
                .setAccentColor(0x57F287)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
;

            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        // Unknown subcommand
        const container = buildErrorResponse(
            'Unknown Subcommand',
            `\`${sub}\` is not a valid option.`,
            '**Available:** `equip`, `unequip`, `leaderboard`, `set`, `remove`, `reward`, `notify`, `channel`, `scan`, `status`'
        );
        return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
};
