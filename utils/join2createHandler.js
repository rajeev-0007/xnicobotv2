'use strict';

/**
 * Join-to-Create Runtime Handler
 * ───────────────────────────────────────────────────────────────────
 * - Voice state listener (creates / cleans up temp VCs)
 * - Button + select + modal routing for the owner control panel
 * - Per-guild lock + per-user cooldown to stop duplicate-channel races
 * - Premium-aware interface lookup (multi-interface for premium guilds,
 *   single interface for free guilds — enforced at config time, not
 *   runtime, so the runtime path stays fast)
 *
 * The handler keeps backward compatibility with v1 storage by going
 * through `join2createManager` which migrates legacy configs on every
 * read.
 */

const {
    ChannelType, PermissionFlagsBits,
    ActionRowBuilder, ContainerBuilder, TextDisplayBuilder, MessageFlags,
    ModalBuilder, TextInputBuilder, TextInputStyle,
    SeparatorBuilder, SeparatorSpacingSize,
    UserSelectMenuBuilder
} = require('discord.js');

const { buildSuccessResponse, buildErrorResponse, BRANDING } = require('./responseBuilder');
const trustManager = require('./trustManager');
const log          = require('./logger-styled');
const mgr          = require('./join2createManager');

const CV2_EPH = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;
const ok  = (t, d) => ({ components: [buildSuccessResponse(t, d)], flags: CV2_EPH });
const err = (t, d) => ({ components: [buildErrorResponse(t, d)], flags: CV2_EPH });

const OWNER_PERMS  = {
    ViewChannel: true, Connect: true, Speak: true,
    ManageChannels: true, MoveMembers: true, MuteMembers: true, DeafenMembers: true
};
const TRUSTED_PERMS = { ViewChannel: true, Connect: true, Speak: true, MoveMembers: true, MuteMembers: true };
const MEMBER_PERMS = {
    ViewChannel: true, Connect: true, Speak: true,
    ManageChannels: false, MoveMembers: false, MuteMembers: false, DeafenMembers: false
};

/* ═══════════════════════════════════════════════════════════════════
   PERMISSION GUARD
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Returns the active-channel record the interaction's user has rights
 * over, with the actual Discord channel attached, or `null` if they
 * don't own / co-own / aren't staff for any active channel they could
 * be acting on.
 *
 * Resolution order:
 *   1. If the user is in a temp VC and owns it → that channel.
 *   2. If the user is in a temp VC and is trusted on it → that channel.
 *   3. If the user is staff (`hasVcModAccess`) and is in a temp VC →
 *      that channel (admin override).
 *   4. If the user is in NO temp VC but owns one elsewhere → that one.
 */
function resolveActionable(interaction) {
    const guildId = interaction.guild.id;
    const guild   = interaction.guild;
    const member  = interaction.member;
    const uid     = member?.id;

    // 1. Voice channel the user is currently in
    const inVc = member?.voice?.channel || null;

    if (inVc) {
        const ownerId = mgr.findOwnerByChannel(guildId, inVc.id);
        if (ownerId) {
            const cfg = mgr.getGuildConfig(guildId);
            const entry = cfg.activeChannels[ownerId];
            const trusted = (entry?.trustedUsers || []).includes(uid);
            const isStaff = trustManager.hasVcModAccess(guild, uid, member.roles.cache.map(r => r.id));

            if (ownerId === uid || trusted || isStaff) {
                return {
                    ownerId,
                    channel: inVc,
                    entry,
                    role: ownerId === uid ? 'owner' : (trusted ? 'trusted' : 'staff')
                };
            }
        }
    }

    // 2. Fall back to any channel the user owns
    const owned = mgr.getActiveChannel(guildId, uid);
    if (owned) {
        const ch = guild.channels.cache.get(owned.channelId);
        if (ch) return { ownerId: uid, channel: ch, entry: owned, role: 'owner' };
    }

    return null;
}

/* ═══════════════════════════════════════════════════════════════════
   VOICE STATE HANDLER
   ═══════════════════════════════════════════════════════════════════ */

