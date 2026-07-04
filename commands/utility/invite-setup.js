const { 
    SlashCommandBuilder, 
    PermissionFlagsBits, 
    ContainerBuilder, 
    TextDisplayBuilder, 
    MessageFlags,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ChannelType,
    StringSelectMenuBuilder
} = require('discord.js');
const { 
    toggleInviteTracking, 
    isTrackingEnabled, 
    preloadGuildInvites,
    getRewards,
    setReward,
    removeReward
} = require('../../utils/inviteManager');
const { getDefaultMessages, getVariableGroups, replaceInviteVariables, buildContainer: buildMsgContainer } = require('../../utils/inviteMessageBuilder');

const jsonStore = require('../../utils/jsonStore');
const { checkAndExpire } = require('../../utils/panelExpiration');
const { buildSafeListText } = require('../../utils/componentHelpers');

// ── Message type metadata for the Messages panel ──────────────────────────
const MESSAGE_TYPES = {
    join: {
        label: 'Join Message',
        description: 'Sent when a tracked member joins via a known invite.',
        emoji: '<:Userplus:1521227719621218477>',
        accent: 0x57F287,
    },
    leave: {
        label: 'Leave Message',
        description: 'Sent when a tracked member leaves the server.',
        emoji: '<:Userblock:1521227822641975366>',
        accent: 0xED4245,
    },
    vanity: {
        label: 'Vanity / Unknown',
        description: 'Sent when a member joins without a trackable invite.',
        emoji: '<:Sketch:1521228025365004471>',
        accent: 0xFEE75C,
    },
    fake: {
        label: 'Alt Detection',
        description: 'Sent when a joining member is flagged as a likely alt.',
        emoji: '<:Shield:1521227694677692467>',
        accent: 0xED4245,
    },
};

function loadConfig() {
    if (!jsonStore.has('invites')) {
        return {};
    }
    return jsonStore.read('invites');
}

function saveConfig(config) {
    jsonStore.write('invites', config);
}

function getGuildConfig(guildId) {
    const config = loadConfig();
    const entry = config[guildId] || { enabled: false, rewards: [], channel: null };
    if (!entry.messages) entry.messages = getDefaultMessages();
    return entry;
}

function updateGuildConfig(guildId, updates) {
    const config = loadConfig();
    if (!config[guildId]) {
        config[guildId] = {
            enabled: false,
            rewards: [],
            channel: null,
            totals: {},
            members: {},
            invites: {},
            messages: getDefaultMessages(),
        };
    }
    if (!config[guildId].messages) config[guildId].messages = getDefaultMessages();
    Object.assign(config[guildId], updates);
    saveConfig(config);
    return config[guildId];
}

/**
 * Update a single message-type config (merge fields) for a guild.
 */
function updateMessageConfig(guildId, type, updates) {
    const config = loadConfig();
    if (!config[guildId]) {
        config[guildId] = {
            enabled: false,
            rewards: [],
            channel: null,
            totals: {},
            members: {},
            invites: {},
            messages: getDefaultMessages(),
        };
    }
    if (!config[guildId].messages) config[guildId].messages = getDefaultMessages();
    if (!config[guildId].messages[type]) config[guildId].messages[type] = getDefaultMessages()[type];
    Object.assign(config[guildId].messages[type], updates);
    saveConfig(config);
    return config[guildId].messages[type];
}

