const { isOwner } = require('../../utils/helpers');
const { 
    ContainerBuilder, 
    TextDisplayBuilder, 
    MessageFlags, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle,
    StringSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    SeparatorBuilder,
    SeparatorSpacingSize,
    SectionBuilder,
    ThumbnailBuilder,
    ActivityType,
    PresenceUpdateStatus
} = require('discord.js');

const jsonStore = require('../../utils/jsonStore');

function getActivities() {
    try {
        if (jsonStore.has('bot-activities')) {
            const data = jsonStore.read('bot-activities');
            let needsSave = false;
            // Migrate: move Custom activities to customStatuses
            if (!data.customStatuses) {
                data.customStatuses = [];
                if (data.activities) {
                    const customOnes = data.activities.filter(a => a.type === 'Custom');
                    if (customOnes.length > 0) {
                        data.activities = data.activities.filter(a => a.type !== 'Custom');
                        data.customStatuses = customOnes.map(a => ({ text: a.text }));
                        needsSave = true;
                    }
                }
            }
            if (!data.savedStatus) { data.savedStatus = 'online'; needsSave = true; }
            if (data.customRotating === undefined) { data.customRotating = false; needsSave = true; }
            if (!data.customRotateInterval) { data.customRotateInterval = 30; needsSave = true; }
            if (needsSave) {
                if (!data.rotationSettings) data.rotationSettings = {};
                jsonStore.write('bot-activities', data);
            }
            return data;
        }
    } catch (e) {}
    return { activities: [], customStatuses: [], savedStatus: 'online', current: null, rotating: false, customRotating: false, rotateInterval: 30, customRotateInterval: 30, rotationSettings: {} };
}

function saveActivities(data) {
    if (!data.rotationSettings) data.rotationSettings = {};
    jsonStore.write('bot-activities', data);
}

/**
 * Replace variable placeholders in text with live values
 * Supported: {members}, {server}, {channels}, {roles}, {owner}, {date}, {time}, {uptime}, {users}, {guilds}, {boosts}, {boost_level}, {online}
 */
function resolveVariables(text, client) {
    if (!text || !client) return text;

    const guild = client.guilds.cache.first();

    const uptimeMs = client.uptime || 0;
    const uptimeH = Math.floor(uptimeMs / 3600000);
    const uptimeM = Math.floor((uptimeMs % 3600000) / 60000);
    const uptimeStr = uptimeH > 0 ? `${uptimeH}h ${uptimeM}m` : `${uptimeM}m`;

    const now = new Date();

    const vars = {
        '{members}': guild ? guild.memberCount.toLocaleString() : '0',
        '{server}': guild ? guild.name : 'Unknown',
        '{channels}': guild ? guild.channels.cache.size.toString() : '0',
        '{roles}': guild ? guild.roles.cache.size.toString() : '0',
        '{owner}': guild?.ownerId ? `<@${guild.ownerId}>` : 'Unknown',
        '{date}': now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        '{time}': now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
        '{uptime}': uptimeStr,
        '{users}': client.users.cache.size.toLocaleString(),
        '{guilds}': client.guilds.cache.size.toLocaleString(),
        '{boosts}': guild ? (guild.premiumSubscriptionCount || 0).toString() : '0',
        '{boost_level}': guild ? (guild.premiumTier || 0).toString() : '0',
        '{online}': '0' // Presence Intent disabled – always 0
    };

    let result = text;
    for (const [key, value] of Object.entries(vars)) {
        result = result.split(key).join(value);
    }
    return result;
}

module.exports = {
    prefix: 'botpanel',
    description: 'Professional bot management panel',
    usage: 'botpanel',
    category: 'owner',
    aliases: ['bp', 'botmanage', 'botcontrol'],
    ownerOnly: true,

    async executePrefix(message, args) {
        if (!isOwner(message.author.id)) {
            const container = new ContainerBuilder()
                .setAccentColor(0xED4245)
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent('# <:Cancel:1521227723916181644> Access Denied\n\nThis command is restricted to the bot owner.')
                );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const panel = buildBotPanel(message.client);
        const reply = await message.reply({ components: [panel], flags: MessageFlags.IsComponentsV2 });
        
        if (!global.botPanelData) global.botPanelData = new Map();
        global.botPanelData.set(reply.id, { 
            ownerId: message.author.id, 
            timestamp: Date.now(),
            channelId: message.channel.id
        });
    }
};