async function handleVoiceStateUpdate(oldState, newState) {
    const guild = newState.guild || oldState.guild;
    if (!guild) return;
    const guildId = guild.id;

    const cfg = mgr.getGuildConfig(guildId);
    const hasInterfaces = cfg.interfaces && Object.keys(cfg.interfaces).length > 0;

    /* ── Spawn path: user joined a trigger channel ──────────────── */
    if (hasInterfaces && newState.channelId && newState.channelId !== oldState.channelId) {
        const iface = mgr.findInterfaceByTrigger(guildId, newState.channelId);
        if (iface) {
            const member = newState.member;
            const uid    = member.id;

            // Per-user cooldown — silently ignore rapid re-triggers.
            if (mgr.isOnCooldown(guildId, uid)) return;
            mgr.markCooldown(guildId, uid);

            // If the user already owns one, move them back instead of creating a duplicate.
            const existing = mgr.getActiveChannel(guildId, uid);
            if (existing) {
                const ch = guild.channels.cache.get(existing.channelId);
                if (ch) {
                    await member.voice.setChannel(ch).catch(() => {});
                    return;
                }
                mgr.dropActiveChannel(guildId, uid);
            }

            // Role gating
            if (iface.allowedRoles?.length) {
                const allowed = iface.allowedRoles.some(r => member.roles.cache.has(r));
                if (!allowed) {
                    await member.voice.setChannel(null).catch(() => {});
                    return;
                }
            }
            if (iface.deniedRoles?.length) {
                const denied = iface.deniedRoles.some(r => member.roles.cache.has(r));
                if (denied) {
                    await member.voice.setChannel(null).catch(() => {});
                    return;
                }
            }

            // Lock the create branch so two simultaneous trigger events
            // can't race the activeChannels read.
            await mgr.withGuildLock(guildId, async () => {
                const current = mgr.getActiveChannel(guildId, uid);
                if (current && guild.channels.cache.get(current.channelId)) {
                    await member.voice.setChannel(current.channelId).catch(() => {});
                    return;
                }

                try {
                    let parentCategoryId = iface.categoryId;
                    if (parentCategoryId && !guild.channels.cache.get(parentCategoryId)) parentCategoryId = null;
                    if (!parentCategoryId) {
                        // Inherit from the trigger that fired this spawn.
                        const trigger = guild.channels.cache.get(newState.channelId);
                        parentCategoryId = trigger?.parentId || null;
                    }

                    const activeCount = Object.values(mgr.getGuildConfig(guildId).activeChannels)
                        .filter(e => e.interfaceId === iface.id).length;

                    // Concurrency cap: 0 = unlimited, otherwise hard-limit live temp VCs
                    // for this interface. Checked inside the guild lock so simultaneous
                    // joins can't race past the cap.
                    const cap = Number(iface.maxConcurrentChannels) || 0;
                    if (cap > 0 && activeCount >= cap) {
                        await member.voice.setChannel(null).catch(() => {});
                        log.info(`[J2C] Cap reached (${activeCount}/${cap}) for interface ${iface.id} in ${guildId}; bounced ${uid}.`);
                        return;
                    }

                    const channelName = mgr.applyNamingTemplate(iface.namingTemplate, {
                        user:  member.user,
                        iface,
                        guild,
                        activeCount: activeCount + 1
                    });

                    const maxBitrate = guild.premiumTier >= 3 ? 384 : guild.premiumTier >= 2 ? 256 : guild.premiumTier >= 1 ? 128 : 96;
                    const bitrate = Math.min(iface.defaultBitrate || mgr.DEFAULT_BITRATE_KBPS, maxBitrate);

                    const overwrites = [
                        { id: guild.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak] },
                        {
                            id: uid,
                            allow: [
                                PermissionFlagsBits.ViewChannel,
                                PermissionFlagsBits.Connect,
                                PermissionFlagsBits.Speak,
                                PermissionFlagsBits.ManageChannels,
                                PermissionFlagsBits.MoveMembers,
                                PermissionFlagsBits.MuteMembers,
                                PermissionFlagsBits.DeafenMembers
                            ]
                        }
                    ];
                    if (iface.defaultVisibility === 'private') {
                        overwrites[0].deny = [PermissionFlagsBits.Connect];
                    }

                    const vc = await guild.channels.create({
                        name:    channelName,
                        type:    ChannelType.GuildVoice,
                        parent:  parentCategoryId || undefined,
                        userLimit: iface.defaultUserLimit || 0,
                        bitrate: bitrate * 1000,
                        permissionOverwrites: overwrites
                    });

                    mgr.recordActiveChannel(guildId, uid, vc.id, iface.id);
                    await member.voice.setChannel(vc).catch(() => {});
                } catch (e) {
                    log.error(`[J2C] Channel create failed for ${uid} in ${guildId}: ${e.message}`);
                }
            });
            return;
        }
    }

    /* ── Cleanup path: user left a temp VC and it's now empty ──── */
    if (oldState.channelId && oldState.channelId !== newState.channelId) {
        const ch = oldState.guild?.channels?.cache?.get(oldState.channelId);
        if (!ch) return;

        const ownerId = mgr.findOwnerByChannel(guildId, ch.id);
        if (!ownerId) return;

        const human = ch.members.filter(m => !m.user.bot);
        if (human.size === 0) {
            const fresh = mgr.getGuildConfig(guildId);
            const entry = fresh.activeChannels[ownerId];
            const iface = entry ? fresh.interfaces[entry.interfaceId] : null;
            const autoDelete = iface ? iface.autoDelete !== false : true;
            if (autoDelete) {
                try { await ch.delete('J2C: empty temp channel'); } catch {}
                mgr.dropActiveChannel(guildId, ownerId);
            }
        }
    }
}