function buildMainPanel(guildConfig, guild) {
    const enabled = guildConfig.enabled;
    const rewards = guildConfig.rewards || [];
    const messages = guildConfig.messages || getDefaultMessages();
    const logChannel = guildConfig.channel ? guild.channels.cache.get(guildConfig.channel) : null;

    const enabledMsgCount = Object.values(messages).filter(m => m?.enabled !== false).length;
    const totalMsgCount = Object.keys(MESSAGE_TYPES).length;

    let content = `# <:Fire:1521227907647668374> Invite Tracking System\n\n`;
    content += `Track member invites, reward top inviters, and broadcast custom join/leave messages with full variable support.\n\n`;

    content += `### <:Bookopen:1521227911137595605> Current Configuration\n`;
    content += `<:Caretright:1521227704953864202> **Status:** ${enabled ? '<:Toggleon:1521227758011809964> Enabled' : '<:Toggleoff:1521227763816595559> Disabled'}\n`;
    content += `<:Caretright:1521227704953864202> **Log Channel:** ${logChannel ? `<#${logChannel.id}>` : '*Not configured*'}\n`;
    content += `<:Caretright:1521227704953864202> **Reward Roles:** \`${rewards.length}\` configured\n`;
    content += `<:Caretright:1521227704953864202> **Custom Messages:** \`${enabledMsgCount}/${totalMsgCount}\` enabled\n\n`;

    content += `### <:Present:1521228115655917659> Invite Rewards\n`;
    if (rewards.length === 0) {
        content += `*No reward roles configured yet. Click "Rewards" to set up milestone rewards.*\n`;
    } else {
        const sortedRewards = [...rewards].sort((a, b) => a.invites - b.invites);
        for (const reward of sortedRewards.slice(0, 5)) {
            content += `<:Caretright:1521227704953864202> **${reward.invites} invites** → <@&${reward.roleId}>\n`;
        }
        if (rewards.length > 5) {
            content += `-# …and ${rewards.length - 5} more rewards\n`;
        }
    }

    content += `\n### <:Hashtag:1521227771957870604> Quick Setup\n`;
    content += `**1.** Enable **Tracking** to start collecting invite data\n`;
    content += `**2.** Set a **Log Channel** to receive event messages\n`;
    content += `**3.** Customize **Messages** with your own variables\n`;
    content += `**4.** Add **Rewards** to grant roles at milestones\n\n`;

    content += `### <:Shield:1521227694677692467> Related Commands\n`;
    content += `\`/invite-stats\` — your invite statistics\n`;
    content += `\`/invite-leaderboard\` — top inviters\n`;
    content += `\`/invite-analytics\` — server-wide analytics`;

    return content;
}

function buildContainer(guildConfig, guild) {
    const container = new ContainerBuilder()
        .setAccentColor(guildConfig.enabled ? 0x57F287 : 0xED4245);
    
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(buildMainPanel(guildConfig, guild))
    );
    
    container.addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    );
    
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent('### Controls')
    );
    
    container.addActionRowComponents(createControlRow(guildConfig));
    container.addActionRowComponents(createSettingsRow(guildConfig));
    
    return container;
}

function createControlRow(guildConfig) {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('invite_toggle')
                .setLabel(guildConfig.enabled ? 'Disable Tracking' : 'Enable Tracking')
                .setStyle(guildConfig.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
                .setEmoji(guildConfig.enabled ? '<:Toggleoff:1521227763816595559>' : '<:Toggleon:1521227758011809964>'),
            new ButtonBuilder()
                .setCustomId('invite_channel')
                .setLabel('Log Channel')
                .setStyle(guildConfig.channel ? ButtonStyle.Success : ButtonStyle.Primary)
                .setEmoji('<:Bullhorn:1521227936575914016>'),
            new ButtonBuilder()
                .setCustomId('invite_rewards')
                .setLabel('Rewards')
                .setStyle((guildConfig.rewards?.length > 0) ? ButtonStyle.Success : ButtonStyle.Primary)
                .setEmoji('<:Present:1521228115655917659>'),
            new ButtonBuilder()
                .setCustomId('invite_messages')
                .setLabel('Messages')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('<:Hashtag:1521227771957870604>')
        );
}