function buildBotPanel(client) {
    const container = new ContainerBuilder();

    const presence = client.user.presence;
    const currentStatus = presence?.status || 'online';
    const currentActivity = presence?.activities?.[0];

    // Unicode status dots — these render on ANY bot token (custom emojis from
    // a single emoji server fail when the bot runs on a different token).
    const statusEmojis = {
        online: '🟢',
        idle: '🌙',
        dnd: '⛔',
        invisible: '⚫',
        offline: '⚫',
        streaming: '🟣'
    };

    // Discord has no literal "streaming" status string — the purple indicator
    // appears when the bot has a Streaming activity (type 1).
    const isStreaming = (presence?.activities || []).some(a => a.type === ActivityType.Streaming);

    const activityTypes = {
        0: 'Playing',
        1: 'Streaming',
        2: 'Listening to',
        3: 'Watching',
        4: 'Custom',
        5: 'Competing in'
    };

    let headerContent = `# <:Settings:1521227767780343879> Bot Management Panel\n\n`;
    headerContent += `### Current Configuration\n`;
    headerContent += `> **Username:** ${client.user.username}\n`;
    const statusLabel = isStreaming ? 'Streaming' : (currentStatus.charAt(0).toUpperCase() + currentStatus.slice(1));
    const statusDot = isStreaming ? statusEmojis.streaming : (statusEmojis[currentStatus] || '🟢');
    headerContent += `> **Status:** ${statusDot} ${statusLabel}\n`;
    // Platform comes from the gateway identify `browser` property (set in index.js).
    let platform = 'Desktop';
    try { platform = require('discord.js').DefaultWebSocketManagerOptions?.identifyProperties?.browser || 'Desktop'; } catch { /* keep default */ }
    headerContent += `> **Platform:** ${platform.includes('VR') ? '🥽' : '💻'} ${platform}\n`;
    
    if (currentActivity) {
        if (currentActivity.type === 4) {
            headerContent += `> **Custom Status:** ${currentActivity.state || currentActivity.name}\n`;
        } else {
            headerContent += `> **Activity:** ${activityTypes[currentActivity.type] || 'Playing'} ${currentActivity.name}\n`;
        }
    } else {
        headerContent += `> **Activity:** None set\n`;
    }

    const activityData = getActivities();
    if (activityData.rotating) headerContent += `> <:History:1521227863079256278> Activity Rotation: **Active** (${activityData.activities.length} items)\n`;
    if (activityData.customRotating) headerContent += `> <:History:1521227863079256278> Custom Status Rotation: **Active** (${(activityData.customStatuses || []).length} items)\n`;
    
    headerContent += `> **Servers:** ${client.guilds.cache.size} • **Users:** ${client.users.cache.size}`;

    const section = new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(headerContent))
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(client.user.displayAvatarURL({ size: 256 })));

    container.addSectionComponents(section);
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

    let controlsContent = `### Quick Controls\n`;
    controlsContent += `-# Use the buttons below to manage your bot`;

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(controlsContent));

    // Row 1: Appearance
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('botpanel_avatar')
            .setLabel('Avatar')
            .setEmoji('🖼️')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('botpanel_banner')
            .setLabel('Banner')
            .setEmoji('🎨')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('botpanel_username')
            .setLabel('Username')
            .setEmoji('✏️')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('botpanel_nickname')
            .setLabel('Nickname')
            .setEmoji('📝')
            .setStyle(ButtonStyle.Secondary)
    );

    // Row 2: Presence Status (unicode emojis — render on any bot token)
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('botpanel_status_online')
            .setLabel('Online')
            .setEmoji('🟢')
            .setStyle(currentStatus === 'online' && !isStreaming ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('botpanel_status_idle')
            .setLabel('Idle')
            .setEmoji('🌙')
            .setStyle(currentStatus === 'idle' ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('botpanel_status_dnd')
            .setLabel('DND')
            .setEmoji('⛔')
            .setStyle(currentStatus === 'dnd' ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('botpanel_status_invisible')
            .setLabel('Invisible')
            .setEmoji('⚫')
            .setStyle(currentStatus === 'invisible' ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('botpanel_status_streaming')
            .setLabel('Streaming')
            .setEmoji('🟣')
            .setStyle(isStreaming ? ButtonStyle.Success : ButtonStyle.Secondary)
    );

    // Row 2b: Extra presence options
    // - "None" clears the activity so nothing is shown (keeps the status).
    // - "VR" reflects the bot's VR platform (set via the gateway identify
    //   `browser = 'Discord VR'`) and applies a clean online VR preset.
    const hasActivity = (presence?.activities || []).length > 0;
    const row2b = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('botpanel_status_none')
            .setLabel('None')
            .setEmoji('🚫')
            .setStyle(!hasActivity ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('botpanel_status_vr')
            .setLabel('VR')
            .setEmoji('🥽')
            .setStyle(ButtonStyle.Secondary)
    );

    // Row 3: Activity Manager
    const row3 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('botpanel_activity_manager')
            .setLabel('Manage Activities')
            .setEmoji('📋')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('botpanel_activity_rotate')
            .setLabel(activityData.rotating ? 'Stop Activity' : 'Start Activity')
            .setEmoji(activityData.rotating ? '❌' : '🔄')
            .setStyle(activityData.rotating ? ButtonStyle.Danger : ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId('botpanel_activity_clear')
            .setLabel('Clear Activity')
            .setEmoji('🗑️')
            .setStyle(ButtonStyle.Danger)
    );

    // Row 4: Custom Status Manager
    const row4 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('botpanel_custom_manager')
            .setLabel('Manage Custom')
            .setEmoji('💬')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('botpanel_custom_rotate')
            .setLabel(activityData.customRotating ? 'Stop Custom' : 'Start Custom')
            .setEmoji(activityData.customRotating ? '❌' : '🔄')
            .setStyle(activityData.customRotating ? ButtonStyle.Danger : ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId('botpanel_custom_clear')
            .setLabel('Clear Custom')
            .setEmoji('🗑️')
            .setStyle(ButtonStyle.Danger)
    );

    // Row 5: Actions
    const row5 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('botpanel_refresh')
            .setLabel('Refresh')
            .setEmoji('🔄')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('botpanel_variables')
            .setLabel('Variables')
            .setEmoji('📋')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('botpanel_stats')
            .setLabel('Stats')
            .setEmoji('📊')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('botpanel_reset')
            .setLabel('Reset Bot')
            .setEmoji('♻️')
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId('botpanel_close')
            .setLabel('Close')
            .setEmoji('❌')
            .setStyle(ButtonStyle.Danger)
    );

    container.addActionRowComponents(row1, row2, row2b, row3, row4, row5);

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Bot Panel • Owner: <@${process.env.OWNER_ID}>`));

    return container;
}

function buildActivityModal(activityType) {
    const typeLabels = {
        'playing': 'Playing',
        'watching': 'Watching', 
        'listening': 'Listening to',
        'competing': 'Competing in'
    };

    const modal = new ModalBuilder()
        .setCustomId(`botpanel_activity_modal_${activityType}`)
        .setTitle(`Set ${typeLabels[activityType]} Activity`);

    const activityInput = new TextInputBuilder()
        .setCustomId('activity_text')
        .setLabel(`What is the bot ${activityType}?`)
        .setStyle(TextInputStyle.Short)
        .setPlaceholder(`Enter ${activityType} text...`)
        .setMaxLength(128)
        .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(activityInput));
    return modal;
}

function buildImageModal(type) {
    const labels = {
        'avatar': 'Bot Avatar',
        'banner': 'Bot Banner'
    };

    const modal = new ModalBuilder()
        .setCustomId(`botpanel_${type}_modal`)
        .setTitle(`Set ${labels[type]}`);

    const urlInput = new TextInputBuilder()
        .setCustomId('image_url')
        .setLabel('Image URL')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('https://example.com/image.png')
        .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(urlInput));
    return modal;
}

function buildUsernameModal() {
    const modal = new ModalBuilder()
        .setCustomId('botpanel_username_modal')
        .setTitle('Set Bot Username');

    const usernameInput = new TextInputBuilder()
        .setCustomId('username_text')
        .setLabel('New Username')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Enter new bot username...')
        .setMinLength(2)
        .setMaxLength(32)
        .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(usernameInput));
    return modal;
}

function buildNicknameModal() {
    const modal = new ModalBuilder()
        .setCustomId('botpanel_nickname_modal')
        .setTitle('Set Bot Nickname (This Server)');

    const nicknameInput = new TextInputBuilder()
        .setCustomId('nickname_text')
        .setLabel('New Nickname (leave empty to reset)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Enter nickname...')
        .setMaxLength(32)
        .setRequired(false);

    modal.addComponents(new ActionRowBuilder().addComponents(nicknameInput));
    return modal;
}

function buildActivityManagerPanel(client, page = 0) {
    const container = new ContainerBuilder();

    const activityData = getActivities();
    const activities = activityData.activities || [];
    const itemsPerPage = 3; // Reduced to fit within Discord's 5 action row limit
    const totalPages = Math.max(1, Math.ceil(activities.length / itemsPerPage));
    const currentPage = Math.min(Math.max(0, page), totalPages - 1);
    const startIdx = currentPage * itemsPerPage;
    const pageActivities = activities.slice(startIdx, startIdx + itemsPerPage);

    const typeEmojis = {
        'Playing': '🎮',
        'Watching': '👀',
        'Listening': '🎧',
        'Competing': '🏆',
        'Streaming': '📺',
        'Custom': '💬'
    };

    const presence = client.user.presence;
    const currentActivity = presence?.activities?.[0];
    let currentText = 'None';
    if (currentActivity) {
        const typeNames = { 0: 'Playing', 1: 'Streaming', 2: 'Listening', 3: 'Watching', 4: 'Custom', 5: 'Competing' };
        if (currentActivity.type === 4) {
            currentText = `💬 **${currentActivity.state || currentActivity.name}**`;
        } else {
            currentText = `${typeEmojis[typeNames[currentActivity.type]] || '🎮'} ${typeNames[currentActivity.type] || 'Playing'} **${currentActivity.name}**`;
        }
    }

    let headerContent = `# <:Document:1521227875016114266> Activity Manager\n\n`;
    headerContent += `### Current Activity\n`;
    headerContent += `> ${currentText}\n\n`;
    headerContent += `### Saved Activities (${activities.length})\n`;
    
    if (activities.length === 0) {
        headerContent += `> No activities saved yet!\n> Use the buttons below to add activities.`;
    } else {
        headerContent += `-# Click an activity to set it • Page ${currentPage + 1}/${totalPages}`;
    }

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(headerContent));
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

    // Activity selection buttons (up to 5 per page)
    if (pageActivities.length > 0) {
        const activityRows = [];
        for (let i = 0; i < pageActivities.length; i++) {
            const act = pageActivities[i];
            const globalIdx = startIdx + i;
            const emoji = typeEmojis[act.type] || '🎮';
            const isActive = currentActivity && currentActivity.name === act.text && 
                            (act.type === 'Playing' && currentActivity.type === 0 ||
                             act.type === 'Watching' && currentActivity.type === 3 ||
                             act.type === 'Listening' && currentActivity.type === 2 ||
                             act.type === 'Competing' && currentActivity.type === 5 ||
                             act.type === 'Custom' && currentActivity.type === 4);
            
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`activity_select_${globalIdx}`)
                    .setLabel(`${act.text.substring(0, 40)}`)
                    .setEmoji(emoji)
                    .setStyle(isActive ? ButtonStyle.Success : ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId(`activity_remove_${globalIdx}`)
                    .setLabel('Remove')
                    .setEmoji('🗑️')
                    .setStyle(ButtonStyle.Danger)
            );
            activityRows.push(row);
        }
        
        for (const row of activityRows) {
            container.addActionRowComponents(row);
        }
    }

    // Add activity type buttons
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`### Add New Activity`));

    const addRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('activity_add_playing')
            .setLabel('Playing')
            .setEmoji('🎮')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('activity_add_streaming')
            .setLabel('Streaming')
            .setEmoji('📺')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('activity_add_watching')
            .setLabel('Watching')
            .setEmoji('👀')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('activity_add_listening')
            .setLabel('Listening')
            .setEmoji('🎧')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('activity_add_competing')
            .setLabel('Competing')
            .setEmoji('🏆')
            .setStyle(ButtonStyle.Primary)
    );

    container.addActionRowComponents(addRow);

    // Navigation row
    const navRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`activity_page_${currentPage - 1}`)
            .setEmoji('◀️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(currentPage === 0),
        new ButtonBuilder()
            .setCustomId('activity_back')
            .setLabel('Back to Panel')
            .setEmoji('↩️')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('botpanel_rotation_settings')
            .setLabel('Rotation Settings')
            .setEmoji('⚙️')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(`activity_page_${currentPage + 1}`)
            .setEmoji('▶️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(currentPage >= totalPages - 1)
    );

    container.addActionRowComponents(navRow);

    return container;
}

