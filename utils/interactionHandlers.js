const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, EmbedBuilder, ContainerBuilder, TextDisplayBuilder, MessageFlags, ChannelType, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOption, ChannelSelectMenuBuilder, RoleSelectMenuBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, SectionBuilder, SeparatorBuilder, SeparatorSpacingSize, ThumbnailBuilder, AttachmentBuilder, PermissionFlagsBits } = require('discord.js');

const jsonStore = require('./jsonStore');
const log = require('./logger-styled');
const { checkAndExpire, registerSession } = require('./panelExpiration');
const { buildSafeListText } = require('./componentHelpers');
/**
 * Resolve a channel from user input (ID, mention, or name).
 * Accepts: raw ID, <#ID>, #name, or channel name.
 * Returns the channel object or null.
 */
function resolveChannel(guild, input) {
    if (!input || !guild) return null;
    const cleaned = input.trim();
    if (!cleaned) return null;

    // Try as mention format <#123456> or raw ID
    const idMatch = cleaned.match(/^<?#?(\d{17,20})>?$/);
    if (idMatch) {
        const ch = guild.channels.cache.get(idMatch[1]);
        if (ch) return ch;
    }

    // Try by exact name (case-insensitive), prefer text channels
    const nameLower = cleaned.replace(/^#/, '').toLowerCase();
    const byName = guild.channels.cache.find(
        c => c.name.toLowerCase() === nameLower && c.type === ChannelType.GuildText,
    );
    if (byName) return byName;

    // Fallback: any channel type with that name
    return guild.channels.cache.find(c => c.name.toLowerCase() === nameLower) || null;
}

// Temporary storage for embed/welcomer/components data
const embedData = new Map();
const welcomerData = new Map();
const componentsData = new Map();

// Store message references for live updates
const builderMessages = new Map();

// Track message creation times for expiration
const messageTimestamps = new Map();

// Expiration times in milliseconds
const HELP_MENU_TIMEOUT = 60 * 1000; // 1 minute
const BUILDER_TIMEOUT = 30 * 60 * 1000; // 30 minutes

// Helper function to check if an interaction has expired
function isInteractionExpired(messageId, timeout) {
    const timestamp = messageTimestamps.get(messageId);
    if (!timestamp) return false;
    return Date.now() - timestamp > timeout;
}

// Helper function to disable all components in a message
function createExpiredContainer(type = 'menu') {
    const expiredText = type === 'help' 
        ? '# <:Timer:1521227971590095070> Help Menu Expired\n\nThis help menu has expired due to inactivity (1 minute). Please use `/help` to open a new menu.'
        : '# <:Timer:1521227971590095070> Builder Session Expired\n\nThis builder session has expired due to inactivity (30 minutes). Please run the command again to start a new session.';

    return new ContainerBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder()
                .setContent(expiredText)
        );
}

// Anti-Nuke config helpers are in utils/panels/antinukePanel.js
// (loadConfig, saveConfig, buildAntiNukePanel, getDefaultConfig)

async function handleWelcomerButtons(interaction) {
    if (!interaction || !interaction.guild) return;

    // Check if welcomer config session has expired
    if (await checkAndExpire(interaction, 'config')) return;

    const guildId = interaction.guild.id;
    const userId = interaction.user.id;
    const key = `${guildId}-${userId}`;

    // Components v2 Welcomer handlers
    if (interaction.customId === 'leave_setup_channel') {
        const config = jsonStore.read('welcomer');
        const guildConfig = config[guildId] || {};
        const currentCh = guildConfig.leave?.channelId ? `<#${guildConfig.leave.channelId}>` : '`None`';
        const row = new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
                .setCustomId('leave_select_channel')
                .setPlaceholder('Select the leave message channel')
                .addChannelTypes(ChannelType.GuildText)
                .setMinValues(1)
                .setMaxValues(1)
        );
        const container = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `## <:Pin:1521227932625014916> Set Leave Channel\nCurrent: ${currentCh}\n\nSelect the channel where leave messages will be sent.`
            ))
            .addActionRowComponents(row);
        await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        return;
    }

    if (interaction.customId === 'leave_setup_message') {
        const modal = new ModalBuilder()
            .setCustomId('welcomer_leave_modal_msg')
            .setTitle('Set Leave Message');

        const messageInput = new TextInputBuilder()
            .setCustomId('leave_message_content')
            .setLabel('Leave Message')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Goodbye {username}! We will miss you!')
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(messageInput));
        await interaction.showModal(modal);
        return;
    }

    if (interaction.customId === 'leave_preview') {
        const config = jsonStore.read('welcomer');
        const guildConfig = config[guildId] || {};

        const leaveMsg = guildConfig.leaveMessage || 'Goodbye {username}! <:Userplus:1521227719621218477>';
        const processedMsg = replacePlaceholders(leaveMsg, interaction.user, interaction.guild, interaction.channel);

        const container = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder()
                    .setContent(processedMsg)
            );

        await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        return;
    }

    if (interaction.customId === 'welcomer_comp_channel') {
        const config = jsonStore.read('welcomer');
        const guildConfig = config[guildId] || {};
        const currentCh = guildConfig.channelId ? `<#${guildConfig.channelId}>` : '`None`';
        const row = new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
                .setCustomId('welcomer_comp_select_channel')
                .setPlaceholder('Select the welcome channel')
                .addChannelTypes(ChannelType.GuildText)
                .setMinValues(1)
                .setMaxValues(1)
        );
        const container = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `## <:Pin:1521227932625014916> Set Welcome Channel\nCurrent: ${currentCh}\n\nSelect the channel where welcome messages will be sent.`
            ))
            .addActionRowComponents(row);
        await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        return;
    }

    if (interaction.customId === 'welcomer_comp_message') {
        const modal = new ModalBuilder()
            .setCustomId('welcomer_comp_modal_message')
            .setTitle('Set Welcome Message');

        const messageInput = new TextInputBuilder()
            .setCustomId('message_content')
            .setLabel('Welcome Message (supports variables)')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Welcome {user} to {server}!\n\nWe now have {membercount} members!')
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(messageInput));
        await interaction.showModal(modal);
        return;
    }

    if (interaction.customId === 'welcomer_comp_color') {
        const modal = new ModalBuilder()
            .setCustomId('welcomer_comp_modal_color')
            .setTitle('Set Container Color');

        const colorInput = new TextInputBuilder()
            .setCustomId('color_value')
            .setLabel('Color (hex code or name)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('#bcf1e4 or red, blue, green, etc.')
            .setRequired(false);

        modal.addComponents(new ActionRowBuilder().addComponents(colorInput));
        await interaction.showModal(modal);
        return;
    }

    if (interaction.customId === 'welcomer_comp_media') {
        const modal = new ModalBuilder()
            .setCustomId('welcomer_comp_modal_media')
            .setTitle('Add Media Gallery');

        const mediaUrlInput = new TextInputBuilder()
            .setCustomId('media_url')
            .setLabel('Image URL')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('https://example.com/image.png')
            .setRequired(true);

        const mediaDescInput = new TextInputBuilder()
            .setCustomId('media_description')
            .setLabel('Image Description')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Description of the image')
            .setRequired(false);

        modal.addComponents(
            new ActionRowBuilder().addComponents(mediaUrlInput),
            new ActionRowBuilder().addComponents(mediaDescInput)
        );
        await interaction.showModal(modal);
        return;
    }

    if (interaction.customId === 'welcomer_comp_thumbnail') {
        const modal = new ModalBuilder()
            .setCustomId('welcomer_comp_modal_thumbnail')
            .setTitle('Add Thumbnail');

        const thumbnailUrlInput = new TextInputBuilder()
            .setCustomId('thumbnail_url')
            .setLabel('Thumbnail URL')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('https://example.com/thumbnail.png')
            .setRequired(true);

        const thumbnailDescInput = new TextInputBuilder()
            .setCustomId('thumbnail_description')
            .setLabel('Thumbnail Description')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Description of the thumbnail')
            .setRequired(false);

        modal.addComponents(
            new ActionRowBuilder().addComponents(thumbnailUrlInput),
            new ActionRowBuilder().addComponents(thumbnailDescInput)
        );
        await interaction.showModal(modal);
        return;
    }

    if (interaction.customId === 'welcomer_comp_enable') {
        const config = jsonStore.read('welcomer');

        if (!config[guildId] || !config[guildId].channelId) {
            return interaction.reply({ content: '<:Cancel:1521227723916181644> Please set up the channel first!', flags: MessageFlags.Ephemeral });
        }

        config[guildId].enabled = true;
        config[guildId].displayType = 'components';
        jsonStore.write('welcomer', config);

        const container = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder()
                    .setContent(`# <:Toggleon:1521227758011809964> Welcomer Enabled\n\nComponents v2 welcomer has been enabled!`)
            );

        await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        return;
    }

    if (interaction.customId === 'welcomer_comp_disable') {
        const config = jsonStore.read('welcomer');

        if (!config[guildId]) {
            return interaction.reply({ content: '<:Cancel:1521227723916181644> No welcomer configured!', flags: MessageFlags.Ephemeral });
        }

        config[guildId].enabled = false;
        jsonStore.write('welcomer', config);

        const container = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder()
                    .setContent(`# <:Toggleoff:1521227763816595559> Welcomer Disabled\n\nWelcomer has been disabled!`)
            );

        await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        return;
    }

    if (interaction.customId === 'welcomer_comp_preview') {
        const config = jsonStore.read('welcomer');
        const guildConfig = config[guildId] || {};

        if (!guildConfig.content) {
            return interaction.reply({ content: '<:Cancel:1521227723916181644> No message configured yet!', flags: MessageFlags.Ephemeral });
        }

        const container = createComponentContainer(guildConfig, interaction.user, interaction.guild, interaction.channel);

        await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        return;
    }

    // Legacy leave_modal_channel handler - now handled by welcomer.js handleInteraction
    // Kept as safe fallback only
    if (interaction.customId === 'leave_modal_channel') {
        const channelInput = interaction.fields.getTextInputValue('channel_id');
        const channelId = channelInput.replace(/[<#>]/g, '');

        const channel = interaction.guild.channels.cache.get(channelId);
        if (!channel || channel.type !== ChannelType.GuildText) {
            return interaction.reply({ content: '<:Cancel:1521227723916181644> Invalid text channel ID or mention!', flags: MessageFlags.Ephemeral });
        }

        const config = jsonStore.read('welcomer');
        if (!config[guildId]) config[guildId] = {};
        if (!config[guildId].leave) config[guildId].leave = {};
        config[guildId].leave.channelId = channelId;
        jsonStore.write('welcomer', config);

        await interaction.reply({ content: `<:Checkedbox:1521227734943269077> Leave channel set to ${channel}!`, flags: MessageFlags.Ephemeral });
        return;
    }

    // Legacy welcomer_leave_modal_msg handler - now handled by welcomer.js handleInteraction
    if (interaction.customId === 'welcomer_leave_modal_msg') {
        const messageContent = interaction.fields.getTextInputValue('leave_message_content');
        const config = jsonStore.read('welcomer');
        if (!config[guildId]) config[guildId] = {};
        if (!config[guildId].leave) config[guildId].leave = {};
        config[guildId].leave.content = messageContent;
        jsonStore.write('welcomer', config);

        await interaction.reply({ content: '<:Checkedbox:1521227734943269077> Leave message updated!', flags: MessageFlags.Ephemeral });
        return;
    }

    // Welcomer autorole select menu submissions (legacy fallback — primary handler in welcomer.js)
    if (interaction.customId === 'welcomer_select_autorole_humans' || interaction.customId === 'welcomer_select_autorole_bots') {
        const isBots = interaction.customId.includes('bots');
        const roleIds = interaction.values || [];
        let autoroleConfig = {};
        if (jsonStore.has('autorole')) {
            autoroleConfig = jsonStore.read('autorole');
        }
        if (!autoroleConfig[guildId]) {
            autoroleConfig[guildId] = { humans: [], bots: [] };
        }

        if (isBots) autoroleConfig[guildId].bots = roleIds;
        else autoroleConfig[guildId].humans = roleIds;

        jsonStore.write('autorole', autoroleConfig);

        const roleDisplay = roleIds.length > 0
            ? roleIds.slice(0, 3).map(id => `<@&${id}>`).join(', ') + (roleIds.length > 3 ? ` +${roleIds.length - 3} more` : '')
            : '*None configured*';

        await interaction.reply({
            content: `<:Checkedbox:1521227734943269077> AutoRole for ${isBots ? 'bots' : 'humans'} configured!\n\n**Roles:** ${roleDisplay}`,
            flags: MessageFlags.Ephemeral
        });

        return;
    }

    if (interaction.customId === 'welcomer_leave_msg') {
        const modal = new ModalBuilder()
            .setCustomId('welcomer_leave_modal_msg')
            .setTitle('Set Leave Message');

        const messageInput = new TextInputBuilder()
            .setCustomId('leave_message_content')
            .setLabel('Leave Message (supports variables)')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Goodbye {username}! We will miss you!')
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(messageInput));
        await interaction.showModal(modal);
        return;
    }

    // Legacy welcomer_leave_toggle handler - now handled by welcomer.js handleInteraction
    if (interaction.customId === 'welcomer_leave_toggle') {
        const config = jsonStore.read('welcomer');
        if (!config[guildId]) config[guildId] = {};
        if (!config[guildId].leave) config[guildId].leave = {};
        config[guildId].leave.enabled = !config[guildId].leave.enabled;
        jsonStore.write('welcomer', config);

        const statusText = config[guildId].leave.enabled ? 'enabled' : 'disabled';
        await interaction.reply({ content: `<:Checkedbox:1521227734943269077> Leave messages have been ${statusText}!`, flags: MessageFlags.Ephemeral });
        return;
    }

    if (interaction.customId === 'welcomer_comp_canvas') {
        const modal = new ModalBuilder()
            .setCustomId('welcomer_comp_modal_canvas')
            .setTitle('Configure Canvas Welcome Card');

        const enabledInput = new TextInputBuilder()
            .setCustomId('canvas_enabled')
            .setLabel('Enable Canvas? (true/false)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('true or false')
            .setValue('true')
            .setRequired(true);

        const bgColorInput = new TextInputBuilder()
            .setCustomId('canvas_bgcolor')
            .setLabel('Background Color (hex code)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('#1a1d23 (leave empty for default)')
            .setRequired(false);

        const accentInput = new TextInputBuilder()
            .setCustomId('canvas_accent')
            .setLabel('Accent Color (hex code)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('#bcf1e4 (leave empty for default)')
            .setRequired(false);

        const customMsgInput = new TextInputBuilder()
            .setCustomId('canvas_message')
            .setLabel('Custom Message (supports variables)')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Welcome to {server}! Enjoy your stay!')
            .setRequired(false);

        modal.addComponents(
            new ActionRowBuilder().addComponents(enabledInput),
            new ActionRowBuilder().addComponents(bgColorInput),
            new ActionRowBuilder().addComponents(accentInput),
            new ActionRowBuilder().addComponents(customMsgInput)
        );
        await interaction.showModal(modal);
        return;
    }

    if (interaction.customId === 'welcomer_setup_canvas') {
        const modal = new ModalBuilder()
            .setCustomId('welcomer_modal_canvas')
            .setTitle('Configure Canvas Welcome Card');

        const enabledInput = new TextInputBuilder()
            .setCustomId('canvas_enabled')
            .setLabel('Enable Canvas? (true/false)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('true or false')
            .setValue('true')
            .setRequired(true);

        const bgColorInput = new TextInputBuilder()
            .setCustomId('canvas_bgcolor')
            .setLabel('Background Color (hex code)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('#1a1d23 (leave empty for default)')
            .setRequired(false);

        const accentInput = new TextInputBuilder()
            .setCustomId('canvas_accent')
            .setLabel('Accent Color (hex code)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('#bcf1e4 (leave empty for default)')
            .setRequired(false);

        const customMsgInput = new TextInputBuilder()
            .setCustomId('canvas_message')
            .setLabel('Custom Message (supports variables)')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Welcome to {server}! Enjoy your stay!')
            .setRequired(false);

        modal.addComponents(
            new ActionRowBuilder().addComponents(enabledInput),
            new ActionRowBuilder().addComponents(bgColorInput),
            new ActionRowBuilder().addComponents(accentInput),
            new ActionRowBuilder().addComponents(customMsgInput)
        );
        await interaction.showModal(modal);
        return;
    }

    if (interaction.customId === 'welcomer_setup_channel') {
        const config = jsonStore.read('welcomer');
        const guildConfig = config[guildId] || {};
        const currentCh = guildConfig.channelId ? `<#${guildConfig.channelId}>` : '`None`';
        const row = new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
                .setCustomId('welcomer_select_channel')
                .setPlaceholder('Select the welcome channel')
                .addChannelTypes(ChannelType.GuildText)
                .setMinValues(1)
                .setMaxValues(1)
        );
        const container = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `## <:Pin:1521227932625014916> Set Welcome Channel\nCurrent: ${currentCh}\n\nSelect the channel where welcome messages will be sent.`
            ))
            .addActionRowComponents(row);
        await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    }

    else if (interaction.customId === 'welcomer_setup_message') {
        const modal = new ModalBuilder()
            .setCustomId('welcomer_modal_message')
            .setTitle('Configure Welcome Message');

        const titleInput = new TextInputBuilder()
            .setCustomId('message_title')
            .setLabel('Title')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Welcome to {server}!')
            .setRequired(false);

        const descInput = new TextInputBuilder()
            .setCustomId('message_description')
            .setLabel('Description')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Hey {user}! Welcome to our server with {membercount} members!')
            .setRequired(false);

        modal.addComponents(
            new ActionRowBuilder().addComponents(titleInput),
            new ActionRowBuilder().addComponents(descInput)
        );
        await interaction.showModal(modal);
    }

    else if (interaction.customId === 'welcomer_setup_embed') {
        const modal = new ModalBuilder()
            .setCustomId('welcomer_modal_embed')
            .setTitle('Configure Embed Styling');

        const colorInput = new TextInputBuilder()
            .setCustomId('embed_color')
            .setLabel('Color (hex code)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('#bcf1e4')
            .setRequired(false);

        const imageInput = new TextInputBuilder()
            .setCustomId('embed_image')
            .setLabel('Image URL')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('https://example.com/image.png')
            .setRequired(false);

        const thumbInput = new TextInputBuilder()
            .setCustomId('embed_thumbnail')
            .setLabel('Thumbnail URL')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('https://example.com/thumb.png')
            .setRequired(false);

        const footerInput = new TextInputBuilder()
            .setCustomId('embed_footer')
            .setLabel('Footer Text')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Member #{membercount}')
            .setRequired(false);

        const authorInput = new TextInputBuilder()
            .setCustomId('embed_author')
            .setLabel('Author Name')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('{username} joined!')
            .setRequired(false);

        modal.addComponents(
            new ActionRowBuilder().addComponents(colorInput),
            new ActionRowBuilder().addComponents(imageInput),
            new ActionRowBuilder().addComponents(thumbInput),
            new ActionRowBuilder().addComponents(footerInput),
            new ActionRowBuilder().addComponents(authorInput)
        );
        await interaction.showModal(modal);
    }

    else if (interaction.customId === 'welcomer_setup_media') {
        const modal = new ModalBuilder()
            .setCustomId('welcomer_modal_media')
            .setTitle('Configure Media/Image');

        const imageInput = new TextInputBuilder()
            .setCustomId('media_url')
            .setLabel('Image URL (for welcome message)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('https://example.com/image.png or leave empty to remove')
            .setRequired(false);

        modal.addComponents(new ActionRowBuilder().addComponents(imageInput));
        await interaction.showModal(modal);
    }

    else if (interaction.customId === 'welcomer_toggle_enable' || interaction.customId === 'welcomer_toggle_disable') {
        const enabled = interaction.customId === 'welcomer_toggle_enable';

        if (!jsonStore.has('welcomer')) {
            jsonStore.write('welcomer', {});
        }

        const config = jsonStore.read('welcomer');

        if (!config[guildId]) {
            config[guildId] = { enabled: false };
        }

        config[guildId].enabled = enabled;
        jsonStore.write('welcomer', config);

        const container = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder()
                    .setContent(`# ${enabled ? '<:Toggleon:1521227758011809964> Welcomer Enabled' : '<:Toggleoff:1521227763816595559> Welcomer Disabled'}\n\nWelcomer has been ${enabled ? 'enabled' : 'disabled'}!`)
            );

        await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    else if (interaction.customId === 'welcomer_preview') {

        if (!jsonStore.has('welcomer')) {
            return interaction.reply({ content: '<:Cancel:1521227723916181644> No welcomer configured yet! Use the setup buttons first.', flags: MessageFlags.Ephemeral });
        }

        const config = jsonStore.read('welcomer');
        const guildConfig = config[guildId] || {};

        const preview = guildConfig.title || guildConfig.description ?
            createWelcomerPreview(interaction.user, interaction.guild, guildConfig) : null;

        if (!preview) {
            return interaction.reply({ content: '<:Cancel:1521227723916181644> No welcomer configured yet! Use the setup buttons first.', flags: MessageFlags.Ephemeral });
        }

        await interaction.reply({ embeds: [preview], flags: MessageFlags.Ephemeral });
    }
}

async function handleAntiNukeButtons(interaction) {
    if (!interaction || !interaction.guild) return;

    // Check if config session has expired
    if (await checkAndExpire(interaction, 'config')) return;

    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator) && !interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({
            content: '<:Cancel:1521227723916181644> You need **Administrator** or **Manage Guild** permission to configure Anti-Nuke!',
            flags: MessageFlags.Ephemeral
        });
    }

    const { buildAntiNukePanel, loadConfig, saveConfig } = require('./panels/antinukePanel');
    const guildId = interaction.guild.id;

    // Delegate to the antinuke command's handleInteraction
    const antinukeCmd = interaction.client.commands.get('antinuke');
    if (antinukeCmd && antinukeCmd.handleInteraction) {
        try {
            await antinukeCmd.handleInteraction(interaction);
            return;
        } catch (error) {
            log.error('Anti-Nuke Interaction Error:', error);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: '<:Cancel:1521227723916181644> There was an error processing the Anti-Nuke interaction.', flags: MessageFlags.Ephemeral }).catch(() => {});
            }
            return;
        }
    }

    // Fallback handlers if command handler is not loaded
    if (interaction.customId === 'antinuke_toggle') {
        const config = loadConfig();
        const guildConfig = config[guildId];

        if (!guildConfig) {
            return interaction.reply({ content: '<:Cancel:1521227723916181644> Anti-Nuke configuration not found!', flags: MessageFlags.Ephemeral });
        }

        guildConfig.enabled = !guildConfig.enabled;
        config[guildId] = guildConfig;
        saveConfig(config);

        const container = buildAntiNukePanel(guildConfig);
        await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
        return;
    }

    if (interaction.customId === 'antinuke_enable_all' || interaction.customId === 'antinuke_disable_all') {
        const config = loadConfig();
        const guildConfig = config[guildId];

        if (!guildConfig) {
            return interaction.reply({ content: '<:Cancel:1521227723916181644> Anti-Nuke configuration not found!', flags: MessageFlags.Ephemeral });
        }

        const enabled = interaction.customId === 'antinuke_enable_all';
        const protections = ['banProtection', 'kickProtection', 'channelDelete', 'channelCreate', 'roleDelete', 'roleCreate', 'webhookCreate', 'botAdd'];
        protections.forEach(protection => {
            if (guildConfig[protection]) {
                guildConfig[protection].enabled = enabled;
            }
        });

        config[guildId] = guildConfig;
        saveConfig(config);

        const container = buildAntiNukePanel(guildConfig);
        await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
        return;
    }

    if (interaction.customId === 'antinuke_power') {
        const config = loadConfig();
        const guildConfig = config[guildId];
        if (!guildConfig) {
            return interaction.reply({ content: '<:Cancel:1521227723916181644> Anti-Nuke configuration not found!', flags: MessageFlags.Ephemeral });
        }
        // Toggle all three "Max Power" flags together: zero-tolerance,
        // instant quarantine, and auto-restore.
        const currentlyOn = guildConfig.zeroTolerance && guildConfig.instantQuarantine && guildConfig.autoRestore;
        const next = !currentlyOn;
        guildConfig.zeroTolerance = next;
        guildConfig.instantQuarantine = next;
        guildConfig.autoRestore = next;
        config[guildId] = guildConfig;
        saveConfig(config);
        const container = buildAntiNukePanel(guildConfig);
        await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
        return;
    }

    if (interaction.customId === 'antinuke_protection_select') {
        const config = loadConfig();
        const guildConfig = config[guildId];
        const selectedProtections = interaction.values;
        const protectionMap = {
            'ban': 'banProtection',
            'kick': 'kickProtection',
            'channel_delete': 'channelDelete',
            'channel_create': 'channelCreate',
            'role_delete': 'roleDelete',
            'role_create': 'roleCreate',
            'webhook': 'webhookCreate',
            'bot_add': 'botAdd'
        };

        for (const protection of selectedProtections) {
            const configKey = protectionMap[protection];
            if (configKey && guildConfig[configKey]) {
                guildConfig[configKey].enabled = !guildConfig[configKey].enabled;
            }
        }

        config[guildId] = guildConfig;
        saveConfig(config);

        const container = buildAntiNukePanel(guildConfig);
        await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
        return;
    }
}

