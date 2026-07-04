'use strict';

/**
 * Join-to-Create Setup (multi-interface dashboard)
 * ───────────────────────────────────────────────────────────────────
 * Each interface is a self-contained pairing of one trigger VC and
 * one control panel. Free guilds can run 1; premium guilds up to 10.
 *
 * Custom-ID layout (so the index.js router can dispatch reliably):
 *   j2cset_main_<action>                      — top-level dashboard buttons
 *   j2cset_iface_<action>_<interfaceId>       — per-interface buttons
 *   j2cset_select_iface_<action>              — string-select interface picker
 *   j2cset_select_trigger_<interfaceId>       — channel-select for trigger VC
 *   j2cset_select_panel_<interfaceId>         — channel-select for control panel
 *   j2cset_select_category_<interfaceId>      — channel-select for spawn category
 *   j2cset_select_roles_<interfaceId>         — role-select for allowed roles
 *   j2cset_modal_create                       — modal for new interface
 *   j2cset_modal_edit_<interfaceId>           — modal for editing defaults
 */

const {
    SlashCommandBuilder, PermissionFlagsBits, ChannelType,
    ContainerBuilder, TextDisplayBuilder, MessageFlags,
    ActionRowBuilder, ButtonBuilder, ButtonStyle,
    SeparatorBuilder, SeparatorSpacingSize,
    ChannelSelectMenuBuilder, RoleSelectMenuBuilder, StringSelectMenuBuilder,
    ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');

const {
    buildSuccessResponse, buildErrorResponse, buildPermissionDenied,
    buildPremiumGate, BRANDING
} = require('../../utils/responseBuilder');
const { registerPanel, updatePanel } = require('../../utils/panelRegistry');
const mgr = require('../../utils/join2createManager');

const CV2     = MessageFlags.IsComponentsV2;
const CV2_EPH = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;

/* ═══════════════════════════════════════════════════════════════════
   PUBLIC CONTROL PANEL (rendered in each interface's text channel)
   ═══════════════════════════════════════════════════════════════════ */

function buildControlPanel() {
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('j2c_rename').setEmoji('<:Editalt:1521227921673556019>').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('j2c_limit').setEmoji('<:User:1521227714227343380>').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('j2c_bitrate').setEmoji('<:Volumeup:1521228004502536272>').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('j2c_invite').setEmoji('<:Attach:1521228039135170722>').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('j2c_region').setEmoji('<:rocket:1521228374805057756>').setStyle(ButtonStyle.Primary)
    );
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('j2c_lock').setEmoji('<:Lock:1521227892770734120>').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('j2c_unlock').setEmoji('<:Unlock:1521228030842769610>').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('j2c_hide').setEmoji('<:Eyeclosed:1521228356463362291>').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('j2c_unhide').setEmoji('<:Eye:1521227940480815156>').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('j2c_info').setEmoji('<:Document:1521227875016114266>').setStyle(ButtonStyle.Secondary)
    );
    const row3 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('j2c_kick').setEmoji('<:dnd:1521228070701502486>').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('j2c_block').setEmoji('<:Commentblock:1521227898101432331>').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('j2c_unblock').setEmoji('<:Checkedbox:1521227734943269077>').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('j2c_permit').setEmoji('<:Userplus:1521227719621218477>').setStyle(ButtonStyle.Success)
    );
    const row4 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('j2c_trust').setEmoji('<:trust:1521228380454916096>').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('j2c_untrust').setEmoji('<:untrust:1521228385794261105>').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('j2c_claim').setEmoji('<:Crown:1521227739988889764>').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('j2c_transfer').setEmoji('<:transfer:1521228019824590948>').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('j2c_delete').setEmoji('<:Trash:1521227750420254820>').setStyle(ButtonStyle.Danger)
    );

    const header = `## <:Volumeup:1521228004502536272>  Voice Channel Controls`;
    const intro  = `-# Owner-only · Hover any button for its action`;
    const legend = [
        `<:Settings:1521227767780343879> **Channel** — Rename · Limit · Bitrate · Invite · Region`,
        `<:Key:1521228000467878111> **Privacy** — Lock · Unlock · Hide · Unhide · Info`,
        `<:User:1521227714227343380> **Members** — Kick · Block · Unblock · Permit`,
        `<:Crown:1521227739988889764> **Ownership** — Trust · Untrust · Claim · Transfer · Delete`
    ].join('\n');

    return new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`${header}\n${intro}`))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(legend))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addActionRowComponents(row1, row2, row3, row4)
}

/* ═══════════════════════════════════════════════════════════════════
   ADMIN DASHBOARD (list view)
   ═══════════════════════════════════════════════════════════════════ */

