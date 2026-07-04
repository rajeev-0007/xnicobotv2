const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { buildErrorResponse, buildSuccessResponse, buildPermissionDenied, COLORS, EMOJIS } = require('../../utils/responseBuilder');
const jsonStore = require('../../utils/jsonStore');
const economyManager = require('../../utils/economyManager');

/* ═══════════════════════════════════════════════════════
   DATA LAYER
   ═══════════════════════════════════════════════════════ */

function loadGuildTags() {
    try { if (jsonStore.has('guildtags')) return jsonStore.read('guildtags'); } catch { }
    return {};
}

function saveGuildTags(data) {
    jsonStore.write('guildtags', data);
}

function getGuildData(guildId) {
    const data = loadGuildTags();
    if (!data[guildId]) data[guildId] = { tags: [], users: {}, settings: { maxEquipped: 1 } };
    if (!data[guildId].tags) data[guildId].tags = [];
    if (!data[guildId].users) data[guildId].users = {};
    if (!data[guildId].settings) data[guildId].settings = { maxEquipped: 1 };
    return data;
}

function ensureUserData(gd, userId) {
    if (!gd.users[userId]) gd.users[userId] = { equipped: [], purchased: [], streaks: {} };
    if (!gd.users[userId].streaks) gd.users[userId].streaks = {};
    if (!gd.users[userId].purchased) gd.users[userId].purchased = [];
    if (!gd.users[userId].equipped) gd.users[userId].equipped = [];
    return gd.users[userId];
}

function ensureTagRewards(tag) {
    if (!tag.rewards) tag.rewards = { dailyCoins: 0, dailyXP: 0, milestones: [] };
    if (!tag.rewards.milestones) tag.rewards.milestones = [];
    return tag.rewards;
}

function getStreakDays(streakEntry) {
    if (!streakEntry || !streakEntry.equippedSince) return 0;
    const since = new Date(streakEntry.equippedSince);
    const now = new Date();
    return Math.floor((now - since) / 86400000);
}

function canClaimDaily(streakEntry) {
    if (!streakEntry || !streakEntry.lastClaim) return true;
    const last = new Date(streakEntry.lastClaim);
    const now = new Date();
    return now.toDateString() !== last.toDateString();
}

/**
 * Process streak rewards for all guilds — called from index.js interval
 */
async function processStreakRewards(client) {
    const data = loadGuildTags();
    let changed = false;

    for (const [guildId, gd] of Object.entries(data)) {
        if (!gd.tags?.length) continue;
        const guild = client.guilds.cache.get(guildId);
        if (!guild) continue;

        for (const [userId, userData] of Object.entries(gd.users || {})) {
            if (!userData.equipped?.length || !userData.streaks) continue;

            for (const tagId of userData.equipped) {
                const tag = gd.tags.find(t => t.id === tagId);
                if (!tag) continue;

                const rewards = ensureTagRewards(tag);
                const streak = userData.streaks[tagId];
                if (!streak || !streak.equippedSince) continue;

                const days = getStreakDays(streak);
                const canClaim = canClaimDaily(streak);

                // Daily rewards
                if (canClaim && (rewards.dailyCoins > 0 || rewards.dailyXP > 0)) {
                    const economy = economyManager.loadEconomy();
                    const { userData: ecoData } = economyManager.getUser(economy, userId);
                    if (rewards.dailyCoins > 0) ecoData.coins = (ecoData.coins || 0) + rewards.dailyCoins;
                    if (rewards.dailyXP > 0) economyManager.addXP(economy, userId, rewards.dailyXP);
                    economyManager.saveEconomy(economy);
                    streak.lastClaim = new Date().toISOString();
                    streak.totalClaimed = (streak.totalClaimed || 0) + 1;
                    changed = true;
                }

                // Milestone roles
                if (rewards.milestones.length > 0) {
                    try {
                        const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
                        if (member) {
                            for (const ms of rewards.milestones) {
                                if (days >= ms.days && ms.roleId) {
                                    if (!member.roles.cache.has(ms.roleId)) {
                                        await member.roles.add(ms.roleId, `Guild tag streak: ${tag.name} — ${days} days`).catch(() => { });
                                        changed = true;
                                    }
                                }
                            }
                            // One-time milestone coin/XP rewards
                            if (!streak.claimedMilestones) streak.claimedMilestones = [];
                            for (const ms of rewards.milestones) {
                                const msKey = `${ms.days}`;
                                if (days >= ms.days && !streak.claimedMilestones.includes(msKey)) {
                                    if (ms.coins > 0 || ms.xp > 0) {
                                        const economy = economyManager.loadEconomy();
                                        const { userData: ecoData } = economyManager.getUser(economy, userId);
                                        if (ms.coins > 0) ecoData.coins = (ecoData.coins || 0) + ms.coins;
                                        if (ms.xp > 0) economyManager.addXP(economy, userId, ms.xp);
                                        economyManager.saveEconomy(economy);
                                    }
                                    streak.claimedMilestones.push(msKey);
                                    changed = true;
                                }
                            }
                        }
                    } catch { }
                }
            }
        }
    }

    if (changed) saveGuildTags(data);
}

function findTag(tags, name) {
    return tags.find(t => t.name.toLowerCase() === name.toLowerCase() || t.id === name.toLowerCase());
}

function formatDuration(days) {
    if (days <= 0) return '0 days';
    if (days === 1) return '1 day';
    return `${days} days`;
}

function generateTagId(name) {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 20);
}

function formatNickname(baseName, tag) {
    const symbol = tag.symbol || tag.name;
    const sep = tag.separator || ' ';
    const pos = tag.position || 'suffix';
    const bracket = tag.bracket || 'none';

    let tagText = symbol;
    if (bracket === 'square') tagText = `[${symbol}]`;
    else if (bracket === 'round') tagText = `(${symbol})`;
    else if (bracket === 'curly') tagText = `{${symbol}}`;
    else if (bracket === 'angle') tagText = `<${symbol}>`;
    else if (bracket === 'fancy') tagText = `「${symbol}」`;
    else if (bracket === 'star') tagText = `★${symbol}★`;
    else if (bracket === 'dot') tagText = `·${symbol}·`;
    else if (bracket === 'pipe') tagText = `|${symbol}|`;

    if (tag.emoji) tagText = `${tag.emoji} ${tagText}`;

    if (pos === 'prefix') return `${tagText}${sep}${baseName}`;
    return `${baseName}${sep}${tagText}`;
}