function createSettingsRow(guildConfig) {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('invite_variables')
                .setLabel('Variables')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('<:Clipboard:1521228175298920448>'),
            new ButtonBuilder()
                .setCustomId('invite_add_reward')
                .setLabel('Add Reward')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('<:Add:1521227828199293152>'),
            new ButtonBuilder()
                .setCustomId('invite_remove_reward')
                .setLabel('Remove Reward')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('<:Trash:1521227750420254820>'),
            new ButtonBuilder()
                .setCustomId('invite_reset')
                .setLabel('Reset Stats')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('<:Trash:1521227750420254820>')
        );
}

function buildRewardsPanel(guildConfig, guild) {
    const rewards = guildConfig.rewards || [];

    if (rewards.length === 0) {
        return `# <:Present:1521228115655917659> Invite Rewards\n\n` +
            `*No reward roles configured yet.*\n\nClick **Add Reward** to create invite milestones.`;
    }

    const sortedRewards = [...rewards].sort((a, b) => a.invites - b.invites);
    const lineEntries = sortedRewards.map(reward => {
        const role = guild.roles.cache.get(reward.roleId);
        return `<:Caretright:1521227704953864202> **${reward.invites} invites** → ${role ? role.toString() : '*Unknown Role*'}`;
    });

    // Trim to fit Discord's 4 000-char per-TextDisplay cap. With many
    // rewards plus deleted-role entries the naive concat would exceed it.
    const { content } = buildSafeListText({
        header:
            `# <:Present:1521228115655917659> Invite Rewards\n\n` +
            `Members who hit these invite milestones will be awarded the matching role automatically.\n`,
        lines: lineEntries,
        separator: '\n',
        overflowHint: '\n-# +${n} more not shown — remove some entries to see them all',
    });
    return content;
}

function buildRewardsContainer(guildConfig, guild) {
    const container = new ContainerBuilder()
        ;
    
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(buildRewardsPanel(guildConfig, guild))
    );
    
    container.addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    );
    
    container.addActionRowComponents(
        new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('invite_add_reward')
                    .setLabel('Add Reward')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('<:Add:1521227828199293152>'),
                new ButtonBuilder()
                    .setCustomId('invite_remove_reward')
                    .setLabel('Remove Reward')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('<:Trash:1521227750420254820>'),
                new ButtonBuilder()
                    .setCustomId('invite_back')
                    .setLabel('Back')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('<:Caretright:1521227704953864202>')
            )
    );
    
    return container;
}

// ── Messages Hub ─────────────────────────────────────────────────────────

function buildMessagesPanel(guildConfig) {
    const messages = guildConfig.messages || getDefaultMessages();
    const logChannelId = guildConfig.channel;

    let content = `# <:Hashtag:1521227771957870604> Custom Invite Messages\n\n`;
    content += `Customize what gets posted to your invite log channel for each event.\nEvery message supports rich variables — click **Variables** to see the full list.\n\n`;

    if (!logChannelId) {
        content += `### <:Infotriangle:1521227710381428926> No Log Channel Configured\n`;
        content += `Set a log channel from the main panel before messages can be sent.\n\n`;
    }

    content += `### <:Bookopen:1521227911137595605> Message Status\n`;
    for (const [type, meta] of Object.entries(MESSAGE_TYPES)) {
        const cfg = messages[type] || {};
        const status = cfg.enabled === false
            ? '<:Toggleoff:1521227763816595559> Disabled'
            : '<:Toggleon:1521227758011809964> Enabled';
        content += `${meta.emoji} **${meta.label}** — ${status}\n`;
        content += `-# ${meta.description}\n`;
    }

    content += `\n### <:Clipboard:1521228175298920448> Tips\n`;
    content += `<:Caretright:1521227704953864202> Use **Edit** on any message to rewrite the content with variables.\n`;
    content += `<:Caretright:1521227704953864202> Use **Toggle** to turn a message on or off without losing the template.\n`;
    content += `<:Caretright:1521227704953864202> **Reset** restores the default xNico-styled template.\n`;

    return content;
}