function buildAdminDashboard(guild, requesterUserId) {
    const tier      = mgr.getGuildTier(guild.id, requesterUserId);
    const isPremium = tier === 'premium';
    const max       = mgr.maxInterfacesFor(tier);
    const ifaces    = mgr.listInterfaces(guild.id);
    const enabled   = ifaces.filter(i => i.enabled !== false).length;
    const activeCount = Object.keys(mgr.getGuildConfig(guild.id).activeChannels || {}).length;

    const tierLine = isPremium
        ? `<:Crown:1521227739988889764> **Premium Server**`
        : `<:Star:1521227981685526568> **Free Server**`;

    const header =
        `# <:Volumeup:1521228004502536272> Join-to-Create — Setup\n` +
        `-# ${tierLine}  ·  Interfaces: \`${ifaces.length}/${max}\`  ·  Enabled: \`${enabled}\`  ·  Active temp VCs: \`${activeCount}\``;

    let body;
    if (ifaces.length === 0) {
        body =
            `### <:Infotriangle:1521227710381428926> No interfaces yet\n` +
            `> Click **Quick Setup** to auto-create your first trigger VC + control panel, or **+ New Interface** to configure manually.\n\n` +
            `### <:Lightbulbalt:1521227880703463675> What you get\n` +
            (isPremium
                ? `> <:Crown:1521227739988889764> Up to **${mgr.MAX_INTERFACES_PREMIUM}** interfaces with custom names, role gating, and per-interface defaults.`
                : `> Free servers can run **${mgr.MAX_INTERFACES_FREE}** interface. Premium unlocks **${mgr.MAX_INTERFACES_PREMIUM}** + role gating.`);
    } else {
        const lines = ifaces.map(i => {
            const state = i.enabled === false
                ? '<:Toggleoff:1521227763816595559>'
                : '<:Toggleon:1521227758011809964>';
            const triggers = (i.triggerChannelIds || []).length
                ? i.triggerChannelIds.map(id => `<#${id}>`).join(' ')
                : '`No triggers`';
            const panel = i.interfaceChannelId ? `<#${i.interfaceChannelId}>` : '`No panel`';
            return `${state} ${i.emoji} **${i.name}**  ·  Panel: ${panel}\n` +
                   `> Triggers: ${triggers}\n` +
                   `-# Limit \`${i.defaultUserLimit || '∞'}\` · Bitrate \`${i.defaultBitrate}kbps\` · Max VCs \`${i.maxConcurrentChannels ? i.maxConcurrentChannels : '∞'}\` · ${i.defaultVisibility === 'private' ? 'Private' : 'Public'} · Auto-delete \`${i.autoDelete ? 'On' : 'Off'}\``;
        }).join('\n\n');
        body = `### <:Bookopen:1521227911137595605> Interfaces\n${lines}`;
    }

    const container = new ContainerBuilder()
        .setAccentColor(isPremium ? 0xF1C40F : 0x5865F2)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(header))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(body))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

    // Interface picker (when there's at least one)
    if (ifaces.length > 0) {
        const opts = ifaces.slice(0, 25).map(i => ({
            label:       i.name.slice(0, 100),
            description: ((i.triggerChannelIds?.length)
                ? `${i.triggerChannelIds.length} trigger${i.triggerChannelIds.length === 1 ? '' : 's'}`
                : 'No triggers set').slice(0, 100),
            value:       i.id
        }));
        container.addActionRowComponents(new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('j2cset_select_iface_pick')
                .setPlaceholder('Edit an interface…')
                .addOptions(opts)
        ));
    }

    const newDisabled = ifaces.length >= max;
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('j2cset_main_quick')
            .setLabel('Quick Setup')
            .setStyle(ButtonStyle.Success)
            .setEmoji('<:Lightning:1521227915537285150>')
            .setDisabled(newDisabled),
        new ButtonBuilder()
            .setCustomId('j2cset_main_new')
            .setLabel(newDisabled ? `+ New Interface (${isPremium ? 'cap reached' : 'premium only'})` : '+ New Interface')
            .setStyle(newDisabled ? ButtonStyle.Secondary : ButtonStyle.Primary)
            .setEmoji('<:Add:1521227828199293152>')
            .setDisabled(newDisabled),
        new ButtonBuilder()
            .setCustomId('j2cset_main_refresh')
            .setLabel('Refresh')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('<:History:1521227863079256278>'),
        new ButtonBuilder()
            .setCustomId('j2cset_main_reset')
            .setLabel('Disable All')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('<:Trash:1521227750420254820>')
            .setDisabled(ifaces.length === 0)
    );
    container.addActionRowComponents(row1);

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    return container;
}

/* ═══════════════════════════════════════════════════════════════════
   INTERFACE EDITOR (per-interface view)
   ═══════════════════════════════════════════════════════════════════ */