async function handleEmbedButtons(interaction) {
    if (!interaction || !interaction.guild) return;

    // Check if builder session has expired
    if (await checkAndExpire(interaction, 'builder')) return;

    // Handle embed builder button interactions
    const userId = interaction.user.id;
    const key = `${interaction.guild.id}-${userId}`;
    const messageKey = `embed-${key}`;

    // Always update message reference for live updates
    if (interaction.message) {
        builderMessages.set(messageKey, interaction.message);
    }

    const customId = interaction.customId;

    if (customId === 'embed_setup_basic') {
        const modal = new ModalBuilder()
            .setCustomId('embed_modal_basic')
            .setTitle('Title & Description');

        const titleInput = new TextInputBuilder()
            .setCustomId('embed_title')
            .setLabel('Embed Title')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Enter the embed title')
            .setRequired(false);

        const descInput = new TextInputBuilder()
            .setCustomId('embed_description')
            .setLabel('Embed Description')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Enter the embed description')
            .setRequired(false);

        modal.addComponents(
            new ActionRowBuilder().addComponents(titleInput),
            new ActionRowBuilder().addComponents(descInput)
        );
        await interaction.showModal(modal);
    }

    else if (customId === 'embed_setup_media') {
        const modal = new ModalBuilder()
            .setCustomId('embed_modal_media')
            .setTitle('Images & Thumbnail');

        const imageInput = new TextInputBuilder()
            .setCustomId('embed_image')
            .setLabel('Image URL')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('https://example.com/image.png')
            .setRequired(false);

        const thumbInput = new TextInputBuilder()
            .setCustomId('embed_thumbnail')
            .setLabel('Thumbnail URL')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('https://example.com/thumb.png')
            .setRequired(false);

        modal.addComponents(new ActionRowBuilder().addComponents(imageInput),
            new ActionRowBuilder().addComponents(thumbInput)
        );
        await interaction.showModal(modal);
    }

    else if (customId === 'embed_setup_footer') {
        const modal = new ModalBuilder()
            .setCustomId('embed_modal_footer')
            .setTitle('Footer & Author');

        const footerInput = new TextInputBuilder()
            .setCustomId('embed_footer')
            .setLabel('Footer Text')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Footer text here')
            .setRequired(false);

        const footerIconInput = new TextInputBuilder()
            .setCustomId('embed_footer_icon')
            .setLabel('Footer Icon URL')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('https://example.com/icon.png')
            .setRequired(false);

        const authorInput = new TextInputBuilder()
            .setCustomId('embed_author')
            .setLabel('Author Name')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Author name here')
            .setRequired(false);

        const authorIconInput = new TextInputBuilder()
            .setCustomId('embed_author_icon')
            .setLabel('Author Icon URL')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('https://example.com/author.png')
            .setRequired(false);

        const authorUrlInput = new TextInputBuilder()
            .setCustomId('embed_author_url')
            .setLabel('Author URL (clickable link)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('https://example.com')
            .setRequired(false);

        modal.addComponents(
            new ActionRowBuilder().addComponents(footerInput),
            new ActionRowBuilder().addComponents(footerIconInput),
            new ActionRowBuilder().addComponents(authorInput),
            new ActionRowBuilder().addComponents(authorIconInput),
            new ActionRowBuilder().addComponents(authorUrlInput)
        );
        await interaction.showModal(modal);
    }

    else if (customId === 'embed_setup_color') {
        const modal = new ModalBuilder()
            .setCustomId('embed_modal_color')
            .setTitle('Set Embed Color');

        const colorInput = new TextInputBuilder()
            .setCustomId('embed_color')
            .setLabel('Color (hex code or name)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('#bcf1e4 or red, blue, green, etc.')
            .setRequired(false);

        modal.addComponents(new ActionRowBuilder().addComponents(colorInput));
        await interaction.showModal(modal);
    }

    else if (customId === 'embed_setup_fields') {
        const modal = new ModalBuilder()
            .setCustomId('embed_modal_fields')
            .setTitle('Add Fields');

        const fieldNameInput = new TextInputBuilder()
            .setCustomId('field_name')
            .setLabel('Field Name')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Field title')
            .setRequired(true);

        const fieldValueInput = new TextInputBuilder()
            .setCustomId('field_value')
            .setLabel('Field Value')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Field content')
            .setRequired(true);

        const fieldInlineInput = new TextInputBuilder()
            .setCustomId('field_inline')
            .setLabel('Inline? (yes/no)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('yes or no')
            .setRequired(false);

        modal.addComponents(
            new ActionRowBuilder().addComponents(fieldNameInput),
            new ActionRowBuilder().addComponents(fieldValueInput),
            new ActionRowBuilder().addComponents(fieldInlineInput)
        );
        await interaction.showModal(modal);
    }

    else if (customId === 'embed_preview') {
        const data = embedData.get(key) || {};
        const embed = createEmbedFromData(data, interaction.user, interaction.guild, interaction.channel);

        if (!embed.data.title && !embed.data.description) {
            return interaction.reply({ content: '<:Cancel:1521227723916181644> No embed configured yet! Use the setup buttons first.', flags: MessageFlags.Ephemeral });
        }

        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    else if (customId === 'embed_send_here') {
        const messageKey = `embed-${key}`;
        const data = embedData.get(key) || {};
        const embed = createEmbedFromData(data, interaction.user, interaction.guild, interaction.channel);

        if (!embed.data.title && !embed.data.description) {
            return interaction.reply({ content: '<:Cancel:1521227723916181644> No embed configured yet! Use the setup buttons first.', flags: MessageFlags.Ephemeral });
        }

        await interaction.channel.send({ embeds: [embed] });
        await interaction.reply({ content: '<:Checkedbox:1521227734943269077> Embed sent!', flags: MessageFlags.Ephemeral });
        embedData.delete(key);
        builderMessages.delete(messageKey);
    }

    else if (customId === 'embed_send_channel') {
        const modal = new ModalBuilder()
            .setCustomId('embed_modal_send_channel')
            .setTitle('Send to Channel');

        const channelInput = new TextInputBuilder()
            .setCustomId('target_channel')
            .setLabel('Channel ID or Mention')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Channel ID or #channel-mention')
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(channelInput));
        await interaction.showModal(modal);
    }

    else if (customId === 'embed_see_variables') {
        // Update timestamp on interaction (always refresh or initialize)
        if (!global.builderTimestamps) global.builderTimestamps = new Map();
        const messageId = interaction.message.id;
        global.builderTimestamps.set(messageId, Date.now());

        const variablesText = `**Available Variables:**\n\n` +
            `\`{user}\` - User mention (@User)\n` +
            `\`{username}\` - User's display name\n` +
            `\`{userid}\` - User's ID\n` +
            `\`{server}\` - Server name\n` +
            `\`{serverid}\` - Server ID\n` +
            `\`{membercount}\` - Total member count\n` +
            `\`{channelname}\` - Channel name\n` +
            `\`{channelid}\` - Channel ID\n\n` +
            `*Use these in your content, titles, descriptions, and more!*`;

        await interaction.reply({ content: variablesText, flags: MessageFlags.Ephemeral });
    }

    else if (customId === 'embed_reset') {
        const messageKey = `embed-${key}`;
        embedData.delete(key);
        const defaultData = { title: '', description: '', color: '', image: '', thumbnail: '', footer: '', footerIcon: '', author: '', authorIcon: '', fields: [] };
        embedData.set(key, defaultData);
        await updateEmbedBuilderMessage(interaction, messageKey, defaultData);
        await interaction.reply({ content: '<:Checkedbox:1521227734943269077> Embed data reset!', flags: MessageFlags.Ephemeral });
    }
}

async function handleModalSubmit(interaction) {
    const userId = interaction.user.id;
    const guildId = interaction.guild.id;
    const key = `${guildId}-${userId}`;

    // ── AutoMod modals + config selects live in commands/utility/automod.js ──
    // (single source of truth, mirroring antinuke). Delegate early.
    if (interaction.customId?.startsWith('automod_modal_') || interaction.customId?.startsWith('automod_select_')) {
        const cmd = interaction.client?.commands?.get('automod');
        if (interaction.isModalSubmit() && cmd?.handleModal) return cmd.handleModal(interaction);
        if (cmd?.handleInteraction) return cmd.handleInteraction(interaction);
        return;
    }

    // ── Premium gate for rank/profile customization modals ────────────
    // Modal submissions don't go through the slash dispatcher's
    // `premiumOnly` check. If a user opened a customize panel before
    // their server's premium expired, we still need to fail closed
    // when they actually submit a modal (color hex, opacity, bio, …).
    if (
        interaction.customId.startsWith('profile_') && interaction.customId.endsWith('_modal') ||
        interaction.customId.startsWith('rankcard_') && interaction.customId.endsWith('_modal')
    ) {
        const premiumManager = require('./premiumManager');
        if (!premiumManager.hasPremiumAccess(userId, interaction.guild?.id)) {
            const { buildPremiumGate } = require('./responseBuilder');
            const which = interaction.customId.startsWith('rankcard_')
                ? '/rank-customize'
                : '/profile-customize';
            return interaction.reply({
                components: [buildPremiumGate(which)],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            }).catch(() => {});
        }
    }

    // Profile customization modals
    if (interaction.customId === 'profile_background_modal') {
        const { updateUserData, getUserData } = require('./dataManager');
        const backgroundUrl = interaction.fields.getTextInputValue('background_url');

        if (backgroundUrl && !backgroundUrl.match(/^https?:\/\/.+\.(jpg|jpeg|png|gif|webp)/i)) {
            return interaction.reply({ 
                content: '<:Cancel:1521227723916181644> Invalid image URL! Please provide a valid image URL (jpg, png, gif, webp).', 
                flags: MessageFlags.Ephemeral 
            });
        }

        await updateUserData(userId, {
            'profile.profileCard.customBackground': backgroundUrl || null
        });

        await interaction.reply({ 
            content: backgroundUrl 
                ? '<:Checkedbox:1521227734943269077> Background image updated successfully! Use the **Refresh** button to see changes.' 
                : '<:Checkedbox:1521227734943269077> Background image reset to default! Use the **Refresh** button to see changes.', 
            flags: MessageFlags.Ephemeral 
        });

        return;
    }

    if (interaction.customId === 'profile_banner_modal') {
        const { updateUserData } = require('./dataManager');
        const bannerUrl = interaction.fields.getTextInputValue('banner_url');

        if (bannerUrl && !bannerUrl.match(/^https?:\/\/.+\.(jpg|jpeg|png|gif|webp)/i)) {
            return interaction.reply({
                content: '<:Cancel:1521227723916181644> Invalid image URL! Please provide a valid image URL (jpg, png, gif, webp).',
                flags: MessageFlags.Ephemeral
            });
        }

        await updateUserData(userId, {
            'profile.profileCard.bannerImage': bannerUrl || null
        });

        await interaction.reply({
            content: bannerUrl
                ? '<:Checkedbox:1521227734943269077> Profile banner updated! Use the **Refresh** button to see changes.'
                : '<:Checkedbox:1521227734943269077> Profile banner removed! Use the **Refresh** button to see changes.',
            flags: MessageFlags.Ephemeral
        });

        return;
    }

    if (interaction.customId === 'profile_bgcolor_modal') {
        const { updateUserData, getUserData } = require('./dataManager');
        const colorHex = interaction.fields.getTextInputValue('bgcolor_hex');

        if (!colorHex.match(/^#?([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/)) {
            return interaction.reply({ 
                content: '<:Cancel:1521227723916181644> Invalid hex color! Use format like #bcf1e4 or #FFF', 
                flags: MessageFlags.Ephemeral 
            });
        }

        const formattedColor = colorHex.startsWith('#') ? colorHex : `#${colorHex}`;
        await updateUserData(userId, {
            'profile.profileCard.backgroundColor': formattedColor
        });

        await interaction.reply({ 
            content: `<:Checkedbox:1521227734943269077> Background color set to ${formattedColor}! Use the **Refresh** button to see changes.`, 
            flags: MessageFlags.Ephemeral 
        });

        return;
    }

    if (interaction.customId === 'profile_accentcolor_modal') {
        const { updateUserData, getUserData } = require('./dataManager');
        const colorHex = interaction.fields.getTextInputValue('accentcolor_hex');

        if (!colorHex.match(/^#?([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/)) {
            return interaction.reply({ 
                content: '<:Cancel:1521227723916181644> Invalid hex color! Use format like #57F287 or #5F2', 
                flags: MessageFlags.Ephemeral 
            });
        }

        const formattedColor = colorHex.startsWith('#') ? colorHex : `#${colorHex}`;
        await updateUserData(userId, {
            'profile.profileCard.accentColor': formattedColor
        });

        await interaction.reply({ 
            content: `<:Checkedbox:1521227734943269077> Profile accent color set to ${formattedColor}! Use the **Refresh** button to see changes.`, 
            flags: MessageFlags.Ephemeral 
        });

        return;
    }

    if (interaction.customId === 'profile_progresscolor_modal') {
        const { updateUserData, getUserData } = require('./dataManager');
        const colorHex = interaction.fields.getTextInputValue('progresscolor_hex');

        if (!colorHex.match(/^#?([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/)) {
            return interaction.reply({ 
                content: '<:Cancel:1521227723916181644> Invalid hex color! Use format like #57F287 or #5F2', 
                flags: MessageFlags.Ephemeral 
            });
        }

        const formattedColor = colorHex.startsWith('#') ? colorHex : `#${colorHex}`;
        await updateUserData(userId, {
            'profile.progressBarColor': formattedColor
        });

        await interaction.reply({ 
            content: `<:Checkedbox:1521227734943269077> Progress bar color set to ${formattedColor}! Use the **Refresh** button to see changes.`, 
            flags: MessageFlags.Ephemeral 
        });

        return;
    }

    if (interaction.customId === 'profile_bio_modal') {
        const { updateUserData, getUserData } = require('./dataManager');
        const bioText = interaction.fields.getTextInputValue('bio_text');

        await updateUserData(userId, {
            'social.bio': bioText || null
        });

        await interaction.reply({ 
            content: bioText 
                ? `<:Checkedbox:1521227734943269077> Bio updated successfully! Use the **Refresh** button to see changes.\n> ${bioText}` 
                : '<:Checkedbox:1521227734943269077> Bio cleared! Use the **Refresh** button to see changes.', 
            flags: MessageFlags.Ephemeral 
        });

        return;
    }

    if (interaction.customId === 'profile_textcolor_modal') {
        const { updateUserData, getUserData } = require('./dataManager');
        const colorHex = interaction.fields.getTextInputValue('textcolor_hex');

        if (!colorHex.match(/^#?([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/)) {
            return interaction.reply({ 
                content: '<:Cancel:1521227723916181644> Invalid hex color! Use format like #ffffff or #FFF', 
                flags: MessageFlags.Ephemeral 
            });
        }

        const formattedColor = colorHex.startsWith('#') ? colorHex : `#${colorHex}`;
        await updateUserData(userId, {
            'profile.profileCard.textColor': formattedColor
        });

        await interaction.reply({ 
            content: `<:Checkedbox:1521227734943269077> Text color set to ${formattedColor}! Use the **Refresh** button to see changes.`, 
            flags: MessageFlags.Ephemeral 
        });

        return;
    }

    // Legacy fallback for welcomer_leave_modal_msg - primary handler is in welcomer.js
    if (interaction.customId === 'welcomer_leave_modal_msg') {
        const config = jsonStore.read('welcomer');
        const leaveMsg = interaction.fields.getTextInputValue('leave_message_content');

        if (!config[guildId]) config[guildId] = {};
        if (!config[guildId].leave) config[guildId].leave = {};
        config[guildId].leave.content = leaveMsg;
        jsonStore.write('welcomer', config);

        const container = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder()
                    .setContent(`# <:Checkedbox:1521227734943269077> Leave Message Updated\n\n**New Message:** ${leaveMsg}`)
            );

        await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        return;
    }

    // Legacy fallback for leave_modal_channel - primary handler is in welcomer.js
    if (interaction.customId === 'leave_modal_channel') {
        const config = jsonStore.read('welcomer');
        let channelId = interaction.fields.getTextInputValue('channel_id');

        // Extract ID from mention if needed
        if (channelId.includes('<#') && channelId.includes('>')) {
            channelId = channelId.replace(/[<#>]/g, '');
        }

        const channel = interaction.guild.channels.cache.get(channelId);
        if (!channel || (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)) {
            return interaction.reply({ content: '<:Cancel:1521227723916181644> Invalid text channel ID!', flags: MessageFlags.Ephemeral });
        }

        if (!config[guildId]) config[guildId] = {};
        if (!config[guildId].leave) config[guildId].leave = {};
        config[guildId].leave.channelId = channelId;
        jsonStore.write('welcomer', config);

        await interaction.reply({ content: `<:Checkedbox:1521227734943269077> Leave channel set to ${channel}!`, flags: MessageFlags.Ephemeral });
        return;
    }

    if (interaction.customId === 'profile_overlay_modal') {
        const { updateUserData } = require('./dataManager');
        const overlayType = interaction.fields.getTextInputValue('overlay_type').toLowerCase();

        const validTypes = ['dark', 'light', 'none'];
        if (!validTypes.includes(overlayType)) {
            return interaction.reply({ 
                content: '<:Cancel:1521227723916181644> Invalid overlay type! Use: dark, light, or none', 
                flags: MessageFlags.Ephemeral 
            });
        }

        await updateUserData(userId, {
            'profile.overlay': overlayType.charAt(0).toUpperCase() + overlayType.slice(1)
        });

        await interaction.reply({ 
            content: `<:Checkedbox:1521227734943269077> Overlay effect set to ${overlayType}!`, 
            flags: MessageFlags.Ephemeral 
        });

        return;
    }

    if (interaction.customId === 'profile_border_modal') {
        const { updateUserData } = require('./dataManager');
        const borderHex = interaction.fields.getTextInputValue('border_hex');

        if (borderHex && !borderHex.match(/^#?([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/)) {
            return interaction.reply({ 
                content: '<:Cancel:1521227723916181644> Invalid hex color! Use format like #bcf1e4 or #5F2', 
                flags: MessageFlags.Ephemeral 
            });
        }

        const formattedColor = borderHex ? (borderHex.startsWith('#') ? borderHex : `#${borderHex}`) : null;
        await updateUserData(userId, {
            'profile.borderColor': formattedColor
        });

        await interaction.reply({ 
            content: formattedColor 
                ? `<:Checkedbox:1521227734943269077> Border color set to ${formattedColor}!` 
                : '<:Checkedbox:1521227734943269077> Border removed!', 
            flags: MessageFlags.Ephemeral 
        });

        return;
    }

    // Rank card customization modals
    if (interaction.customId === 'rankcard_background_modal') {
        const { updateUserData, getUserData } = require('./dataManager');
        const backgroundUrl = interaction.fields.getTextInputValue('background_url');

        if (backgroundUrl && !backgroundUrl.match(/^https?:\/\/.+\.(jpg|jpeg|png|gif|webp)/i)) {
            return interaction.reply({ 
                content: '<:Cancel:1521227723916181644> Invalid image URL! Please provide a valid image URL (jpg, png, gif, webp).', 
                flags: MessageFlags.Ephemeral 
            });
        }

        await updateUserData(userId, {
            'profile.rankCard.customBackground': backgroundUrl || null
        });

        await interaction.reply({ 
            content: backgroundUrl 
                ? '<:Checkedbox:1521227734943269077> Rank card background image updated successfully! Use the **Refresh** button to see changes.' 
                : '<:Checkedbox:1521227734943269077> Rank card background image reset to default! Use the **Refresh** button to see changes.', 
            flags: MessageFlags.Ephemeral 
        });

        return;
    }

    if (interaction.customId === 'rankcard_banner_modal') {
        const { updateUserData } = require('./dataManager');
        const bannerUrl = interaction.fields.getTextInputValue('banner_url');

        if (bannerUrl && !bannerUrl.match(/^https?:\/\/.+\.(jpg|jpeg|png|gif|webp)/i)) {
            return interaction.reply({
                content: '<:Cancel:1521227723916181644> Invalid image URL! Please provide a valid image URL (jpg, png, gif, webp).',
                flags: MessageFlags.Ephemeral
            });
        }

        await updateUserData(userId, {
            'profile.rankCard.bannerImage': bannerUrl || null
        });

        await interaction.reply({
            content: bannerUrl
                ? '<:Checkedbox:1521227734943269077> Rank card banner updated! Use the **Refresh** button to see changes.'
                : '<:Checkedbox:1521227734943269077> Rank card banner removed! Use the **Refresh** button to see changes.',
            flags: MessageFlags.Ephemeral
        });

        return;
    }

    if (interaction.customId === 'rankcard_bgcolor_modal') {
        const { updateUserData, getUserData } = require('./dataManager');
        const colorHex = interaction.fields.getTextInputValue('bgcolor_hex');

        if (!colorHex.match(/^#?([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/)) {
            return interaction.reply({ 
                content: '<:Cancel:1521227723916181644> Invalid hex color! Use format like #bcf1e4 or #FFF', 
                flags: MessageFlags.Ephemeral 
            });
        }

        const formattedColor = colorHex.startsWith('#') ? colorHex : `#${colorHex}`;
        await updateUserData(userId, {
            'profile.rankCard.backgroundColor': formattedColor
        });

        await interaction.reply({ 
            content: `<:Checkedbox:1521227734943269077> Rank card background color set to ${formattedColor}! Use the **Refresh** button to see changes.`, 
            flags: MessageFlags.Ephemeral 
        });

        return;
    }

    if (interaction.customId === 'rankcard_progresscolor_modal') {
        const { updateUserData, getUserData } = require('./dataManager');
        const colorHex = interaction.fields.getTextInputValue('progresscolor_hex');

        if (!colorHex.match(/^#?([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/)) {
            return interaction.reply({ 
                content: '<:Cancel:1521227723916181644> Invalid hex color! Use format like #57F287 or #5F2', 
                flags: MessageFlags.Ephemeral 
            });
        }

        const formattedColor = colorHex.startsWith('#') ? colorHex : `#${colorHex}`;
        await updateUserData(userId, {
            'profile.rankCard.progressBarColor': formattedColor
        });

        await interaction.reply({ 
            content: `<:Checkedbox:1521227734943269077> Rank card progress bar color set to ${formattedColor}! Use the **Refresh** button to see changes.`, 
            flags: MessageFlags.Ephemeral 
        });

        return;
    }

    if (interaction.customId === 'rankcard_textcolor_modal') {
        const { updateUserData, getUserData } = require('./dataManager');
        const colorHex = interaction.fields.getTextInputValue('textcolor_hex');

        if (!colorHex.match(/^#?([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/)) {
            return interaction.reply({ 
                content: '<:Cancel:1521227723916181644> Invalid hex color! Use format like #ffffff or #FFF', 
                flags: MessageFlags.Ephemeral 
            });
        }

        const formattedColor = colorHex.startsWith('#') ? colorHex : `#${colorHex}`;
        await updateUserData(userId, {
            'profile.rankCard.textColor': formattedColor
        });

        await interaction.reply({ 
            content: `<:Checkedbox:1521227734943269077> Rank card text color set to ${formattedColor}! Use the **Refresh** button to see changes.`, 
            flags: MessageFlags.Ephemeral 
        });
        return true;
    }

    if (interaction.customId === 'rankcard_opacity_modal') {
        const { updateUserData } = require('./dataManager');
        const opacityValue = parseFloat(interaction.fields.getTextInputValue('opacity_value'));

        if (isNaN(opacityValue) || opacityValue < 0.1 || opacityValue > 1.0) {
            return interaction.reply({ 
                content: '<:Cancel:1521227723916181644> Invalid opacity! Use a value between 0.1 and 1.0 (e.g., 0.4, 0.7, 1.0)', 
                flags: MessageFlags.Ephemeral 
            });
        }

        await updateUserData(userId, {
            'profile.rankCard.backgroundOpacity': opacityValue
        });

        await interaction.reply({ 
            content: `<:Checkedbox:1521227734943269077> Rank card background opacity set to ${opacityValue}! Use the **Refresh** button to see changes.`, 
            flags: MessageFlags.Ephemeral 
        });
        return true;
    }

    if (interaction.customId === 'profile_opacity_modal') {
        const { updateUserData } = require('./dataManager');
        const opacityValue = parseFloat(interaction.fields.getTextInputValue('opacity_value'));

        if (isNaN(opacityValue) || opacityValue < 0.1 || opacityValue > 1.0) {
            return interaction.reply({ 
                content: '<:Cancel:1521227723916181644> Invalid opacity! Use a value between 0.1 and 1.0 (e.g., 0.4, 0.7, 1.0)', 
                flags: MessageFlags.Ephemeral 
            });
        }

        await updateUserData(userId, {
            'profile.profileCard.backgroundOpacity': opacityValue
        });

        await interaction.reply({ 
            content: `<:Checkedbox:1521227734943269077> Profile card background opacity set to ${opacityValue}! Use the **Refresh** button to see changes.`, 
            flags: MessageFlags.Ephemeral 
        });

        return;
    }

    // Components v2 Welcomer channel select
    if (interaction.customId === 'welcomer_comp_select_channel') {
        const channelId = interaction.values[0];
        const channel = interaction.guild.channels.cache.get(channelId);

        if (!channel) {
            return interaction.reply({ content: '<:Cancel:1521227723916181644> Selected channel not found!', flags: MessageFlags.Ephemeral });
        }

        if (!jsonStore.has('welcomer')) {
            jsonStore.write('welcomer', {});
        }

        const config = jsonStore.read('welcomer');
        if (!config[guildId]) config[guildId] = {};

        config[guildId].channelId = channelId;
        config[guildId].displayType = 'components';
        jsonStore.write('welcomer', config);

        await interaction.reply({ content: `<:Checkedbox:1521227734943269077> Welcome channel set to ${channel}!`, flags: MessageFlags.Ephemeral });
    }

    else if (interaction.customId === 'welcomer_comp_modal_message') {
        const messageContent = interaction.fields.getTextInputValue('message_content');

        if (!jsonStore.has('welcomer')) {
            jsonStore.write('welcomer', {});
        }

        const config = jsonStore.read('welcomer');
        if (!config[guildId]) config[guildId] = {};

        config[guildId].content = messageContent;
        config[guildId].displayType = 'components';
        jsonStore.write('welcomer', config);

        await interaction.reply({ content: '<:Checkedbox:1521227734943269077> Welcome message configured!', flags: MessageFlags.Ephemeral });
    }

    else if (interaction.customId === 'welcomer_comp_modal_color') {
        const colorInput = interaction.fields.getTextInputValue('color_value');

        const colorMap = {
            'red': 0xFF0000, 'green': 0x00FF00, 'blue': 0x0000FF,
            'yellow': 0xFFFF00, 'purple': 0x9B59B6, 'orange': 0xFFA500,
            'pink': 0xFFC0CB, 'blurple': 0x5865F2
        };

        let color = colorMap[colorInput.toLowerCase()];
        if (!color && colorInput.startsWith('#')) {
            color = parseInt(colorInput.replace('#', ''), 16);
        }

        if (!jsonStore.has('welcomer')) {
            jsonStore.write('welcomer', {});
        }

        const config = jsonStore.read('welcomer');
        if (!config[guildId]) config[guildId] = {};

        config[guildId].containerColor = color;
        config[guildId].displayType = 'components';
        jsonStore.write('welcomer', config);

        await interaction.reply({ content: '<:Checkedbox:1521227734943269077> Container color set!', flags: MessageFlags.Ephemeral });
    }

    else if (interaction.customId === 'welcomer_comp_modal_media') {
        const mediaUrl = interaction.fields.getTextInputValue('media_url');
        const mediaDesc = interaction.fields.getTextInputValue('media_description') || '';

        if (!mediaUrl || (!mediaUrl.startsWith('http://') && !mediaUrl.startsWith('https://'))) {
            return interaction.reply({ content: '<:Cancel:1521227723916181644> Invalid URL! Please provide a valid image URL.', flags: MessageFlags.Ephemeral });
        }

        if (!jsonStore.has('welcomer')) {
            jsonStore.write('welcomer', {});
        }

        const config = jsonStore.read('welcomer');
        if (!config[guildId]) config[guildId] = {};

        config[guildId].mediaGallery = { url: mediaUrl, description: mediaDesc };
        config[guildId].displayType = 'components';
        jsonStore.write('welcomer', config);

        await interaction.reply({ content: '<:Checkedbox:1521227734943269077> Media gallery added!', flags: MessageFlags.Ephemeral });
    }

    else if (interaction.customId === 'welcomer_comp_modal_thumbnail') {
        const thumbnailUrl = interaction.fields.getTextInputValue('thumbnail_url');
        const thumbnailDesc = interaction.fields.getTextInputValue('thumbnail_description') || '';

        if (!thumbnailUrl || (!thumbnailUrl.startsWith('http://') && !thumbnailUrl.startsWith('https://'))) {
            return interaction.reply({ content: '<:Cancel:1521227723916181644> Invalid URL! Please provide a valid image URL.', flags: MessageFlags.Ephemeral });
        }

        if (!jsonStore.has('welcomer')) {
            jsonStore.write('welcomer', {});
        }

        const config = jsonStore.read('welcomer');
        if (!config[guildId]) config[guildId] = {};

        config[guildId].thumbnail = { url: thumbnailUrl, description: thumbnailDesc };
        config[guildId].displayType = 'components';
        jsonStore.write('welcomer', config);

        await interaction.reply({ content: '<:Checkedbox:1521227734943269077> Thumbnail added!', flags: MessageFlags.Ephemeral });
    }

    else if (interaction.customId === 'welcomer_comp_modal_canvas') {
        const enabledValue = interaction.fields.getTextInputValue('canvas_enabled').toLowerCase();
        const enabled = enabledValue === 'true' || enabledValue === 'yes' || enabledValue === '1';
        const bgColor = interaction.fields.getTextInputValue('canvas_bgcolor') || null;
        const accentColor = interaction.fields.getTextInputValue('canvas_accent') || null;
        const customMessage = interaction.fields.getTextInputValue('canvas_message') || null;

        if (!jsonStore.has('welcomer')) {
            jsonStore.write('welcomer', {});
        }

        const config = jsonStore.read('welcomer');
        if (!config[guildId]) config[guildId] = {};
        if (!config[guildId].canvas) config[guildId].canvas = {};

        config[guildId].canvas.enabled = enabled;
        if (bgColor) config[guildId].canvas.backgroundColor = bgColor;
        if (accentColor) config[guildId].canvas.accentColor = accentColor;
        if (customMessage) config[guildId].canvas.customMessage = customMessage;

        jsonStore.write('welcomer', config);

        await interaction.reply({ 
            content: `<:Palette:1521227950601539755> Canvas mode ${enabled ? 'enabled' : 'disabled'}! ${enabled ? 'Welcome messages will now be sent as beautiful canvas images.' : ''}`, 
            flags: MessageFlags.Ephemeral 
        });
    }

    // Welcomer channel select (legacy handler)
    else if (interaction.customId === 'welcomer_select_channel') {
        const channelId = interaction.values[0];
        const channel = interaction.guild.channels.cache.get(channelId);

        if (!channel) {
            return interaction.reply({ content: '<:Cancel:1521227723916181644> Selected channel not found!', flags: MessageFlags.Ephemeral });
        }

        if (!jsonStore.has('welcomer')) {
            jsonStore.write('welcomer', {});
        }

        const config = jsonStore.read('welcomer');

        if (!config[guildId]) config[guildId] = {};
        config[guildId].channelId = channelId;

        jsonStore.write('welcomer', config);

        // Update the original message with live preview if available
        try {
            const updatedContent = createWelcomerBuilderUI(config[guildId], guildId);
            const setupButtons = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder().setCustomId('welcomer_setup_channel').setLabel('Set Channel').setStyle(ButtonStyle.Primary).setEmoji('<:Pin:1521227932625014916>'),
                    new ButtonBuilder().setCustomId('welcomer_setup_message').setLabel('Configure Message').setStyle(ButtonStyle.Primary).setEmoji('<:Envelope:1521228013910626426> '),
                    new ButtonBuilder().setCustomId('welcomer_setup_embed').setLabel('Configure Embed').setStyle(ButtonStyle.Primary).setEmoji('<:Caretright:1521227704953864202>')
                );
            const controlButtons = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder().setCustomId('welcomer_toggle_enable').setLabel('Enable').setStyle(ButtonStyle.Success).setEmoji('<:Toggleon:1521227758011809964>'),
                    new ButtonBuilder().setCustomId('welcomer_toggle_disable').setLabel('Disable').setStyle(ButtonStyle.Danger).setEmoji('<:Toggleoff:1521227763816595559>'),
                    new ButtonBuilder().setCustomId('welcomer_preview').setLabel('Preview').setStyle(ButtonStyle.Secondary).setEmoji('<:Eye:1521227940480815156>')
                );

            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(updatedContent))
                .addActionRowComponents(setupButtons)
                .addActionRowComponents(controlButtons);

            if (interaction.message) {
                await interaction.message.edit({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }
        } catch (error) {
            log.error('Failed to update message:', error);
        }

        await interaction.reply({ content: `<:Checkedbox:1521227734943269077> Welcome channel set to ${channel}!`, flags: MessageFlags.Ephemeral });
    }

    else if (interaction.customId === 'leave_select_channel') {
        const channelId = interaction.values[0];
        const channel = interaction.guild.channels.cache.get(channelId);

        if (!channel) {
            return interaction.reply({ content: '<:Cancel:1521227723916181644> Selected channel not found!', flags: MessageFlags.Ephemeral });
        }

        if (!jsonStore.has('welcomer')) {
            jsonStore.write('welcomer', {});
        }

        const config = jsonStore.read('welcomer');

        if (!config[guildId]) config[guildId] = {};
        if (!config[guildId].leave) config[guildId].leave = {};
        config[guildId].leave.channelId = channelId;

        jsonStore.write('welcomer', config);

        await interaction.reply({ content: `<:Checkedbox:1521227734943269077> Leave channel set to ${channel}!`, flags: MessageFlags.Ephemeral });
    }

    else if (interaction.customId === 'welcomer_modal_message') {
        const title = interaction.fields.getTextInputValue('message_title');
        const description = interaction.fields.getTextInputValue('message_description');


        if (!jsonStore.has('welcomer')) {
            jsonStore.write('welcomer', {});
        }

        const config = jsonStore.read('welcomer');

        if (!config[guildId]) config[guildId] = {};
        if (title) config[guildId].title = title;
        if (description) config[guildId].description = description;

        jsonStore.write('welcomer', config);

        // Update the original message with live preview
        try {
            const updatedContent = createWelcomerBuilderUI(config[guildId], guildId);
            const setupButtons = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder().setCustomId('welcomer_setup_channel').setLabel('Set Channel').setStyle(ButtonStyle.Primary).setEmoji('<:Pin:1521227932625014916>'),
                    new ButtonBuilder().setCustomId('welcomer_setup_message').setLabel('Configure Message').setStyle(ButtonStyle.Primary).setEmoji('<:Envelope:1521228013910626426> '),
                    new ButtonBuilder().setCustomId('welcomer_setup_embed').setLabel('Configure Embed').setStyle(ButtonStyle.Primary).setEmoji('<:Caretright:1521227704953864202>')
                );
            const controlButtons = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder().setCustomId('welcomer_toggle_enable').setLabel('Enable').setStyle(ButtonStyle.Success).setEmoji('<:Toggleon:1521227758011809964>'),
                    new ButtonBuilder().setCustomId('welcomer_toggle_disable').setLabel('Disable').setStyle(ButtonStyle.Danger).setEmoji('<:Toggleoff:1521227763816595559>'),
                    new ButtonBuilder().setCustomId('welcomer_preview').setLabel('Preview').setStyle(ButtonStyle.Secondary).setEmoji('<:Eye:1521227940480815156>')
                );

            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(updatedContent))
                .addActionRowComponents(setupButtons)
                .addActionRowComponents(controlButtons);

            await interaction.message.edit({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            log.error('Failed to update message:', error);
        }

        await interaction.reply({ content: '<:Checkedbox:1521227734943269077> Welcome message configured!', flags: MessageFlags.Ephemeral });
    }

    else if (interaction.customId === 'welcomer_modal_embed') {
        const color = interaction.fields.getTextInputValue('embed_color');
        const image = interaction.fields.getTextInputValue('embed_image');
        const thumbnail = interaction.fields.getTextInputValue('embed_thumbnail');
        const footer = interaction.fields.getTextInputValue('embed_footer');
        const author = interaction.fields.getTextInputValue('embed_author');


        if (!jsonStore.has('welcomer')) {
            jsonStore.write('welcomer', {});
        }

        const config = jsonStore.read('welcomer');

        if (!config[guildId]) config[guildId] = {};
        if (color) config[guildId].color = color;
        if (image) config[guildId].image = image;
        if (thumbnail) config[guildId].thumbnail = thumbnail;
        if (footer) config[guildId].footer = footer;
        if (author) config[guildId].author = author;

        jsonStore.write('welcomer', config);

        // Update the original message with live preview
        try {
            const updatedContent = createWelcomerBuilderUI(config[guildId], guildId);
            const setupButtons = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder().setCustomId('welcomer_setup_channel').setLabel('Set Channel').setStyle(ButtonStyle.Primary).setEmoji('<:Pin:1521227932625014916>'),
                    new ButtonBuilder().setCustomId('welcomer_setup_message').setLabel('Configure Message').setStyle(ButtonStyle.Primary).setEmoji('<:Envelope:1521228013910626426> '),
                    new ButtonBuilder().setCustomId('welcomer_setup_embed').setLabel('Configure Embed').setStyle(ButtonStyle.Primary).setEmoji('<:Caretright:1521227704953864202>')
                );
            const controlButtons = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder().setCustomId('welcomer_toggle_enable').setLabel('Enable').setStyle(ButtonStyle.Success).setEmoji('<:Toggleon:1521227758011809964>'),
                    new ButtonBuilder().setCustomId('welcomer_toggle_disable').setLabel('Disable').setStyle(ButtonStyle.Danger).setEmoji('<:Toggleoff:1521227763816595559>'),
                    new ButtonBuilder().setCustomId('welcomer_preview').setLabel('Preview').setStyle(ButtonStyle.Secondary).setEmoji('<:Eye:1521227940480815156>')
                );

            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(updatedContent))
                .addActionRowComponents(setupButtons)
                .addActionRowComponents(controlButtons);

            await interaction.message.edit({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            log.error('Failed to update message:', error);
        }

        await interaction.reply({ content: '<:Checkedbox:1521227734943269077> Embed styling configured!', flags: MessageFlags.Ephemeral });
    }

    else if (interaction.customId === 'welcomer_modal_canvas') {
        const enabledValue = interaction.fields.getTextInputValue('canvas_enabled').toLowerCase();
        const enabled = enabledValue === 'true' || enabledValue === 'yes' || enabledValue === '1';
        const bgColor = interaction.fields.getTextInputValue('canvas_bgcolor') || null;
        const accentColor = interaction.fields.getTextInputValue('canvas_accent') || null;
        const customMessage = interaction.fields.getTextInputValue('canvas_message') || null;

        if (!jsonStore.has('welcomer')) {
            jsonStore.write('welcomer', {});
        }

        const config = jsonStore.read('welcomer');
        if (!config[guildId]) config[guildId] = {};
        if (!config[guildId].canvas) config[guildId].canvas = {};

        config[guildId].canvas.enabled = enabled;
        if (bgColor) config[guildId].canvas.backgroundColor = bgColor;
        if (accentColor) config[guildId].canvas.accentColor = accentColor;
        if (customMessage) config[guildId].canvas.customMessage = customMessage;

        jsonStore.write('welcomer', config);

        // Update the original message with refreshed UI
        try {
            const guildConfig = config[guildId] || {};
            const canvasStatus = guildConfig.canvas?.enabled ? '<:Toggleon:1521227758011809964> Enabled' : '<:Toggleoff:1521227763816595559> Disabled';

            const setupButtons = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder().setCustomId('welcomer_setup_channel').setLabel('Set Channel').setStyle(ButtonStyle.Primary).setEmoji('<:Pin:1521227932625014916>'),
                    new ButtonBuilder().setCustomId('welcomer_setup_message').setLabel('Configure Message').setStyle(ButtonStyle.Primary).setEmoji('<:Envelope:1521228013910626426> '),
                    new ButtonBuilder().setCustomId('welcomer_setup_embed').setLabel('Configure Embed').setStyle(ButtonStyle.Primary).setEmoji('<:Caretright:1521227704953864202>'),
                    new ButtonBuilder().setCustomId('welcomer_setup_canvas').setLabel('Canvas Mode').setStyle(guildConfig.canvas?.enabled ? ButtonStyle.Success : ButtonStyle.Secondary).setEmoji('<:Palette:1521227950601539755>')
                );
            const controlButtons = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder().setCustomId('welcomer_toggle_enable').setLabel('Enable').setStyle(ButtonStyle.Success).setEmoji('<:Toggleon:1521227758011809964>'),
                    new ButtonBuilder().setCustomId('welcomer_toggle_disable').setLabel('Disable').setStyle(ButtonStyle.Danger).setEmoji('<:Toggleoff:1521227763816595559>'),
                    new ButtonBuilder().setCustomId('welcomer_preview').setLabel('Preview').setStyle(ButtonStyle.Secondary).setEmoji('<:Eye:1521227940480815156>')
                );

            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(createWelcomerBuilderUI(config[guildId], guildId) + `\n\n**<:Palette:1521227950601539755> Canvas Mode:** ${canvasStatus}`))
                .addActionRowComponents(setupButtons)
                .addActionRowComponents(controlButtons);

            await interaction.message.edit({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            log.error('Failed to update message:', error);
        }

        await interaction.reply({ 
            content: `<:Palette:1521227950601539755> Canvas mode ${enabled ? 'enabled' : 'disabled'}! ${enabled ? 'Welcome messages will now be sent as beautiful canvas images.' : ''}`, 
            flags: MessageFlags.Ephemeral 
        });
    }

    else if (interaction.customId === 'welcomer_modal_media') {
        const mediaUrl = interaction.fields.getTextInputValue('media_url') || null;

        if (!jsonStore.has('welcomer')) {
            jsonStore.write('welcomer', {});
        }

        const config = jsonStore.read('welcomer');
        if (!config[guildId]) config[guildId] = {};

        if (mediaUrl) {
            config[guildId].image = mediaUrl;
            config[guildId].mediaUrl = mediaUrl;
        } else {
            delete config[guildId].image;
            delete config[guildId].mediaUrl;
        }

        jsonStore.write('welcomer', config);

        try {
            const guildConfig = config[guildId] || {};
            const mediaStatus = guildConfig.image ? '<:Checkedbox:1521227734943269077> Set' : '<:Cancel:1521227723916181644> Not set';

            const setupButtons = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder().setCustomId('welcomer_setup_channel').setLabel('Set Channel').setStyle(ButtonStyle.Primary).setEmoji('<:Pin:1521227932625014916>'),
                    new ButtonBuilder().setCustomId('welcomer_setup_message').setLabel('Configure Message').setStyle(ButtonStyle.Primary).setEmoji('<:Envelope:1521228013910626426> '),
                    new ButtonBuilder().setCustomId('welcomer_setup_embed').setLabel('Configure Embed').setStyle(ButtonStyle.Primary).setEmoji('<:Caretright:1521227704953864202>'),
                    new ButtonBuilder().setCustomId('welcomer_setup_media').setLabel('Media/Image').setStyle(guildConfig.image ? ButtonStyle.Success : ButtonStyle.Secondary).setEmoji('<:Picture:1521227954191995024>')
                );
            const controlButtons = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder().setCustomId('welcomer_setup_canvas').setLabel('Canvas Mode').setStyle(guildConfig.canvas?.enabled ? ButtonStyle.Success : ButtonStyle.Secondary).setEmoji('<:Palette:1521227950601539755>'),
                    new ButtonBuilder().setCustomId('welcomer_toggle_enable').setLabel('Enable').setStyle(ButtonStyle.Success).setEmoji('<:Toggleon:1521227758011809964>'),
                    new ButtonBuilder().setCustomId('welcomer_toggle_disable').setLabel('Disable').setStyle(ButtonStyle.Danger).setEmoji('<:Toggleoff:1521227763816595559>'),
                    new ButtonBuilder().setCustomId('welcomer_preview').setLabel('Preview').setStyle(ButtonStyle.Secondary).setEmoji('<:Eye:1521227940480815156>')
                );

            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(createWelcomerBuilderUI(config[guildId], guildId) + `\n\n**<:Picture:1521227954191995024> Media/Image:** ${mediaStatus}`))
                .addActionRowComponents(setupButtons)
                .addActionRowComponents(controlButtons);

            await interaction.message.edit({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            log.error('Failed to update message:', error);
        }

        await interaction.reply({ 
            content: mediaUrl ? `<:Picture:1521227954191995024> Media image has been set!\n\nImage URL: ${mediaUrl}` : '<:Trash:1521227750420254820> Media image has been removed!', 
            flags: MessageFlags.Ephemeral 
        });
    }

    // Embed builder modals
    else if (interaction.customId === 'embed_modal_basic') {
        const data = embedData.get(key) || {};
        const messageKey = `embed-${key}`;
        const title = interaction.fields.getTextInputValue('embed_title');
        const description = interaction.fields.getTextInputValue('embed_description');

        if (title) data.title = title;
        if (description) data.description = description;

        embedData.set(key, data);
        await updateEmbedBuilderMessage(interaction, messageKey, data);
        await interaction.reply({ content: '<:Checkedbox:1521227734943269077> Title and description updated!', flags: MessageFlags.Ephemeral });
    }

    else if (interaction.customId === 'embed_modal_media') {
        const data = embedData.get(key) || {};
        const messageKey = `embed-${key}`;
        const image = interaction.fields.getTextInputValue('embed_image');
        const thumbnail = interaction.fields.getTextInputValue('embed_thumbnail');

        if (image) data.image = image;
        if (thumbnail) data.thumbnail = thumbnail;

        embedData.set(key, data);
        await updateEmbedBuilderMessage(interaction, messageKey, data);
        await interaction.reply({ content: '<:Checkedbox:1521227734943269077> Images updated!', flags: MessageFlags.Ephemeral });
    }

    else if (interaction.customId === 'embed_modal_footer') {
        const data = embedData.get(key) || {};
        const messageKey = `embed-${key}`;
        const footer = interaction.fields.getTextInputValue('embed_footer');
        const footerIcon = interaction.fields.getTextInputValue('embed_footer_icon');
        const author = interaction.fields.getTextInputValue('embed_author');
        const authorIcon = interaction.fields.getTextInputValue('embed_author_icon');
        const authorUrl = interaction.fields.getTextInputValue('embed_author_url');

        if (footer) {
            data.footer = { text: footer };
            if (footerIcon) data.footer.iconURL = footerIcon;
        }
        if (author) {
            data.author = { name: author };
            if (authorIcon) data.author.iconURL = authorIcon;
            if (authorUrl) data.author.url = authorUrl;
        }

        embedData.set(key, data);
        await updateEmbedBuilderMessage(interaction, messageKey, data);
        await interaction.reply({ content: '<:Checkedbox:1521227734943269077> Footer and author updated!', flags: MessageFlags.Ephemeral });
    }

    else if (interaction.customId === 'embed_modal_color') {
        const data = embedData.get(key) || {};
        const messageKey = `embed-${key}`;
        const colorInput = interaction.fields.getTextInputValue('embed_color');

        const colorMap = {
            'red': 0xFF0000, 'green': 0x00FF00, 'blue': 0x0000FF,
            'yellow': 0xFFFF00, 'purple': 0x9B59B6, 'orange': 0xFFA500,
            'pink': 0xFFC0CB, 'blurple': 0x5865F2
        };

        let color = colorMap[colorInput.toLowerCase()];
        if (!color && colorInput.startsWith('#')) {
            color = parseInt(colorInput.replace('#', ''), 16);
        }

        if (color) {
            data.color = color;
            embedData.set(key, data);
            await updateEmbedBuilderMessage(interaction, messageKey, data);
            await interaction.reply({ content: '<:Checkedbox:1521227734943269077> Color updated!', flags: MessageFlags.Ephemeral });
        } else {
            await interaction.reply({ content: '<:Cancel:1521227723916181644> Invalid color! Use hex (#bcf1e4) or name (red, blue, etc.)', flags: MessageFlags.Ephemeral });
        }
    }

    else if (interaction.customId === 'embed_modal_fields') {
        const data = embedData.get(key) || {};
        const messageKey = `embed-${key}`;
        const name = interaction.fields.getTextInputValue('field_name');
        const value = interaction.fields.getTextInputValue('field_value');
        const inlineInput = interaction.fields.getTextInputValue('field_inline') || 'no';
        const inline = inlineInput.toLowerCase() === 'yes' || inlineInput === 'true';

        if (!data.fields) data.fields = [];
        data.fields.push({ name, value, inline });

        embedData.set(key, data);
        await updateEmbedBuilderMessage(interaction, messageKey, data);
        await interaction.reply({ content: `<:Checkedbox:1521227734943269077> Field added! (Total: ${data.fields.length})`, flags: MessageFlags.Ephemeral });
    }

    else if (interaction.customId === 'embed_modal_send_channel') {
        const messageKey = `embed-${key}`;
        const channelInput = interaction.fields.getTextInputValue('target_channel');
        const channelId = channelInput.replace(/[<#>]/g, '');
        const channel = interaction.guild.channels.cache.get(channelId);

        if (!channel) {
            return interaction.reply({ content: '<:Cancel:1521227723916181644> Invalid channel!', flags: MessageFlags.Ephemeral });
        }

        const data = embedData.get(key) || {};
        const embed = createEmbedFromData(data, interaction.user, interaction.guild, interaction.channel);

        await channel.send({ embeds: [embed] });
        await interaction.reply({ content: `<:Checkedbox:1521227734943269077> Embed sent to ${channel}!`, flags: MessageFlags.Ephemeral });
        embedData.delete(key);
        builderMessages.delete(messageKey);
    }

    // Components modals
    else if (interaction.customId === 'components_modal_content') {
        const data = componentsData.get(key) || {};
        const messageKey = `components-${key}`;
        const content = interaction.fields.getTextInputValue('component_content');

        data.content = content;
        componentsData.set(key, data);

        await updateComponentsBuilderMessage(interaction, messageKey, data);
        await interaction.reply({ content: '<:Checkedbox:1521227734943269077> Content set!', flags: MessageFlags.Ephemeral });
    }

    else if (interaction.customId === 'components_modal_media') {
        const data = componentsData.get(key) || {};
        const messageKey = `components-${key}`;
        const mediaUrl = interaction.fields.getTextInputValue('media_url');
        const mediaDesc = interaction.fields.getTextInputValue('media_description') || '';

        // Validate URL
        if (mediaUrl && (mediaUrl.startsWith('http://') || mediaUrl.startsWith('https://'))) {
            data.mediaGallery = {
                url: mediaUrl,
                description: mediaDesc
            };
            componentsData.set(key, data);

            await updateComponentsBuilderMessage(interaction, messageKey, data);
            await interaction.reply({ content: '<:Checkedbox:1521227734943269077> Media gallery added!', flags: MessageFlags.Ephemeral });
        } else {
            await interaction.reply({ content: '<:Cancel:1521227723916181644> Invalid URL! Please provide a valid image URL.', flags: MessageFlags.Ephemeral });
        }
    }

    else if (interaction.customId === 'components_modal_thumbnail') {
        const data = componentsData.get(key) || {};
        const messageKey = `components-${key}`;
        const thumbnailUrl = interaction.fields.getTextInputValue('thumbnail_url');
        const thumbnailDesc = interaction.fields.getTextInputValue('thumbnail_description') || '';

        // Validate URL
        if (thumbnailUrl && (thumbnailUrl.startsWith('http://') || thumbnailUrl.startsWith('https://'))) {
            data.thumbnail = {
                url: thumbnailUrl,
                description: thumbnailDesc
            };
            componentsData.set(key, data);

            await updateComponentsBuilderMessage(interaction, messageKey, data);
            await interaction.reply({ content: '<:Checkedbox:1521227734943269077> Thumbnail added!', flags: MessageFlags.Ephemeral });
        } else {
            await interaction.reply({ content: '<:Cancel:1521227723916181644> Invalid URL! Please provide a valid image URL.', flags: MessageFlags.Ephemeral });
        }
    }

    else if (interaction.customId === 'components_modal_color') {
        const data = componentsData.get(key) || {};
        const messageKey = `components-${key}`;
        const colorInput = interaction.fields.getTextInputValue('component_color');

        if (colorInput) {
            const colorMap = {
                'red': 0xFF0000, 'green': 0x00FF00, 'blue': 0x0000FF,
                'yellow': 0xFFFF00, 'purple': 0x9B59B6, 'orange': 0xFFA500,
                'pink': 0xFFC0CB, 'blurple': 0x5865F2
            };

            let color = colorMap[colorInput.toLowerCase()];
            if (!color && colorInput.startsWith('#')) {
                color = parseInt(colorInput.replace('#', ''), 16);
            }

            if (color) {
                data.color = color;
                componentsData.set(key, data);
                await updateComponentsBuilderMessage(interaction, messageKey, data);
                await interaction.reply({ content: '<:Checkedbox:1521227734943269077> Color set!', flags: MessageFlags.Ephemeral });
            } else {
                await interaction.reply({ content: '<:Cancel:1521227723916181644> Invalid color! Use hex (#bcf1e4) or name (red, blue, etc.)', flags: MessageFlags.Ephemeral });
            }
        } else {
            await interaction.reply({ content: '<:Cancel:1521227723916181644> Please provide a color!', flags: MessageFlags.Ephemeral });
        }
    }

    else if (interaction.customId === 'components_modal_send_channel') {
        const channelInput = interaction.fields.getTextInputValue('target_channel');
        const channelId = channelInput.replace(/[<#>]/g, '');
        const channel = interaction.guild.channels.cache.get(channelId);

        if (!channel) {
            return interaction.reply({ content: '<:Cancel:1521227723916181644> Invalid channel!', flags: MessageFlags.Ephemeral });
        }

        const data = componentsData.get(key) || {};

        if (!data.content) {
            return interaction.reply({ content: '<:Cancel:1521227723916181644> No component configured yet!', flags: MessageFlags.Ephemeral });
        }

        const container = createComponentContainer(data, interaction.user, interaction.guild, channel);

        await channel.send({ components: [container], flags: MessageFlags.IsComponentsV2 });
        await interaction.reply({ content: `<:Checkedbox:1521227734943269077> Component sent to ${channel}!`, flags: MessageFlags.Ephemeral });
        componentsData.delete(key);
    }

    else if (interaction.customId === 'autoresponder_modal_add') {
        const trigger = interaction.fields.getTextInputValue('trigger').toLowerCase().trim();
        const response = interaction.fields.getTextInputValue('response');
        const guildId = interaction.guild.id;

        if (!trigger) {
            return interaction.reply({ content: '<:Cancel:1521227723916181644> Trigger cannot be empty!', flags: MessageFlags.Ephemeral });
        }

        let config = {};
        if (jsonStore.has('autoresponder')) {
            config = jsonStore.read('autoresponder');
        }

        if (!config[guildId]) config[guildId] = { enabled: false, responses: [] };
        if (!config[guildId].responses) config[guildId].responses = [];

        const existing = config[guildId].responses.find(r => r.trigger === trigger);
        if (existing) {
            return interaction.reply({ content: `<:Cancel:1521227723916181644> A response for trigger \`${trigger}\` already exists! Remove it first.`, flags: MessageFlags.Ephemeral });
        }

        config[guildId].responses.push({ trigger, response });

        jsonStore.write('autoresponder', config);
        if (global.updateAutoresponderCache) {
            global.updateAutoresponderCache(guildId, config[guildId]);
        }
        await interaction.reply({ content: `<:Checkedbox:1521227734943269077> Autoresponse added!\nTrigger: \`${trigger}\``, flags: MessageFlags.Ephemeral });
    }

    else if (interaction.customId === 'autoresponder_modal_remove') {
        const rawInput = interaction.fields.getTextInputValue('index').trim();
        const index = parseInt(rawInput) - 1;
        const guildId = interaction.guild.id;

        if (isNaN(index) || index < 0) {
            return interaction.reply({ content: '<:Cancel:1521227723916181644> Please enter a valid number!', flags: MessageFlags.Ephemeral });
        }

        if (!jsonStore.has('autoresponder')) {
            return interaction.reply({ content: '<:Cancel:1521227723916181644> No config found!', flags: MessageFlags.Ephemeral });
        }

        const config = jsonStore.read('autoresponder');
        if (!config[guildId] || !config[guildId].responses || !config[guildId].responses[index]) {
            return interaction.reply({ content: '<:Cancel:1521227723916181644> Invalid number! Use the list button to see available responses.', flags: MessageFlags.Ephemeral });
        }

        const removed = config[guildId].responses.splice(index, 1)[0];
        jsonStore.write('autoresponder', config);
        if (global.updateAutoresponderCache) {
            global.updateAutoresponderCache(guildId, config[guildId]);
        }
        await interaction.reply({ content: `<:Checkedbox:1521227734943269077> Removed autoresponse: \`${removed.trigger}\``, flags: MessageFlags.Ephemeral });
    }

    else if (interaction.customId === 'autoreact_modal_add') {
        const trigger = interaction.fields.getTextInputValue('trigger').toLowerCase().trim();
        const emojisInput = interaction.fields.getTextInputValue('emojis');
        const emojis = emojisInput.split(/\s+/).filter(e => e.trim());
        const guildId = interaction.guild.id;

        if (!trigger) {
            return interaction.reply({ content: '<:Cancel:1521227723916181644> Trigger cannot be empty!', flags: MessageFlags.Ephemeral });
        }

        if (emojis.length === 0) {
            return interaction.reply({ content: '<:Cancel:1521227723916181644> Please provide at least one emoji!', flags: MessageFlags.Ephemeral });
        }

        let config = {};
        if (jsonStore.has('autoreact')) {
            config = jsonStore.read('autoreact');
        }

        if (!config[guildId]) config[guildId] = { enabled: false, reactions: [] };
        if (!config[guildId].reactions) config[guildId].reactions = [];

        const existing = config[guildId].reactions.find(r => r.trigger === trigger);
        if (existing) {
            return interaction.reply({ content: `<:Cancel:1521227723916181644> A reaction for trigger \`${trigger}\` already exists! Remove it first.`, flags: MessageFlags.Ephemeral });
        }

        config[guildId].reactions.push({ trigger, emojis });

        jsonStore.write('autoreact', config);
        if (global.updateAutoreactCache) {
            global.updateAutoreactCache(guildId, config[guildId]);
        }
        await interaction.reply({ content: `<:Toggleon:1521227758011809964> Autoreaction added!\nTrigger: \`${trigger}\`\nEmojis: ${emojis.join(' ')}`, flags: MessageFlags.Ephemeral });
    }

    else if (interaction.customId === 'autoreact_modal_remove') {
        const rawInput = interaction.fields.getTextInputValue('index').trim();
        const index = parseInt(rawInput) - 1;
        const guildId = interaction.guild.id;

        if (isNaN(index) || index < 0) {
            return interaction.reply({ content: '<:Cancel:1521227723916181644> Please enter a valid number!', flags: MessageFlags.Ephemeral });
        }

        if (!jsonStore.has('autoreact')) {
            return interaction.reply({ content: '<:Cancel:1521227723916181644> No config found!', flags: MessageFlags.Ephemeral });
        }

        const config = jsonStore.read('autoreact');
        if (!config[guildId] || !config[guildId].reactions || !config[guildId].reactions[index]) {
            return interaction.reply({ content: '<:Cancel:1521227723916181644> Invalid number! Use the list button to see available reactions.', flags: MessageFlags.Ephemeral });
        }

        const removed = config[guildId].reactions.splice(index, 1)[0];
        jsonStore.write('autoreact', config);
        if (global.updateAutoreactCache) {
            global.updateAutoreactCache(guildId, config[guildId]);
        }
        await interaction.reply({ content: `<:Checkedbox:1521227734943269077> Removed autoreaction: \`${removed.trigger}\``, flags: MessageFlags.Ephemeral });
    }

    // Anti-Nuke modals are handled by antinukeCmd.handleModal() in index.js
    // No fallback needed here — the primary handler in antinuke.js is authoritative

    else if (interaction.customId.startsWith('verification_captcha_')) {
        const { verifyCaptcha, getVerificationConfig } = require('./verificationManager');
        const sessionId = interaction.customId.replace('verification_captcha_', '');
        const answer = interaction.fields.getTextInputValue('captcha_answer');

        const result = verifyCaptcha(sessionId, answer);

        if (result.success) {
            const config = getVerificationConfig(interaction.guild.id);
            const role = interaction.guild.roles.cache.get(config.roleId);

            if (role) {
                try {
                    await interaction.member.roles.add(role);
                    await interaction.reply({
                        content: `<:Checkedbox:1521227734943269077> **Verification Successful!**\n\nYou have been verified and received the ${role} role!`,
                        flags: MessageFlags.Ephemeral
                    });
                } catch (error) {
                    log.error('Error assigning verification role:', error);
                    await interaction.reply({
                        content: '<:Cancel:1521227723916181644> Verification succeeded but failed to assign role. Please contact an administrator.',
                        flags: MessageFlags.Ephemeral
                    });
                }
            } else {
                await interaction.reply({
                    content: '<:Cancel:1521227723916181644> Verification role not found. Please contact an administrator.',
                    flags: MessageFlags.Ephemeral
                });
            }
        } else {
            await interaction.reply({
                content: `<:Cancel:1521227723916181644> ${result.error}`,
                flags: MessageFlags.Ephemeral
            });
        }
    }
}

function createEmbedFromData(data, user = null, guild = null, channel = null) {
    const embed = new EmbedBuilder();

    if (data.title) {
        const title = user ? replacePlaceholders(data.title, user, guild, channel) : data.title;
        embed.setTitle(title);
    }
    if (data.description) {
        const description = user ? replacePlaceholders(data.description, user, guild, channel) : data.description;
        embed.setDescription(description);
    }
    if (data.color) embed.setColor(data.color);
    if (data.image) {
        const imageUrl = user ? replacePlaceholders(data.image, user, guild, channel) : data.image;
        if (imageUrl && (imageUrl.startsWith('http://') || imageUrl.startsWith('https://'))) {
            embed.setImage(imageUrl);
        }
    }
    if (data.thumbnail) {
        const thumbnailUrl = user ? replacePlaceholders(data.thumbnail, user, guild, channel) : data.thumbnail;
        if (thumbnailUrl && (thumbnailUrl.startsWith('http://') || thumbnailUrl.startsWith('https://'))) {
            embed.setThumbnail(thumbnailUrl);
        }
    }
    if (data.footer) {
        const footerText = user ? replacePlaceholders(data.footer.text, user, guild, channel) : data.footer.text;
        const footerObj = { text: footerText };
        if (data.footer.iconURL) footerObj.iconURL = user ? replacePlaceholders(data.footer.iconURL, user, guild, channel) : data.footer.iconURL;
        embed.setFooter(footerObj);
    }
    if (data.author) {
        const authorName = user ? replacePlaceholders(data.author.name, user, guild, channel) : data.author.name;
        const authorObj = { name: authorName };
        if (data.author.iconURL) authorObj.iconURL = user ? replacePlaceholders(data.author.iconURL, user, guild, channel) : data.author.iconURL;
        if (data.author.url) authorObj.url = data.author.url;
        embed.setAuthor(authorObj);
    }
    if (data.fields) {
        data.fields.forEach(field => {
            const fieldName = user ? replacePlaceholders(field.name, user, guild, channel) : field.name;
            const fieldValue = user ? replacePlaceholders(field.value, user, guild, channel) : field.value;
            embed.addFields({ name: fieldName, value: fieldValue, inline: field.inline });
        });
    }

    embed.setTimestamp();

    return embed;
}

function createComponentContainer(data, user, guild, channel) {
    let content = data.content || '';
    const container = new ContainerBuilder();

    // Add thumbnail if provided
    if (data.thumbnail && data.thumbnail.url) {
        try {
            const url = replacePlaceholders(data.thumbnail.url, user, guild, channel);
            if (url && url.startsWith('http') && (url.match(/\.(jpg|jpeg|png|gif|webp)$/i) || url.includes('cdn.discordapp.com'))) {
                container.addThumbnailComponents(
                    new ThumbnailBuilder()
                        .setURL(url)
                );
            }
        } catch (e) {
            // Thumbnail parsing failed - non-critical
        }
    }

    // Parse content and separators (no global flag to avoid .test() side-effects)
    const separatorRegex = /\{separator:(small|medium|large)\}/i;
    const parts = content.split(separatorRegex);

    for (let i = 0; i < parts.length; i++) {
        if (i % 2 === 0) {
            // This is content
            const textContent = parts[i].trim();
            if (textContent) {
                const processedContent = replacePlaceholders(textContent, user, guild, channel);
                container.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(processedContent)
                );
            }
        } else {
            // This is a separator size
            const size = parts[i].toLowerCase();
            const spacingMap = {
                'small': SeparatorSpacingSize.Small,
                'medium': SeparatorSpacingSize.Medium,
                'large': SeparatorSpacingSize.Large
            };
            try {
                container.addSeparatorComponents(
                    new SeparatorBuilder()
                        .setDivider(true)
                        .setSpacing(spacingMap[size] || SeparatorSpacingSize.Medium)
                );
            } catch (e) {
                // Separator not supported in this context
            }
        }
    }

    // If no separators were found and content wasn't added by the loop, add it
    if (!separatorRegex.test(data.content || '') && parts.length <= 1) {
        const processedContent = replacePlaceholders(content, user, guild, channel);
        if (processedContent) {
            // Content was already added in the loop above, skip
        }
    }

    // Add media gallery if provided
    if (data.mediaGallery && data.mediaGallery.url) {
        try {
            const url = replacePlaceholders(data.mediaGallery.url, user, guild, channel);
            if (url && url.startsWith('http') && (url.match(/\.(jpg|jpeg|png|gif|webp)$/i) || url.includes('cdn.discordapp.com'))) {
                container.addMediaGalleryComponents(
                    new MediaGalleryBuilder()
                        .addItems((item) => {
                            item.setURL(url);
                            // Description is optional — empty string would throw.
                            const desc = String(data.mediaGallery.description ?? '').trim().slice(0, 1024);
                            if (desc) item.setDescription(desc);
                            return item;
                        })
                );
            }
        } catch (e) {
            // Media gallery error - non-critical
        }
    }

    return container;
}

function replacePlaceholders(text, user, guild, channel = null) {
    if (!text) return text;
    if (!user || !guild) return text;

    try {
    const member = guild.members.cache.get(user.id);
    const boostCount = guild.premiumSubscriptionCount || 0;
    const boostLevel = guild.premiumTier || 0;
    const roleList = member ? member.roles.cache.filter(r => r.id !== guild.id).map(r => r.name).join(', ') || 'None' : 'None';
    const highestRole = member ? (member.roles.highest?.name || 'None') : 'None';
    const highestRoleMention = member ? (member.roles.highest?.toString() || 'None') : 'None';
    const highestRoleColor = member ? (member.roles.highest?.hexColor || '#000000') : '#000000';
    const joinPosition = member ? [...guild.members.cache.values()].sort((a, b) => (a.joinedTimestamp || 0) - (b.joinedTimestamp || 0)).indexOf(member) + 1 : 0;
    const userAvatar = user.displayAvatarURL({ dynamic: true, size: 1024 });
    const userIcon = user.displayAvatarURL({ dynamic: true, size: 1024 });
    const roleCount = member ? member.roles.cache.size - 1 : 0;
    const onlineMembers = 0; // Presence Intent disabled – always 0
    const botCount = guild.members.cache.filter(m => m.user?.bot).size;
    const humanCount = guild.memberCount - botCount;
    const textChannels = guild.channels.cache.filter(c => c.type === 0).size;
    const voiceChannels = guild.channels.cache.filter(c => c.type === 2).size;
    const categories = guild.channels.cache.filter(c => c.type === 4).size;
    const emojiCount = guild.emojis.cache.size;
    const roleTotal = guild.roles.cache.size - 1;
    const verificationLevel = ['None', 'Low', 'Medium', 'High', 'Very High'][guild.verificationLevel] || 'None';

    // Timestamps
    const now = Math.floor(Date.now() / 1000);
    const userCreatedTimestamp = Math.floor(user.createdTimestamp / 1000);
    const userJoinedTimestamp = member ? Math.floor(member.joinedTimestamp / 1000) : now;
    const serverCreatedTimestamp = Math.floor(guild.createdTimestamp / 1000);

    return text
        // User Info
        .replace(/{user}/g, user.toString())
        .replace(/{usermention}/g, user.toString())
        .replace(/{username}/g, user.username)
        .replace(/{displayname}/g, member ? member.displayName : user.username)
        .replace(/{nickname}/g, member && member.nickname ? member.nickname : user.username)
        .replace(/{userid}/g, user.id)
        .replace(/{usertag}/g, user.username)
        .replace(/{discriminator}/g, user.discriminator)
        .replace(/{useravatar}/g, userAvatar)
        .replace(/{usericon}/g, userIcon)
        .replace(/{userbanner}/g, (user.bannerURL?.({ dynamic: true, size: 1024 })) || 'None')
        .replace(/{userbot}/g, user.bot ? 'Yes' : 'No')

        // User Timestamps (Multiple formats)
        .replace(/{usercreated}/g, `<t:${userCreatedTimestamp}:R>`)
        .replace(/{usercreated:relative}/g, `<t:${userCreatedTimestamp}:R>`)
        .replace(/{usercreated:date}/g, `<t:${userCreatedTimestamp}:D>`)
        .replace(/{usercreated:time}/g, `<t:${userCreatedTimestamp}:T>`)
        .replace(/{usercreated:full}/g, `<t:${userCreatedTimestamp}:F>`)
        .replace(/{userjoined}/g, member ? `<t:${userJoinedTimestamp}:R>` : 'N/A')
        .replace(/{userjoined:relative}/g, member ? `<t:${userJoinedTimestamp}:R>` : 'N/A')
        .replace(/{userjoined:date}/g, member ? `<t:${userJoinedTimestamp}:D>` : 'N/A')
        .replace(/{userjoined:time}/g, member ? `<t:${userJoinedTimestamp}:T>` : 'N/A')
        .replace(/{userjoined:full}/g, member ? `<t:${userJoinedTimestamp}:F>` : 'N/A')

        // User Roles
        .replace(/{roles}/g, roleList)
        .replace(/{rolecount}/g, roleCount.toString())
        .replace(/{highestrole}/g, highestRole)
        .replace(/{highestrolemention}/g, highestRoleMention)
        .replace(/{highestrolecolor}/g, highestRoleColor)
        .replace(/{joinposition}/g, joinPosition.toString())

        // Server Info
        .replace(/{server}/g, guild.name)
        .replace(/{servername}/g, guild.name)
        .replace(/{serverid}/g, guild.id)
        .replace(/{servericon}/g, guild.iconURL?.({ dynamic: true, size: 1024 }) || 'None')
        .replace(/{serverbanner}/g, guild.bannerURL?.({ dynamic: true, size: 1024 }) || 'None')
        .replace(/{serversplash}/g, guild.splashURL?.({ size: 1024 }) || 'None')
        .replace(/{serverdiscovery}/g, guild.discoverySplashURL?.({ size: 1024 }) || 'None')
        .replace(/{serverowner}/g, `<@${guild.ownerId}>`)
        .replace(/{serverownerid}/g, guild.ownerId)
        .replace(/{serverowner:mention}/g, `<@${guild.ownerId}>`)
        .replace(/{serverdescription}/g, guild.description || 'No description')
        .replace(/{serververification}/g, verificationLevel)

        // Server Timestamps
        .replace(/{servercreated}/g, `<t:${serverCreatedTimestamp}:R>`)
        .replace(/{servercreated:relative}/g, `<t:${serverCreatedTimestamp}:R>`)
        .replace(/{servercreated:date}/g, `<t:${serverCreatedTimestamp}:D>`)
        .replace(/{servercreated:time}/g, `<t:${serverCreatedTimestamp}:T>`)
        .replace(/{servercreated:full}/g, `<t:${serverCreatedTimestamp}:F>`)

        // Member Counts
        .replace(/{membercount}/g, guild.memberCount.toString())
        .replace(/{members}/g, guild.memberCount.toString())
        .replace(/{onlinecount}/g, onlineMembers.toString())
        .replace(/{botcount}/g, botCount.toString())
        .replace(/{humancount}/g, humanCount.toString())

        // Boost Info
        .replace(/{boostcount}/g, boostCount.toString())
        .replace(/{boostlevel}/g, boostLevel.toString())
        .replace(/{boosttier}/g, boostLevel.toString())

        // Channel Info
        .replace(/{channelname}/g, channel ? channel.name : '')
        .replace(/{channelid}/g, channel ? channel.id : '')
        .replace(/{channelmention}/g, channel ? `<#${channel.id}>` : '')
        .replace(/{channel}/g, channel ? `<#${channel.id}>` : '')
        .replace(/{textchannels}/g, textChannels.toString())
        .replace(/{voicechannels}/g, voiceChannels.toString())
        .replace(/{categories}/g, categories.toString())

        // Server Stats
        .replace(/{emojicount}/g, emojiCount.toString())
        .replace(/{rolecount:server}/g, roleTotal.toString())
        .replace(/{roletotal}/g, roleTotal.toString())

        // Current Time
        .replace(/{time}/g, `<t:${now}:T>`)
        .replace(/{date}/g, `<t:${now}:D>`)
        .replace(/{datetime}/g, `<t:${now}:F>`)
        .replace(/{timestamp}/g, `<t:${now}:R>`);
    } catch (error) {
        log.error('replacePlaceholders error:', error);
        return text;
    }
}

function createWelcomerPreview(user, guild, config, channel = null) {
    const embed = new EmbedBuilder();

    if (config.title) embed.setTitle(replacePlaceholders(config.title, user, guild, channel));
    if (config.description) embed.setDescription(replacePlaceholders(config.description, user, guild, channel));

    if (config.color) {
        let color = config.color;
        if (color.startsWith('#')) {
            color = parseInt(color.replace('#', ''), 16);
        }
        embed.setColor(color);
    }

    if (config.image) {
        const processedImage = replacePlaceholders(config.image, user, guild, channel);
        if (processedImage && (processedImage.startsWith('http://') || processedImage.startsWith('https://'))) {
            embed.setImage(processedImage);
        }
    }
    if (config.thumbnail) {
        const processedThumbnail = replacePlaceholders(config.thumbnail, user, guild, channel);
        if (processedThumbnail && (processedThumbnail.startsWith('http://') || processedThumbnail.startsWith('https://'))) {
            embed.setThumbnail(processedThumbnail);
        }
    }
    if (config.footer) embed.setFooter({ text: replacePlaceholders(config.footer, user, guild, channel) });
    if (config.author) embed.setAuthor({ name: replacePlaceholders(config.author, user, guild, channel) });

    embed.setTimestamp();

    return embed;
}

// Helper function to create a simple welcomer builder UI (used by legacy modal handlers)
function createWelcomerBuilderUI(config = {}, guildId = '') {
    const checkmark = '<:Checkedbox:1521227734943269077>';
    const crossmark = '<:Cancel:1521227723916181644>';
    
    let statusText = `# <:Userplus:1521227719621218477> Welcomer Setup\n\n`;
    statusText += `**Status:** ${config.enabled ? checkmark + ' Enabled' : crossmark + ' Disabled'}\n`;
    statusText += `**Channel:** ${config.channelId ? `<#${config.channelId}>` : '_Not set_'}\n`;
    statusText += `**Mode:** ${config.mode === 'embed' ? '<:Document:1521227875016114266> Embed' : '<:Fire:1521227907647668374> Components V2'}\n\n`;
    statusText += `**Message:** ${config.content ? '`' + (config.content.length > 80 ? config.content.substring(0, 80) + '...' : config.content) + '`' : '_Not set_'}\n`;
    statusText += `**Title:** ${config.title || '_Not set_'}\n`;
    statusText += `**Color:** ${config.color || '#bcf1e4'}\n`;
    statusText += `**Image:** ${config.image ? checkmark : crossmark}\n`;
    statusText += `**Thumbnail:** ${config.thumbnail ? checkmark : crossmark}\n`;
    statusText += `**Footer:** ${config.footer || '_Not set_'}\n`;
    statusText += `**Author:** ${config.author || '_Not set_'}\n`;
    
    return statusText;
}

// Helper function to add embed preview content directly into the container
function addEmbedPreviewContent(container, data) {
    const hasContent = data.title || data.description;
    if (!hasContent) {
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent('-# *Set a title or description to see a preview*')
        );
        return;
    }

    let previewText = '';
    if (data.author) {
        const authorName = typeof data.author === 'string' ? data.author : data.author.name || '';
        if (authorName) previewText += `> -# ${authorName}\n`;
    }
    if (data.title) {
        previewText += `> ### ${data.title}\n`;
    }
    if (data.description) {
        const desc = data.description.length > 500 ? data.description.substring(0, 500) + '...' : data.description;
        previewText += desc.split('\n').map(l => `> ${l}`).join('\n') + '\n';
    }
    if (data.fields?.length > 0) {
        previewText += '> \n';
        for (const field of data.fields.slice(0, 5)) {
            previewText += `> **${field.name}**\n> ${field.value}\n`;
        }
        if (data.fields.length > 5) {
            previewText += `> -# *...and ${data.fields.length - 5} more fields*\n`;
        }
    }
    if (data.footer) {
        const footerText = typeof data.footer === 'string' ? data.footer : data.footer.text || '';
        if (footerText) previewText += `> \n> -# ${footerText}`;
    }

    if (previewText) {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(previewText));
    }

    const imageUrl = data.image || '';
    const thumbUrl = typeof data.thumbnail === 'string' ? data.thumbnail : (data.thumbnail?.url || '');
    const mediaUrls = [thumbUrl, imageUrl].filter(u => u && (u.startsWith('http://') || u.startsWith('https://')));
    if (mediaUrls.length > 0) {
        const gallery = new MediaGalleryBuilder();
        for (const url of mediaUrls) {
            gallery.addItems(new MediaGalleryItemBuilder().setURL(url));
        }
        container.addMediaGalleryComponents(gallery);
    }
}

// Helper function to add CV2 preview content directly into the container
function addComponentsPreviewContent(container, data) {
    if (!data.content) {
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent('-# *Set content to see a preview*')
        );
        return;
    }

    const displayContent = data.content.length > 600 ? data.content.substring(0, 600) + '...' : data.content;
    const thumbUrl = data.thumbnail?.url || (typeof data.thumbnail === 'string' ? data.thumbnail : '');

    if (thumbUrl) {
        const section = new SectionBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(displayContent))
            .setThumbnailAccessory(new ThumbnailBuilder().setURL(thumbUrl));
        container.addSectionComponents(section);
    } else {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(displayContent));
    }

    if (data.mediaGallery?.url) {
        container.addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL(data.mediaGallery.url)
            )
        );
    }
}

// Helper function to update Embed builder message with current state
async function updateEmbedBuilderMessage(interaction, messageKey, data) {
    try {
        const messageRef = builderMessages.get(messageKey);
        if (!messageRef) return;

        const colorDisplay = data.color ? (typeof data.color === 'number' ? `#${data.color.toString(16).padStart(6, '0')}` : data.color) : 'Default';
        const headerText = `# <:Document:1521227875016114266> Embed Builder\n**Color:** ${colorDisplay} • **Fields:** ${data.fields?.length || 0}/25`;

        const setupButtons = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('embed_setup_basic')
                    .setLabel('Title & Description')
                    .setStyle(data.title || data.description ? ButtonStyle.Success : ButtonStyle.Primary)
                    .setEmoji('<:Edit:1521227886634205298>'),
                new ButtonBuilder()
                    .setCustomId('embed_setup_media')
                    .setLabel('Images & Thumbnail')
                    .setStyle(data.image || data.thumbnail ? ButtonStyle.Success : ButtonStyle.Primary)
                    .setEmoji('<:Attach:1521228039135170722>'),
                new ButtonBuilder()
                    .setCustomId('embed_setup_footer')
                    .setLabel('Footer & Author')
                    .setStyle(data.footer || data.author ? ButtonStyle.Success : ButtonStyle.Primary)
                    .setEmoji('<:User:1521227714227343380>'),
                new ButtonBuilder()
                    .setCustomId('embed_setup_color')
                    .setLabel('Color')
                    .setStyle(data.color ? ButtonStyle.Success : ButtonStyle.Primary)
                    .setEmoji('<:Palette:1521227950601539755>'),
                new ButtonBuilder()
                    .setCustomId('embed_setup_fields')
                    .setLabel(`Fields (${data.fields?.length || 0})`)
                    .setStyle(data.fields?.length ? ButtonStyle.Success : ButtonStyle.Secondary)
                    .setEmoji('<:Bookopen:1521227911137595605>')
            );

        const actionButtons = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('embed_preview')
                    .setLabel('Preview')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('<:Eye:1521227940480815156>'),
                new ButtonBuilder()
                    .setCustomId('embed_send_here')
                    .setLabel('Send Here')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('<:Image:1521227966435037255>'),
                new ButtonBuilder()
                    .setCustomId('embed_send_channel')
                    .setLabel('Send to Channel')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('<:Editalt:1521227921673556019>'),
                new ButtonBuilder()
                    .setCustomId('embed_see_variables')
                    .setLabel('Variables')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('<:Document:1521227875016114266>'),
                new ButtonBuilder()
                    .setCustomId('embed_reset')
                    .setLabel('Reset')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('<:Refresh:1521227946441052420>')
            );

        const accentColor = data.color || 0xCAD7E6;
        const container = new ContainerBuilder()
            .setAccentColor(typeof accentColor === 'number' ? accentColor : parseInt(String(accentColor).replace('#', ''), 16) || 0xCAD7E6)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(headerText));

        addEmbedPreviewContent(container, data);

        container
            .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
            .addActionRowComponents(setupButtons)
            .addActionRowComponents(actionButtons);

        await messageRef.edit({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(error => {
            log.error('Failed to edit embed builder message:', error);
        });
    } catch (error) {
        log.error('Error updating embed builder message:', error);
    }
}

// Helper function to update Components V2 builder message with live preview
async function updateComponentsBuilderMessage(interaction, messageKey, data) {
    try {
        const messageRef = builderMessages.get(messageKey);
        if (!messageRef) return;

        const headerText = `# <:Document:1521227875016114266> Components V2 Builder\n**Color:** ${data.color ? (typeof data.color === 'number' ? '#' + data.color.toString(16).padStart(6, '0') : data.color) : 'Default'}`;

        const setupButtons = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('components_setup_content')
                    .setLabel('Content')
                    .setStyle(data.content ? ButtonStyle.Success : ButtonStyle.Primary)
                    .setEmoji('<:Edit:1521227886634205298>'),
                new ButtonBuilder()
                    .setCustomId('components_setup_media')
                    .setLabel('Media Gallery')
                    .setStyle(data.mediaGallery ? ButtonStyle.Success : ButtonStyle.Primary)
                    .setEmoji('<:Picture:1521227954191995024>'),
                new ButtonBuilder()
                    .setCustomId('components_setup_thumbnail')
                    .setLabel('Thumbnail')
                    .setStyle(data.thumbnail ? ButtonStyle.Success : ButtonStyle.Primary)
                    .setEmoji('<:Copy:1521227960554881084>'),
                new ButtonBuilder()
                    .setCustomId('components_setup_color')
                    .setLabel('Color')
                    .setStyle(data.color ? ButtonStyle.Success : ButtonStyle.Primary)
                    .setEmoji('<:Palette:1521227950601539755>')
            );

        const actionButtons = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('components_preview')
                    .setLabel('Preview')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('<:Eye:1521227940480815156>'),
                new ButtonBuilder()
                    .setCustomId('components_send_here')
                    .setLabel('Send Here')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('<:Image:1521227966435037255>'),
                new ButtonBuilder()
                    .setCustomId('components_send_channel')
                    .setLabel('Send to Channel')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('<:Editalt:1521227921673556019>'),
                new ButtonBuilder()
                    .setCustomId('components_see_variables')
                    .setLabel('Variables')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('<:Document:1521227875016114266>'),
                new ButtonBuilder()
                    .setCustomId('components_reset')
                    .setLabel('Reset')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('<:Refresh:1521227946441052420>')
            );

        const accentColor = data.color || 0xCAD7E6;
        const container = new ContainerBuilder()
            .setAccentColor(typeof accentColor === 'number' ? accentColor : parseInt(String(accentColor).replace('#', ''), 16) || 0xCAD7E6)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(headerText));

        addComponentsPreviewContent(container, data);

        container
            .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
            .addActionRowComponents(setupButtons)
            .addActionRowComponents(actionButtons);

        await messageRef.edit({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(error => {
            log.error('Failed to edit components builder message:', error);
        });
    } catch (error) {
        log.error('Error updating components builder message:', error);
    }
}

async function handleComponentsButtons(interaction) {
    // Check if builder session has expired
    if (await checkAndExpire(interaction, 'builder')) return;

    const userId = interaction.user.id;
    const key = `${interaction.guild.id}-${userId}`;
    const messageKey = `components-${key}`;

    // Always update message reference for live updates
    if (interaction.message) {
        builderMessages.set(messageKey, interaction.message);
    }

    if (interaction.customId === 'components_setup_content') {
        const modal = new ModalBuilder()
            .setCustomId('components_modal_content')
            .setTitle('Set Component Content');

        const contentInput = new TextInputBuilder()
            .setCustomId('component_content')
            .setLabel('Content (supports markdown)')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('# Welcome {user}!\n\nTotal members: {membercount}')
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(contentInput));
        await interaction.showModal(modal);
    }

    if (interaction.customId === 'components_setup_media') {
        const modal = new ModalBuilder()
            .setCustomId('components_modal_media')
            .setTitle('Media Gallery');

        const imageUrlInput = new TextInputBuilder()
            .setCustomId('media_url')
            .setLabel('Image URL')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('https://example.com/image.png')
            .setRequired(true);

        const imageDescInput = new TextInputBuilder()
            .setCustomId('media_description')
            .setLabel('Image Description')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Description of the image')
            .setRequired(false);

        modal.addComponents(
            new ActionRowBuilder().addComponents(imageUrlInput),
            new ActionRowBuilder().addComponents(imageDescInput)
        );
        await interaction.showModal(modal);
    }

    else if (interaction.customId === 'components_setup_thumbnail') {
        const modal = new ModalBuilder()
            .setCustomId('components_modal_thumbnail')
            .setTitle('Add Thumbnail');

        const thumbnailUrlInput = new TextInputBuilder()
            .setCustomId('thumbnail_url')
            .setLabel('Thumbnail URL')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('https://example.com/thumbnail.png')
            .setRequired(true);

        const thumbnailDescInput = new TextInputBuilder()
            .setCustomId('thumbnail_description')
            .setLabel('Thumbnail Description')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Description of the thumbnail')
            .setRequired(false);

        modal.addComponents(
            new ActionRowBuilder().addComponents(thumbnailUrlInput),
            new ActionRowBuilder().addComponents(thumbnailDescInput)
        );
        await interaction.showModal(modal);
    }

    else if (interaction.customId === 'components_setup_color') {
        const modal = new ModalBuilder()
            .setCustomId('components_modal_color')
            .setTitle('Set Component Color');

        const colorInput = new TextInputBuilder()
            .setCustomId('component_color')
            .setLabel('Color (hex code or name)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('#bcf1e4 or red, blue, green, etc.')
            .setRequired(false);

        modal.addComponents(new ActionRowBuilder().addComponents(colorInput));
        await interaction.showModal(modal);
    }

    else if (interaction.customId === 'components_preview') {
        const data = componentsData.get(key) || {};

        if (!data.content) {
            return interaction.reply({ content: '<:Cancel:1521227723916181644> No component configured yet! Use the setup buttons first.', flags: MessageFlags.Ephemeral });
        }

        const container = createComponentContainer(data, interaction.user, interaction.guild, interaction.channel);

        await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    }

    else if (interaction.customId === 'components_send_here') {
        const messageKey = `components-${key}`;
        const data = componentsData.get(key) || {};

        if (!data.content) {
            return interaction.reply({ content: '<:Cancel:1521227723916181644> No component configured yet! Use the setup buttons first.', flags: MessageFlags.Ephemeral });
        }

        const container = createComponentContainer(data, interaction.user, interaction.guild, interaction.channel);

        await interaction.channel.send({ components: [container], flags: MessageFlags.IsComponentsV2 });
        await interaction.reply({ content: '<:Checkedbox:1521227734943269077> Component sent!', flags: MessageFlags.Ephemeral });
        componentsData.delete(key);
        builderMessages.delete(messageKey);
    }

    else if (interaction.customId === 'components_send_channel') {
        const modal = new ModalBuilder()
            .setCustomId('components_modal_send_channel')
            .setTitle('Send to Channel');

        const channelInput = new TextInputBuilder()
            .setCustomId('target_channel')
            .setLabel('Channel ID or Mention')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Channel ID or #channel-mention')
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(channelInput));
        await interaction.showModal(modal);
    }

    else if (interaction.customId === 'components_see_variables') {
        // Update timestamp on interaction
        if (!global.builderTimestamps) global.builderTimestamps = new Map();
        const messageId = interaction.message.id;
        const timestamp = global.builderTimestamps.get(messageId);
        if (timestamp) {
            global.builderTimestamps.set(messageId, Date.now());
        }

        const variablesText = `**Available Variables (70+):**\n\n` +
            `**<:User:1521227714227343380> User Info:**\n` +
            `\`{user}\` \`{usermention}\` - Mention user\n` +
            `\`{username}\` - Username\n` +
            `\`{displayname}\` \`{nickname}\` - Display/nickname\n` +
            `\`{userid}\` - User ID\n` +
            `\`{useravatar}\` - Avatar URL\n` +
            `\`{usercreated}\` - Account age\n` +
            `\`{userjoined}\` - Join time\n\n` +
            `**🏰 Server Info:**\n` +
            `\`{server}\` \`{servername}\` - Server name\n` +
            `\`{serverid}\` - Server ID\n` +
            `\`{membercount}\` \`{members}\` - Total members\n` +
            `\`{onlinecount}\` - Online members\n` +
            `\`{boostcount}\` - Boost count\n\n` +
            `**<:Bullhorn:1521227936575914016> Channel Info:**\n` +
            `\`{channel}\` \`{channelmention}\` - Mention channel\n` +
            `\`{channelname}\` - Channel name\n` +
            `\`{channelid}\` - Channel ID\n\n` +
            `**<:Alarm:1521227869047750689> Time:**\n` +
            `\`{time}\` \`{date}\` \`{datetime}\` \`{timestamp}\`\n\n` +
            `*See /variables command for the complete list of 70+ variables!*`;

        await interaction.reply({ content: variablesText, flags: MessageFlags.Ephemeral });
    }

    else if (interaction.customId === 'components_reset') {
        const messageKey = `components-${key}`;
        componentsData.delete(key);
        const defaultData = { content: '', color: '', thumbnail: '', mediaGallery: '' };
        componentsData.set(key, defaultData);
        await updateComponentsBuilderMessage(interaction, messageKey, defaultData);
        await interaction.reply({ content: '<:Checkedbox:1521227734943269077> Component data reset!', flags: MessageFlags.Ephemeral });
    }
}