function buildRotationSettingsPanel(client) {
    const container = new ContainerBuilder();

    const activityData = getActivities();
    const delay = activityData.rotateInterval || 30;
    const rotating = activityData.rotating || false;
    const activities = activityData.activities || [];
    const settings = activityData.rotationSettings || {};

    let content = `# <:Settings:1521227767780343879> Rotation Settings\n\n`;
    content += `**Status:** ${rotating ? '<:Checkedbox:1521227734943269077> Rotating' : '<:Cancel:1521227723916181644> Stopped'}\n`;
    content += `**Delay:** ${delay} seconds\n\n`;
    content += `### Activities in Rotation\n`;

    if (activities.length === 0) {
        content += `> No activities saved to rotate!`;
    } else {
        activities.forEach((act, i) => {
            const isIncluded = settings[i] !== false;
            content += `> ${isIncluded ? '<:Toggleon:1521227758011809964>' : '<:Toggleoff:1521227763816595559>'} ${act.type}: ${act.text}\n`;
        });
    }

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('botpanel_rotation_delay')
            .setLabel('Set Delay')
            .setEmoji('⏱️')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('botpanel_rotation_toggle_all')
            .setLabel('Toggle All')
            .setEmoji('🔄')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('activity_back')
            .setLabel('Back')
            .setEmoji('↩️')
            .setStyle(ButtonStyle.Secondary)
    );

    container.addActionRowComponents(row1);

    return container;
}