function stripAllTags(nickname, guildTags) {
    let clean = nickname;
    for (const tag of guildTags) {
        const symbol = tag.symbol || tag.name;
        const brackets = {
            'none': [symbol],
            'square': [`[${symbol}]`],
            'round': [`(${symbol})`],
            'curly': [`{${symbol}}`],
            'angle': [`<${symbol}>`],
            'fancy': [`「${symbol}」`],
            'star': [`★${symbol}★`],
            'dot': [`·${symbol}·`],
            'pipe': [`|${symbol}|`] };
        const variations = brackets[tag.bracket || 'none'] || [symbol];
        for (const v of variations) {
            const withEmoji = tag.emoji ? `${tag.emoji} ${v}` : v;
            clean = clean.replace(new RegExp(escapeRegex(withEmoji), 'gi'), '');
            clean = clean.replace(new RegExp(escapeRegex(v), 'gi'), '');
        }
    }
    return clean.replace(/\s{2 }/g, ' ').trim();
}

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ═══════════════════════════════════════════════════════
   COMMAND
   ═══════════════════════════════════════════════════════ */

module.exports = {
    prefix: 'guildtag',
    description: 'Create, customize, and equip custom guild tags — a multi-tag system for your server',
    usage: 'guildtag <create|delete|customize|list|shop|equip|unequip|info|rewards|streak|settings> [args]',
    category: 'admin',
    aliases: ['gt', 'gtag', 'clantag'],
    permissions: [],
    loadGuildTags,
    saveGuildTags,
    getGuildData,
    processStreakRewards,

    async executePrefix(message, args, lavalinkManager, client) {
        const sub = args[0]?.toLowerCase();
        const guildId = message.guild.id;

        // ╔══════════════════════════════════════════════╗
        // ║              USER COMMANDS                    ║
        // ╚══════════════════════════════════════════════╝

        // --- LIST / SHOP ---
        if (sub === 'list' || sub === 'shop' || sub === 'browse' || sub === 'tags') {
            const data = getGuildData(guildId);
            const gd = data[guildId];

            if (!gd.tags.length) {
                const container = buildErrorResponse('No Tags', 'No guild tags have been created yet.', 'An admin can create tags with `guildtag create <name> <symbol>`.');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            const userEquipped = gd.users[message.author.id]?.equipped || [];

            let content = `# 🏷️ Guild Tags\n\n`;

            for (const tag of gd.tags) {
                const isEquipped = userEquipped.includes(tag.id);
                const equipped = isEquipped ? ' `EQUIPPED`' : '';
                const pos = tag.position === 'prefix' ? 'Prefix' : 'Suffix';
                const bracket = tag.bracket && tag.bracket !== 'none' ? ` • ${tag.bracket}` : '';

                let preview = formatNickname('Username', tag);
                let reqText = '';
                if (tag.cost > 0) reqText += `💰 ${tag.cost.toLocaleString()} coins`;
                if (tag.requiredLevel > 0) reqText += `${reqText ? ' • ' : ''}<:transfer:1521228019824590948> Lv.${tag.requiredLevel}+`;
                if (tag.requiredRole) reqText += `${reqText ? ' • ' : ''}🔒 <@&${tag.requiredRole}>`;

                content += `### ${tag.emoji || '🏷️'} ${tag.name}${equipped}\n`;
                content += `> **Preview:** \`${preview}\`\n`;
                content += `> **Position:** ${pos}${bracket}`;
                if (tag.separator && tag.separator !== ' ') content += ` • Sep: \`${tag.separator}\``;
                content += `\n`;
                if (tag.description) content += `> ${tag.description}\n`;
                if (reqText) content += `> **Requires:** ${reqText}\n`;
                if (tag.rewardRole) content += `> **Gives Role:** <@&${tag.rewardRole}>\n`;
                content += `\n`;
            }

            const equippedCount = userEquipped.length;
            const maxEquip = gd.settings.maxEquipped || 1;
            content += `-# ${gd.tags.length} tag(s) available • ${equippedCount}/${maxEquip} equipped • Use \`guildtag equip <name>\` to equip`;

            const container = new ContainerBuilder()
                .setAccentColor(COLORS.CYAN)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
;

            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        // --- EQUIP ---
        if (sub === 'equip' || sub === 'use' || sub === 'wear') {
            const tagName = args.slice(1).join(' ');
            if (!tagName) {
                const container = buildErrorResponse('Missing Tag Name', 'Which tag do you want to equip?', '**Usage:** `guildtag equip <tag name>`\n**Browse:** `guildtag list`');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            const data = getGuildData(guildId);
            const gd = data[guildId];
            const tag = findTag(gd.tags, tagName);

            if (!tag) {
                const container = buildErrorResponse('Tag Not Found', `No tag named **${tagName}** exists.`, 'Use `guildtag list` to see available tags.');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            const userData = ensureUserData(gd, message.author.id);

            // Already equipped?
            if (userData.equipped.includes(tag.id)) {
                const container = buildErrorResponse('Already Equipped', `You already have **${tag.name}** equipped.`, 'Use `guildtag unequip` to remove it first.');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            // Max equipped check
            const maxEquip = gd.settings.maxEquipped || 1;
            if (userData.equipped.length >= maxEquip) {
                const container = buildErrorResponse(
                    'Max Tags Reached',
                    `You can only equip **${maxEquip}** tag(s) at a time.`,
                    'Use `guildtag unequip` to remove your current tag first.'
                );
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            // Check requirements
            const member = message.member;

            // Role requirement
            if (tag.requiredRole && !member.roles.cache.has(tag.requiredRole)) {
                const container = buildErrorResponse('Missing Role', `You need the <@&${tag.requiredRole}> role to equip this tag.`);
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            // Level requirement
            if (tag.requiredLevel > 0) {
                const economy = economyManager.loadEconomy();
                const { userData: ecoData } = economyManager.getUser(economy, message.author.id);
                if ((ecoData.level || 1) < tag.requiredLevel) {
                    const container = buildErrorResponse('Level Too Low', `You need to be **Level ${tag.requiredLevel}+** to equip this tag. You're Level ${ecoData.level || 1}.`);
                    return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
                }
            }

            // Cost (one-time purchase)
            if (tag.cost > 0 && !userData.purchased.includes(tag.id)) {
                const economy = economyManager.loadEconomy();
                const { userData: ecoData } = economyManager.getUser(economy, message.author.id);
                if ((ecoData.coins || 0) < tag.cost) {
                    const container = buildErrorResponse(
                        'Not Enough Coins',
                        `This tag costs **${tag.cost.toLocaleString()}** coins. You have **${(ecoData.coins || 0).toLocaleString()}**.`,
                        'Earn more coins and try again!'
                    );
                    return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
                }
                ecoData.coins -= tag.cost;
                economyManager.saveEconomy(economy);
                userData.purchased.push(tag.id);
            }

            // Apply tag to nickname
            const currentNick = member.nickname || member.user.displayName || member.user.username;
            const baseName = stripAllTags(currentNick, gd.tags);
            const newNick = formatNickname(baseName, tag);

            if (newNick.length > 32) {
                const container = buildErrorResponse(
                    'Nickname Too Long',
                    `Equipping this tag would make your nickname **${newNick.length}** characters (max 32).`,
                    'Shorten your nickname first, then try again.'
                );
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            // Bot permissions check
            if (!message.guild.members.me.permissions.has(PermissionFlagsBits.ManageNicknames)) {
                const container = buildErrorResponse('Missing Permission', 'I need **Manage Nicknames** permission.');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            if (member.id === message.guild.ownerId) {
                const container = buildErrorResponse('Server Owner', 'I cannot change the server owner\'s nickname. Please set it manually.', `Your tag should be: \`${newNick}\``);
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            if (member.roles.highest.position >= message.guild.members.me.roles.highest.position) {
                const container = buildErrorResponse('Role Hierarchy', 'Your highest role is above mine — I can\'t change your nickname.', `Set it manually to: \`${newNick}\``);
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            try {
                await member.setNickname(newNick, `Guild tag equipped: ${tag.name}`);

                // Give reward role
                if (tag.rewardRole) {
                    const rewardRole = message.guild.roles.cache.get(tag.rewardRole);
                    if (rewardRole && !member.roles.cache.has(rewardRole.id)) {
                        await member.roles.add(rewardRole, `Guild tag: ${tag.name}`).catch(() => { });
                    }
                }

                // Give XP/coin reward
                let rewardText = '';
                if (tag.coinReward > 0 || tag.xpReward > 0) {
                    const economy = economyManager.loadEconomy();
                    const { userData: ecoData } = economyManager.getUser(economy, message.author.id);
                    if (tag.coinReward > 0) {
                        ecoData.coins = (ecoData.coins || 0) + tag.coinReward;
                        rewardText += `**+${tag.coinReward.toLocaleString()}** coins`;
                    }
                    if (tag.xpReward > 0) {
                        economyManager.addXP(economy, message.author.id, tag.xpReward);
                        rewardText += `${rewardText ? ' & ' : ''}**+${tag.xpReward}** XP`;
                    }
                    economyManager.saveEconomy(economy);
                }

                userData.equipped.push(tag.id);
                // Initialize streak tracking
                userData.streaks[tag.id] = {
                    equippedSince: new Date().toISOString(),
                    lastClaim: null,
                    totalClaimed: 0,
                    totalDaysEquipped: 0,
                    claimedMilestones: []
                };
                saveGuildTags(data);

                const details = {
                    'Tag': `${tag.emoji || '🏷️'} ${tag.name}`,
                    'Nickname': newNick
                };
                if (tag.cost > 0 && !userData.purchased.includes(tag.id)) details['Cost'] = `${tag.cost.toLocaleString()} coins`;
                if (tag.rewardRole) details['Role'] = `<@&${tag.rewardRole}>`;
                if (rewardText) details['Bonus'] = rewardText;

                const container = buildSuccessResponse(
                    `Tag Equipped! ${tag.emoji || '🏷️'}`,
                    `You are now wearing the **${tag.name}** guild tag!`,
                    details
                );
                container.setAccentColor(0x57F287);
                container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
                container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Use \`guildtag unequip\` to remove • \`guildtag list\` to browse`));

                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            } catch (err) {
                const container = buildErrorResponse('Failed', 'Something went wrong while setting your nickname.', `Try setting it manually to: \`${newNick}\``);
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }
        }

        // --- UNEQUIP ---
        if (sub === 'unequip' || sub === 'remove' || sub === 'take' || sub === 'off') {
            const data = getGuildData(guildId);
            const gd = data[guildId];
            const userData = ensureUserData(gd, message.author.id);

            if (!userData.equipped.length) {
                const container = buildErrorResponse('No Tag Equipped', 'You don\'t have any guild tag equipped.', 'Use `guildtag list` to browse available tags.');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            const tagName = args.slice(1).join(' ');
            let tagToRemove;

            if (tagName) {
                tagToRemove = findTag(gd.tags, tagName);
                if (!tagToRemove || !userData.equipped.includes(tagToRemove.id)) {
                    const container = buildErrorResponse('Not Equipped', `You don't have **${tagName}** equipped.`);
                    return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
                }
            } else {
                // Remove the most recent
                const tagId = userData.equipped[userData.equipped.length - 1];
                tagToRemove = gd.tags.find(t => t.id === tagId);
            }

            if (!tagToRemove) {
                userData.equipped = [];
                saveGuildTags(data);
                const container = buildSuccessResponse('Tags Cleared', 'All equipped tags have been removed.');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            // Remove from equipped
            userData.equipped = userData.equipped.filter(id => id !== tagToRemove.id);
            // End streak tracking — save total days
            if (userData.streaks[tagToRemove.id]) {
                const days = getStreakDays(userData.streaks[tagToRemove.id]);
                userData.streaks[tagToRemove.id].totalDaysEquipped = (userData.streaks[tagToRemove.id].totalDaysEquipped || 0) + days;
                userData.streaks[tagToRemove.id].equippedSince = null;
                userData.streaks[tagToRemove.id].lastClaim = null;
            }
            saveGuildTags(data);

            // Update nickname
            const member = message.member;
            const currentNick = member.nickname || member.user.displayName || member.user.username;
            let newNick = stripAllTags(currentNick, gd.tags);

            // Re-apply remaining equipped tags
            for (const eqId of userData.equipped) {
                const eqTag = gd.tags.find(t => t.id === eqId);
                if (eqTag) newNick = formatNickname(newNick, eqTag);
            }

            if (!newNick || newNick === member.user.username || newNick === member.user.displayName) {
                newNick = null;
            }

            try {
                if (member.id !== message.guild.ownerId && member.roles.highest.position < message.guild.members.me.roles.highest.position) {
                    await member.setNickname(newNick, `Guild tag unequipped: ${tagToRemove.name}`);
                }
            } catch { }

            // Remove reward role
            if (tagToRemove.rewardRole) {
                const rewardRole = message.guild.roles.cache.get(tagToRemove.rewardRole);
                if (rewardRole && member.roles.cache.has(rewardRole.id)) {
                    await member.roles.remove(rewardRole, 'Guild tag unequipped').catch(() => { });
                }
            }

            const container = buildSuccessResponse(
                'Tag Unequipped',
                `The **${tagToRemove.name}** tag has been removed.`,
                { 'Nickname': newNick || member.user.displayName }
            );
            container.setAccentColor(COLORS.WARNING);
            container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Use \`guildtag equip <name>\` to equip another tag`));

            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        // --- INFO (user's tag info) ---
        if (sub === 'info' || sub === 'me' || sub === 'profile') {
            const data = getGuildData(guildId);
            const gd = data[guildId];
            const userData = gd.users[message.author.id];

            let content = `# 🏷️ Your Guild Tags\n\n`;

            if (!userData || !userData.equipped.length) {
                content += `> You don't have any tag equipped.\n\n`;
            } else {
                content += `### Equipped\n`;
                for (const eqId of userData.equipped) {
                    const tag = gd.tags.find(t => t.id === eqId);
                    if (tag) content += `> ${tag.emoji || '🏷️'} **${tag.name}** — \`${formatNickname('You', tag)}\`\n`;
                }
                content += `\n`;
            }

            const purchased = userData?.purchased || [];
            if (purchased.length > 0) {
                content += `### Purchased Tags\n`;
                for (const pId of purchased) {
                    const tag = gd.tags.find(t => t.id === pId);
                    if (tag) {
                        const isEq = userData.equipped.includes(pId);
                        content += `> ${tag.emoji || '🏷️'} **${tag.name}**${isEq ? ' `EQUIPPED`' : ''}\n`;
                    }
                }
                content += `\n`;
            }

            const maxEquip = gd.settings.maxEquipped || 1;
            content += `-# ${(userData?.equipped || []).length}/${maxEquip} slots used • ${gd.tags.length} tags available`;

            const container = new ContainerBuilder()
                .setAccentColor(COLORS.CYAN)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
;

            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        // --- STREAK (user command) ---
        if (sub === 'streak' || sub === 'daily' || sub === 'claim') {
            const data = getGuildData(guildId);
            const gd = data[guildId];
            const userData = ensureUserData(gd, message.author.id);

            if (!userData.equipped.length) {
                const container = buildErrorResponse('No Tag Equipped', 'You need to equip a tag first to track streaks.', 'Use `guildtag equip <name>` to get started.');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            let content = `# <:Fire:1521227907647668374> Your Tag Streaks\n\n`;
            let claimedAny = false;

            for (const tagId of userData.equipped) {
                const tag = gd.tags.find(t => t.id === tagId);
                if (!tag) continue;

                const streak = userData.streaks[tagId];
                if (!streak || !streak.equippedSince) continue;

                const days = getStreakDays(streak);
                const rewards = ensureTagRewards(tag);
                const daily = canClaimDaily(streak);

                content += `### ${tag.emoji || '🏷️'} ${tag.name}\n`;
                content += `> 📅 **Streak:** ${formatDuration(days)}\n`;
                content += `> ⏰ **Equipped Since:** <t:${Math.floor(new Date(streak.equippedSince).getTime() / 1000)}:R>\n`;

                // Auto-claim daily rewards
                if (daily && (rewards.dailyCoins > 0 || rewards.dailyXP > 0)) {
                    const economy = economyManager.loadEconomy();
                    const { userData: ecoData } = economyManager.getUser(economy, message.author.id);
                    let claimText = '';
                    if (rewards.dailyCoins > 0) {
                        ecoData.coins = (ecoData.coins || 0) + rewards.dailyCoins;
                        claimText += `**+${rewards.dailyCoins.toLocaleString()}** coins`;
                    }
                    if (rewards.dailyXP > 0) {
                        economyManager.addXP(economy, message.author.id, rewards.dailyXP);
                        claimText += `${claimText ? ' & ' : ''}**+${rewards.dailyXP}** XP`;
                    }
                    economyManager.saveEconomy(economy);
                    streak.lastClaim = new Date().toISOString();
                    streak.totalClaimed = (streak.totalClaimed || 0) + 1;
                    claimedAny = true;
                    content += `> <:Checkedbox:1521227734943269077> **Daily Claimed:** ${claimText}\n`;
                } else if (rewards.dailyCoins > 0 || rewards.dailyXP > 0) {
                    content += `> ⏳ **Daily:** Already claimed today\n`;
                }

                // Show milestones progress
                if (rewards.milestones.length > 0) {
                    content += `> \n> **Milestones:**\n`;
                    const claimed = streak.claimedMilestones || [];
                    for (const ms of rewards.milestones.sort((a, b) => a.days - b.days)) {
                        const done = days >= ms.days;
                        const icon = done ? '<:Checkedbox:1521227734943269077>' : '⬜';
                        let msText = `${formatDuration(ms.days)}`;
                        if (ms.roleId) msText += ` → <@&${ms.roleId}>`;
                        if (ms.coins > 0) msText += ` + ${ms.coins.toLocaleString()} coins`;
                        if (ms.xp > 0) msText += ` + ${ms.xp} XP`;
                        content += `> ${icon} ${msText}\n`;
                    }
                }

                if (tag.rewardRole) content += `> 🎖️ **Role:** <@&${tag.rewardRole}>\n`;
                content += `\n`;
            }

            content += `-# ${userData.equipped.length} tag(s) active • Keep tags equipped to build streaks!`;

            if (claimedAny) saveGuildTags(data);

            const container = new ContainerBuilder()
                .setAccentColor(0xFF9900)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
;

            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        // ╔══════════════════════════════════════════════╗
        // ║             ADMIN COMMANDS                    ║
        // ╚══════════════════════════════════════════════╝

        if (!message.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
            // Default help for non-admins
            if (!sub || sub === 'help') {
                let content = `# 🏷️ Guild Tag System\n\n`;
                content += `Equip custom tags to display on your nickname!\n\n`;
                content += `### Commands\n`;
                content += `> \`guildtag list\` — Browse available tags\n`;
                content += `> \`guildtag equip <name>\` — Equip a tag\n`;
                content += `> \`guildtag unequip [name]\` — Remove a tag\n`;
                content += `> \`guildtag info\` — View your equipped/purchased tags\n`;
                content += `> \`guildtag streak\` — View streaks & claim daily rewards\n`;

                const container = new ContainerBuilder()
                    .setAccentColor(COLORS.CYAN)
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
;

                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            const container = buildPermissionDenied('Manage Roles');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        // --- CREATE ---
        if (sub === 'create' || sub === 'add' || sub === 'new') {
            const name = args[1];
            const symbol = args.slice(2).join(' ') || name;

            if (!name) {
                const container = buildErrorResponse(
                    'Missing Name',
                    'Provide a name for the tag.',
                    '**Usage:** `guildtag create <name> [symbol]`\n**Examples:**\n> `guildtag create VIP ★VIP`\n> `guildtag create OG`\n> `guildtag create Supporter <:Sketch:1521228025365004471>SUP`'
                );
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            if (name.length > 20) {
                const container = buildErrorResponse('Name Too Long', 'Tag name must be 20 characters or less.');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            if (symbol.length > 15) {
                const container = buildErrorResponse('Symbol Too Long', 'Tag symbol must be 15 characters or less.');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            const data = getGuildData(guildId);
            const gd = data[guildId];

            if (gd.tags.length >= 25) {
                const container = buildErrorResponse('Tag Limit', 'Maximum of 25 guild tags per server.');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            const id = generateTagId(name);
            if (findTag(gd.tags, name)) {
                const container = buildErrorResponse('Already Exists', `A tag named **${name}** already exists.`);
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            const newTag = {
                id,
                name,
                symbol,
                emoji: '',
                description: '',
                position: 'suffix',
                separator: ' ',
                bracket: 'none',
                cost: 0,
                requiredRole: null,
                requiredLevel: 0,
                rewardRole: null,
                coinReward: 0,
                xpReward: 0,
                rewards: { dailyCoins: 0, dailyXP: 0, milestones: [] },
                createdBy: message.author.id,
                createdAt: new Date().toISOString()
            };

            gd.tags.push(newTag);
            saveGuildTags(data);

            const preview = formatNickname('Username', newTag);

            const container = buildSuccessResponse(
                'Guild Tag Created! 🏷️',
                `The **${name}** tag is now available for members to equip.`,
                {
                    'Name': name,
                    'Symbol': symbol,
                    'ID': id,
                    'Preview': `\`${preview}\``,
                    'Position': 'Suffix',
                    'Cost': 'Free'
                }
            );
            container.setAccentColor(0x57F287);
            container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `-# Customize with \`guildtag customize ${name} <option> <value>\`\n` +
                `-# Options: position, separator, bracket, emoji, cost, level, role, rewardrole, coinreward, xpreward, description`
            ));

            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        // --- DELETE ---
        if (sub === 'delete' || sub === 'del') {
            const tagName = args.slice(1).join(' ');
            if (!tagName) {
                const container = buildErrorResponse('Missing Tag', 'Which tag do you want to delete?', '**Usage:** `guildtag delete <name>`');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            const data = getGuildData(guildId);
            const gd = data[guildId];
            const tag = findTag(gd.tags, tagName);

            if (!tag) {
                const container = buildErrorResponse('Not Found', `No tag named **${tagName}** exists.`);
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            // Remove from all users
            let affectedCount = 0;
            for (const [userId, ud] of Object.entries(gd.users)) {
                if (ud.equipped.includes(tag.id)) {
                    ud.equipped = ud.equipped.filter(id => id !== tag.id);
                    affectedCount++;

                    // Try to update nickname
                    try {
                        const member = message.guild.members.cache.get(userId);
                        if (member && member.id !== message.guild.ownerId) {
                            const nick = member.nickname || member.user.displayName || member.user.username;
                            const clean = stripAllTags(nick, [tag]);
                            if (clean !== nick && member.roles.highest.position < message.guild.members.me.roles.highest.position) {
                                await member.setNickname(clean || null, 'Guild tag deleted by admin').catch(() => { });
                            }
                        }
                    } catch { }

                    // Remove reward role
                    if (tag.rewardRole) {
                        try {
                            const member = message.guild.members.cache.get(userId);
                            if (member) await member.roles.remove(tag.rewardRole).catch(() => { });
                        } catch { }
                    }
                }
            }

            gd.tags = gd.tags.filter(t => t.id !== tag.id);
            saveGuildTags(data);

            const container = buildSuccessResponse(
                'Tag Deleted',
                `The **${tag.name}** tag has been permanently deleted.`,
                {
                    'Tag': tag.name,
                    'Users Affected': `${affectedCount}`,
                    'Remaining Tags': `${gd.tags.length}`
                }
            );
            container.setAccentColor(COLORS.ERROR);

            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        // --- CUSTOMIZE ---
        if (sub === 'customize' || sub === 'config' || sub === 'edit' || sub === 'set') {
            const tagName = args[1];
            const option = args[2]?.toLowerCase();
            const value = args.slice(3).join(' ');

            if (!tagName) {
                let content = `# ${EMOJIS.SETTINGS} Guild Tag Customization\n\n`;
                content += `**Usage:** \`guildtag customize <tag name> <option> <value>\`\n\n`;
                content += `### Available Options\n`;
                content += `> **position** — \`prefix\` or \`suffix\` (where tag appears)\n`;
                content += `> **separator** — Character between name & tag (e.g. \` \`, \`|\`, \`·\`, \`-\`)\n`;
                content += `> **bracket** — Wrap style: \`none\`, \`square\`, \`round\`, \`curly\`, \`angle\`, \`fancy\`, \`star\`, \`dot\`, \`pipe\`\n`;
                content += `> **emoji** — Emoji displayed with the tag\n`;
                content += `> **symbol** — The tag text itself\n`;
                content += `> **description** — Tag description\n`;
                content += `> **cost** — Coin cost to purchase (0 = free)\n`;
                content += `> **level** — Required economy level (0 = none)\n`;
                content += `> **role** — Required role to equip (mention or ID, \`none\` to clear)\n`;
                content += `> **rewardrole** — Role given when equipped (mention or ID, \`none\` to clear)\n`;
                content += `> **coinreward** — Coins given when first equipped\n`;
                content += `> **xpreward** — XP given when first equipped\n\n`;
                content += `### Examples\n`;
                content += `> \`guildtag customize VIP position prefix\`\n`;
                content += `> \`guildtag customize VIP bracket fancy\`\n`;
                content += `> \`guildtag customize VIP emoji 👑\`\n`;
                content += `> \`guildtag customize VIP cost 1000\`\n`;
                content += `> \`guildtag customize VIP separator |\`\n`;
                content += `> \`guildtag customize OG rewardrole @OGRole\``;

                const container = new ContainerBuilder()
                    .setAccentColor(COLORS.CYAN)
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
;

                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            const data = getGuildData(guildId);
            const gd = data[guildId];
            const tag = findTag(gd.tags, tagName);

            if (!tag) {
                const container = buildErrorResponse('Not Found', `No tag named **${tagName}** exists.`, 'Use `guildtag list` to see tags.');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            if (!option) {
                // Show current config
                const preview = formatNickname('Username', tag);
                let content = `# ${EMOJIS.SETTINGS} Tag: ${tag.name}\n\n`;
                content += `> **Symbol:** ${tag.symbol}\n`;
                content += `> **Position:** ${tag.position}\n`;
                content += `> **Separator:** \`${tag.separator || ' '}\`\n`;
                content += `> **Bracket:** ${tag.bracket || 'none'}\n`;
                content += `> **Emoji:** ${tag.emoji || 'None'}\n`;
                content += `> **Description:** ${tag.description || 'None'}\n`;
                content += `> **Cost:** ${tag.cost > 0 ? `${tag.cost.toLocaleString()} coins` : 'Free'}\n`;
                content += `> **Required Level:** ${tag.requiredLevel > 0 ? `Lv.${tag.requiredLevel}` : 'None'}\n`;
                content += `> **Required Role:** ${tag.requiredRole ? `<@&${tag.requiredRole}>` : 'None'}\n`;
                content += `> **Reward Role:** ${tag.rewardRole ? `<@&${tag.rewardRole}>` : 'None'}\n`;
                content += `> **Coin Reward:** ${tag.coinReward || 0}\n`;
                content += `> **XP Reward:** ${tag.xpReward || 0}\n`;
                content += `> **Preview:** \`${preview}\`\n\n`;
                content += `-# Use \`guildtag customize ${tag.name} <option> <value>\` to change`;

                const container = new ContainerBuilder()
                    .setAccentColor(COLORS.CYAN)
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
;

                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            let resultText = '';

            switch (option) {
                case 'position':
                case 'pos': {
                    if (!['prefix', 'suffix'].includes(value.toLowerCase())) {
                        const container = buildErrorResponse('Invalid', 'Position must be `prefix` or `suffix`.');
                        return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
                    }
                    tag.position = value.toLowerCase();
                    resultText = `Position set to **${value.toLowerCase()}**`;
                    break;
                }
                case 'separator':
                case 'sep': {
                    if (value.length > 3) {
                        const container = buildErrorResponse('Too Long', 'Separator must be 3 characters or less.');
                        return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
                    }
                    tag.separator = value || ' ';
                    resultText = `Separator set to \`${value || ' '}\``;
                    break;
                }
                case 'bracket':
                case 'wrap': {
                    const valid = ['none', 'square', 'round', 'curly', 'angle', 'fancy', 'star', 'dot', 'pipe'];
                    if (!valid.includes(value.toLowerCase())) {
                        const container = buildErrorResponse('Invalid', `Bracket must be one of: ${valid.map(v => `\`${v}\``).join(', ')}.`);
                        return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
                    }
                    tag.bracket = value.toLowerCase();
                    resultText = `Bracket style set to **${value.toLowerCase()}**`;
                    break;
                }
                case 'emoji': {
                    tag.emoji = value || '';
                    resultText = value ? `Emoji set to ${value}` : 'Emoji cleared';
                    break;
                }
                case 'symbol':
                case 'text': {
                    if (!value || value.length > 15) {
                        const container = buildErrorResponse('Invalid', 'Symbol must be 1-15 characters.');
                        return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
                    }
                    tag.symbol = value;
                    resultText = `Symbol set to **${value}**`;
                    break;
                }
                case 'description':
                case 'desc': {
                    tag.description = value.slice(0, 100) || '';
                    resultText = value ? `Description set to: ${value.slice(0, 100)}` : 'Description cleared';
                    break;
                }
                case 'cost':
                case 'price': {
                    const num = parseInt(value);
                    if (isNaN(num) || num < 0 || num > 10000000) {
                        const container = buildErrorResponse('Invalid', 'Cost must be 0–10,000,000.');
                        return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
                    }
                    tag.cost = num;
                    resultText = num > 0 ? `Cost set to **${num.toLocaleString()}** coins` : 'Tag is now **free**';
                    break;
                }
                case 'level':
                case 'lvl': {
                    const num = parseInt(value);
                    if (isNaN(num) || num < 0 || num > 1000) {
                        const container = buildErrorResponse('Invalid', 'Level must be 0–1000.');
                        return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
                    }
                    tag.requiredLevel = num;
                    resultText = num > 0 ? `Required level set to **${num}**` : 'Level requirement removed';
                    break;
                }
                case 'role':
                case 'requiredrole': {
                    if (value.toLowerCase() === 'none' || value.toLowerCase() === 'off') {
                        tag.requiredRole = null;
                        resultText = 'Role requirement removed';
                    } else {
                        const role = message.mentions.roles.first() || message.guild.roles.cache.get(value);
                        if (!role) {
                            const container = buildErrorResponse('Invalid Role', 'Mention a role or provide a role ID.', 'Use `none` to clear.');
                            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
                        }
                        tag.requiredRole = role.id;
                        resultText = `Required role set to ${role}`;
                    }
                    break;
                }
                case 'rewardrole':
                case 'giverole': {
                    if (value.toLowerCase() === 'none' || value.toLowerCase() === 'off') {
                        tag.rewardRole = null;
                        resultText = 'Reward role removed';
                    } else {
                        const role = message.mentions.roles.first() || message.guild.roles.cache.get(value);
                        if (!role) {
                            const container = buildErrorResponse('Invalid Role', 'Mention a role or provide a role ID.', 'Use `none` to clear.');
                            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
                        }
                        if (role.position >= message.guild.members.me.roles.highest.position) {
                            const container = buildErrorResponse('Role Hierarchy', 'I cannot assign a role higher than or equal to my highest role.');
                            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
                        }
                        tag.rewardRole = role.id;
                        resultText = `Reward role set to ${role}`;
                    }
                    break;
                }
                case 'coinreward':
                case 'coins': {
                    const num = parseInt(value);
                    if (isNaN(num) || num < 0 || num > 1000000) {
                        const container = buildErrorResponse('Invalid', 'Coin reward must be 0–1,000,000.');
                        return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
                    }
                    tag.coinReward = num;
                    resultText = num > 0 ? `Coin reward set to **${num.toLocaleString()}**` : 'Coin reward disabled';
                    break;
                }
                case 'xpreward':
                case 'xp': {
                    const num = parseInt(value);
                    if (isNaN(num) || num < 0 || num > 10000) {
                        const container = buildErrorResponse('Invalid', 'XP reward must be 0–10,000.');
                        return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
                    }
                    tag.xpReward = num;
                    resultText = num > 0 ? `XP reward set to **${num}**` : 'XP reward disabled';
                    break;
                }
                default: {
                    const container = buildErrorResponse(
                        'Unknown Option',
                        `\`${option}\` is not a valid customize option.`,
                        '**Options:** `position`, `separator`, `bracket`, `emoji`, `symbol`, `description`, `cost`, `level`, `role`, `rewardrole`, `coinreward`, `xpreward`'
                    );
                    return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
                }
            }

            saveGuildTags(data);

            const preview = formatNickname('Username', tag);
            const container = buildSuccessResponse(
                'Tag Updated',
                resultText,
                {
                    'Tag': `${tag.emoji || '🏷️'} ${tag.name}`,
                    'Preview': `\`${preview}\``
                }
            );
            container.setAccentColor(0x57F287);

            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        // --- REWARDS (admin) ---
        if (sub === 'rewards' || sub === 'reward') {
            const tagName = args[1];
            const action = args[2]?.toLowerCase();

            if (!tagName) {
                let content = `# 🎁 Guild Tag Rewards Configuration\n\n`;
                content += `Set up daily rewards and milestone roles for keeping tags equipped.\n\n`;
                content += `### Usage\n`;
                content += `> \`guildtag rewards <tag> daily <coins> <xp>\` — Set daily coin/XP rewards\n`;
                content += `> \`guildtag rewards <tag> milestone <days> <@role> [coins] [xp]\` — Add a streak milestone\n`;
                content += `> \`guildtag rewards <tag> removemilestone <days>\` — Remove a milestone\n`;
                content += `> \`guildtag rewards <tag> view\` — View current reward config\n`;
                content += `> \`guildtag rewards <tag> reset\` — Clear all rewards for a tag\n\n`;
                content += `### How It Works\n`;
                content += `> Members who keep a tag equipped build a **streak** (days).\n`;
                content += `> **Daily Rewards** — coins & XP auto-claimed via \`guildtag streak\`.\n`;
                content += `> **Milestones** — At X days, members get a role + one-time bonus.\n\n`;
                content += `### Examples\n`;
                content += `> \`guildtag rewards VIP daily 50 10\`\n`;
                content += `> \`guildtag rewards VIP milestone 7 @Bronze 100 25\`\n`;
                content += `> \`guildtag rewards VIP milestone 30 @Gold 500 100\`\n`;
                content += `> \`guildtag rewards VIP milestone 90 @Legendary 2000 500\``;

                const container = new ContainerBuilder()
                    .setAccentColor(COLORS.CYAN)
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
;

                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            const data = getGuildData(guildId);
            const gd = data[guildId];
            const tag = findTag(gd.tags, tagName);

            if (!tag) {
                const container = buildErrorResponse('Not Found', `No tag named **${tagName}** exists.`);
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            const rewards = ensureTagRewards(tag);

            // --- rewards view ---
            if (!action || action === 'view' || action === 'status') {
                let content = `# 🎁 Rewards: ${tag.emoji || '🏷️'} ${tag.name}\n\n`;
                content += `### Instant (on equip)\n`;
                content += `> **Reward Role:** ${tag.rewardRole ? `<@&${tag.rewardRole}>` : 'None'}\n`;
                content += `> **Coins:** ${tag.coinReward || 0}\n`;
                content += `> **XP:** ${tag.xpReward || 0}\n\n`;
                content += `### Daily Rewards\n`;
                content += `> **Coins/day:** ${rewards.dailyCoins || 0}\n`;
                content += `> **XP/day:** ${rewards.dailyXP || 0}\n\n`;

                if (rewards.milestones.length > 0) {
                    content += `### Streak Milestones\n`;
                    for (const ms of rewards.milestones.sort((a, b) => a.days - b.days)) {
                        let msText = `**${formatDuration(ms.days)}**`;
                        if (ms.roleId) msText += ` → <@&${ms.roleId}>`;
                        if (ms.coins > 0) msText += ` + ${ms.coins.toLocaleString()} coins`;
                        if (ms.xp > 0) msText += ` + ${ms.xp} XP`;
                        content += `> 🏆 ${msText}\n`;
                    }
                } else {
                    content += `### Streak Milestones\n> None configured\n`;
                }

                content += `\n-# Use \`guildtag rewards ${tag.name} daily/milestone\` to configure`;

                const container = new ContainerBuilder()
                    .setAccentColor(COLORS.CYAN)
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
;

                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            // --- rewards daily ---
            if (action === 'daily') {
                const coins = parseInt(args[3]);
                const xp = parseInt(args[4]) || 0;

                if (isNaN(coins) || coins < 0 || coins > 100000) {
                    const container = buildErrorResponse('Invalid', 'Daily coins must be 0–100,000.', '**Usage:** `guildtag rewards <tag> daily <coins> [xp]`');
                    return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
                }
                if (xp < 0 || xp > 5000) {
                    const container = buildErrorResponse('Invalid', 'Daily XP must be 0–5,000.');
                    return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
                }

                rewards.dailyCoins = coins;
                rewards.dailyXP = xp;
                saveGuildTags(data);

                const container = buildSuccessResponse(
                    'Daily Rewards Set',
                    `Members with **${tag.name}** equipped will earn daily rewards.`,
                    {
                        'Tag': `${tag.emoji || '🏷️'} ${tag.name}`,
                        'Daily Coins': coins > 0 ? `${coins.toLocaleString()}/day` : 'None',
                        'Daily XP': xp > 0 ? `${xp}/day` : 'None'
                    }
                );
                container.setAccentColor(0x57F287);
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            // --- rewards milestone ---
            if (action === 'milestone' || action === 'ms' || action === 'addmilestone') {
                const days = parseInt(args[3]);
                if (isNaN(days) || days < 1 || days > 365) {
                    const container = buildErrorResponse('Invalid Days', 'Milestone days must be 1–365.', '**Usage:** `guildtag rewards <tag> milestone <days> <@role> [coins] [xp]`');
                    return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
                }

                // Parse role (arg 4)
                const roleArg = args[4];
                let roleId = null;
                if (roleArg && roleArg !== '0' && roleArg.toLowerCase() !== 'none') {
                    const roleMention = roleArg.match(/^<@&(\d+)>$/);
                    if (roleMention) {
                        roleId = roleMention[1];
                    } else if (/^\d+$/.test(roleArg)) {
                        roleId = roleArg;
                    } else {
                        // Try role name
                        const found = message.guild.roles.cache.find(r => r.name.toLowerCase() === roleArg.toLowerCase());
                        if (found) roleId = found.id;
                    }
                    if (roleId) {
                        const role = message.guild.roles.cache.get(roleId);
                        if (!role) {
                            const container = buildErrorResponse('Role Not Found', 'That role doesn\'t exist in this server.');
                            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
                        }
                        if (role.position >= message.guild.members.me.roles.highest.position) {
                            const container = buildErrorResponse('Role Hierarchy', 'I cannot assign a role higher than or equal to my highest role.');
                            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
                        }
                    }
                }

                const msCoins = parseInt(args[5]) || 0;
                const msXP = parseInt(args[6]) || 0;

                if (msCoins < 0 || msCoins > 10000000) {
                    const container = buildErrorResponse('Invalid', 'Milestone coins must be 0–10,000,000.');
                    return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
                }

                // Check if milestone for this day already exists — update it
                const existing = rewards.milestones.find(m => m.days === days);
                if (existing) {
                    existing.roleId = roleId;
                    existing.coins = msCoins;
                    existing.xp = msXP;
                } else {
                    if (rewards.milestones.length >= 10) {
                        const container = buildErrorResponse('Limit', 'Maximum 10 milestones per tag.');
                        return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
                    }
                    rewards.milestones.push({ days, roleId, coins: msCoins, xp: msXP });
                }
                rewards.milestones.sort((a, b) => a.days - b.days);
                saveGuildTags(data);

                const details = { 'Tag': `${tag.emoji || '🏷️'} ${tag.name}`, 'At': `${formatDuration(days)} streak` };
                if (roleId) details['Role'] = `<@&${roleId}>`;
                if (msCoins > 0) details['Coins'] = msCoins.toLocaleString();
                if (msXP > 0) details['XP'] = `${msXP}`;
                details['Total Milestones'] = `${rewards.milestones.length}`;

                const container = buildSuccessResponse(
                    existing ? 'Milestone Updated' : 'Milestone Added 🏆',
                    `Members will receive rewards at **${formatDuration(days)}** streak with **${tag.name}**.`,
                    details
                );
                container.setAccentColor(0x57F287);
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            // --- rewards removemilestone ---
            if (action === 'removemilestone' || action === 'removems' || action === 'delmilestone') {
                const days = parseInt(args[3]);
                if (isNaN(days)) {
                    const container = buildErrorResponse('Invalid', 'Specify the milestone day count to remove.', '**Usage:** `guildtag rewards <tag> removemilestone <days>`');
                    return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
                }

                const idx = rewards.milestones.findIndex(m => m.days === days);
                if (idx === -1) {
                    const container = buildErrorResponse('Not Found', `No milestone at **${days}** days.`);
                    return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
                }

                rewards.milestones.splice(idx, 1);
                saveGuildTags(data);

                const container = buildSuccessResponse('Milestone Removed', `The **${formatDuration(days)}** milestone for **${tag.name}** has been removed.`);
                container.setAccentColor(COLORS.WARNING);
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            // --- rewards reset ---
            if (action === 'reset' || action === 'clear') {
                tag.rewards = { dailyCoins: 0, dailyXP: 0, milestones: [] };
                tag.rewardRole = null;
                tag.coinReward = 0;
                tag.xpReward = 0;
                saveGuildTags(data);

                const container = buildSuccessResponse('Rewards Reset', `All rewards for **${tag.name}** have been cleared.`);
                container.setAccentColor(COLORS.WARNING);
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            const container = buildErrorResponse(
                'Unknown Action',
                `\`${action}\` is not valid.`,
                '**Options:** `view`, `daily`, `milestone`, `removemilestone`, `reset`'
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        // --- SETTINGS ---
        if (sub === 'settings' || sub === 'config') {
            const option = args[1]?.toLowerCase();
            const value = args[2];

            const data = getGuildData(guildId);
            const gd = data[guildId];

            if (!option) {
                let content = `# ${EMOJIS.SETTINGS} Guild Tag Settings\n\n`;
                content += `> **Max Equipped Tags:** ${gd.settings.maxEquipped || 1}\n`;
                content += `> **Total Tags:** ${gd.tags.length}\n`;
                content += `> **Total Users:** ${Object.keys(gd.users).length}\n\n`;
                content += `### Configure\n`;
                content += `> \`guildtag settings maxequip <1-5>\` — Max tags a user can equip\n`;

                const container = new ContainerBuilder()
                    .setAccentColor(COLORS.CYAN)
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
;

                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            if (option === 'maxequip' || option === 'max') {
                const num = parseInt(value);
                if (isNaN(num) || num < 1 || num > 5) {
                    const container = buildErrorResponse('Invalid', 'Max equipped must be between 1 and 5.');
                    return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
                }
                gd.settings.maxEquipped = num;
                saveGuildTags(data);

                const container = buildSuccessResponse('Setting Updated', `Members can now equip up to **${num}** tag(s) at a time.`);
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            const container = buildErrorResponse('Unknown Setting', `\`${option}\` is not a valid setting.`, '**Available:** `maxequip`');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        // --- DEFAULT HELP ---
        if (!sub || sub === 'help' || sub === 'status') {
            const data = getGuildData(guildId);
            const gd = data[guildId];

            let content = `# 🏷️ Guild Tag System\n\n`;
            content += `Create custom tags that members can browse, purchase, and equip on their nickname.\n\n`;
            content += `### User Commands\n`;
            content += `> \`guildtag list\` — Browse available tags & shop\n`;
            content += `> \`guildtag equip <name>\` — Equip a tag\n`;
            content += `> \`guildtag unequip [name]\` — Remove a tag\n`;
            content += `> \`guildtag info\` — View your tags\n`;
            content += `> \`guildtag streak\` — View streaks & claim daily rewards\n\n`;
            content += `### Admin Commands\n`;
            content += `> \`guildtag create <name> [symbol]\` — Create a new tag\n`;
            content += `> \`guildtag delete <name>\` — Delete a tag\n`;
            content += `> \`guildtag customize <name>\` — View/edit tag options\n`;
            content += `> \`guildtag customize <name> <option> <value>\` — Full customization\n`;
            content += `> \`guildtag rewards <name>\` — Configure role rewards & streaks\n`;
            content += `> \`guildtag settings\` — Server-level settings\n\n`;
            content += `### Tag Stats\n`;
            content += `> **Total Tags:** ${gd.tags.length}\n`;
            content += `> **Active Users:** ${Object.values(gd.users).filter(u => u.equipped?.length > 0).length}\n`;
            content += `> **Max Equipped:** ${gd.settings.maxEquipped || 1}\n\n`;
            content += `### Quick Start\n`;
            content += `> \`guildtag create VIP ★VIP\`\n`;
            content += `> \`guildtag customize VIP bracket fancy\`\n`;
            content += `> \`guildtag customize VIP cost 500\`\n`;
            content += `> \`guildtag customize VIP emoji 👑\`\n`;
            content += `> \`guildtag customize VIP rewardrole @VIP\``;

            const container = new ContainerBuilder()
                .setAccentColor(COLORS.CYAN)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
;

            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        // Unknown subcommand
        const container = buildErrorResponse(
            'Unknown Subcommand',
            `\`${sub}\` is not a valid option.`,
            '**Available:** `list`, `equip`, `unequip`, `info`, `streak`, `create`, `delete`, `customize`, `rewards`, `settings`'
        );
        return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
};