/* ═══════════════════════════════════════════════════════════════════
   UI HELPERS
   ═══════════════════════════════════════════════════════════════════ */

function userSelectPanel(customId, title, hint) {
    return {
        components: [
            new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(`### <:User:1521227714227343380> ${title}\n-# ${hint}`))
                .addActionRowComponents(new ActionRowBuilder().addComponents(
                    new UserSelectMenuBuilder().setCustomId(customId).setPlaceholder('Pick a member…').setMinValues(1).setMaxValues(1)
                ))
        ],
        flags: CV2_EPH
    };
}

/* ═══════════════════════════════════════════════════════════════════
   BUTTON HANDLER
   ═══════════════════════════════════════════════════════════════════ */

async function handleJ2CButtons(interaction) {
    const action = interaction.customId.replace('j2c_', '');

    // The "claim" action uniquely operates on a channel the user is
    // standing in, even when they don't own one. Handle it separately.
    if (action === 'claim') return handleClaim(interaction);

    const ctx = resolveActionable(interaction);
    if (!ctx) {
        return interaction.reply(err(
            'No Active Channel',
            'You must be in a temporary voice channel you own (or have permission to manage) to use these controls.'
        ));
    }
    const { channel, ownerId, entry, role } = ctx;
    const guild = interaction.guild;

    // Modal-driven actions that take free-form text
    const modalSpecs = {
        rename:  ['j2c_rename_modal',  'Rename Voice Channel', 'channel_name', 'New Channel Name', 'Enter new channel name', 100],
        limit:   ['j2c_limit_modal',   'Set User Limit',       'user_limit',   'User Limit (0 for unlimited)', '0-99', 2],
        bitrate: ['j2c_bitrate_modal', 'Set Bitrate',          'bitrate',      'Bitrate (kbps)', '8-384', 3],
        region:  ['j2c_region_modal',  'Set Voice Region',     'region',       'Region', 'auto, us-west, eu-west, singapore, japan…', 32]
    };
    if (modalSpecs[action]) {
        const [id, title, fieldId, label, placeholder, maxLen] = modalSpecs[action];
        const modal = new ModalBuilder().setCustomId(id).setTitle(title);
        const input = new TextInputBuilder().setCustomId(fieldId).setLabel(label).setStyle(TextInputStyle.Short).setPlaceholder(placeholder).setRequired(true);
        if (maxLen) input.setMaxLength(maxLen);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return interaction.showModal(modal);
    }

    // User-target actions now use a UserSelectMenu instead of a typed-ID
    // modal — much faster and impossible to fat-finger.
    const userPickerSpecs = {
        kick:     ['j2c_select_kick',     'Kick a Member',                 'They will be disconnected from your channel.'],
        block:    ['j2c_select_block',    'Block a Member',                'They cannot rejoin until you unblock them.'],
        unblock:  ['j2c_select_unblock',  'Unblock a Member',              'They regain access to your channel.'],
        permit:   ['j2c_select_permit',   'Permit a Member',               'They can join even if the channel is locked.'],
        trust:    ['j2c_select_trust',    'Trust a Member as Co-Owner',    'They gain channel-management rights.'],
        untrust:  ['j2c_select_untrust',  'Untrust a Member',              'Removes their co-owner permissions.'],
        transfer: ['j2c_select_transfer', 'Transfer Ownership',            'They become the new owner of this channel.']
    };
    if (userPickerSpecs[action]) {
        const [customId, title, hint] = userPickerSpecs[action];
        return interaction.reply(userSelectPanel(customId, title, hint));
    }

    // Permission toggles
    const toggles = {
        lock:   [{ Connect: false }, 'Channel Locked',   '<:Lock:1521227892770734120> Your channel is now **locked**.'],
        unlock: [{ Connect: null  }, 'Channel Unlocked', '<:Unlock:1521228030842769610> Your channel is now **unlocked**.'],
        hide:   [{ ViewChannel: false }, 'Channel Hidden',  '<:Eyeclosed:1521228356463362291> Your channel is now **hidden**.'],
        unhide: [{ ViewChannel: null  }, 'Channel Visible', '<:Eye:1521227940480815156> Your channel is now **visible**.']
    };
    if (toggles[action]) {
        const [perms, title, desc] = toggles[action];
        try {
            await channel.permissionOverwrites.edit(guild.id, perms);
            return interaction.reply(ok(title, desc));
        } catch {
            return interaction.reply(err(`${action} Failed`, 'Failed to update channel. Check bot permissions.'));
        }
    }

    if (action === 'delete') {
        if (role !== 'owner' && role !== 'staff') {
            return interaction.reply(err('Permission Denied', 'Only the owner or server staff can delete this channel.'));
        }
        await interaction.reply(ok('Channel Deleted', '<:Trash:1521227750420254820> Your voice channel is being deleted.'));
        try { await channel.delete('J2C: owner-requested delete'); } catch {}
        mgr.dropActiveChannel(guild.id, ownerId);
        return;
    }

    if (action === 'invite') {
        try {
            const inv = await channel.createInvite({ maxAge: 3600, maxUses: 10, unique: true });
            return interaction.reply({
                components: [new ContainerBuilder()
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`### <:Attach:1521228039135170722> Voice Channel Invite`))
                    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                        `**Channel:** ${channel.name}\n**Link:** ${inv.url}\n**Expires:** <t:${Math.floor(Date.now() / 1000) + 3600}:R>\n**Max Uses:** \`10\`\n\n-# Share this link to invite others`
                    ))
],
                flags: CV2_EPH
            });
        } catch {
            return interaction.reply(err('Invite Failed', 'Failed to create invite. Check bot permissions.'));
        }
    }

    if (action === 'info') {
        const mc = channel.members.size;
        const ul = channel.userLimit || 'Unlimited';
        const br = Math.round(channel.bitrate / 1000);
        const everyone = channel.permissionsFor(guild.id);
        const locked   = !everyone?.has(PermissionFlagsBits.Connect);
        const hidden   = !everyone?.has(PermissionFlagsBits.ViewChannel);
        const on  = '<:Toggleon:1521227758011809964>';
        const off = '<:Toggleoff:1521227763816595559>';
        const memberLine = channel.members.map(m => m.user.username).slice(0, 10).join(', ') || 'Empty';
        const trusted = entry?.trustedUsers?.length
            ? entry.trustedUsers.map(id => `<@${id}>`).join(', ')
            : '*None*';

        return interaction.reply({
            components: [new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(`### <:Document:1521227875016114266> Channel Information`))
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `### <:Volumeup:1521228004502536272> ${channel.name}\n` +
                    `**Owner:** <@${ownerId}>\n` +
                    `**Members:** \`${mc}${ul !== 'Unlimited' ? `/${ul}` : ''}\` · **Bitrate:** \`${br} kbps\` · **Region:** \`${channel.rtcRegion || 'Auto'}\`\n` +
                    `${locked ? on : off} **Locked** · ${hidden ? on : off} **Hidden** · **Created:** <t:${Math.floor(channel.createdTimestamp / 1000)}:R>\n\n` +
                    `**Currently in channel:** ${memberLine}${mc > 10 ? ` +${mc - 10} more` : ''}\n` +
                    `**Trusted co-owners:** ${trusted}`
                ))
],
            flags: CV2_EPH
        });
    }

    return interaction.reply(err('Unknown Action', `No handler for \`${action}\`.`));
}