function buildInterfaceEditor(guild, iface, requesterUserId) {
    const isPremium = mgr.isPremium(guild.id, requesterUserId);

    const triggers = (iface.triggerChannelIds || []).length
        ? iface.triggerChannelIds.map(id => `<#${id}>`).join(' ')
        : '`Not set`';
    const panel   = iface.interfaceChannelId ? `<#${iface.interfaceChannelId}>` : '`Not set`';
    const cat     = iface.categoryId         ? `<#${iface.categoryId}>`         : '`Inherit from trigger`';
    const status  = iface.enabled === false
        ? '<:Toggleoff:1521227763816595559> Disabled'
        : '<:Toggleon:1521227758011809964> Enabled';

    let body =
        `# ${iface.emoji} ${iface.name}\n` +
        `-# Interface ID \`${iface.id}\`  ·  ${status}\n\n` +
        `### <:Settings:1521227767780343879> Channels\n` +
        `> **Trigger VCs:** ${triggers}\n` +
        `> **Control Panel:** ${panel}\n` +
        `> **Spawn Category:** ${cat}\n\n` +
        `### <:Document:1521227875016114266> Defaults\n` +
        `> **Naming:** \`${iface.namingTemplate}\`\n` +
        `> **User limit:** \`${iface.defaultUserLimit === 0 ? 'Unlimited' : iface.defaultUserLimit}\`  ·  **Bitrate:** \`${iface.defaultBitrate} kbps\`\n` +
        `> **Max temp channels:** \`${iface.maxConcurrentChannels ? iface.maxConcurrentChannels : 'Unlimited'}\`\n` +
        `> **Visibility:** \`${iface.defaultVisibility}\`  ·  **Auto-delete when empty:** \`${iface.autoDelete ? 'On' : 'Off'}\`\n`;

    if (iface.allowedRoles?.length) {
        body += `> **Allowed roles:** ${iface.allowedRoles.map(r => `<@&${r}>`).join(', ')}\n`;
    }

    const container = new ContainerBuilder()
        .setAccentColor(iface.enabled === false ? 0xED4245 : (isPremium ? 0xF1C40F : 0x5865F2))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(body))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`j2cset_iface_trigger_${iface.id}`).setLabel('Set Trigger VCs').setStyle(ButtonStyle.Primary).setEmoji('<:Volumeup:1521228004502536272>'),
        new ButtonBuilder().setCustomId(`j2cset_iface_panel_${iface.id}`).setLabel('Set Panel Channel').setStyle(ButtonStyle.Primary).setEmoji('<:Document:1521227875016114266>'),
        new ButtonBuilder().setCustomId(`j2cset_iface_category_${iface.id}`).setLabel('Set Category').setStyle(ButtonStyle.Secondary).setEmoji('<:Bookopen:1521227911137595605>'),
        new ButtonBuilder().setCustomId(`j2cset_iface_send_${iface.id}`).setLabel('Send Panel').setStyle(ButtonStyle.Success).setEmoji('<:Add:1521227828199293152>').setDisabled(!iface.interfaceChannelId)
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`j2cset_iface_edit_${iface.id}`).setLabel('Edit Defaults').setStyle(ButtonStyle.Secondary).setEmoji('<:Editalt:1521227921673556019>'),
        new ButtonBuilder().setCustomId(`j2cset_iface_visibility_${iface.id}`).setLabel(iface.defaultVisibility === 'private' ? 'Default: Public' : 'Default: Private').setStyle(ButtonStyle.Secondary).setEmoji(iface.defaultVisibility === 'private' ? '<:Eye:1521227940480815156>' : '<:Eyeclosed:1521228356463362291>'),
        new ButtonBuilder().setCustomId(`j2cset_iface_autodelete_${iface.id}`).setLabel(iface.autoDelete ? 'Auto-delete: On' : 'Auto-delete: Off').setStyle(ButtonStyle.Secondary).setEmoji(iface.autoDelete ? '<:Toggleon:1521227758011809964>' : '<:Toggleoff:1521227763816595559>'),
        new ButtonBuilder().setCustomId(`j2cset_iface_roles_${iface.id}`).setLabel(isPremium ? 'Allowed Roles' : 'Allowed Roles (Premium)').setStyle(ButtonStyle.Secondary).setEmoji('<:Crown:1521227739988889764>').setDisabled(!isPremium)
    );

    const row3 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`j2cset_iface_toggle_${iface.id}`).setLabel(iface.enabled === false ? 'Enable' : 'Disable').setStyle(iface.enabled === false ? ButtonStyle.Success : ButtonStyle.Danger).setEmoji(iface.enabled === false ? '<:Toggleon:1521227758011809964>' : '<:Toggleoff:1521227763816595559>'),
        new ButtonBuilder().setCustomId('j2cset_main_back').setLabel('Back').setStyle(ButtonStyle.Secondary).setEmoji('<:Caretright:1521227704953864202>'),
        new ButtonBuilder().setCustomId(`j2cset_iface_delete_${iface.id}`).setLabel('Delete Interface').setStyle(ButtonStyle.Danger).setEmoji('<:Trash:1521227750420254820>')
    );

    container.addActionRowComponents(row1, row2, row3);
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    return container;
}

/* ═══════════════════════════════════════════════════════════════════
   ENTRY POINTS
   ═══════════════════════════════════════════════════════════════════ */

async function showDashboard(replyTarget, guild, requesterUserId) {
    const container = buildAdminDashboard(guild, requesterUserId);
    const sent = await replyTarget.reply({ components: [container], flags: CV2 });
    let msg = sent;
    if (typeof replyTarget.fetchReply === 'function') {
        try { msg = await replyTarget.fetchReply(); } catch {}
    }
    if (msg?.id && msg?.channel?.id) {
        registerPanel(guild.id, 'join2create-setup', msg.channel.id, msg.id);
    }
    return msg;
}

async function refreshDashboard(client, guild, requesterUserId) {
    return updatePanel(client, guild.id, 'join2create-setup', async (m) => {
        await m.edit({ components: [buildAdminDashboard(guild, requesterUserId)] });
    }).catch(() => null);
}

/* ═══════════════════════════════════════════════════════════════════
   COMMAND
   ═══════════════════════════════════════════════════════════════════ */