function buildMessagesContainer(guildConfig) {
    const container = new ContainerBuilder();

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(buildMessagesPanel(guildConfig))
    );

    container.addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    );

    // Selector to pick which message to manage
    const select = new StringSelectMenuBuilder()
        .setCustomId('invite_msg_select')
        .setPlaceholder('Select a message to configure…')
        .setMinValues(1)
        .setMaxValues(1);

    for (const [type, meta] of Object.entries(MESSAGE_TYPES)) {
        const cfg = (guildConfig.messages || {})[type] || {};
        select.addOptions({
            label: meta.label,
            value: type,
            description: cfg.enabled === false ? 'Disabled' : 'Enabled',
            emoji: meta.emoji.match(/^<a?:.+?:(\d+)>$/) ? { id: meta.emoji.match(/^<a?:.+?:(\d+)>$/)[1], name: meta.emoji.match(/^<a?:(.+?):/)[1] } : undefined,
        });
    }

    container.addActionRowComponents(new ActionRowBuilder().addComponents(select));

    container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('invite_variables')
                .setLabel('Variables')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('<:Clipboard:1521228175298920448>'),
            new ButtonBuilder()
                .setCustomId('invite_back')
                .setLabel('Back')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('<:Caretright:1521227704953864202>')
        )
    );

    return container;
}

function buildMessageEditorPanel(type, guildConfig) {
    const meta = MESSAGE_TYPES[type];
    const cfg = (guildConfig.messages || {})[type] || getDefaultMessages()[type];
    const enabled = cfg.enabled !== false;

    let content = `# ${meta.emoji} ${meta.label}\n`;
    content += `-# ${meta.description}\n\n`;
    content += `### <:Bookopen:1521227911137595605> Status\n`;
    content += `<:Caretright:1521227704953864202> ${enabled ? '<:Toggleon:1521227758011809964> Enabled' : '<:Toggleoff:1521227763816595559> Disabled'}\n\n`;

    content += `### <:Editalt:1521227921673556019> Current Template\n`;
    const preview = (cfg.content || '*(empty)*').slice(0, 1500);
    content += '```\n' + preview.replace(/```/g, '`\u200b``') + '\n```\n';
    if ((cfg.content || '').length > 1500) {
        content += `-# Template truncated for preview (${cfg.content.length} chars total).\n`;
    }

    content += `\n### <:Clipboard:1521228175298920448> Quick Reference\n`;
    content += `<:Caretright:1521227704953864202> Click **Variables** for the full placeholder list.\n`;
    content += `<:Caretright:1521227704953864202> Click **Preview** to render the template against your own data.\n`;

    return content;
}

function buildMessageEditorContainer(type, guildConfig) {
    const meta = MESSAGE_TYPES[type];
    const cfg = (guildConfig.messages || {})[type] || getDefaultMessages()[type];
    const enabled = cfg.enabled !== false;

    const container = new ContainerBuilder().setAccentColor(meta.accent);

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(buildMessageEditorPanel(type, guildConfig))
    );

    container.addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    );

    container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`invite_msg_edit_${type}`)
                .setLabel('Edit Template')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('<:Editalt:1521227921673556019>'),
            new ButtonBuilder()
                .setCustomId(`invite_msg_toggle_${type}`)
                .setLabel(enabled ? 'Disable' : 'Enable')
                .setStyle(enabled ? ButtonStyle.Danger : ButtonStyle.Success)
                .setEmoji(enabled ? '<:Toggleoff:1521227763816595559>' : '<:Toggleon:1521227758011809964>'),
            new ButtonBuilder()
                .setCustomId(`invite_msg_preview_${type}`)
                .setLabel('Preview')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('<:Eye:1521227940480815156>'),
            new ButtonBuilder()
                .setCustomId(`invite_msg_reset_${type}`)
                .setLabel('Reset')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('<:History:1521227863079256278>')
        )
    );

    container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('invite_variables')
                .setLabel('Variables')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('<:Clipboard:1521228175298920448>'),
            new ButtonBuilder()
                .setCustomId('invite_messages')
                .setLabel('Back to Messages')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('<:Caretright:1521227704953864202>')
        )
    );

    return container;
}