async function handleClaim(interaction) {
    const guild  = interaction.guild;
    const member = interaction.member;
    const inVc   = member?.voice?.channel;
    if (!inVc) return interaction.reply(err('Not in a Channel', 'You must be in a temp voice channel to claim it.'));

    const ownerId = mgr.findOwnerByChannel(guild.id, inVc.id);
    if (!ownerId) return interaction.reply(err('Not a Temp Channel', 'This is not a Join-to-Create channel.'));
    if (ownerId === member.id) return interaction.reply(err('Already Owner', 'You already own this channel.'));

    if (inVc.members.has(ownerId)) {
        return interaction.reply(err('Owner Present', 'The current owner is still in the channel — you can only claim when they leave.'));
    }

    const result = mgr.transferOwnership(guild.id, ownerId, member.id);
    if (!result.ok) return interaction.reply(err('Claim Failed', result.error || 'Could not claim the channel.'));

    try {
        await inVc.permissionOverwrites.edit(member.id, OWNER_PERMS);
        await inVc.permissionOverwrites.edit(ownerId, MEMBER_PERMS);
    } catch (e) {
        log.error(`[J2C] Claim overwrite failed: ${e.message}`);
    }
    return interaction.reply(ok('Channel Claimed', '<:Crown:1521227739988889764> You are now the **owner** of this channel.'));
}