module.exports = {
    data: new SlashCommandBuilder()
        .setName('join2create-setup')
        .setDescription('Configure Join-to-Create voice interfaces')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(s => s.setName('panel').setDescription('Open the admin dashboard'))
        .addSubcommand(s => s.setName('quick-enable').setDescription('Auto-create one trigger VC + control panel'))
        .addSubcommand(s => s.setName('disable').setDescription('Disable + remove every interface'))
        .addSubcommand(s => s.setName('status').setDescription('Show a quick status summary')),

    name: 'join2create-setup',
    prefix: 'join2create-setup',
    description: 'Configure Join-to-Create voice interfaces',
    usage: 'join2create-setup [panel|quick-enable|disable|status]',
    category: 'voice',
    aliases: ['j2c', 'j2csetup'],

    buildControlPanel,

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        if (sub === 'quick-enable') return quickEnable(interaction);
        if (sub === 'disable')      return disableAll(interaction);
        if (sub === 'status')       return statusSummary(interaction);
        return showDashboard(interaction, interaction.guild, interaction.user.id);
    },

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply({ components: [buildPermissionDenied('Administrator')], flags: CV2 });
        }
        const sub = (args[0] || '').toLowerCase();
        if (sub === 'enable' || sub === 'quick-enable') return quickEnable(message);
        if (sub === 'disable')                          return disableAll(message);
        if (sub === 'status')                           return statusSummary(message);
        return showDashboard(message, message.guild, message.author.id);
    },

    async handleInteraction(interaction) {
        if (!interaction.guild || !interaction.member) return false;
        const id = interaction.customId;
        if (!id || !id.startsWith('j2cset_')) return false;

        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            await interaction.reply({ components: [buildPermissionDenied('Administrator')], flags: CV2_EPH });
            return true;
        }

        // ── Top-level dashboard buttons ────────────────────────────
        if (id === 'j2cset_main_refresh' || id === 'j2cset_main_back') {
            await interaction.update({ components: [buildAdminDashboard(interaction.guild, interaction.user.id)], flags: CV2 });
            return true;
        }
        if (id === 'j2cset_main_quick') return runQuickSetup(interaction);
        if (id === 'j2cset_main_new')   return openCreateModal(interaction);
        if (id === 'j2cset_main_reset')     return confirmReset(interaction);
        if (id === 'j2cset_main_reset_yes') return doReset(interaction);

        // ── Interface picker (string select) ───────────────────────
        if (interaction.isStringSelectMenu?.() && id === 'j2cset_select_iface_pick') {
            const ifaceId = interaction.values[0];
            const iface = mgr.getInterface(interaction.guild.id, ifaceId);
            if (!iface) {
                await interaction.update({ components: [buildErrorResponse('Not Found', 'That interface no longer exists.')], flags: CV2 });
                return true;
            }
            await interaction.update({ components: [buildInterfaceEditor(interaction.guild, iface, interaction.user.id)], flags: CV2 });
            return true;
        }

        // ── Per-interface buttons (j2cset_iface_<action>_<id>) ─────
        if (id.startsWith('j2cset_iface_')) {
            const rest = id.slice('j2cset_iface_'.length);
            const firstUnderscore = rest.indexOf('_');
            if (firstUnderscore < 0) return false;
            const action  = rest.slice(0, firstUnderscore);
            const ifaceId = rest.slice(firstUnderscore + 1);
            const iface = mgr.getInterface(interaction.guild.id, ifaceId);
            if (!iface) {
                await interaction.reply({ components: [buildErrorResponse('Not Found', 'That interface no longer exists.')], flags: CV2_EPH });
                return true;
            }

            if (action === 'trigger')    return openTriggerSelect(interaction, iface);
            if (action === 'panel')      return openPanelSelect(interaction, iface);
            if (action === 'category')   return openCategorySelect(interaction, iface);
            if (action === 'send')       return sendControlPanelToInterface(interaction, iface);
            if (action === 'edit')       return openEditModal(interaction, iface);
            if (action === 'visibility') return toggleVisibility(interaction, iface);
            if (action === 'autodelete') return toggleAutoDelete(interaction, iface);
            if (action === 'roles')      return openRolesSelect(interaction, iface);
            if (action === 'toggle')     return toggleEnabled(interaction, iface);
            if (action === 'delete')     return confirmDeleteIface(interaction, iface);
            if (action === 'deleteyes')  return doDeleteIface(interaction, iface);
        }

        // ── Channel/role select results ────────────────────────────
        if (interaction.isChannelSelectMenu?.() && id.startsWith('j2cset_select_trigger_'))
            return saveTrigger(interaction, id.slice('j2cset_select_trigger_'.length));
        if (interaction.isChannelSelectMenu?.() && id.startsWith('j2cset_select_panel_'))
            return savePanelChannel(interaction, id.slice('j2cset_select_panel_'.length));
        if (interaction.isChannelSelectMenu?.() && id.startsWith('j2cset_select_category_'))
            return saveCategory(interaction, id.slice('j2cset_select_category_'.length));
        if (interaction.isRoleSelectMenu?.() && id.startsWith('j2cset_select_roles_'))
            return saveAllowedRoles(interaction, id.slice('j2cset_select_roles_'.length));

        return false;
    },

    async handleModalSubmit(interaction) {
        if (!interaction.isModalSubmit?.()) return false;
        if (!interaction.customId.startsWith('j2cset_modal_')) return false;
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            await interaction.reply({ components: [buildPermissionDenied('Administrator')], flags: CV2_EPH });
            return true;
        }

        const id = interaction.customId;

        if (id === 'j2cset_modal_create') {
            const name        = interaction.fields.getTextInputValue('name').trim();
            const naming      = interaction.fields.getTextInputValue('naming').trim();
            const limit       = interaction.fields.getTextInputValue('limit').trim();
            const bitrate     = interaction.fields.getTextInputValue('bitrate').trim();
            const maxChannels = (interaction.fields.getTextInputValue('maxchannels') || '0').trim();

            const r = mgr.createInterface(interaction.guild.id, interaction.user.id, {
                name, namingTemplate: naming,
                defaultUserLimit: limit, defaultBitrate: bitrate,
                maxConcurrentChannels: maxChannels
            });
            if (!r.ok) {
                if (r.tier !== 'premium') {
                    await interaction.reply({ components: [buildPremiumGate('multiple Join-to-Create interfaces')], flags: CV2_EPH });
                } else {
                    await interaction.reply({ components: [buildErrorResponse('Could Not Create', r.error)], flags: CV2_EPH });
                }
                return true;
            }
            await interaction.reply({ components: [buildInterfaceEditor(interaction.guild, r.iface, interaction.user.id)], flags: CV2_EPH });
            refreshDashboard(interaction.client, interaction.guild, interaction.user.id);
            return true;
        }

        if (id.startsWith('j2cset_modal_edit_')) {
            const ifaceId = id.slice('j2cset_modal_edit_'.length);
            const patch = {
                name:                  interaction.fields.getTextInputValue('name').trim(),
                namingTemplate:        interaction.fields.getTextInputValue('naming').trim(),
                defaultUserLimit:      interaction.fields.getTextInputValue('limit').trim(),
                defaultBitrate:        interaction.fields.getTextInputValue('bitrate').trim(),
                maxConcurrentChannels: (interaction.fields.getTextInputValue('maxchannels') || '0').trim()
            };
            const r = mgr.updateInterface(interaction.guild.id, ifaceId, patch);
            if (!r.ok) {
                await interaction.reply({ components: [buildErrorResponse('Update Failed', r.error)], flags: CV2_EPH });
                return true;
            }
            await interaction.reply({ components: [buildInterfaceEditor(interaction.guild, r.iface, interaction.user.id)], flags: CV2_EPH });
            refreshDashboard(interaction.client, interaction.guild, interaction.user.id);
            return true;
        }

        return false;
    }
};