async function handleAutoresponderButtons(interaction) {
    if (!interaction.guild || !interaction.member) {
        return interaction.reply({ content: '<:Cancel:1521227723916181644> This can only be used in a server!', flags: MessageFlags.Ephemeral }).catch(() => {});
    }

    // Check if config session has expired
    if (await checkAndExpire(interaction, 'config')) return;

    // Permission check — only users with Manage Guild can use these buttons
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: '<:Cancel:1521227723916181644> You need **Manage Guild** permission to use these controls!', flags: MessageFlags.Ephemeral }).catch(() => {});
    }

    const guildId = interaction.guild.id;

    function loadConfig() {
        if (!jsonStore.has('autoresponder')) {
            jsonStore.write('autoresponder', {});
            return {};
        }
        return jsonStore.read('autoresponder');
    }

    function saveConfig(config) {
        jsonStore.write('autoresponder', config);
        if (global.updateAutoresponderCache) {
            global.updateAutoresponderCache(guildId, config[guildId] || { enabled: false, responses: [] });
        }
    }

    function buildAutoresponderPanel(gc) {
        const statusText = gc.enabled ? '<:Toggleon:1521227758011809964>  **Enabled**' : '<:Toggleoff:1521227763816595559> **Disabled**';
        const countText = `**Total Responses:** ${gc.responses?.length || 0}`;
        const panelText = `# <:Fire:1521227907647668374> Autoresponder System\n\n**Status:** ${statusText}\n${countText}\n\n**Setup autoresponders to automatically reply when users send specific messages!**\n\n**How it works:**\n<:Add:1521227828199293152> **Add Response** - Create a new trigger → response pair\n<:Bookopen:1521227911137595605> **List All** - View all configured responses\n<:Trash:1521227750420254820> **Remove Response** - Delete a specific response\n\n**Controls:**\n${gc.enabled ? '<:Toggleoff:1521227763816595559>' : '<:Toggleon:1521227758011809964>'} **${gc.enabled ? 'Disable' : 'Enable'}** - Turn the system on/off\n<:Trash:1521227750420254820> **Clear All** - Remove all responses\n\n**Tips:**\n• Triggers are case-insensitive\n• Triggers can be partial matches\n• Supports Components v2 for beautiful responses!`;

        const setupButtons = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder().setCustomId('autoresponder_add').setLabel('Add Response').setStyle(ButtonStyle.Primary).setEmoji('<:Add:1521227828199293152>'),
                new ButtonBuilder().setCustomId('autoresponder_list').setLabel('List All').setStyle(ButtonStyle.Secondary).setEmoji('<:Bookopen:1521227911137595605>'),
                new ButtonBuilder().setCustomId('autoresponder_remove').setLabel('Remove Response').setStyle(ButtonStyle.Danger).setEmoji('<:Trash:1521227750420254820>')
            );
        const controlButtons = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder().setCustomId('autoresponder_toggle').setLabel(gc.enabled ? 'Disable' : 'Enable').setStyle(gc.enabled ? ButtonStyle.Danger : ButtonStyle.Success).setEmoji(gc.enabled ? '<:Toggleoff:1521227763816595559>' : '<:Toggleon:1521227758011809964>'),
                new ButtonBuilder().setCustomId('autoresponder_clear').setLabel('Clear All').setStyle(ButtonStyle.Danger).setEmoji('<:Trash:1521227750420254820>')
            );

        const container = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(panelText))
            .addActionRowComponents(setupButtons)
            .addActionRowComponents(controlButtons);

        return container;
    }

    if (interaction.customId === 'autoresponder_add') {
        const modal = new ModalBuilder()
            .setCustomId('autoresponder_modal_add')
            .setTitle('Add Autoresponse');

        const triggerInput = new TextInputBuilder()
            .setCustomId('trigger')
            .setLabel('Trigger (what message to match)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('hello')
            .setRequired(true);

        const responseInput = new TextInputBuilder()
            .setCustomId('response')
            .setLabel('Response (what to reply with)')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Hi there! Welcome to the server!')
            .setRequired(true);

        modal.addComponents(
            new ActionRowBuilder().addComponents(triggerInput),
            new ActionRowBuilder().addComponents(responseInput)
        );
        return interaction.showModal(modal);
    }

    else if (interaction.customId === 'autoresponder_list') {
        const config = loadConfig();
        const guildConfig = config[guildId] || { responses: [] };

        if (!guildConfig.responses || guildConfig.responses.length === 0) {
            return interaction.reply({ content: '<:Cancel:1521227723916181644> No autoresponses configured!', flags: MessageFlags.Ephemeral });
        }

        // Build response lines, then trim to fit Discord's 4 000-char per-
        // TextDisplay cap. Without this guard, a server with many or long
        // autoresponses would fail with INVALID_FORM_BODY when the panel is
        // edited.
        const lineEntries = guildConfig.responses.map((item, index) => {
            const resp = item.response || '(empty)';
            return `**${index + 1}.** Trigger: \`${item.trigger || '(none)'}\`\n   Response: ${resp.substring(0, 50)}${resp.length > 50 ? '...' : ''}`;
        });
        const { content: listText } = buildSafeListText({
            header: '# <:Bookopen:1521227911137595605> Autoresponse List',
            lines: lineEntries,
            separator: '\n\n',
            overflowHint: '\n\n-# +${n} more not shown — remove some entries to see them all',
        });

        const container = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(listText)
            );

        await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    }

    else if (interaction.customId === 'autoresponder_remove') {
        const config = loadConfig();
        const guildConfig = config[guildId] || { responses: [] };

        if (!guildConfig.responses || guildConfig.responses.length === 0) {
            return interaction.reply({ content: '<:Cancel:1521227723916181644> No autoresponses to remove!', flags: MessageFlags.Ephemeral });
        }

        const modal = new ModalBuilder()
            .setCustomId('autoresponder_modal_remove')
            .setTitle('Remove Autoresponse');

        const indexInput = new TextInputBuilder()
            .setCustomId('index')
            .setLabel('Number to remove (use /autoresponder list)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('1')
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(indexInput));
        return interaction.showModal(modal);
    }

    else if (interaction.customId === 'autoresponder_toggle') {
        await interaction.deferUpdate();
        const config = loadConfig();
        if (!config[guildId]) config[guildId] = { enabled: false, responses: [] };
        if (!config[guildId].responses) config[guildId].responses = [];

        config[guildId].enabled = !config[guildId].enabled;
        saveConfig(config);

        const container = buildAutoresponderPanel(config[guildId]);
        await interaction.editReply({ components: [container] });
        await interaction.followUp({
            content: `<:Toggleon:1521227758011809964> Autoresponder **${config[guildId].enabled ? 'enabled' : 'disabled'}**!`,
            flags: MessageFlags.Ephemeral
        }).catch(() => {});
    }

    else if (interaction.customId === 'autoresponder_clear') {
        await interaction.deferUpdate();
        const config = loadConfig();
        if (!config[guildId]) config[guildId] = { enabled: false, responses: [] };

        const count = config[guildId].responses?.length || 0;
        config[guildId].responses = [];
        saveConfig(config);

        const container = buildAutoresponderPanel(config[guildId]);
        await interaction.editReply({ components: [container] });
        await interaction.followUp({ content: `<:Checkedbox:1521227734943269077> Cleared **${count}** autoresponse(s)!`, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
}

async function handleAutoreactButtons(interaction) {
    if (!interaction.guild || !interaction.member) {
        return interaction.reply({ content: '<:Cancel:1521227723916181644> This can only be used in a server!', flags: MessageFlags.Ephemeral }).catch(() => {});
    }

    // Check if config session has expired
    if (await checkAndExpire(interaction, 'config')) return;

    // Permission check — only users with Manage Guild can use these buttons
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: '<:Cancel:1521227723916181644> You need **Manage Guild** permission to use these controls!', flags: MessageFlags.Ephemeral }).catch(() => {});
    }

    const guildId = interaction.guild.id;

    function loadConfig() {
        if (!jsonStore.has('autoreact')) {
            jsonStore.write('autoreact', {});
            return {};
        }
        return jsonStore.read('autoreact');
    }

    function saveConfig(config) {
        jsonStore.write('autoreact', config);
        if (global.updateAutoreactCache) {
            global.updateAutoreactCache(guildId, config[guildId] || { enabled: false, reactions: [] });
        }
    }

    function buildAutoreactPanel(gc) {
        const statusText = gc.enabled ? '<:Toggleon:1521227758011809964>  **Enabled**' : '<:Toggleoff:1521227763816595559> **Disabled**';
        const countText = `**Total Reactions:** ${gc.reactions?.length || 0}`;
        const panelText = `# 😄 Autoreact System\n\n**Status:** ${statusText}\n${countText}\n\n**Setup autoreactions to automatically react when users send specific messages!**\n\n**How it works:**\n<:Add:1521227828199293152> **Add Reaction** - Create a trigger → emoji reaction\n<:Bookopen:1521227911137595605> **List All** - View all configured reactions\n<:Trash:1521227750420254820> **Remove Reaction** - Delete a specific reaction\n\n**Controls:**\n${gc.enabled ? '<:Toggleoff:1521227763816595559>' : '<:Toggleon:1521227758011809964>'} **${gc.enabled ? 'Disable' : 'Enable'}** - Turn the system on/off\n<:Trash:1521227750420254820> **Clear All** - Remove all reactions\n\n**Emoji Support:**\n• Unicode emojis: 😀, 👍, <:Heart:1521228100652765247>\n• Custom server emojis: :emojiname:\n• Multiple reactions per trigger!`;

        const setupButtons = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder().setCustomId('autoreact_add').setLabel('Add Reaction').setStyle(ButtonStyle.Primary).setEmoji('<:Add:1521227828199293152>'),
                new ButtonBuilder().setCustomId('autoreact_list').setLabel('List All').setStyle(ButtonStyle.Secondary).setEmoji('<:Bookopen:1521227911137595605>'),
                new ButtonBuilder().setCustomId('autoreact_remove').setLabel('Remove Reaction').setStyle(ButtonStyle.Danger).setEmoji('<:Trash:1521227750420254820>')
            );
        const controlButtons = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder().setCustomId('autoreact_toggle').setLabel(gc.enabled ? 'Disable' : 'Enable').setStyle(gc.enabled ? ButtonStyle.Danger : ButtonStyle.Success).setEmoji(gc.enabled ? '<:Toggleoff:1521227763816595559>' : '<:Toggleon:1521227758011809964>'),
                new ButtonBuilder().setCustomId('autoreact_clear').setLabel('Clear All').setStyle(ButtonStyle.Danger).setEmoji('<:Trash:1521227750420254820>')
            );

        const container = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(panelText))
            .addActionRowComponents(setupButtons)
            .addActionRowComponents(controlButtons);

        return container;
    }

    if (interaction.customId === 'autoreact_add') {
        const modal = new ModalBuilder()
            .setCustomId('autoreact_modal_add')
            .setTitle('Add Autoreaction');

        const triggerInput = new TextInputBuilder()
            .setCustomId('trigger')
            .setLabel('Trigger (what message to match)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('ping')
            .setRequired(true);

        const emojisInput = new TextInputBuilder()
            .setCustomId('emojis')
            .setLabel('Emojis (separate with spaces)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('👍,👎,💸')
            .setRequired(true);

        modal.addComponents(
            new ActionRowBuilder().addComponents(triggerInput),
            new ActionRowBuilder().addComponents(emojisInput)
        );
        return interaction.showModal(modal);
    }

    else if (interaction.customId === 'autoreact_list') {
        const config = loadConfig();
        const guildConfig = config[guildId] || { reactions: [] };

        if (!guildConfig.reactions || guildConfig.reactions.length === 0) {
            return interaction.reply({ content: '<:Cancel:1521227723916181644> No autoreactions configured!', flags: MessageFlags.Ephemeral });
        }

        // Same 4 000-char trimming as autoresponse list above.
        const lineEntries = guildConfig.reactions.map((item, index) => {
            const emojis = Array.isArray(item.emojis) ? item.emojis.join(' ') : '(none)';
            return `**${index + 1}.** Trigger: \`${item.trigger || '(none)'}\`\n   Emojis: ${emojis}`;
        });
        const { content: listText } = buildSafeListText({
            header: '# <:Bookopen:1521227911137595605> Autoreaction List',
            lines: lineEntries,
            separator: '\n\n',
            overflowHint: '\n\n-# +${n} more not shown — remove some entries to see them all',
        });

        const container = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(listText)
            );

        await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    }

    else if (interaction.customId === 'autoreact_remove') {
        const config = loadConfig();
        const guildConfig = config[guildId] || { reactions: [] };

        if (!guildConfig.reactions || guildConfig.reactions.length === 0) {
            return interaction.reply({ content: '<:Cancel:1521227723916181644> No autoreactions to remove!', flags: MessageFlags.Ephemeral });
        }

        const modal = new ModalBuilder()
            .setCustomId('autoreact_modal_remove')
            .setTitle('Remove Autoreaction');

        const indexInput = new TextInputBuilder()
            .setCustomId('index')
            .setLabel('Number to remove (use /autoreact list)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('1')
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(indexInput));
        return interaction.showModal(modal);
    }

    else if (interaction.customId === 'autoreact_toggle') {
        await interaction.deferUpdate();
        const config = loadConfig();
        if (!config[guildId]) config[guildId] = { enabled: false, reactions: [] };
        if (!config[guildId].reactions) config[guildId].reactions = [];

        config[guildId].enabled = !config[guildId].enabled;
        saveConfig(config);

        const container = buildAutoreactPanel(config[guildId]);
        await interaction.editReply({ components: [container] });
        await interaction.followUp({
            content: `<:Toggleon:1521227758011809964> Autoreact **${config[guildId].enabled ? 'enabled' : 'disabled'}**!`,
            flags: MessageFlags.Ephemeral
        }).catch(() => {});
    }

    else if (interaction.customId === 'autoreact_clear') {
        await interaction.deferUpdate();
        const config = loadConfig();
        if (!config[guildId]) config[guildId] = { enabled: false, reactions: [] };

        const count = config[guildId].reactions?.length || 0;
        config[guildId].reactions = [];
        saveConfig(config);

        const container = buildAutoreactPanel(config[guildId]);
        await interaction.editReply({ components: [container] });
        await interaction.followUp({ content: `<:Checkedbox:1521227734943269077> Cleared **${count}** autoreaction(s)!`, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
}

async function handleAutomodButtons(interaction) {
    // All AutoMod button + select logic now lives in commands/utility/automod.js
    // (single source of truth, mirroring the antinuke command). Delegate to it.
    const cmd = interaction.client?.commands?.get('automod');
    if (cmd?.handleInteraction) return cmd.handleInteraction(interaction);
}

// ═══════ AutoMod Select Menu Handlers ═══════
async function handleAutomodSelectMenus(interaction) {
    // Delegates to the automod command (single source of truth).
    const cmd = interaction.client?.commands?.get('automod');
    if (cmd?.handleInteraction) return cmd.handleInteraction(interaction);
}

async function handleVerificationButtons(interaction) {
    const { createCaptchaSession, verifyCaptcha, getVerificationConfig, updateButtonCaptchaAnswer, clearButtonCaptchaAnswer, getButtonCaptchaSession } = require('./verificationManager');

    if (interaction.customId.startsWith('captcha_letter_')) {
        const parts = interaction.customId.split('_');
        const sessionId = parts.slice(2, -1).join('_');
        const letter = parts[parts.length - 1];

        const result = updateButtonCaptchaAnswer(sessionId, letter);

        if (!result.success) {
            return await interaction.reply({ content: '<:Cancel:1521227723916181644> Session expired. Please try again.', flags: MessageFlags.Ephemeral });
        }

        const session = getButtonCaptchaSession(sessionId);
        const attemptsLeft = 3 - (session.attempts || 0);

        const embed = new EmbedBuilder()
            .setColor('#0099FF')
            .setTitle('<:Shield:1521227694677692467> Verification Challenge')
            .setDescription(session.captcha.question)
            .addFields(
                { name: 'Your Answer', value: `\`${result.currentAnswer || '_'}\``, inline: false },
                { name: 'Instructions', value: 'Click the letter buttons below in the correct order', inline: false }
            )
            .setFooter({ text: `Session expires in 5 minutes • ${attemptsLeft} attempts remaining` });

        await interaction.update({ embeds: [embed] });
    } else if (interaction.customId.startsWith('captcha_clear_')) {
        const sessionId = interaction.customId.replace('captcha_clear_', '');

        const result = clearButtonCaptchaAnswer(sessionId);

        if (!result.success) {
            return await interaction.reply({ content: '<:Cancel:1521227723916181644> Session expired. Please try again.', flags: MessageFlags.Ephemeral });
        }

        const session = getButtonCaptchaSession(sessionId);
        const attemptsLeft = 3 - (session.attempts || 0);

        const embed = new EmbedBuilder()
            .setColor('#0099FF')
            .setTitle('<:Shield:1521227694677692467> Verification Challenge')
            .setDescription(session.captcha.question)
            .addFields(
                { name: 'Your Answer', value: '`_`', inline: false },
                { name: 'Instructions', value: 'Click the letter buttons below in the correct order', inline: false }
            )
            .setFooter({ text: `Session expires in 5 minutes • ${attemptsLeft} attempts remaining` });

        await interaction.update({ embeds: [embed] });
    } else if (interaction.customId.startsWith('captcha_submit_')) {
        const sessionId = interaction.customId.replace('captcha_submit_', '');
        const session = getButtonCaptchaSession(sessionId);

        if (!session) {
            return await interaction.reply({ content: '<:Cancel:1521227723916181644> Session expired. Please try again.', flags: MessageFlags.Ephemeral });
        }

        const answer = session.userAnswer || '';
        const result = verifyCaptcha(sessionId, answer);

        if (result.success) {
            const config = getVerificationConfig(interaction.guild.id);
            const role = interaction.guild.roles.cache.get(config.roleId);

            if (role) {
                try {
                    await interaction.member.roles.add(role);
                    await interaction.update({
                        content: '<:Checkedbox:1521227734943269077> Verification successful! You have been granted access to the server.',
                        embeds: [],
                        components: []
                    });
                } catch (error) {
                    log.error('Error adding role:', error);
                    await interaction.update({
                        content: '<:Cancel:1521227723916181644> Verification successful but failed to assign role. Please contact an administrator.',
                        embeds: [],
                        components: []
                    });
                }
            }
        } else {
            await interaction.update({
                content: `<:Cancel:1521227723916181644> ${result.error}`,
                embeds: [],
                components: []
            });
        }
    } else if (interaction.customId === 'verification_start') {
        const config = getVerificationConfig(interaction.guild.id);

        if (!config || !config.enabled) {
            return await interaction.reply({ content: '<:Cancel:1521227723916181644> Verification system is not enabled.', flags: MessageFlags.Ephemeral });
        }

        const role = interaction.guild.roles.cache.get(config.roleId);
        if (!role) {
            return await interaction.reply({ content: '<:Cancel:1521227723916181644> Verification role not found. Please contact an administrator.', flags: MessageFlags.Ephemeral });
        }

        if (interaction.member.roles.cache.has(config.roleId)) {
            return await interaction.reply({ content: '<:Checkedbox:1521227734943269077> You are already verified!', flags: MessageFlags.Ephemeral });
        }

        const captchaData = createCaptchaSession(interaction.user.id, interaction.guild.id, config.captchaType || 'random');

        if (captchaData.captchaType === 'button') {
            const { EmbedBuilder } = require('discord.js');

            const embed = new EmbedBuilder()
                .setColor('#0099FF')
                .setTitle('<:Key:1521228000467878111> Verification Challenge')
                .setDescription(captchaData.question)
                .addFields(
                    { name: 'Your Answer', value: '`_`', inline: false },
                    { name: 'Instructions', value: 'Click the letter buttons below in the correct order', inline: false }
                )
                .setFooter({ text: `Session expires in 5 minutes • ${3} attempts remaining` });

            const buttons = [];
            const rows = [];

            for (let i = 0; i < captchaData.letters.length; i++) {
                const button = new ButtonBuilder()
                    .setCustomId(`captcha_letter_${captchaData.sessionId}_${captchaData.letters[i]}`)
                    .setLabel(captchaData.letters[i])
                    .setStyle(ButtonStyle.Primary);

                buttons.push(button);

                if (buttons.length === 5 || i === captchaData.letters.length - 1) {
                    rows.push(new ActionRowBuilder().addComponents(buttons.splice(0)));
                }
            }

            const clearButton = new ButtonBuilder()
                .setCustomId(`captcha_clear_${captchaData.sessionId}`)
                .setEmoji('<:History:1521227863079256278>')
                .setLabel('Clear')
                .setStyle(ButtonStyle.Secondary);

            const submitButton = new ButtonBuilder()
                .setCustomId(`captcha_submit_${captchaData.sessionId}`)
                .setEmoji('<:Checkedbox:1521227734943269077>')
                .setLabel('Submit')
                .setStyle(ButtonStyle.Success);

            rows.push(new ActionRowBuilder().addComponents(clearButton, submitButton));

            await interaction.reply({ embeds: [embed], components: rows, flags: MessageFlags.Ephemeral });
        } else {
            const modal = new ModalBuilder()
                .setCustomId(`verification_captcha_${captchaData.sessionId}`)
                .setTitle('🔑 Verification Captcha');

            const answerInput = new TextInputBuilder()
                .setCustomId('captcha_answer')
                .setLabel('Solve the captcha to verify')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Type your answer here')
                .setRequired(true);

            const questionDisplay = new TextInputBuilder()
                .setCustomId('captcha_question')
                .setLabel('Question')
                .setStyle(TextInputStyle.Paragraph)
                .setValue(captchaData.question)
                .setRequired(false);

            modal.addComponents(
                new ActionRowBuilder().addComponents(questionDisplay),
                new ActionRowBuilder().addComponents(answerInput)
            );

            await interaction.showModal(modal);
        }
    }

    else if (interaction.customId === 'sticky_modal_message') {
        const guildId = interaction.guild.id;
        const messageContent = interaction.fields.getTextInputValue('sticky_content');

        if (!messageContent || !messageContent.trim()) {
            const err = new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent('### <:Cancel:1521227723916181644> Empty Content\nMessage content cannot be empty.'));
            return interaction.reply({ components: [err], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        let config = {};
        try { config = jsonStore.read('sticky'); } catch {}

        if (!config[guildId]) config[guildId] = { enabled: false, messages: {} };
        if (!config[guildId].messages) config[guildId].messages = {};
        config[guildId].pendingContent = messageContent;
        jsonStore.write('sticky', config);

        const ok = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent('### <:Checkedbox:1521227734943269077> Content Saved\nNow click **Set Channel**, then pick a **Display Type**.'));
        await interaction.reply({ components: [ok], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    }

    else if (interaction.customId === 'sticky_modal_channel') {
        const guildId = interaction.guild.id;
        const channelInput = interaction.fields.getTextInputValue('sticky_channel');

        let channel = resolveChannel(interaction.guild, channelInput);
        if (!channel) {
            try { channel = await interaction.guild.channels.fetch(channelInput.replace(/[<#>]/g, '')).catch(() => null); } catch {}
        }

        if (!channel) {
            const err = new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent('### <:Cancel:1521227723916181644> Channel Not Found\nProvide a valid **channel ID** or **channel name**.\n-# Right-click a channel → Copy Channel ID'));
            return interaction.reply({ components: [err], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        const botMember = interaction.guild.members.me;
        if (!channel.permissionsFor(botMember)?.has(['SendMessages', 'ViewChannel'])) {
            const err = new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent(`### <:Cancel:1521227723916181644> No Access\nI don't have permission to send messages in <#${channel.id}>.`));
            return interaction.reply({ components: [err], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        const channelId = channel.id;
        let config = {};
        try { config = jsonStore.read('sticky'); } catch {}

        if (!config[guildId]) config[guildId] = { enabled: false, messages: {} };
        if (!config[guildId].messages) config[guildId].messages = {};
        config[guildId].pendingChannel = channelId;
        jsonStore.write('sticky', config);

        const hasPending = !!config[guildId].pendingContent;
        const next = hasPending ? 'Now pick a **Display Type** to create the sticky.' : 'Now click **Set Message** to write content, then pick a **Display Type**.';
        const ok = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(`### <:Checkedbox:1521227734943269077> Channel Set\nTarget: <#${channelId}>\n\n${next}`));
        await interaction.reply({ components: [ok], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    }

    else if (interaction.customId === 'sticky_modal_quick') {
        const guildId = interaction.guild.id;
        const messageContent = interaction.fields.getTextInputValue('sticky_quick_content');
        const displayType = (interaction.fields.getTextInputValue('sticky_quick_type') || 'container').toLowerCase().trim();

        if (!messageContent || !messageContent.trim()) {
            const err = new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent('### <:Cancel:1521227723916181644> Empty Content\nMessage content cannot be empty.'));
            return interaction.reply({ components: [err], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        const validTypes = ['embed', 'container', 'content'];
        const finalType = validTypes.includes(displayType) ? displayType : 'container';

        let config = {};
        try { config = jsonStore.read('sticky'); } catch {}
        if (!config[guildId]) config[guildId] = { enabled: false, messages: {} };
        if (!config[guildId].messages) config[guildId].messages = {};
        config[guildId].pendingQuickContent = messageContent;
        config[guildId].pendingQuickType = finalType;
        jsonStore.write('sticky', config);

        const { ChannelSelectMenuBuilder: ChanSelect } = require('discord.js');
        const row = new ActionRowBuilder().addComponents(
            new ChanSelect()
                .setCustomId('sticky_quick_channel_select')
                .setPlaceholder('Select a channel for the sticky message')
                .addChannelTypes(ChannelType.GuildText)
                .setMinValues(1)
                .setMaxValues(1)
        );
        const container = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `### <:Pin:1521227932625014916> Choose a Channel\n**Content saved!** Now select the channel where the sticky message will appear.\n**Type:** ${finalType.charAt(0).toUpperCase() + finalType.slice(1)}`
            ))
            .addActionRowComponents(row);
        await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    }

    else if (interaction.customId === 'sticky_modal_embed') {
        const guildId = interaction.guild.id;
        const channelInput = interaction.fields.getTextInputValue('channel_id');
        const embedTitle = interaction.fields.getTextInputValue('embed_title') || 'Sticky Message';
        const messageContent = interaction.fields.getTextInputValue('message_content');
        const colorFooterInput = interaction.fields.getTextInputValue('embed_color') || '#cad7e6';
        const imagesInput = interaction.fields.getTextInputValue('embed_images') || '';

        let channel = resolveChannel(interaction.guild, channelInput);
        if (!channel) { try { channel = await interaction.guild.channels.fetch(channelInput.replace(/[<#>]/g, '')).catch(() => null); } catch {} }
        if (!channel) {
            const err = new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent('### <:Cancel:1521227723916181644> Channel Not Found\nProvide a valid channel ID or name.'));
            return interaction.reply({ components: [err], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        const channelId = channel.id;
        let config = {};
        try { config = jsonStore.read('sticky'); } catch {}
        if (!config[guildId]) config[guildId] = { enabled: false, messages: {} };
        if (!config[guildId].messages) config[guildId].messages = {};

        if (config[guildId].messages[channelId]?.messageId) {
            try { const old = await channel.messages.fetch(config[guildId].messages[channelId].messageId).catch(() => null); if (old) await old.delete().catch(() => {}); } catch {}
        }

        const [embedColorInput, embedFooter] = colorFooterInput.split('|').map(s => s.trim());
        const embedColor = (embedColorInput || '#cad7e6').replace('#', '');
        const [embedThumbnail, embedImage] = imagesInput.split('|').map(s => s.trim());

        config[guildId].messages[channelId] = {
            content: messageContent, messageId: null, channelId,
            displayType: 'embed', embedTitle, embedColor,
            embedFooter: embedFooter || '', embedThumbnail: embedThumbnail || '', embedImage: embedImage || ''
        };
        if (!config[guildId].enabled) config[guildId].enabled = true;
        jsonStore.write('sticky', config);

        try {
            const processedTitle = replacePlaceholders(embedTitle, interaction.user, interaction.guild, channel);
            const processedContent = replacePlaceholders(messageContent, interaction.user, interaction.guild, channel);
            const processedFooter = replacePlaceholders(embedFooter || '', interaction.user, interaction.guild, channel);

            const embed = new EmbedBuilder().setTitle(processedTitle).setDescription(processedContent).setColor(parseInt(embedColor, 16) || 0xCAD7E6);
            if (embedFooter) embed.setFooter({ text: processedFooter });
            if (embedThumbnail) embed.setThumbnail(embedThumbnail);
            if (embedImage) embed.setImage(embedImage);

            const stickyMsg = await channel.send({ embeds: [embed] });
            config[guildId].messages[channelId].messageId = stickyMsg.id;
            jsonStore.write('sticky', config);

            const ok = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(`### <:Checkedbox:1521227734943269077> Sticky Created\n**Type:** Embed\n**Channel:** <#${channelId}>`));
            await interaction.reply({ components: [ok], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        } catch (error) {
            log.error('Sticky embed send error:', error);
            const err = new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent(`### <:Cancel:1521227723916181644> Failed\nCouldn't send to <#${channelId}>. Check my permissions.`));
            if (!interaction.replied && !interaction.deferred) await interaction.reply({ components: [err], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral }).catch(() => {});
        }
    }

    else if (interaction.customId === 'sticky_modal_container') {
        const guildId = interaction.guild.id;
        const channelInput = interaction.fields.getTextInputValue('channel_id');
        const messageContent = interaction.fields.getTextInputValue('message_content');

        let channel = resolveChannel(interaction.guild, channelInput);
        if (!channel) { try { channel = await interaction.guild.channels.fetch(channelInput.replace(/[<#>]/g, '')).catch(() => null); } catch {} }
        if (!channel) {
            const err = new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent('### <:Cancel:1521227723916181644> Channel Not Found\nProvide a valid channel ID or name.'));
            return interaction.reply({ components: [err], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        const channelId = channel.id;
        let config = {};
        try { config = jsonStore.read('sticky'); } catch {}
        if (!config[guildId]) config[guildId] = { enabled: false, messages: {} };
        if (!config[guildId].messages) config[guildId].messages = {};

        if (config[guildId].messages[channelId]?.messageId) {
            try { const old = await channel.messages.fetch(config[guildId].messages[channelId].messageId).catch(() => null); if (old) await old.delete().catch(() => {}); } catch {}
        }

        config[guildId].messages[channelId] = { content: messageContent, messageId: null, channelId, displayType: 'container' };
        if (!config[guildId].enabled) config[guildId].enabled = true;
        jsonStore.write('sticky', config);

        try {
            const processed = replacePlaceholders(messageContent, interaction.user, interaction.guild, channel);
            const container = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(processed));
            const stickyMsg = await channel.send({ components: [container], flags: MessageFlags.IsComponentsV2 });
            config[guildId].messages[channelId].messageId = stickyMsg.id;
            jsonStore.write('sticky', config);

            const ok = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(`### <:Checkedbox:1521227734943269077> Sticky Created\n**Type:** Container\n**Channel:** <#${channelId}>`));
            await interaction.reply({ components: [ok], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        } catch (error) {
            log.error('Sticky container send error:', error);
            const err = new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent(`### <:Cancel:1521227723916181644> Failed\nCouldn't send to <#${channelId}>. Check my permissions.`));
            if (!interaction.replied && !interaction.deferred) await interaction.reply({ components: [err], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral }).catch(() => {});
        }
    }

    else if (interaction.customId === 'sticky_modal_content') {
        const guildId = interaction.guild.id;
        const channelInput = interaction.fields.getTextInputValue('channel_id');
        const messageContent = interaction.fields.getTextInputValue('message_content');

        let channel = resolveChannel(interaction.guild, channelInput);
        if (!channel) { try { channel = await interaction.guild.channels.fetch(channelInput.replace(/[<#>]/g, '')).catch(() => null); } catch {} }
        if (!channel) {
            const err = new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent('### <:Cancel:1521227723916181644> Channel Not Found\nProvide a valid channel ID or name.'));
            return interaction.reply({ components: [err], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        const channelId = channel.id;
        let config = {};
        try { config = jsonStore.read('sticky'); } catch {}
        if (!config[guildId]) config[guildId] = { enabled: false, messages: {} };
        if (!config[guildId].messages) config[guildId].messages = {};

        if (config[guildId].messages[channelId]?.messageId) {
            try { const old = await channel.messages.fetch(config[guildId].messages[channelId].messageId).catch(() => null); if (old) await old.delete().catch(() => {}); } catch {}
        }

        config[guildId].messages[channelId] = { content: messageContent, messageId: null, channelId, displayType: 'content' };
        if (!config[guildId].enabled) config[guildId].enabled = true;
        jsonStore.write('sticky', config);

        try {
            const processed = replacePlaceholders(messageContent, interaction.user, interaction.guild, channel);
            const stickyMsg = await channel.send({ content: processed });
            config[guildId].messages[channelId].messageId = stickyMsg.id;
            jsonStore.write('sticky', config);

            const ok = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(`### <:Checkedbox:1521227734943269077> Sticky Created\n**Type:** Content\n**Channel:** <#${channelId}>`));
            await interaction.reply({ components: [ok], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        } catch (error) {
            log.error('Sticky content send error:', error);
            const err = new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent(`### <:Cancel:1521227723916181644> Failed\nCouldn't send to <#${channelId}>. Check my permissions.`));
            if (!interaction.replied && !interaction.deferred) await interaction.reply({ components: [err], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral }).catch(() => {});
        }
    }

    else if (interaction.customId === 'sticky_modal_remove') {
        const guildId = interaction.guild.id;
        const channelInput = interaction.fields.getTextInputValue('sticky_remove_channel');

        let channel = resolveChannel(interaction.guild, channelInput);
        if (!channel) { try { channel = await interaction.guild.channels.fetch(channelInput.replace(/[<#>]/g, '')).catch(() => null); } catch {} }
        if (!channel) {
            const err = new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent('### <:Cancel:1521227723916181644> Channel Not Found\nProvide a valid channel ID or name.'));
            return interaction.reply({ components: [err], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        const channelId = channel.id;
        let config = {};
        try { config = jsonStore.read('sticky'); } catch {}

        if (config[guildId]?.messages?.[channelId]) {
            try {
                if (config[guildId].messages[channelId].messageId) {
                    const msg = await channel.messages.fetch(config[guildId].messages[channelId].messageId).catch(() => null);
                    if (msg) await msg.delete().catch(() => {});
                }
            } catch {}

            delete config[guildId].messages[channelId];
            jsonStore.write('sticky', config);

            const ok = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(`### <:Checkedbox:1521227734943269077> Removed\nSticky message removed from <#${channelId}>.`));
            await interaction.reply({ components: [ok], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        } else {
            const err = new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent(`### <:Cancel:1521227723916181644> Not Found\nNo sticky message in <#${channelId}>.`));
            await interaction.reply({ components: [err], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }
    }

    // Anti-Nuke modals are handled by antinukeCmd.handleModal() in index.js — no fallback needed
}

async function handleProfileButtons(interaction) {
    const { updateUserData, getUserData } = require('./dataManager');
    const LevelCard = require('./levelCard');

    // ── Premium gate for the customize panels ─────────────────────────
    // Both `profile-customize` and `rank-customize` (and the "Customize"
    // entry buttons on the user-facing cards) are premium-only commands
    // (see commands/social/profile-customize.js, commands/leveling/rank-customize.js).
    // The slash/prefix dispatcher already gates COMMAND ENTRY, but it
    // doesn't see button presses on a panel that's already open in the
    // channel (e.g. someone opened it 2 days ago, then their server
    // premium expired). We re-validate here so the panel fails closed.
    //
    // `profile_badges_view` is a read-only badge listing — leaving it
    // open to non-premium users on purpose.
    const customizeButton =
        interaction.customId === 'profile_customize_open' ||
        interaction.customId === 'rankcard_customize_open' ||
        interaction.customId.startsWith('profile_set_')   ||
        interaction.customId.startsWith('profile_vis_')   ||
        interaction.customId === 'profile_preview'        ||
        interaction.customId === 'profile_reset'          ||
        interaction.customId === 'profile_refresh'        ||
        interaction.customId === 'profile_help_btn'       ||
        interaction.customId.startsWith('rankcard_set_')  ||
        interaction.customId === 'rankcard_preview'       ||
        interaction.customId === 'rankcard_reset'         ||
        interaction.customId === 'rankcard_refresh'       ||
        interaction.customId === 'rankcard_help_btn';

    if (customizeButton) {
        try {
            const premiumManager = require('./premiumManager');
            if (!premiumManager.hasPremiumAccess(interaction.user.id, interaction.guild?.id)) {
                const { buildPremiumGate } = require('./responseBuilder');
                const which = interaction.customId.startsWith('rankcard_')
                    ? '/rank-customize'
                    : '/profile-customize';
                await interaction.reply({
                    components: [buildPremiumGate(which)],
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                }).catch(() => {});
                return true;
            }
        } catch (e) {
            log.error(`[profile/rank customize gate] ${e.message}`);
        }
    }

    // Open profile customize panel (from socialprofile card button)
    if (interaction.customId === 'profile_customize_open') {
        try {
            const profileCustomizeCmd = interaction.client.commands?.get('profile-customize') || interaction.client.prefixCommands?.get('profile-customize');
            if (profileCustomizeCmd?.showCustomizationPanel) {
                await profileCustomizeCmd.showCustomizationPanel(interaction, true);
            } else {
                await interaction.reply({ content: '<:Palette:1521227950601539755> Use `/profile-customize panel` to customize your profile card!', flags: MessageFlags.Ephemeral });
            }
        } catch (error) {
            log.error('Error opening profile customize:', error);
            await interaction.reply({ content: '<:Cancel:1521227723916181644> Failed to open profile customization panel.', flags: MessageFlags.Ephemeral }).catch(() => {});
        }
        return true;
    }

    // View user badges (from socialprofile card button)
    if (interaction.customId === 'profile_badges_view') {
        try {
            const badgeManager = require('./badgeManager');
            const premiumManager = require('./premiumManager');
            const userBadges = await badgeManager.getUserBadges(interaction.user.id);
            const isPremium = premiumManager.isPremium(interaction.user.id);

            let badgeLines = [];
            if (isPremium) {
                const allBadges = await badgeManager.getAllBadges();
                const premBadge = allBadges.find(b => b.badgeId === 'premium');
                if (premBadge && !userBadges.some(b => b.badgeId === 'premium')) {
                    badgeLines.push(`${premBadge.emoji || '<:Shield:1521227694677692467>'} **${premBadge.name}** — ${premBadge.description || 'Premium subscriber'}`);
                }
            }
            for (const badge of userBadges) {
                badgeLines.push(`${badge.emoji || '<:Award:1521228119640375336>'} **${badge.name}** — ${badge.description || 'No description'}`);
            }

            const content = badgeLines.length > 0
                ? `### <:Award:1521228119640375336> Your Badges (${badgeLines.length})\n${badgeLines.join('\n')}`
                : `### <:Award:1521228119640375336> No Badges Yet\nYou don't have any badges. Earn them by being active!`;

            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        } catch (error) {
            log.error('Error viewing badges:', error);
            await interaction.reply({ content: '<:Cancel:1521227723916181644> Failed to load badges.', flags: MessageFlags.Ephemeral }).catch(() => {});
        }
        return true;
    }

    if (interaction.customId === 'profile_set_background') {
        await interaction.showModal({
            customId: 'profile_background_modal',
            title: 'Set Background Image',
            components: [
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('background_url')
                        .setLabel('Background Image URL')
                        .setPlaceholder('https://i.imgur.com/example.png (leave empty to reset)')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(false)
                )
            ]
        });
        return true;

    }

    if (interaction.customId === 'profile_set_banner') {
        await interaction.showModal({
            customId: 'profile_banner_modal',
            title: 'Set Profile Banner',
            components: [
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('banner_url')
                        .setLabel('Banner Image URL (top strip)')
                        .setPlaceholder('https://i.imgur.com/banner.png (leave empty to reset)')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(false)
                )
            ]
        });
        return true;
    }

    if (interaction.customId === 'profile_set_bannermode') {
        const { getUserData, updateUserData } = require('./dataManager');
        const ud = await getUserData(interaction.user.id);
        const current = ud.profile?.profileCard?.bannerMode || 'strip';
        const next = current === 'full' ? 'strip' : 'full';
        await updateUserData(interaction.user.id, { 'profile.profileCard.bannerMode': next });
        await interaction.reply({
            content: next === 'full'
                ? '<:Checkedbox:1521227734943269077> Banner mode set to **Full background** — your banner image now fills the whole card. Use **Preview** to see it.'
                : '<:Checkedbox:1521227734943269077> Banner mode set to **Top strip** — your banner image sits as a header band. Use **Preview** to see it.',
            flags: MessageFlags.Ephemeral
        });
        return true;
    }

    if (interaction.customId === 'profile_set_bgcolor') {
        await interaction.showModal({
            customId: 'profile_bgcolor_modal',
            title: 'Set Background Color',
            components: [
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('bgcolor_hex')
                        .setLabel('Hex Color Code')
                        .setPlaceholder('#bcf1e4')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                        .setMinLength(4)
                        .setMaxLength(7)
                )
            ]
        });
        return true;
    }

    if (interaction.customId === 'profile_set_accentcolor') {
        await interaction.showModal({
            customId: 'profile_accentcolor_modal',
            title: 'Set Accent Color',
            components: [
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('accentcolor_hex')
                        .setLabel('Hex Color Code')
                        .setPlaceholder('#57F287')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                        .setMinLength(4)
                        .setMaxLength(7)
                )
            ]
        });
        return true;
    }

    if (interaction.customId === 'profile_set_progresscolor') {
        await interaction.showModal({
            customId: 'profile_progresscolor_modal',
            title: 'Set Progress Bar Color',
            components: [
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('progresscolor_hex')
                        .setLabel('Hex Color Code')
                        .setPlaceholder('#57F287')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                        .setMinLength(4)
                        .setMaxLength(7)
                )
            ]
        });
        return true;
    }

    if (interaction.customId === 'profile_set_textcolor') {
        await interaction.showModal({
            customId: 'profile_textcolor_modal',
            title: 'Set Text Color',
            components: [
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('textcolor_hex')
                        .setLabel('Hex Color Code')
                        .setPlaceholder('#ffffff')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                        .setMinLength(4)
                        .setMaxLength(7)
                )
            ]
        });
        return true;
    }

    if (interaction.customId === 'profile_set_opacity') {
        await interaction.showModal({
            customId: 'profile_opacity_modal',
            title: 'Set Background Opacity',
            components: [
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('opacity_value')
                        .setLabel('Opacity (0.1 to 1.0)')
                        .setPlaceholder('0.35 (default) - higher = more visible')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                        .setMinLength(1)
                        .setMaxLength(4)
                )
            ]
        });
        return true;
    }

    if (interaction.customId === 'profile_set_overlay') {
        await interaction.showModal({
            customId: 'profile_overlay_modal',
            title: 'Set Overlay Effect',
            components: [
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('overlay_type')
                        .setLabel('Overlay Type')
                        .setPlaceholder('dark, light, or none')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                )
            ]
        });
        return true;
    }

    if (interaction.customId === 'profile_set_border') {
        await interaction.showModal({
            customId: 'profile_border_modal',
            title: 'Set Border Color',
            components: [
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('border_hex')
                        .setLabel('Hex Color Code (leave empty for none)')
                        .setPlaceholder('#bcf1e4')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(false)
                        .setMaxLength(7)
                )
            ]
        });
        return true;
    }

    if (interaction.customId === 'profile_set_bio') {
        const userData = await getUserData(interaction.user.id);
        await interaction.showModal({
            customId: 'profile_bio_modal',
            title: 'Set Bio Text',
            components: [
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('bio_text')
                        .setLabel('Bio Text (max 150 characters)')
                        .setPlaceholder('I love music and gaming!')
                        .setStyle(TextInputStyle.Paragraph)
                        .setRequired(false)
                        .setMaxLength(150)
                        .setValue(userData.social?.bio || '')
                )
            ]
        });
        return true;
    }

    if (interaction.customId === 'profile_set_cardstyle') {
        const userData = await getUserData(interaction.user.id);
        const currentStyle = (userData.profile?.profileCard?.cardStyle || userData.profile?.cardStyle || 'Default').toLowerCase();

        const CARD_STYLES = [
            { label: 'Default', value: 'Default', description: 'Classic profile — purple accent, dark background', emoji: '🎴', default: currentStyle === 'default' },
            { label: 'Minimal', value: 'Minimal', description: 'Clean & simple — monochrome, subtle tones', emoji: '⬜', default: currentStyle === 'minimal' },
            { label: 'Neon', value: 'Neon', description: 'Cyberpunk glow — cyan & purple neon lights', emoji: '💫', default: currentStyle === 'neon' },
            { label: 'Classic', value: 'Classic', description: 'Elegant & traditional — indigo & blue tones', emoji: '🏛', default: currentStyle === 'classic' },
            { label: 'Modern', value: 'Modern', description: 'Contemporary flat — green accents, dark base', emoji: '🔷', default: currentStyle === 'modern' }
        ];

        const selectMenu = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('profile_style_select')
                .setPlaceholder('Choose a card style...')
                .addOptions(CARD_STYLES)
        );

        await interaction.reply({
            content: '🎴 **Select a Card Style** for your profile card:\n-# Each style changes the color theme. Your custom colors will override the theme.',
            components: [selectMenu],
            flags: MessageFlags.Ephemeral
        });
        return true;
    }

    if (interaction.customId === 'profile_set_badgestyle') {
        const userData = await getUserData(interaction.user.id);
        const currentBadge = (userData.profile?.profileCard?.badgeStyle || userData.profile?.badgeStyle || 'Default').toLowerCase();

        const BADGE_STYLES = [
            { label: 'Default', value: 'Default', description: 'Standard badge layout with icons', emoji: '🏅', default: currentBadge === 'default' },
            { label: 'Compact', value: 'Compact', description: 'Smaller, condensed badge display', emoji: '<:Box:1521228152414666833>', default: currentBadge === 'compact' },
            { label: 'Detailed', value: 'Detailed', description: 'Badges with full descriptions', emoji: '📋', default: currentBadge === 'detailed' },
            { label: 'Hidden', value: 'Hidden', description: 'Hide all badges from your profile', emoji: '🚫', default: currentBadge === 'hidden' }
        ];

        const selectMenu = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('profile_badge_select')
                .setPlaceholder('Choose a badge style...')
                .addOptions(BADGE_STYLES)
        );

        await interaction.reply({
            content: '🏅 **Select a Badge Style** for your profile card:\n-# Controls how your earned badges are displayed.',
            components: [selectMenu],
            flags: MessageFlags.Ephemeral
        });
        return true;
    }

    if (interaction.customId === 'profile_set_font') {
        const { getFontOptions, FONT_FAMILIES, getCustomFontName } = require('./fontRegistry');
        const userData = await getUserData(interaction.user.id);
        const currentFont = userData.profile?.profileCard?.fontFamily || 'Inter';
        const currentName = currentFont.startsWith('custom_')
            ? getCustomFontName(currentFont)
            : (FONT_FAMILIES[currentFont]?.name || 'Inter');

        const fontOptions = getFontOptions().map(opt => ({
            ...opt,
            default: opt.value === currentFont
        }));

        fontOptions.push({
            label: '🔗 Custom Font URL',
            value: '__custom_url__',
            description: 'Use any font from a direct .ttf/.otf/.woff link',
            emoji: '🔗'
        });

        const selectMenu = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('profile_font_select')
                .setPlaceholder(`Current: ${currentName}`)
                .addOptions(fontOptions)
        );

        await interaction.reply({
            content: '🔤 **Select a Font Family** for your profile card:\n-# Pick a preset font or choose **Custom Font URL** to use any .ttf/.otf/.woff font from the web!',
            components: [selectMenu],
            flags: MessageFlags.Ephemeral
        });
        return true;
    }

    if (interaction.customId === 'profile_preview') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const ProfileCard = require('./profileCard');
            const userData = await getUserData(interaction.user.id);
            const profileCard = new ProfileCard();

            const profileSettings = userData.profile?.profileCard || userData.profile || {};
            if (profileSettings.cardStyle) {
                profileCard.setCardStyle(profileSettings.cardStyle);
            }
            if (profileSettings.customBackground) {
                profileCard.setBackgroundImage(profileSettings.customBackground);
            }
            // Default the banner to the user's real Discord banner + fetch
            // their avatar decoration so the preview matches /socialprofile.
            let fullUser = interaction.user;
            try { fullUser = await interaction.client.users.fetch(interaction.user.id, { force: true }); } catch {}
            const discordBanner = (typeof fullUser.bannerURL === 'function')
                ? fullUser.bannerURL({ size: 1024, extension: 'png' }) : null;
            const avatarDecoration = (typeof fullUser.avatarDecorationURL === 'function')
                ? fullUser.avatarDecorationURL() : null;
            const effectiveBanner = profileSettings.bannerImage || discordBanner;
            if (effectiveBanner) {
                profileCard.setBannerImage(effectiveBanner);
                profileCard.setBannerMode(profileSettings.bannerMode || 'strip');
            }
            if (profileSettings.backgroundColor) {
                profileCard.setBackground(profileSettings.backgroundColor);
            }
            if (profileSettings.accentColor) {
                profileCard.setAccentColor(profileSettings.accentColor);
            }
            if (profileSettings.textColor) {
                profileCard.setTextColor(profileSettings.textColor);
            }
            if (profileSettings.backgroundOpacity !== undefined) {
                profileCard.setBackgroundOpacity(profileSettings.backgroundOpacity);
            }
            if (profileSettings.fontFamily) {
                profileCard.setFontFamily(profileSettings.fontFamily);
            }

            const cardBuffer = await profileCard.generate(fullUser, {
                level: userData.profile?.level || 10,
                totalXp: userData.profile?.totalXp || 10000,
                reputation: userData.social?.reputation || 5,
                bio: userData.social?.bio || '',
                relationship: userData.social?.marriedTo ? 'Married' : 'Single',
                commandsUsed: userData.stats?.commandsUsed || 100,
                messageCount: userData.stats?.messageCount || 500,
                voiceTime: userData.stats?.voiceTime || 3600,
                avatarDecoration,
                customBadges: []
            });

            const attachment = new AttachmentBuilder(cardBuffer, { name: 'preview-profile-card.png' });
            await interaction.editReply({ 
                content: '<:Checkedbox:1521227734943269077> **Profile Preview** - This is how your profile card will look!',
                files: [attachment]
            });
        } catch (error) {
            log.error('Error generating profile preview:', error);
            await interaction.editReply({ 
                content: '<:Cancel:1521227723916181644> Failed to generate preview. Please try again!' 
            });
        }
        return true;
    }

    if (interaction.customId === 'profile_help_btn') {
        const container = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder()
                    .setContent(
                        `# 📖 Profile Card Customization Guide\n\n` +
                        `Personalize your profile card to stand out!\n\n` +
                        `## <:Palette:1521227950601539755> Visual Options\n\n` +
                        `### <:Picture:1521227954191995024> Background Image\n` +
                        `Set a custom background image using any direct image URL.\n` +
                        `**Supported formats:** JPG, PNG, GIF, WebP\n\n` +
                        `### <:Picture:1521227954191995024> Banner & Banner Mode\n` +
                        `Set a banner image, then toggle **Banner Mode**:\n` +
                        `• **Strip** — banner sits as a header band (avatar overlaps it)\n` +
                        `• **Full** — banner fills the entire card background\n\n` +
                        `### <:Palette:1521227950601539755> Background Color\n` +
                        `Set a solid background color using hex codes.\n` +
                        `**Examples:** \`#bcf1e4\` (Discord blue), \`#2f3136\` (Dark)\n\n` +
                        `### 💫 Accent Color\n` +
                        `The highlight color used for borders and decorations.\n\n` +
                        `### <:Editalt:1521227921673556019> Text Color\n` +
                        `Change the color of text on your profile card.\n\n` +
                        `### 🏅 Badge Style\n` +
                        `**Default** | **Compact** | **Minimal** | **Hidden**\n\n` +
                        `### 🎴 Card Style\n` +
                        `**Default** | **Minimal** | **Neon** | **Classic** | **Modern**\n\n` +
                        `### 🔤 Font Family\n` +
                        `Choose from 9 unique fonts for your profile card text.\n` +
                        `**Options:** Inter, Poppins, Montserrat, Outfit, Space Grotesk, JetBrains Mono, Comfortaa, Orbitron, Rajdhani\n\n` +
                        `### <:Edit:1521227886634205298> Bio\n` +
                        `Write a short bio (up to 150 characters). Custom emojis work!`
                    )
            );

        await interaction.reply({
            components: [container],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
        });
        return true;
    }

    if (interaction.customId === 'rankcard_help_btn') {
        const container = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder()
                    .setContent(
                        `# 📖 Rank Card Customization Guide\n\n` +
                        `Create a unique rank card for your XP progress!\n\n` +
                        `## <:Palette:1521227950601539755> Visual Options\n\n` +
                        `### <:Picture:1521227954191995024> Background Image\n` +
                        `Set a custom background. **Recommended:** 934x282 pixels\n\n` +
                        `### <:Picture:1521227954191995024> Banner & Banner Mode\n` +
                        `Set a banner image, then toggle **Banner Mode**:\n` +
                        `• **Strip** — banner sits as a header band (avatar overlaps it)\n` +
                        `• **Full** — banner fills the entire card background\n\n` +
                        `### <:Palette:1521227950601539755> Background Color\n` +
                        `Set a solid background using hex codes.\n\n` +
                        `### <:Invoice:1521227903956811836> Progress Bar Color\n` +
                        `Customize your XP progress bar color.\n\n` +
                        `### <:Editalt:1521227921673556019> Text Color\n` +
                        `Change all text colors on your rank card.\n\n` +
                        `## 🎴 Card Styles\n\n` +
                        `• **Default** - Classic design\n` +
                        `• **Minimal** - Clean aesthetic\n` +
                        `• **Neon** - Glowing cyberpunk\n` +
                        `• **Classic** - Elegant look\n` +
                        `• **Modern** - Flat design\n\n` +
                        `## 🔤 Font Families\n\n` +
                        `Choose from 9 unique fonts:\n` +
                        `• **Inter** - Clean & versatile (default)\n` +
                        `• **Poppins** - Geometric & friendly\n` +
                        `• **Montserrat** - Bold & modern\n` +
                        `• **Space Grotesk** - Techy & sharp\n` +
                        `• **JetBrains Mono** - Developer style\n` +
                        `• **Orbitron** - Futuristic & sci-fi`
                    )
            );

        await interaction.reply({
            components: [container],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
        });
        return true;
    }

    if (interaction.customId === 'profile_reset') {
        await updateUserData(interaction.user.id, {
            'profile.profileCard.customBackground': null,
            'profile.profileCard.bannerImage': null,
            'profile.profileCard.bannerMode': 'strip',
            'profile.profileCard.backgroundColor': '#2f3136',
            'profile.profileCard.accentColor': '#bcf1e4',
            'profile.profileCard.textColor': '#ffffff',
            'profile.profileCard.badgeStyle': 'Default',
            'profile.profileCard.cardStyle': 'Default',
            'profile.profileCard.fontFamily': null,
            'social.bio': null
        });

        await interaction.reply({
            content: '<:Checkedbox:1521227734943269077> **Profile Reset** - All profile customizations have been reset to default!',
            flags: MessageFlags.Ephemeral
        });

        return true;
    }

    if (interaction.customId === 'profile_refresh') {
        try {
            const profileCustomizeCmd = interaction.client.commands?.get('profile-customize')
                || interaction.client.prefixCommands?.get('profile-customize');
            if (profileCustomizeCmd?.showCustomizationPanel) {
                await profileCustomizeCmd.showCustomizationPanel(interaction, true, true);
            } else {
                await interaction.reply({ content: '<:Checkedbox:1521227734943269077> Use `/profile-customize panel` to view your updated settings.', flags: MessageFlags.Ephemeral });
            }
        } catch (error) {
            log.error('Error refreshing profile panel:', error);
            await interaction.reply({ content: '<:Cancel:1521227723916181644> Failed to refresh the panel.', flags: MessageFlags.Ephemeral }).catch(() => {});
        }
        return true;
    }

    // Profile visibility handlers
    const visibilityMap = {
        'profile_vis_level': 'showLevel',
        'profile_vis_balance': 'showBalance',
        'profile_vis_badges': 'showBadges',
        'profile_vis_bio': 'showBio',
        'profile_vis_joindate': 'showJoinDate',
        'profile_vis_rep': 'showRep',
        'profile_vis_marriage': 'showMarriage',
        'profile_vis_voicetime': 'showVoiceTime',
        'profile_vis_messages': 'showMessageCount'
    };

    if (visibilityMap[interaction.customId]) {
        const { getUserData, updateUserData } = require('./dataManager');
        const field = visibilityMap[interaction.customId];
        const userData = await getUserData(interaction.user.id);
        const currentVisibility = userData.profile?.visibility || {};
        const newValue = currentVisibility[field] === false ? true : false;
        
        await updateUserData(interaction.user.id, {
            [`profile.visibility.${field}`]: newValue
        });

        await interaction.reply({
            content: `<:Checkedbox:1521227734943269077> **${field.replace('show', '')}** is now ${newValue ? 'visible' : 'hidden'} on your profile!`,
            flags: MessageFlags.Ephemeral
        });
        return true;
    }

    if (interaction.customId === 'profile_vis_show_all') {
        const { updateUserData } = require('./dataManager');
        await updateUserData(interaction.user.id, {
            'profile.visibility.showLevel': true,
            'profile.visibility.showBalance': true,
            'profile.visibility.showBadges': true,
            'profile.visibility.showBio': true,
            'profile.visibility.showJoinDate': true,
            'profile.visibility.showRep': true,
            'profile.visibility.showMarriage': true,
            'profile.visibility.showVoiceTime': true,
            'profile.visibility.showMessageCount': true
        });
        await interaction.reply({ content: '<:Checkedbox:1521227734943269077> All profile elements are now visible!', flags: MessageFlags.Ephemeral });
        return true;
    }

    if (interaction.customId === 'profile_vis_hide_all') {
        const { updateUserData } = require('./dataManager');
        await updateUserData(interaction.user.id, {
            'profile.visibility.showLevel': false,
            'profile.visibility.showBalance': false,
            'profile.visibility.showBadges': false,
            'profile.visibility.showBio': false,
            'profile.visibility.showJoinDate': false,
            'profile.visibility.showRep': false,
            'profile.visibility.showMarriage': false,
            'profile.visibility.showVoiceTime': false,
            'profile.visibility.showMessageCount': false
        });
        await interaction.reply({ content: '<:Checkedbox:1521227734943269077> All profile elements are now hidden!', flags: MessageFlags.Ephemeral });
        return true;
    }

    if (interaction.customId === 'profile_vis_back') {
        await interaction.reply({ content: '<:Checkedbox:1521227734943269077> Use `/profile-customize panel` to return to the main customization menu.', flags: MessageFlags.Ephemeral });
        return true;
    }

    // Rank card customization buttons

    // Open rank-customize panel (from rank card button)
    if (interaction.customId === 'rankcard_customize_open') {
        try {
            const rankCustomizeCmd = interaction.client.commands?.get('rank-customize') || interaction.client.prefixCommands?.get('rank-customize');
            if (rankCustomizeCmd?.showCustomizationPanel) {
                await rankCustomizeCmd.showCustomizationPanel(interaction, true);
            } else {
                await interaction.reply({ content: '<:Palette:1521227950601539755> Use `/rank-customize panel` to customize your rank card!', flags: MessageFlags.Ephemeral });
            }
        } catch (error) {
            log.error('Error opening rank customize:', error);
            await interaction.reply({ content: '<:Cancel:1521227723916181644> Failed to open rank card customization panel.', flags: MessageFlags.Ephemeral }).catch(() => {});
        }
        return true;
    }

    if (interaction.customId === 'rankcard_set_background') {
        await interaction.showModal({
            customId: 'rankcard_background_modal',
            title: 'Set Rank Card Background',
            components: [
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('background_url')
                        .setLabel('Background Image URL')
                        .setPlaceholder('https://i.imgur.com/example.png (leave empty to reset)')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(false)
                )
            ]
        });
        return true;
    }

    if (interaction.customId === 'rankcard_set_banner') {
        await interaction.showModal({
            customId: 'rankcard_banner_modal',
            title: 'Set Rank Card Banner',
            components: [
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('banner_url')
                        .setLabel('Banner Image URL (top strip)')
                        .setPlaceholder('https://i.imgur.com/banner.png (leave empty to reset)')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(false)
                )
            ]
        });
        return true;
    }

    if (interaction.customId === 'rankcard_set_bannermode') {
        const { getUserData, updateUserData } = require('./dataManager');
        const ud = await getUserData(interaction.user.id);
        const current = ud.profile?.rankCard?.bannerMode || 'strip';
        const next = current === 'full' ? 'strip' : 'full';
        await updateUserData(interaction.user.id, { 'profile.rankCard.bannerMode': next });
        await interaction.reply({
            content: next === 'full'
                ? '<:Checkedbox:1521227734943269077> Banner mode set to **Full background** — your banner image now fills the whole card. Use **Preview** to see it.'
                : '<:Checkedbox:1521227734943269077> Banner mode set to **Top strip** — your banner image sits as a header band. Use **Preview** to see it.',
            flags: MessageFlags.Ephemeral
        });
        return true;
    }

    if (interaction.customId === 'rankcard_set_bgcolor') {
        await interaction.showModal({
            customId: 'rankcard_bgcolor_modal',
            title: 'Set Rank Card Background Color',
            components: [
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('bgcolor_hex')
                        .setLabel('Hex Color Code')
                        .setPlaceholder('#bcf1e4')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                        .setMinLength(4)
                        .setMaxLength(7)
                )
            ]
        });
        return true;
    }

    if (interaction.customId === 'rankcard_set_progresscolor') {
        await interaction.showModal({
            customId: 'rankcard_progresscolor_modal',
            title: 'Set Progress Bar Color',
            components: [
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('progresscolor_hex')
                        .setLabel('Hex Color Code')
                        .setPlaceholder('#57F287')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                        .setMinLength(4)
                        .setMaxLength(7)
                )
            ]
        });
        return true;
    }

    if (interaction.customId === 'rankcard_set_textcolor') {
        await interaction.showModal({
            customId: 'rankcard_textcolor_modal',
            title: 'Set Text Color',
            components: [
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('textcolor_hex')
                        .setLabel('Hex Color Code')
                        .setPlaceholder('#ffffff')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                        .setMinLength(4)
                        .setMaxLength(7)
                )
            ]
        });
        return true;
    }

    if (interaction.customId === 'rankcard_set_opacity') {
        await interaction.showModal({
            customId: 'rankcard_opacity_modal',
            title: 'Set Background Opacity',
            components: [
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('opacity_value')
                        .setLabel('Opacity (0.1 to 1.0)')
                        .setPlaceholder('0.4 (default) - higher = more visible')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                        .setMinLength(1)
                        .setMaxLength(4)
                )
            ]
        });
        return true;
    }

    if (interaction.customId === 'rankcard_set_cardstyle') {
        const userData = await getUserData(interaction.user.id);
        const currentStyle = (userData.profile?.rankCard?.cardStyle || userData.profile?.cardStyle || 'Default').toLowerCase();

        const CARD_STYLES = [
            { label: 'Default', value: 'Default', description: 'Classic rank card — purple accent, dark background', emoji: '🎴', default: currentStyle === 'default' },
            { label: 'Minimal', value: 'Minimal', description: 'Clean & simple — monochrome, subtle tones', emoji: '⬜', default: currentStyle === 'minimal' },
            { label: 'Neon', value: 'Neon', description: 'Cyberpunk glow — cyan & purple neon lights', emoji: '💫', default: currentStyle === 'neon' },
            { label: 'Classic', value: 'Classic', description: 'Elegant & traditional — indigo & blue tones', emoji: '🏛', default: currentStyle === 'classic' },
            { label: 'Modern', value: 'Modern', description: 'Contemporary flat — green accents, dark base', emoji: '🔷', default: currentStyle === 'modern' }
        ];

        const selectMenu = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('rankcard_style_select')
                .setPlaceholder('Choose a card style...')
                .addOptions(CARD_STYLES)
        );

        await interaction.reply({
            content: '🎴 **Select a Card Style** for your rank card:\n-# Each style changes the color theme of your card. Your custom colors (if set) will override the theme.',
            components: [selectMenu],
            flags: MessageFlags.Ephemeral
        });
        return true;
    }

    if (interaction.customId === 'rankcard_set_font') {
        const { getFontOptions, FONT_FAMILIES, getCustomFontName } = require('./fontRegistry');
        const userData = await getUserData(interaction.user.id);
        const currentFont = userData.profile?.rankCard?.fontFamily || 'Inter';
        const currentName = currentFont.startsWith('custom_')
            ? getCustomFontName(currentFont)
            : (FONT_FAMILIES[currentFont]?.name || 'Inter');

        const fontOptions = getFontOptions().map(opt => ({
            ...opt,
            default: opt.value === currentFont
        }));

        fontOptions.push({
            label: '🔗 Custom Font URL',
            value: '__custom_url__',
            description: 'Use any font from a direct .ttf/.otf/.woff link',
            emoji: '🔗'
        });

        const selectMenu = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('rankcard_font_select')
                .setPlaceholder(`Current: ${currentName}`)
                .addOptions(fontOptions)
        );

        await interaction.reply({
            content: '🔤 **Select a Font Family** for your rank card:\n-# Pick a preset font or choose **Custom Font URL** to use any .ttf/.otf/.woff font from the web!',
            components: [selectMenu],
            flags: MessageFlags.Ephemeral
        });
        return true;
    }

    if (interaction.customId === 'rankcard_preview') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const userData = await getUserData(interaction.user.id);
            const LevelCard = require('./levelCard');
            const levelCard = new LevelCard();

            // Read from rankCard namespace with backward compatibility
            const rankSettings = userData.profile?.rankCard || userData.profile || {};
            // Apply card style FIRST so user's custom colors override the theme
            if (rankSettings.cardStyle) {
                levelCard.setCardStyle(rankSettings.cardStyle);
            }
            if (rankSettings.customBackground) {
                levelCard.setBackgroundImage(rankSettings.customBackground);
            }
            // Default the banner to the user's real Discord banner + fetch
            // their avatar decoration so the preview matches /rank.
            let fullUser = interaction.user;
            try { fullUser = await interaction.client.users.fetch(interaction.user.id, { force: true }); } catch {}
            const discordBanner = (typeof fullUser.bannerURL === 'function')
                ? fullUser.bannerURL({ size: 1024, extension: 'png' }) : null;
            const avatarDecoration = (typeof fullUser.avatarDecorationURL === 'function')
                ? fullUser.avatarDecorationURL() : null;
            const effectiveBanner = rankSettings.bannerImage || discordBanner;
            if (effectiveBanner) {
                levelCard.setBannerImage(effectiveBanner);
                levelCard.setBannerMode(rankSettings.bannerMode || 'strip');
            }
            if (rankSettings.backgroundColor) {
                levelCard.setBackground(rankSettings.backgroundColor);
            }
            if (rankSettings.progressBarColor) {
                levelCard.setProgressBarColor(rankSettings.progressBarColor);
                levelCard.setAccentColor(rankSettings.progressBarColor);
            }
            if (rankSettings.textColor) {
                levelCard.setTextColor(rankSettings.textColor);
            }
            if (userData.social?.bio) {
                levelCard.setBio(userData.social.bio);
            }
            if (rankSettings.backgroundOpacity !== undefined) {
                levelCard.setBackgroundOpacity(rankSettings.backgroundOpacity);
            }
            if (rankSettings.fontFamily) {
                levelCard.setFontFamily(rankSettings.fontFamily);
            }

            const cardBuffer = await levelCard.generate(fullUser, {
                level: 10,
                rank: 1,
                xpProgress: 750,
                xpNeeded: 1000,
                totalXp: 10000,
                avatarDecoration
            });

            const attachment = new AttachmentBuilder(cardBuffer, { name: 'preview-rank-card.png' });
            await interaction.editReply({ 
                content: '<:Checkedbox:1521227734943269077> **Rank Card Preview** - This is how your rank card will look!',
                files: [attachment]
            });
        } catch (error) {
            log.error('Error generating rank card preview:', error);
            await interaction.editReply({ 
                content: '<:Cancel:1521227723916181644> Failed to generate rank card preview. Please try again!' 
            });
        }
        return true;
    }

    if (interaction.customId === 'rankcard_reset') {
        await updateUserData(interaction.user.id, {
            // Reset new rank card namespace
            'profile.rankCard.customBackground': null,
            'profile.rankCard.bannerImage': null,
            'profile.rankCard.bannerMode': 'strip',
            'profile.rankCard.backgroundColor': '#2f3136',
            'profile.rankCard.progressBarColor': '#bcf1e4',
            'profile.rankCard.textColor': '#ffffff',
            'profile.rankCard.cardStyle': 'Default',
            'profile.rankCard.fontFamily': null,
            // Also clear legacy keys for clean slate
            'profile.customBackground': null,
            'profile.backgroundColor': null,
            'profile.progressBarColor': null,
            'profile.textColor': null,
            'profile.cardStyle': null
        });

        await interaction.reply({
            content: '<:Checkedbox:1521227734943269077> **Rank Card Reset** - All rank card customizations have been reset to default!',
            flags: MessageFlags.Ephemeral
        });

        return true;
    }

    if (interaction.customId === 'rankcard_refresh') {
        try {
            const rankCustomizeCmd = interaction.client.commands?.get('rank-customize')
                || interaction.client.prefixCommands?.get('rank-customize');
            if (rankCustomizeCmd?.showCustomizationPanel) {
                await rankCustomizeCmd.showCustomizationPanel(interaction, true, true);
            } else {
                await interaction.reply({ content: '<:Checkedbox:1521227734943269077> Use `/rank-customize panel` to view your updated settings.', flags: MessageFlags.Ephemeral });
            }
        } catch (error) {
            log.error('Error refreshing rank panel:', error);
            await interaction.reply({ content: '<:Cancel:1521227723916181644> Failed to refresh the panel.', flags: MessageFlags.Ephemeral }).catch(() => {});
        }
        return true;
    }

    return false;
}

async function handleStickyButtons(interaction) {
    // Guard: skip if the interaction was already acknowledged (prevents "already acknowledged" errors)
    if (interaction.replied || interaction.deferred) return;

    // Check if config session has expired
    if (await checkAndExpire(interaction, 'config')) return;

    // Permission check — only users with Manage Messages can use these buttons
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
        const err = new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent('### <:Cancel:1521227723916181644> Missing Permission\nYou need **Manage Messages** to use these controls.'));
        return interaction.reply({ components: [err], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral }).catch(() => {});
    }

    const path = require('path');

    function loadStickyConfig() {
        if (!jsonStore.has('sticky')) {
            jsonStore.write('sticky', {});
            return {};
        }
        try {
            return jsonStore.read('sticky');
        } catch (error) {
            log.error('Error loading sticky config:', error);
            return {};
        }
    }

    function saveStickyConfig(config) {
        try {
            jsonStore.write('sticky', config);
        } catch (error) {
            log.error('Error saving sticky config:', error);
        }
    }

    const guildId = interaction.guild.id;
    const config = loadStickyConfig();
    
    if (!config[guildId]) {
        config[guildId] = { enabled: false, messages: {} };
        saveStickyConfig(config);
    }

    const guildConfig = config[guildId];

    if (interaction.customId === 'sticky_toggle') {
        guildConfig.enabled = !guildConfig.enabled;
        config[guildId] = guildConfig;
        saveStickyConfig(config);

        const color = guildConfig.enabled ? 0xCAD7E6 : 0xED4245;
        const container = new ContainerBuilder()
            .setAccentColor(color)
            .addTextDisplayComponents(
                new TextDisplayBuilder()
                    .setContent(`### ${guildConfig.enabled ? '<:Toggleon:1521227758011809964>' : '<:Toggleoff:1521227763816595559>'} Sticky Messages ${guildConfig.enabled ? 'Enabled' : 'Disabled'}\nThe system is now **${guildConfig.enabled ? 'active' : 'inactive'}**.`)
            );

        await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        return;
    }

    if (interaction.customId === 'sticky_list') {
        const messages = guildConfig.messages || {};
        const messageList = Object.entries(messages);
        
        if (messageList.length === 0) {
            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent('### <:Pin:1521227932625014916> No Sticky Messages\nUse Quick Setup to create one.')
                );
            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            return;
        }

        let listText = '## <:Pin:1521227932625014916> Active Sticky Messages\n\n';
        for (const [channelId, data] of messageList) {
            const channel = interaction.guild.channels.cache.get(channelId);
            const channelName = channel ? `<#${channelId}>` : `Unknown (\`${channelId}\`)`;
            const typeIcon = data.displayType === 'embed' ? '<:Bookopen:1521227911137595605>' : data.displayType === 'container' ? '<:Box:1521228152414666833>' : '<:Edit:1521227886634205298>';
            const content = data.content?.substring(0, 50) || 'No content';
            listText += `${typeIcon} **${channelName}**\n-# ${content}${data.content?.length > 50 ? '...' : ''}\n\n`;
        }
        listText += `-# ${messageList.length} message(s) total`;

        const container = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(listText));

        await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        return;
    }

    if (interaction.customId === 'sticky_clear') {
        const count = Object.keys(guildConfig.messages || {}).length;
        for (const [channelId, data] of Object.entries(guildConfig.messages || {})) {
            try {
                if (data.messageId) {
                    const ch = interaction.guild.channels.cache.get(channelId);
                    if (ch) { const m = await ch.messages.fetch(data.messageId).catch(() => null); if (m) await m.delete().catch(() => {}); }
                }
            } catch {}
        }
        guildConfig.messages = {};
        config[guildId] = guildConfig;
        saveStickyConfig(config);

        const container = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder()
                    .setContent(`### <:Trash:1521227750420254820> All Cleared\nRemoved **${count}** sticky message(s).`)
            );

        await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        return;
    }

    if (interaction.customId === 'sticky_quick_setup') {
        const modal = new ModalBuilder()
            .setCustomId('sticky_modal_quick')
            .setTitle('Quick Sticky Setup');

        const contentInput = new TextInputBuilder()
            .setCustomId('sticky_quick_content')
            .setLabel('Message Content')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Enter your sticky message content...')
            .setRequired(true)
            .setMaxLength(2000);

        const typeInput = new TextInputBuilder()
            .setCustomId('sticky_quick_type')
            .setLabel('Display Type (embed / container / content)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('container')
            .setRequired(false)
            .setValue('container');

        modal.addComponents(
            new ActionRowBuilder().addComponents(contentInput),
            new ActionRowBuilder().addComponents(typeInput)
        );
        await interaction.showModal(modal);
        return;
    }

    if (interaction.customId === 'sticky_set_message') {
        const modal = new ModalBuilder()
            .setCustomId('sticky_modal_message')
            .setTitle('Set Sticky Message');

        const contentInput = new TextInputBuilder()
            .setCustomId('sticky_content')
            .setLabel('Message Content')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Enter your sticky message content...')
            .setRequired(true)
            .setMaxLength(2000);

        modal.addComponents(new ActionRowBuilder().addComponents(contentInput));
        await interaction.showModal(modal);
        return;
    }

    if (interaction.customId === 'sticky_set_channel') {
        const row = new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
                .setCustomId('sticky_channel_select')
                .setPlaceholder('Select a channel for the sticky message')
                .addChannelTypes(ChannelType.GuildText)
                .setMinValues(1)
                .setMaxValues(1)
        );
        const container = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent('### <:Pin:1521227932625014916> Set Sticky Channel\nSelect the channel where your sticky message will appear.'))
            .addActionRowComponents(row);
        await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        return;
    }

    if (interaction.customId === 'sticky_remove') {
        const activeChannels = Object.keys(guildConfig.messages || {});
        if (activeChannels.length === 0) {
            const err = new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent('### <:Cancel:1521227723916181644> No Sticky Messages\nThere are no sticky messages to remove.'));
            return interaction.reply({ components: [err], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }
        const row = new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
                .setCustomId('sticky_remove_channel_select')
                .setPlaceholder('Select a channel to remove sticky from')
                .addChannelTypes(ChannelType.GuildText)
                .setMinValues(1)
                .setMaxValues(1)
        );
        const container = new ContainerBuilder()
            .setAccentColor(0xED4245)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent('### <:Trash:1521227750420254820> Remove Sticky\nSelect the channel to remove its sticky message from.'))
            .addActionRowComponents(row);
        await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        return;
    }

    if (interaction.customId === 'sticky_type_embed' || interaction.customId === 'sticky_type_container' || interaction.customId === 'sticky_type_content') {
        const typeMap = { 'sticky_type_embed': 'embed', 'sticky_type_container': 'container', 'sticky_type_content': 'content' };
        const selectedType = typeMap[interaction.customId];

        if (!guildConfig.pendingChannel) {
            const err = new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent('### <:Cancel:1521227723916181644> No Channel Set\nClick **Set Channel** first, then pick a display type.'));
            await interaction.reply({ components: [err], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            return;
        }

        if (!guildConfig.pendingContent) {
            const err = new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent('### <:Cancel:1521227723916181644> No Message Content\nClick **Set Message** first to write the content.'));
            await interaction.reply({ components: [err], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            return;
        }

        const channelId = guildConfig.pendingChannel;
        const msgContent = guildConfig.pendingContent;
        let channel = interaction.guild.channels.cache.get(channelId);
        if (!channel) { try { channel = await interaction.guild.channels.fetch(channelId).catch(() => null); } catch {} }

        if (!channel) {
            const err = new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent('### <:Cancel:1521227723916181644> Channel Not Found\nThe selected channel no longer exists. Set a new channel.'));
            await interaction.reply({ components: [err], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            return;
        }

        if (guildConfig.messages[channelId]?.messageId) {
            try { const old = await channel.messages.fetch(guildConfig.messages[channelId].messageId).catch(() => null); if (old) await old.delete().catch(() => {}); } catch {}
        }

        guildConfig.messages[channelId] = { content: msgContent, displayType: selectedType, messageId: null, channelId };
        if (!guildConfig.enabled) guildConfig.enabled = true;
        delete guildConfig.pendingChannel;
        delete guildConfig.pendingContent;

        try {
            const processed = replacePlaceholders(msgContent, interaction.user, interaction.guild, channel);
            let stickyMsg;

            if (selectedType === 'embed') {
                const embed = new EmbedBuilder().setDescription(processed).setColor(0xCAD7E6);
                stickyMsg = await channel.send({ embeds: [embed] });
            } else if (selectedType === 'container') {
                const c = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(processed));
                stickyMsg = await channel.send({ components: [c], flags: MessageFlags.IsComponentsV2 });
            } else {
                stickyMsg = await channel.send({ content: processed });
            }

            if (stickyMsg) guildConfig.messages[channelId].messageId = stickyMsg.id;
        } catch (error) {
            log.error('Sticky send error:', error);
            delete guildConfig.messages[channelId];
            config[guildId] = guildConfig;
            saveStickyConfig(config);
            const err = new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent(`### <:Cancel:1521227723916181644> Failed\nCouldn't send to <#${channelId}>. Check my permissions.`));
            await interaction.reply({ components: [err], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            return;
        }

        config[guildId] = guildConfig;
        saveStickyConfig(config);

        const ok = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(`### <:Checkedbox:1521227734943269077> Sticky Message Created\n**Channel:** <#${channelId}>\n**Type:** ${selectedType.charAt(0).toUpperCase() + selectedType.slice(1)}\n\n-# Re-appears when pushed up by new messages`));
        await interaction.reply({ components: [ok], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        return;
    }

    // ── Channel select menu: Set Channel ──────────────────────────────────────
    if (interaction.customId === 'sticky_channel_select') {
        const selectedChannelId = interaction.values[0];
        let channel = interaction.guild.channels.cache.get(selectedChannelId);
        if (!channel) { try { channel = await interaction.guild.channels.fetch(selectedChannelId).catch(() => null); } catch {} }

        if (!channel) {
            const err = new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent('### <:Cancel:1521227723916181644> Channel Not Found\nThe selected channel could not be found.'));
            return interaction.reply({ components: [err], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        const botMember = interaction.guild.members.me;
        if (!channel.permissionsFor(botMember)?.has(['SendMessages', 'ViewChannel'])) {
            const err = new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent(`### <:Cancel:1521227723916181644> No Access\nI don't have permission to send messages in <#${channel.id}>.`));
            return interaction.reply({ components: [err], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        guildConfig.pendingChannel = channel.id;
        config[guildId] = guildConfig;
        saveStickyConfig(config);

        const hasPending = !!guildConfig.pendingContent;
        const next = hasPending
            ? 'Now pick a **Display Type** from the panel to create the sticky.'
            : 'Now click **Set Message** to write content, then pick a **Display Type**.';
        const ok = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(`### <:Checkedbox:1521227734943269077> Channel Set\n**Target:** <#${channel.id}>\n\n${next}`));
        await interaction.reply({ components: [ok], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        return;
    }

    // ── Channel select menu: Remove Sticky ────────────────────────────────────
    if (interaction.customId === 'sticky_remove_channel_select') {
        const selectedChannelId = interaction.values[0];

        if (!guildConfig.messages[selectedChannelId]) {
            const err = new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent(`### <:Cancel:1521227723916181644> Not Found\nNo sticky message exists in <#${selectedChannelId}>.`));
            return interaction.reply({ components: [err], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        let channel = interaction.guild.channels.cache.get(selectedChannelId);
        if (!channel) { try { channel = await interaction.guild.channels.fetch(selectedChannelId).catch(() => null); } catch {} }

        if (channel && guildConfig.messages[selectedChannelId].messageId) {
            try {
                const msg = await channel.messages.fetch(guildConfig.messages[selectedChannelId].messageId).catch(() => null);
                if (msg) await msg.delete().catch(() => {});
            } catch {}
        }

        delete guildConfig.messages[selectedChannelId];
        config[guildId] = guildConfig;
        saveStickyConfig(config);

        const ok = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(`### <:Checkedbox:1521227734943269077> Removed\nSticky message removed from <#${selectedChannelId}>.`));
        await interaction.reply({ components: [ok], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        return;
    }

    // ── Channel select menu: Quick Setup ──────────────────────────────────────
    if (interaction.customId === 'sticky_quick_channel_select') {
        const selectedChannelId = interaction.values[0];
        let channel = interaction.guild.channels.cache.get(selectedChannelId);
        if (!channel) { try { channel = await interaction.guild.channels.fetch(selectedChannelId).catch(() => null); } catch {} }

        if (!channel) {
            const err = new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent('### <:Cancel:1521227723916181644> Channel Not Found\nThe selected channel could not be found.'));
            return interaction.reply({ components: [err], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        const botMember = interaction.guild.members.me;
        if (!channel.permissionsFor(botMember)?.has(['SendMessages', 'ViewChannel'])) {
            const err = new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent(`### <:Cancel:1521227723916181644> No Access\nI can't send messages in <#${channel.id}>.`));
            return interaction.reply({ components: [err], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        const messageContent = guildConfig.pendingQuickContent;
        const finalType = guildConfig.pendingQuickType || 'container';

        if (!messageContent) {
            const err = new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent('### <:Cancel:1521227723916181644> Content Expired\nYour sticky content expired. Click **Quick Setup** again.'));
            return interaction.reply({ components: [err], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        const channelId = channel.id;
        if (guildConfig.messages[channelId]?.messageId) {
            try { const old = await channel.messages.fetch(guildConfig.messages[channelId].messageId).catch(() => null); if (old) await old.delete().catch(() => {}); } catch {}
        }

        guildConfig.messages[channelId] = { content: messageContent, displayType: finalType, messageId: null, channelId };
        if (!guildConfig.enabled) guildConfig.enabled = true;
        delete guildConfig.pendingQuickContent;
        delete guildConfig.pendingQuickType;

        try {
            const processed = replacePlaceholders(messageContent, interaction.user, interaction.guild, channel);
            let stickyMsg;
            if (finalType === 'embed') {
                const embed = new EmbedBuilder().setDescription(processed).setColor(0xCAD7E6);
                stickyMsg = await channel.send({ embeds: [embed] });
            } else if (finalType === 'container') {
                const c = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(processed));
                stickyMsg = await channel.send({ components: [c], flags: MessageFlags.IsComponentsV2 });
            } else {
                stickyMsg = await channel.send({ content: processed });
            }
            if (stickyMsg) guildConfig.messages[channelId].messageId = stickyMsg.id;
        } catch (error) {
            log.error('Sticky quick send error:', error);
            delete guildConfig.messages[channelId];
            config[guildId] = guildConfig;
            saveStickyConfig(config);
            const err = new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent(`### <:Cancel:1521227723916181644> Failed\nCouldn't send to <#${channelId}>. Check my permissions.`));
            return interaction.reply({ components: [err], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        config[guildId] = guildConfig;
        saveStickyConfig(config);

        const ok = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(`### <:Checkedbox:1521227734943269077> Sticky Message Created\n**Channel:** <#${channelId}>\n**Type:** ${finalType.charAt(0).toUpperCase() + finalType.slice(1)}\n\n-# Re-appears when pushed up by new messages`));
        await interaction.reply({ components: [ok], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        return;
    }
}

module.exports = {
    handleModalSubmit,
    handleWelcomerButtons,
    handleEmbedButtons,
    handleComponentsButtons,
    handleAutoresponderButtons,
    handleAutoreactButtons,
    handleAutomodButtons,
    handleAutomodSelectMenus,
    handleVerificationButtons,
    handleProfileButtons,
    handleStickyButtons,
    handleAntiNukeButtons,
    createEmbedFromData,
    createComponentContainer,
    replacePlaceholders,
    createWelcomerPreview
};