function buildRotationDelayModal(currentDelay) {
    const modal = new ModalBuilder()
        .setCustomId('botpanel_rotation_delay_modal')
        .setTitle('Set Rotation Delay');

    const delayInput = new TextInputBuilder()
        .setCustomId('delay_text')
        .setLabel('Delay (seconds, min 10)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('30')
        .setValue(String(currentDelay))
        .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(delayInput));
    return modal;
}

module.exports.buildRotationSettingsPanel = buildRotationSettingsPanel;
module.exports.buildRotationDelayModal = buildRotationDelayModal;

function buildAddActivityModal(activityType) {
    const modal = new ModalBuilder()
        .setCustomId(`activity_add_modal_${activityType}`)
        .setTitle(`Add ${activityType} Activity`);

    const textInput = new TextInputBuilder()
        .setCustomId('activity_text')
        .setLabel(`What is the bot ${activityType.toLowerCase()}?`)
        .setStyle(TextInputStyle.Short)
        .setPlaceholder(`Enter activity text...`)
        .setMaxLength(128)
        .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(textInput));
    return modal;
}

module.exports.buildBotPanel = buildBotPanel;
module.exports.buildActivityModal = buildActivityModal;
module.exports.buildImageModal = buildImageModal;
module.exports.buildUsernameModal = buildUsernameModal;
module.exports.buildNicknameModal = buildNicknameModal;
module.exports.buildActivityManagerPanel = buildActivityManagerPanel;
module.exports.buildAddActivityModal = buildAddActivityModal;
module.exports.getActivities = getActivities;
module.exports.saveActivities = saveActivities;
module.exports.resolveVariables = resolveVariables;