/* ═══════════════════════════════════════════════════════════════════
   ACTION HELPERS
   ═══════════════════════════════════════════════════════════════════ */

async function quickEnable(target) {
    const guild = target.guild;
    const requesterId = target.user?.id || target.author?.id;
    return runQuickSetupForTarget(target, guild, requesterId);
}

async function runQuickSetup(interaction) {
    return runQuickSetupForTarget(interaction, interaction.guild, interaction.user.id);
}

async function runQuickSetupForTarget(target, guild, requesterUserId) {
    const gate = mgr.canAddInterface(guild.id, requesterUserId);
    if (!gate.ok) {
        const reply = {
            components: [gate.tier === 'premium'
                ? buildErrorResponse('Cap Reached', gate.reason)
                : buildPremiumGate('multiple Join-to-Create interfaces')],
            flags: CV2_EPH
        };
        if (target.update) return target.update(reply);
        return target.reply ? target.reply(reply) : null;
    }

    let triggerChannel, interfaceChannel;
    try {
        triggerChannel = await guild.channels.create({
            name: 'Join to Create',
            type: ChannelType.GuildVoice,
            position: 0
        });
        interfaceChannel = await guild.channels.create({
            name: 'voice-controls',
            type: ChannelType.GuildText,
            topic: 'Use these controls inside the temp voice channel you own.',
            position: 0
        });
        const controlMsg = await interfaceChannel.send({
            components: [buildControlPanel()],
            flags: CV2
        });

        // Re-check the cap atomically: another admin could have raced to
        // claim the last slot between `canAddInterface` above and now.
        const r = mgr.createInterface(guild.id, requesterUserId, {
            name: 'Default',
            triggerChannelIds:     [triggerChannel.id],
            interfaceChannelId:    interfaceChannel.id,
            controlPanelMessageId: controlMsg.id
        });
        if (!r.ok) {
            // Roll back the channels we just created so we don't leak orphans.
            try { await triggerChannel.delete().catch(() => {}); } catch {}
            try { await interfaceChannel.delete().catch(() => {}); } catch {}
            const reply = {
                components: [r.tier === 'premium'
                    ? buildErrorResponse('Cap Reached', r.error)
                    : buildPremiumGate('multiple Join-to-Create interfaces')],
                flags: CV2_EPH
            };
            if (target.update) return target.update(reply);
            return target.reply ? target.reply(reply) : null;
        }
    } catch (e) {
        try { triggerChannel?.delete(); } catch {}
        try { interfaceChannel?.delete(); } catch {}
        const reply = { components: [buildErrorResponse('Setup Failed', e.message || 'Failed to create channels.')], flags: CV2 };
        if (target.update) return target.update(reply);
        return target.reply ? target.reply(reply) : null;
    }

    const ok = {
        components: [buildSuccessResponse(
            'Join-to-Create Enabled',
            `**Trigger:** ${triggerChannel}\n**Controls:** ${interfaceChannel}\n\nMembers join the trigger to spawn a personal temp VC. Open \`/join2create-setup panel\` for the dashboard or to add more interfaces.`
        )],
        flags: CV2
    };
    if (target.update) {
        await target.update({ components: [buildAdminDashboard(guild, requesterUserId)], flags: CV2 });
        return target.followUp ? target.followUp({ ...ok, flags: CV2_EPH }) : null;
    }
    return target.reply ? target.reply(ok) : null;
}

async function disableAll(target) {
    const guild = target.guild;
    const cfg = mgr.getGuildConfig(guild.id);
    const ifaces = Object.values(cfg.interfaces || {});

    for (const iface of ifaces) {
        for (const tid of (iface.triggerChannelIds || [])) {
            const ch = guild.channels.cache.get(tid);
            if (ch) try { await ch.delete('J2C: disabled'); } catch {}
        }
        if (iface.interfaceChannelId) {
            const ch = guild.channels.cache.get(iface.interfaceChannelId);
            if (ch) try { await ch.delete('J2C: disabled'); } catch {}
        }
    }
    mgr.deleteGuildConfig(guild.id);

    const reply = {
        components: [buildSuccessResponse('System Disabled', `${ifaces.length} interface${ifaces.length === 1 ? '' : 's'} removed and channels deleted.`)],
        flags: CV2
    };
    return target.reply ? target.reply(reply) : null;
}