/* ═══════════════════════════════════════════════════════════════════
   USER-SELECT HANDLER
   ═══════════════════════════════════════════════════════════════════ */

async function handleJ2CSelects(interaction) {
    const id = interaction.customId;
    if (!id.startsWith('j2c_select_')) return false;

    const action = id.replace('j2c_select_', '');
    const ctx = resolveActionable(interaction);
    if (!ctx) {
        await interaction.update(err('No Active Channel', 'Your temporary voice channel is gone — pick from a panel inside the channel you own.'));
        return true;
    }
    const { channel, ownerId, role } = ctx;
    const guild  = interaction.guild;
    const target = interaction.guild.members.cache.get(interaction.values[0])
        || await interaction.guild.members.fetch(interaction.values[0]).catch(() => null);

    if (!target) {
        await interaction.update(err('User Not Found', 'Could not resolve that member.'));
        return true;
    }
    if (target.id === interaction.user.id) {
        await interaction.update(err('Invalid Target', 'You cannot pick yourself.'));
        return true;
    }
    if (target.user.bot) {
        await interaction.update(err('Invalid Target', 'You cannot run member actions on bots.'));
        return true;
    }

    try {
        if (action === 'kick') {
            if (!channel.members.has(target.id)) {
                await interaction.update(err('Not in Channel', `**${target.user.username}** is not in your channel.`));
                return true;
            }
            await target.voice.disconnect('J2C: kicked by owner');
            await interaction.update(ok('Kicked', `<:Microphoneoff:1521228303762063380> Kicked **${target.user.username}**.`));
            return true;
        }

        if (action === 'block') {
            await channel.permissionOverwrites.edit(target.id, { Connect: false, ViewChannel: false });
            if (channel.members.has(target.id)) await target.voice.disconnect('J2C: blocked').catch(() => {});
            // Sync the manager state: track the ban and strip co-owner status.
            mgr.addBannedUser(guild.id, ownerId, target.id);
            await interaction.update(ok('Blocked', `<:Commentblock:1521227898101432331> Blocked **${target.user.username}**.`));
            return true;
        }

        if (action === 'unblock') {
            await channel.permissionOverwrites.delete(target.id).catch(() => {});
            mgr.removeBannedUser(guild.id, ownerId, target.id);
            await interaction.update(ok('Unblocked', `<:Checkedbox:1521227734943269077> Unblocked **${target.user.username}**.`));
            return true;
        }

        if (action === 'permit') {
            await channel.permissionOverwrites.edit(target.id, { Connect: true, ViewChannel: true });
            await interaction.update(ok('Permitted', `<:Userplus:1521227719621218477> **${target.user.username}** can now bypass the lock.`));
            return true;
        }

        if (action === 'trust') {
            await channel.permissionOverwrites.edit(target.id, TRUSTED_PERMS);
            mgr.addTrustedUser(guild.id, ownerId, target.id);
            await interaction.update(ok('Trusted', `<:trust:1521228380454916096> **${target.user.username}** is now a co-owner.`));
            return true;
        }

        if (action === 'untrust') {
            await channel.permissionOverwrites.edit(target.id, MEMBER_PERMS);
            mgr.removeTrustedUser(guild.id, ownerId, target.id);
            await interaction.update(ok('Untrusted', `<:untrust:1521228385794261105> Removed co-owner status from **${target.user.username}**.`));
            return true;
        }

        if (action === 'transfer') {
            if (role !== 'owner' && role !== 'staff') {
                await interaction.update(err('Permission Denied', 'Only the owner or server staff can transfer ownership.'));
                return true;
            }
            if (!channel.members.has(target.id)) {
                await interaction.update(err('Not in Channel', `**${target.user.username}** must be in the channel to receive ownership.`));
                return true;
            }
            const r = mgr.transferOwnership(guild.id, ownerId, target.id);
            if (!r.ok) {
                await interaction.update(err('Transfer Failed', r.error || 'Could not transfer ownership.'));
                return true;
            }
            await channel.permissionOverwrites.edit(ownerId, MEMBER_PERMS);
            await channel.permissionOverwrites.edit(target.id, OWNER_PERMS);
            await interaction.update(ok('Transferred', `<:transfer:1521228019824590948> Ownership transferred to **${target.user.username}**.`));
            return true;
        }
    } catch (e) {
        log.error(`[J2C] Select action ${action} failed: ${e.message}`);
        await interaction.update(err('Action Failed', e.message || 'Unknown error.')).catch(() => {});
        return true;
    }

    return false;
}