function buildCustomStatusManagerPanel(client, page = 0) {
    const container = new ContainerBuilder();

    const activityData = getActivities();
    const statuses = activityData.customStatuses || [];
    const itemsPerPage = 3;
    const totalPages = Math.max(1, Math.ceil(statuses.length / itemsPerPage));
    const currentPage = Math.min(Math.max(0, page), totalPages - 1);
    const startIdx = currentPage * itemsPerPage;
    const pageStatuses = statuses.slice(startIdx, startIdx + itemsPerPage);

    const presence = client.user.presence;
    const currentActivity = presence?.activities?.[0];
    let currentText = 'None';
    if (currentActivity && currentActivity.type === 4) {
        currentText = `💬 **${currentActivity.state || currentActivity.name}**`;
    }

    let headerContent = `# 💬 Custom Status Manager\n\n`;
    headerContent += `### Current Custom Status\n`;
    headerContent += `> ${currentText}\n\n`;
    headerContent += `### Saved Custom Statuses (${statuses.length})\n`;

    if (statuses.length === 0) {
        headerContent += `> No custom statuses saved yet!\n> Use the button below to add one.`;
    } else {
        headerContent += `-# Click a status to set it • Page ${currentPage + 1}/${totalPages}`;
    }

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(headerContent));
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

    if (pageStatuses.length > 0) {
        for (let i = 0; i < pageStatuses.length; i++) {
            const st = pageStatuses[i];
            const globalIdx = startIdx + i;
            const isActive = currentActivity && currentActivity.type === 4 && (currentActivity.state === st.text || currentActivity.name === st.text);

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`custom_select_${globalIdx}`)
                    .setLabel(`${st.text.substring(0, 40)}`)
                    .setEmoji('💬')
                    .setStyle(isActive ? ButtonStyle.Success : ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId(`custom_remove_${globalIdx}`)
                    .setLabel('Remove')
                    .setEmoji('🗑️')
                    .setStyle(ButtonStyle.Danger)
            );
            container.addActionRowComponents(row);
        }
    }

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`### Add New Custom Status`));

    const addRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('custom_add')
            .setLabel('Add Custom Status')
            .setEmoji('💬')
            .setStyle(ButtonStyle.Success)
    );
    container.addActionRowComponents(addRow);

    const navRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`custom_page_${currentPage - 1}`)
            .setEmoji('◀️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(currentPage === 0),
        new ButtonBuilder()
            .setCustomId('custom_back')
            .setLabel('Back to Panel')
            .setEmoji('↩️')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`custom_page_${currentPage + 1}`)
            .setEmoji('▶️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(currentPage >= totalPages - 1)
    );
    container.addActionRowComponents(navRow);

    return container;
}