async function statusSummary(target) {
    const guild = target.guild;
    const requesterId = target.user?.id || target.author?.id;
    const tier = mgr.getGuildTier(guild.id, requesterId);
    const ifaces = mgr.listInterfaces(guild.id);
    const active = Object.keys(mgr.getGuildConfig(guild.id).activeChannels || {}).length;

    const lines = [
        `# <:Volumeup:1521228004502536272> Join-to-Create Status`,
        `-# ${tier === 'premium' ? '<:Crown:1521227739988889764> Premium server' : '<:Star:1521227981685526568> Free server'}`,
        ``,
        `**Interfaces:** \`${ifaces.length}/${mgr.maxInterfacesFor(tier)}\``,
        `**Active temp channels:** \`${active}\``
    ];
    if (ifaces.length > 0) {
        lines.push(``, `### Interfaces`);
        for (const i of ifaces) {
            const triggers = (i.triggerChannelIds || []).length
                ? i.triggerChannelIds.map(id => `<#${id}>`).join(' ')
                : '`Not set`';
            lines.push(`> ${i.enabled === false ? '<:Toggleoff:1521227763816595559>' : '<:Toggleon:1521227758011809964>'} ${i.emoji} **${i.name}** — ${triggers}`);
        }
    }

    const container = new ContainerBuilder()
        .setAccentColor(tier === 'premium' ? 0xF1C40F : 0x5865F2)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')))
;

    const reply = { components: [container], flags: CV2_EPH };
    return target.reply ? target.reply(reply) : null;
}

/* ── New / edit modals ────────────────────────────────────────────── */

async function openCreateModal(interaction) {
    const gate = mgr.canAddInterface(interaction.guild.id, interaction.user.id);
    if (!gate.ok) {
        const reply = {
            components: [gate.tier === 'premium'
                ? buildErrorResponse('Cap Reached', gate.reason)
                : buildPremiumGate('multiple Join-to-Create interfaces')],
            flags: CV2_EPH
        };
        await interaction.reply(reply);
        return true;
    }

    const modal = new ModalBuilder()
        .setCustomId('j2cset_modal_create')
        .setTitle('New J2C Interface')
        .addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder()
                .setCustomId('name').setLabel('Interface Name').setStyle(TextInputStyle.Short)
                .setPlaceholder('e.g. Duo Rooms').setMaxLength(50).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder()
                .setCustomId('naming').setLabel('Naming Template').setStyle(TextInputStyle.Short)
                .setPlaceholder("{user}'s Channel").setMaxLength(80).setValue("{user}'s Channel").setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder()
                .setCustomId('limit').setLabel('Default User Limit (0-99, 0 = unlimited)').setStyle(TextInputStyle.Short)
                .setPlaceholder('0').setMaxLength(2).setValue('0').setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder()
                .setCustomId('bitrate').setLabel('Default Bitrate (8-384 kbps)').setStyle(TextInputStyle.Short)
                .setPlaceholder('96').setMaxLength(3).setValue('96').setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder()
                .setCustomId('maxchannels').setLabel('Max Temp Channels (0-99, 0 = unlimited)').setStyle(TextInputStyle.Short)
                .setPlaceholder('0').setMaxLength(2).setValue('0').setRequired(true))
        );
    return interaction.showModal(modal);
}

async function openEditModal(interaction, iface) {
    const modal = new ModalBuilder()
        .setCustomId(`j2cset_modal_edit_${iface.id}`)
        .setTitle(`Edit ${iface.name}`.slice(0, 45))
        .addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder()
                .setCustomId('name').setLabel('Interface Name').setStyle(TextInputStyle.Short)
                .setValue(iface.name).setMaxLength(50).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder()
                .setCustomId('naming').setLabel('Naming Template').setStyle(TextInputStyle.Short)
                .setValue(iface.namingTemplate).setMaxLength(80).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder()
                .setCustomId('limit').setLabel('Default User Limit (0-99, 0 = unlimited)').setStyle(TextInputStyle.Short)
                .setValue(String(iface.defaultUserLimit)).setMaxLength(2).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder()
                .setCustomId('bitrate').setLabel('Default Bitrate (8-384 kbps)').setStyle(TextInputStyle.Short)
                .setValue(String(iface.defaultBitrate)).setMaxLength(3).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder()
                .setCustomId('maxchannels').setLabel('Max Temp Channels (0-99, 0 = unlimited)').setStyle(TextInputStyle.Short)
                .setValue(String(iface.maxConcurrentChannels || 0)).setMaxLength(2).setRequired(true))
        );
    return interaction.showModal(modal);
}

/* ── Channel / role pickers ───────────────────────────────────────── */

async function openTriggerSelect(interaction, iface) {
    const current = (iface.triggerChannelIds || []).length;
    const c = new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `### <:Volumeup:1521228004502536272> Pick Trigger Voice Channels\n` +
            `-# Members joining **any** of these VCs will spawn a personal temp channel for **${iface.name}**.\n` +
            `-# Pick up to 25 voice channels. Select **none** to clear.${current ? `\n-# Currently configured: \`${current}\`.` : ''}`
        ))
        .addActionRowComponents(new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
                .setCustomId(`j2cset_select_trigger_${iface.id}`)
                .setPlaceholder('Select voice channels…')
                .setChannelTypes(ChannelType.GuildVoice)
                .setMinValues(0)
                .setMaxValues(25)
                .setDefaultChannels(iface.triggerChannelIds || [])
        ))
        .addActionRowComponents(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('j2cset_main_back').setLabel('Back').setStyle(ButtonStyle.Secondary).setEmoji('<:Caretright:1521227704953864202>')
        ));
    return interaction.update({ components: [c], flags: CV2 });
}