/* ═══════════════════════════════════════════════════════════════════
   MODAL HANDLER
   ═══════════════════════════════════════════════════════════════════ */

async function handleJ2CModals(interaction) {
    const action = interaction.customId.replace('j2c_', '').replace('_modal', '');
    const ctx = resolveActionable(interaction);
    if (!ctx) return interaction.reply(err('No Active Channel', 'Your temporary voice channel is gone.'));
    const { channel } = ctx;
    const guild = interaction.guild;

    if (action === 'rename') {
        const name = interaction.fields.getTextInputValue('channel_name').slice(0, 100);
        await channel.setName(name).catch(() => {});
        return interaction.reply(ok('Renamed', `<:Editalt:1521227921673556019> Channel renamed to **${name}**.`));
    }

    if (action === 'limit') {
        const n = mgr.clampInt(interaction.fields.getTextInputValue('user_limit'), 0, 99, NaN);
        if (Number.isNaN(n)) return interaction.reply(err('Invalid Limit', 'Must be **0–99**. Use `0` for unlimited.'));
        await channel.setUserLimit(n);
        return interaction.reply(ok('Limit Set', `<:User:1521227714227343380> User limit set to **${n === 0 ? 'Unlimited' : n}**.`));
    }

    if (action === 'bitrate') {
        const n = mgr.clampInt(interaction.fields.getTextInputValue('bitrate'), 8, 384, NaN);
        if (Number.isNaN(n)) return interaction.reply(err('Invalid Bitrate', 'Must be **8–384** kbps.'));
        const max = guild.premiumTier >= 3 ? 384 : guild.premiumTier >= 2 ? 256 : guild.premiumTier >= 1 ? 128 : 96;
        const final = Math.min(n, max);
        await channel.setBitrate(final * 1000);
        return interaction.reply(ok('Bitrate Set', `<:Volumeup:1521228004502536272> Bitrate set to **${final} kbps**.`));
    }

    if (action === 'region') {
        const input = interaction.fields.getTextInputValue('region').toLowerCase().trim();
        const valid = ['auto', 'us-west', 'us-east', 'us-central', 'us-south', 'eu-west', 'eu-central', 'singapore', 'brazil', 'hongkong', 'russia', 'japan', 'southafrica', 'sydney', 'india'];
        if (!valid.includes(input)) {
            return interaction.reply(err('Invalid Region', `Valid: \`${valid.join('`, `')}\``));
        }
        try {
            await channel.setRTCRegion(input === 'auto' ? null : input);
            return interaction.reply(ok('Region Set', `<:rocket:1521228374805057756> Region set to **${input === 'auto' ? 'Automatic' : input}**.`));
        } catch {
            return interaction.reply(err('Region Failed', 'Failed to change voice region.'));
        }
    }

    return interaction.reply(err('Unknown Action', `No handler for \`${action}\`.`));
}

/* ═══════════════════════════════════════════════════════════════════
   EXPORTS
   ═══════════════════════════════════════════════════════════════════ */

module.exports = {
    handleVoiceStateUpdate,
    handleJ2CButtons,
    handleJ2CSelects,
    handleJ2CModals
};