function buildVariablesContainer() {
    const container = new ContainerBuilder();

    let content = `# <:Clipboard:1521228175298920448> Available Variables\n\n`;
    content += `Drop any of these placeholders into your message templates and they'll be replaced at send-time.\n\n`;

    for (const group of getVariableGroups()) {
        content += `### ${group.title}\n`;
        content += group.vars.map(v => `\`${v}\``).join(' ') + `\n\n`;
    }

    content += `### <:Infotriangle:1521227710381428926> Tips\n`;
    content += `<:Caretright:1521227704953864202> Variables are case-sensitive — lowercase only.\n`;
    content += `<:Caretright:1521227704953864202> Inviter variables resolve to *Unknown* on vanity/discovery joins.\n`;
    content += `<:Caretright:1521227704953864202> Alt-detection variables only populate inside the **fake** template.\n`;

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

    container.addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    );

    container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('invite_messages')
                .setLabel('Back to Messages')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('<:Caretright:1521227704953864202>'),
            new ButtonBuilder()
                .setCustomId('invite_back')
                .setLabel('Main Panel')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('<:Bookopen:1521227911137595605>')
        )
    );

    return container;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('invite-setup')
        .setDescription('Configure invite tracking system')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    
    async execute(interaction) {
        const guildConfig = getGuildConfig(interaction.guild.id);
        const container = buildContainer(guildConfig, interaction.guild);
        
        await interaction.reply({ 
            components: [container], 
            flags: MessageFlags.IsComponentsV2 
        });
    },

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return message.reply('<:Cancel:1521227723916181644> You need Manage Guild permission to use this command!');
        }

        const guildConfig = getGuildConfig(message.guild.id);
        const container = buildContainer(guildConfig, message.guild);
        
        message.reply({ 
            components: [container], 
            flags: MessageFlags.IsComponentsV2 
        });
    },

    async handleInteraction(interaction) {
        if (!interaction.isButton() && !interaction.isModalSubmit() && !interaction.isStringSelectMenu()) return false;
        
        const customId = interaction.customId;
        if (!customId.startsWith('invite_')) return false;
        
        // Check if config session has expired
        if (await checkAndExpire(interaction, 'config')) return true;
        
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            await interaction.reply({ 
                content: '<:Cancel:1521227723916181644> You need Manage Server permission to use these controls!', 
                flags: MessageFlags.Ephemeral 
            });
            return true;
        }
        
        const guildId = interaction.guild.id;
        let guildConfig = getGuildConfig(guildId);

        // ── String select menu (message-type chooser) ────────────────────
        if (interaction.isStringSelectMenu()) {
            if (customId === 'invite_msg_select') {
                const type = interaction.values[0];
                if (!MESSAGE_TYPES[type]) {
                    await interaction.reply({
                        content: '<:Cancel:1521227723916181644> Unknown message type.',
                        flags: MessageFlags.Ephemeral,
                    });
                    return true;
                }
                const container = buildMessageEditorContainer(type, guildConfig);
                await interaction.update({ components: [container] });
                return true;
            }
            return false;
        }
        
        if (interaction.isButton()) {
            if (customId === 'invite_toggle') {
                const newState = !guildConfig.enabled;
                toggleInviteTracking(guildId, newState);
                guildConfig = getGuildConfig(guildId);
                
                if (newState) {
                    await preloadGuildInvites(interaction.guild);
                }
                
                const container = buildContainer(guildConfig, interaction.guild);
                await interaction.update({ components: [container] });
                return true;
            }
            
            if (customId === 'invite_channel') {
                const modal = new ModalBuilder()
                    .setCustomId('invite_modal_channel')
                    .setTitle('Set Log Channel');
                
                const channelInput = new TextInputBuilder()
                    .setCustomId('channel_id')
                    .setLabel('Channel ID (or leave empty to disable)')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('123456789012345678')
                    .setValue(guildConfig.channel || '')
                    .setRequired(false);
                
                modal.addComponents(new ActionRowBuilder().addComponents(channelInput));
                await interaction.showModal(modal);
                return true;
            }
            
            if (customId === 'invite_rewards') {
                const container = buildRewardsContainer(guildConfig, interaction.guild);
                await interaction.update({ components: [container] });
                return true;
            }
            
            if (customId === 'invite_add_reward') {
                const modal = new ModalBuilder()
                    .setCustomId('invite_modal_add_reward')
                    .setTitle('Add Invite Reward');
                
                const invitesInput = new TextInputBuilder()
                    .setCustomId('invites')
                    .setLabel('Number of Invites Required')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('10')
                    .setRequired(true);
                
                const roleInput = new TextInputBuilder()
                    .setCustomId('role_id')
                    .setLabel('Role ID')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('123456789012345678')
                    .setRequired(true);
                
                modal.addComponents(
                    new ActionRowBuilder().addComponents(invitesInput),
                    new ActionRowBuilder().addComponents(roleInput)
                );
                await interaction.showModal(modal);
                return true;
            }
            
            if (customId === 'invite_remove_reward') {
                const modal = new ModalBuilder()
                    .setCustomId('invite_modal_remove_reward')
                    .setTitle('Remove Invite Reward');
                
                const invitesInput = new TextInputBuilder()
                    .setCustomId('invites')
                    .setLabel('Invite Count to Remove')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('10')
                    .setRequired(true);
                
                modal.addComponents(new ActionRowBuilder().addComponents(invitesInput));
                await interaction.showModal(modal);
                return true;
            }
            
            if (customId === 'invite_reset') {
                const config = loadConfig();
                if (config[guildId]) {
                    config[guildId].totals = {};
                    config[guildId].members = {};
                    saveConfig(config);
                }
                
                await interaction.reply({ 
                    content: '<:Checkedbox:1521227734943269077> All invite statistics have been reset!', 
                    flags: MessageFlags.Ephemeral 
                });
                
                guildConfig = getGuildConfig(guildId);
                const container = buildContainer(guildConfig, interaction.guild);
                await interaction.message.edit({ components: [container] });
                return true;
            }
            
            if (customId === 'invite_back') {
                guildConfig = getGuildConfig(guildId);
                const container = buildContainer(guildConfig, interaction.guild);
                await interaction.update({ components: [container] });
                return true;
            }

            // ── Messages hub ───────────────────────────────────────────
            if (customId === 'invite_messages') {
                const container = buildMessagesContainer(guildConfig);
                await interaction.update({ components: [container] });
                return true;
            }

            if (customId === 'invite_variables') {
                const container = buildVariablesContainer();
                await interaction.update({ components: [container] });
                return true;
            }

            // Per-message-type buttons: edit / toggle / preview / reset
            const editMatch = customId.match(/^invite_msg_edit_(\w+)$/);
            if (editMatch) {
                const type = editMatch[1];
                if (!MESSAGE_TYPES[type]) return true;
                const cfg = (guildConfig.messages || {})[type] || getDefaultMessages()[type];

                const modal = new ModalBuilder()
                    .setCustomId(`invite_modal_msg_${type}`)
                    .setTitle(`Edit ${MESSAGE_TYPES[type].label}`);

                const contentInput = new TextInputBuilder()
                    .setCustomId('content')
                    .setLabel('Message Template (variables supported)')
                    .setStyle(TextInputStyle.Paragraph)
                    .setPlaceholder('Use {user}, {invitermention}, {invitercount}, etc.')
                    .setValue((cfg.content || '').slice(0, 4000))
                    .setMaxLength(4000)
                    .setRequired(true);

                const colorInput = new TextInputBuilder()
                    .setCustomId('color')
                    .setLabel('Accent Color (hex, e.g. #57F287)')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('#57F287')
                    .setValue(cfg.accentColor ? `#${cfg.accentColor.toString(16).padStart(6, '0').toUpperCase()}` : '#CAD7E6')
                    .setMaxLength(9)
                    .setRequired(false);

                modal.addComponents(
                    new ActionRowBuilder().addComponents(contentInput),
                    new ActionRowBuilder().addComponents(colorInput),
                );
                await interaction.showModal(modal);
                return true;
            }

            const toggleMatch = customId.match(/^invite_msg_toggle_(\w+)$/);
            if (toggleMatch) {
                const type = toggleMatch[1];
                if (!MESSAGE_TYPES[type]) return true;
                const current = (guildConfig.messages || {})[type] || getDefaultMessages()[type];
                updateMessageConfig(guildId, type, { enabled: !(current.enabled !== false) });
                guildConfig = getGuildConfig(guildId);

                const container = buildMessageEditorContainer(type, guildConfig);
                await interaction.update({ components: [container] });
                return true;
            }

            const resetMatch = customId.match(/^invite_msg_reset_(\w+)$/);
            if (resetMatch) {
                const type = resetMatch[1];
                if (!MESSAGE_TYPES[type]) return true;
                const defaults = getDefaultMessages()[type];
                updateMessageConfig(guildId, type, {
                    content: defaults.content,
                    accentColor: defaults.accentColor,
                    enabled: true,
                });
                guildConfig = getGuildConfig(guildId);

                await interaction.reply({
                    content: '<:Checkedbox:1521227734943269077> Template restored to default.',
                    flags: MessageFlags.Ephemeral,
                });
                const container = buildMessageEditorContainer(type, guildConfig);
                await interaction.message.edit({ components: [container] }).catch(() => {});
                return true;
            }

            const previewMatch = customId.match(/^invite_msg_preview_(\w+)$/);
            if (previewMatch) {
                const type = previewMatch[1];
                if (!MESSAGE_TYPES[type]) return true;
                const cfg = (guildConfig.messages || {})[type] || getDefaultMessages()[type];

                // Build a preview using the invoker as both member and inviter
                const ctx = {
                    member: interaction.member,
                    guild: interaction.guild,
                    inviter: interaction.user,
                    invite: {
                        code: 'preview',
                        url: 'https://discord.gg/preview',
                        totalForInviter: 42,
                        inviterCodeCount: 3,
                    },
                    alt: {
                        riskScore: 75,
                        accountAgeDays: 2,
                        flags: ['Account created less than 3 days ago', 'No profile picture set'],
                    },
                };
                const resolved = replaceInviteVariables(cfg.content || '', ctx);
                const preview = buildMsgContainer(resolved, cfg.accentColor || 0xCAD7E6, `Preview — ${MESSAGE_TYPES[type].label}`);

                await interaction.reply({
                    components: [preview],
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                });
                return true;
            }
        }
        
        if (interaction.isModalSubmit()) {
            if (customId === 'invite_modal_channel') {
                const channelId = interaction.fields.getTextInputValue('channel_id').trim();
                
                if (channelId) {
                    const channel = interaction.guild.channels.cache.get(channelId);
                    if (!channel || channel.type !== ChannelType.GuildText) {
                        await interaction.reply({ 
                            content: '<:Cancel:1521227723916181644> Invalid channel ID! Please provide a valid text channel ID.', 
                            flags: MessageFlags.Ephemeral 
                        });
                        return true;
                    }
                    updateGuildConfig(guildId, { channel: channelId });
                } else {
                    updateGuildConfig(guildId, { channel: null });
                }
                
                await interaction.reply({ 
                    content: channelId ? '<:Checkedbox:1521227734943269077> Log channel updated!' : '<:Checkedbox:1521227734943269077> Log channel disabled!', 
                    flags: MessageFlags.Ephemeral 
                });
                
                guildConfig = getGuildConfig(guildId);
                const container = buildContainer(guildConfig, interaction.guild);
                await interaction.message.edit({ components: [container] });
                return true;
            }
            
            if (customId === 'invite_modal_add_reward') {
                const invites = parseInt(interaction.fields.getTextInputValue('invites'));
                const roleId = interaction.fields.getTextInputValue('role_id').trim();
                
                if (isNaN(invites) || invites < 1) {
                    await interaction.reply({ 
                        content: '<:Cancel:1521227723916181644> Please enter a valid number of invites!', 
                        flags: MessageFlags.Ephemeral 
                    });
                    return true;
                }
                
                const role = interaction.guild.roles.cache.get(roleId);
                if (!role) {
                    await interaction.reply({ 
                        content: '<:Cancel:1521227723916181644> Invalid role ID! Please provide a valid role ID.', 
                        flags: MessageFlags.Ephemeral 
                    });
                    return true;
                }
                
                setReward(guildId, invites, roleId);
                
                await interaction.reply({ 
                    content: `<:Checkedbox:1521227734943269077> Reward added! Users will receive ${role} at **${invites} invites**.`, 
                    flags: MessageFlags.Ephemeral 
                });
                
                guildConfig = getGuildConfig(guildId);
                const container = buildRewardsContainer(guildConfig, interaction.guild);
                await interaction.message.edit({ components: [container] });
                return true;
            }
            
            if (customId === 'invite_modal_remove_reward') {
                const invites = parseInt(interaction.fields.getTextInputValue('invites'));
                
                if (isNaN(invites)) {
                    await interaction.reply({ 
                        content: '<:Cancel:1521227723916181644> Please enter a valid number!', 
                        flags: MessageFlags.Ephemeral 
                    });
                    return true;
                }
                
                removeReward(guildId, invites);
                
                await interaction.reply({ 
                    content: `<:Checkedbox:1521227734943269077> Reward for **${invites} invites** has been removed.`, 
                    flags: MessageFlags.Ephemeral 
                });
                
                guildConfig = getGuildConfig(guildId);
                const container = buildRewardsContainer(guildConfig, interaction.guild);
                await interaction.message.edit({ components: [container] });
                return true;
            }

            // ── Custom message editor modal ───────────────────────────
            const msgEditMatch = customId.match(/^invite_modal_msg_(\w+)$/);
            if (msgEditMatch) {
                const type = msgEditMatch[1];
                if (!MESSAGE_TYPES[type]) return true;

                const content = interaction.fields.getTextInputValue('content').trim();
                if (!content) {
                    await interaction.reply({
                        content: '<:Cancel:1521227723916181644> Message content cannot be empty.',
                        flags: MessageFlags.Ephemeral,
                    });
                    return true;
                }

                let accentColor;
                const rawColor = interaction.fields.getTextInputValue('color').trim();
                if (rawColor) {
                    const cleaned = rawColor.replace(/^#/, '');
                    if (/^[0-9A-Fa-f]{6}$/.test(cleaned)) {
                        accentColor = parseInt(cleaned, 16);
                    } else {
                        await interaction.reply({
                            content: '<:Cancel:1521227723916181644> Invalid hex color. Use a format like `#57F287`.',
                            flags: MessageFlags.Ephemeral,
                        });
                        return true;
                    }
                }

                const updates = { content };
                if (accentColor !== undefined) updates.accentColor = accentColor;
                updateMessageConfig(guildId, type, updates);

                await interaction.reply({
                    content: `<:Checkedbox:1521227734943269077> ${MESSAGE_TYPES[type].label} updated.`,
                    flags: MessageFlags.Ephemeral,
                });

                guildConfig = getGuildConfig(guildId);
                const container = buildMessageEditorContainer(type, guildConfig);
                await interaction.message.edit({ components: [container] }).catch(() => {});
                return true;
            }
        }
        
        return false;
    }
};