async function saveTrigger(interaction, ifaceId) {
    const channelIds = interaction.values || [];
    const r = mgr.updateInterface(interaction.guild.id, ifaceId, { triggerChannelIds: channelIds });
    if (!r.ok) {
        await interaction.update({ components: [buildErrorResponse('Update Failed', r.error)], flags: CV2 });
        return true;
    }
    await interaction.update({ components: [buildInterfaceEditor(interaction.guild, r.iface, interaction.user.id)], flags: CV2 });
    refreshDashboard(interaction.client, interaction.guild, interaction.user.id);
    return true;
}

async function openPanelSelect(interaction, iface) {
    const c = new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `### <:Document:1521227875016114266> Pick Control Panel Channel\n-# The voice control panel for **${iface.name}** will be posted here. Pick any text channel.`
        ))
        .addActionRowComponents(new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
                .setCustomId(`j2cset_select_panel_${iface.id}`)
                .setPlaceholder('Select a text channel…')
                .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        ))
        .addActionRowComponents(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('j2cset_main_back').setLabel('Back').setStyle(ButtonStyle.Secondary).setEmoji('<:Caretright:1521227704953864202>')
        ));
    return interaction.update({ components: [c], flags: CV2 });
}

async function savePanelChannel(interaction, ifaceId) {
    const channelId = interaction.values[0];
    const channel = interaction.guild.channels.cache.get(channelId);
    if (!channel) {
        await interaction.update({ components: [buildErrorResponse('Channel Not Found', 'Could not resolve that channel.')], flags: CV2 });
        return true;
    }

    let sentMsg;
    try {
        sentMsg = await channel.send({ components: [buildControlPanel()], flags: CV2 });
    } catch (e) {
        await interaction.update({
            components: [buildErrorResponse('Send Failed', e.message || `I can't send messages in ${channel}. Check my permissions.`)],
            flags: CV2
        });
        return true;
    }

    const r = mgr.updateInterface(interaction.guild.id, ifaceId, {
        interfaceChannelId:    channel.id,
        controlPanelMessageId: sentMsg.id
    });
    if (!r.ok) {
        await interaction.update({ components: [buildErrorResponse('Update Failed', r.error)], flags: CV2 });
        return true;
    }
    await interaction.update({ components: [buildInterfaceEditor(interaction.guild, r.iface, interaction.user.id)], flags: CV2 });
    refreshDashboard(interaction.client, interaction.guild, interaction.user.id);
    return true;
}

async function openCategorySelect(interaction, iface) {
    const c = new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `### <:Bookopen:1521227911137595605> Pick Spawn Category\n-# Temp VCs for **${iface.name}** will be created inside the chosen category. Leave unset to inherit the trigger's parent.`
        ))
        .addActionRowComponents(new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
                .setCustomId(`j2cset_select_category_${iface.id}`)
                .setPlaceholder('Select a category…')
                .setChannelTypes(ChannelType.GuildCategory)
        ))
        .addActionRowComponents(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('j2cset_main_back').setLabel('Back').setStyle(ButtonStyle.Secondary).setEmoji('<:Caretright:1521227704953864202>')
        ));
    return interaction.update({ components: [c], flags: CV2 });
}

async function saveCategory(interaction, ifaceId) {
    const r = mgr.updateInterface(interaction.guild.id, ifaceId, { categoryId: interaction.values[0] });
    if (!r.ok) {
        await interaction.update({ components: [buildErrorResponse('Update Failed', r.error)], flags: CV2 });
        return true;
    }
    await interaction.update({ components: [buildInterfaceEditor(interaction.guild, r.iface, interaction.user.id)], flags: CV2 });
    refreshDashboard(interaction.client, interaction.guild, interaction.user.id);
    return true;
}

async function openRolesSelect(interaction, iface) {
    if (!mgr.isPremium(interaction.guild.id, interaction.user.id)) {
        await interaction.reply({ components: [buildPremiumGate('role gating')], flags: CV2_EPH });
        return true;
    }
    const c = new ContainerBuilder()
        .setAccentColor(0xF1C40F)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `### <:Crown:1521227739988889764> Allowed Roles (Premium)\n-# Only members with one of the selected roles can spawn a channel from **${iface.name}**.\n-# Pick **none** to allow everyone.`
        ))
        .addActionRowComponents(new ActionRowBuilder().addComponents(
            new RoleSelectMenuBuilder()
                .setCustomId(`j2cset_select_roles_${iface.id}`)
                .setPlaceholder('Select roles…')
                .setMinValues(0)
                .setMaxValues(10)
        ))
        .addActionRowComponents(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('j2cset_main_back').setLabel('Back').setStyle(ButtonStyle.Secondary).setEmoji('<:Caretright:1521227704953864202>')
        ));
    return interaction.update({ components: [c], flags: CV2 });
}

async function saveAllowedRoles(interaction, ifaceId) {
    const r = mgr.updateInterface(interaction.guild.id, ifaceId, { allowedRoles: interaction.values || [] });
    if (!r.ok) {
        await interaction.update({ components: [buildErrorResponse('Update Failed', r.error)], flags: CV2 });
        return true;
    }
    await interaction.update({ components: [buildInterfaceEditor(interaction.guild, r.iface, interaction.user.id)], flags: CV2 });
    refreshDashboard(interaction.client, interaction.guild, interaction.user.id);
    return true;
}