function buildAddCustomModal() {
    const modal = new ModalBuilder()
        .setCustomId('custom_add_modal')
        .setTitle('Add Custom Status');

    const textInput = new TextInputBuilder()
        .setCustomId('custom_text')
        .setLabel('Custom status text')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Enter custom status text...')
        .setMaxLength(128)
        .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(textInput));
    return modal;
}

module.exports.buildCustomStatusManagerPanel = buildCustomStatusManagerPanel;
module.exports.buildAddCustomModal = buildAddCustomModal;

function buildVariablesPanel(client) {
    const container = new ContainerBuilder();

    // Show live values
    const liveValues = resolveVariables(
        '{members}|{server}|{channels}|{roles}|{date}|{time}|{uptime}|{users}|{guilds}|{boosts}|{boost_level}|{online}',
        client
    ).split('|');

    let content = `# <:Document:1521227875016114266> Activity Variables\n\n`;
    content += `Use these variables in your activity text or custom status. They will be replaced with live values.\n\n`;
    content += `### <:Invoice:1521227903956811836> Server Variables\n`;
    content += `> \`{members}\` — Total member count → **${liveValues[0]}**\n`;
    content += `> \`{server}\` — Server name → **${liveValues[1]}**\n`;
    content += `> \`{channels}\` — Channel count → **${liveValues[2]}**\n`;
    content += `> \`{roles}\` — Role count → **${liveValues[3]}**\n`;
    content += `> \`{boosts}\` — Boost count → **${liveValues[9]}**\n`;
    content += `> \`{boost_level}\` — Boost level → **${liveValues[10]}**\n`;
    content += `> \`{online}\` — Online members → **${liveValues[11]}**\n\n`;
    content += `### <:Settings:1521227767780343879> Bot Variables\n`;
    content += `> \`{users}\` — Cached users → **${liveValues[7]}**\n`;
    content += `> \`{guilds}\` — Server count → **${liveValues[8]}**\n`;
    content += `> \`{uptime}\` — Bot uptime → **${liveValues[6]}**\n\n`;
    content += `### <:Alarm:1521227869047750689> Time Variables\n`;
    content += `> \`{date}\` — Current date → **${liveValues[4]}**\n`;
    content += `> \`{time}\` — Current time → **${liveValues[5]}**\n\n`;
    content += `### <:Edit:1521227886634205298> Example Usage\n`;
    content += `> \`Watching {members} members\`\n`;
    content += `> \`Playing in {guilds} servers\`\n`;
    content += `> \`<:Fire:1521227907647668374> {boosts} boosts | {online} online\``;

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

    const navRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('activity_back')
            .setLabel('Back to Panel')
            .setEmoji('↩️')
            .setStyle(ButtonStyle.Secondary)
    );
    container.addActionRowComponents(navRow);

    return container;
}

module.exports.buildVariablesPanel = buildVariablesPanel;