/* ── Interface toggles & deletion ─────────────────────────────────── */

async function toggleVisibility(interaction, iface) {
    const next = iface.defaultVisibility === 'private' ? 'public' : 'private';
    const r = mgr.updateInterface(interaction.guild.id, iface.id, { defaultVisibility: next });
    await interaction.update({ components: [buildInterfaceEditor(interaction.guild, r.iface, interaction.user.id)], flags: CV2 });
    return true;
}

async function toggleAutoDelete(interaction, iface) {
    const r = mgr.updateInterface(interaction.guild.id, iface.id, { autoDelete: !iface.autoDelete });
    await interaction.update({ components: [buildInterfaceEditor(interaction.guild, r.iface, interaction.user.id)], flags: CV2 });
    return true;
}

async function toggleEnabled(interaction, iface) {
    if (!(iface.triggerChannelIds || []).length && iface.enabled === false) {
        await interaction.reply({ components: [buildErrorResponse('No Triggers', 'Add at least one trigger voice channel before enabling.')], flags: CV2_EPH });
        return true;
    }
    const r = mgr.updateInterface(interaction.guild.id, iface.id, { enabled: iface.enabled === false });
    await interaction.update({ components: [buildInterfaceEditor(interaction.guild, r.iface, interaction.user.id)], flags: CV2 });
    refreshDashboard(interaction.client, interaction.guild, interaction.user.id);
    return true;
}

async function sendControlPanelToInterface(interaction, iface) {
    if (!iface.interfaceChannelId) {
        await interaction.reply({ components: [buildErrorResponse('No Panel Channel', 'Pick a panel channel first.')], flags: CV2_EPH });
        return true;
    }
    const channel = interaction.guild.channels.cache.get(iface.interfaceChannelId);
    if (!channel) {
        await interaction.reply({ components: [buildErrorResponse('Channel Missing', 'The configured panel channel was deleted. Pick a new one.')], flags: CV2_EPH });
        return true;
    }
    try {
        const sent = await channel.send({ components: [buildControlPanel()], flags: CV2 });
        const r = mgr.updateInterface(interaction.guild.id, iface.id, { controlPanelMessageId: sent.id });
        await interaction.reply({
            components: [buildSuccessResponse('Control Panel Sent', `Posted in ${channel} for **${iface.name}**.`)],
            flags: CV2_EPH
        });
        // Re-render the editor underneath to reflect updated message id.
        if (r.ok) refreshDashboard(interaction.client, interaction.guild, interaction.user.id);
    } catch (e) {
        await interaction.reply({ components: [buildErrorResponse('Send Failed', e.message || 'Could not send the panel there.')], flags: CV2_EPH });
    }
    return true;
}

async function confirmDeleteIface(interaction, iface) {
    const c = new ContainerBuilder()
        .setAccentColor(0xED4245)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `### <:Infotriangle:1521227710381428926> Delete \`${iface.name}\`?\n-# This removes the interface configuration. The trigger VC and panel channel are kept; existing temp channels stay until empty.`
        ))
        .addActionRowComponents(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`j2cset_iface_deleteyes_${iface.id}`).setLabel('Confirm Delete').setStyle(ButtonStyle.Danger).setEmoji('<:Trash:1521227750420254820>'),
            new ButtonBuilder().setCustomId('j2cset_main_back').setLabel('Cancel').setStyle(ButtonStyle.Secondary).setEmoji('<:Cancel:1521227723916181644>')
        ));
    return interaction.update({ components: [c], flags: CV2 });
}

async function doDeleteIface(interaction, iface) {
    mgr.deleteInterface(interaction.guild.id, iface.id);
    await interaction.update({ components: [buildAdminDashboard(interaction.guild, interaction.user.id)], flags: CV2 });
    refreshDashboard(interaction.client, interaction.guild, interaction.user.id);
    return true;
}

async function confirmReset(interaction) {
    const c = new ContainerBuilder()
        .setAccentColor(0xED4245)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `### <:Infotriangle:1521227710381428926> Disable Join-to-Create?\n-# Removes every interface and deletes the trigger VC and panel channel for each. Existing temp VCs stay until empty.`
        ))
        .addActionRowComponents(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('j2cset_main_reset_yes').setLabel('Confirm Disable').setStyle(ButtonStyle.Danger).setEmoji('<:Trash:1521227750420254820>'),
            new ButtonBuilder().setCustomId('j2cset_main_back').setLabel('Cancel').setStyle(ButtonStyle.Secondary).setEmoji('<:Cancel:1521227723916181644>')
        ));
    return interaction.update({ components: [c], flags: CV2 });
}

async function doReset(interaction) {
    const guild = interaction.guild;
    const cfg = mgr.getGuildConfig(guild.id);
    for (const iface of Object.values(cfg.interfaces || {})) {
        for (const tid of (iface.triggerChannelIds || [])) {
            const ch = guild.channels.cache.get(tid);
            if (ch) try { await ch.delete('J2C: disabled'); } catch {}
        }
        if (iface.interfaceChannelId) {
            const ch = guild.channels.cache.get(iface.interfaceChannelId);
            if (ch) try { await ch.delete('J2C: disabled'); } catch {}
        }
    }
    mgr.deleteGuildConfig(guild.id);
    await interaction.update({ components: [buildAdminDashboard(guild, interaction.user.id)], flags: CV2 });
    return true;
}
