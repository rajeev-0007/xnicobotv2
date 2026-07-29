const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, SectionBuilder, ThumbnailBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, MessageFlags, EmbedBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ChannelSelectMenuBuilder, RoleSelectMenuBuilder, ChannelType, AttachmentBuilder } = require('discord.js');

const jsonStore = require('../../utils/jsonStore');
const { checkAndExpire, registerSession } = require('../../utils/panelExpiration');

function loadButtonsConfig() {
    if (!jsonStore.has('button-commands')) return {};
    try { return jsonStore.read('button-commands'); } catch { return {}; }
}

function getButtonStyle(style) {
    const styles = { 'primary': ButtonStyle.Primary, 'secondary': ButtonStyle.Secondary, 'success': ButtonStyle.Success, 'danger': ButtonStyle.Danger, 'link': ButtonStyle.Link };
    return styles[style] || ButtonStyle.Primary;
}

function buildActionButtonRows(actionButtonIds, guildId) {
    const btnConfig = loadButtonsConfig();
    if (!btnConfig[guildId]) return [];
    const rows = [];
    let currentRow = new ActionRowBuilder();
    let count = 0;
    for (const buttonId of actionButtonIds) {
        const btnData = btnConfig[guildId][buttonId];
        if (!btnData) continue;
        const button = new ButtonBuilder()
            .setLabel(btnData.label)
            .setStyle(getButtonStyle(btnData.style));
        if (btnData.style === 'link') {
            if (btnData.url) button.setURL(btnData.url);
            else continue;
        } else {
            button.setCustomId(`btn_cmd_${guildId}_${buttonId}`);
        }
        if (btnData.emoji) button.setEmoji(btnData.emoji);
        currentRow.addComponents(button);
        count++;
        if (count >= 5) {
            rows.push(currentRow);
            currentRow = new ActionRowBuilder();
            count = 0;
        }
    }
    if (count > 0) rows.push(currentRow);
    return rows;
}

// Safe string helpers to prevent 'Invalid string length' errors from discord.js builders
function safeContent(str, fallback = '\u200b') {
    if (!str || typeof str !== 'string') return fallback;
    return str.length > 4096 ? str.substring(0, 4093) + '...' : str;
}
function safeLabel(str, fallback = 'Button') {
    if (!str || typeof str !== 'string') return fallback;
    return str.length > 80 ? str.substring(0, 77) + '...' : str;
}

// Helper: find the welcomer panel message for this user/guild from session data
// Modal submissions don't carry interaction.message, so we look it up via sessions.
// Selects/buttons on ephemeral pickers (e.g. the template loader popup) carry the
// ephemeral message — but we want the *main* welcomer panel, not the picker — so
// we ignore ephemeral source messages and fall through to the session lookup.
async function findPanelMessage(interaction) {
    // If the interaction has a non-ephemeral message (buttons/selects on the main
    // welcomer panel itself), use it directly.
    if (interaction.message) {
        const flags = interaction.message.flags;
        // MessageFlags.Ephemeral = 1 << 6 (64). Treat ephemeral messages as
        // "picker popups" and search sessions for the real panel instead.
        const isEphemeral = typeof flags?.has === 'function'
            ? flags.has(64)
            : ((flags ?? 0) & 64) === 64;
        if (!isEphemeral) return interaction.message;
    }

    // For modals or ephemeral pickers: search sessions for the real panel
    // owned by this user in this guild.
    if (!global.welcomerSessions) return null;

    for (const [messageId, session] of global.welcomerSessions.entries()) {
        if (session.userId === interaction.user.id && session.guildId === interaction.guild.id) {
            try {
                const channel = interaction.guild.channels.cache.get(session.channelId);
                if (channel) {
                    const msg = await channel.messages.fetch(messageId).catch(() => null);
                    if (msg) return msg;
                }
            } catch (e) { }
            // Session exists but message is gone — clean up
            global.welcomerSessions.delete(messageId);
        }
    }
    return null;
}

// Helper: update the panel message with new container
async function updatePanelMessage(interaction, container, flags) {
    const panelMsg = await findPanelMessage(interaction);
    if (panelMsg) {
        try {
            const editPayload = { components: [container], flags: MessageFlags.IsComponentsV2 };
            await panelMsg.edit(editPayload);
        } catch (e) {
            console.error('Error updating panel:', e);
        }
    }
}

function loadTemplates() {
    if (!jsonStore.has('welcomer-templates')) {
        jsonStore.write('welcomer-templates', {});
        return {};
    }
    return jsonStore.read('welcomer-templates');
}

function saveTemplatesFile(templates) {
    jsonStore.write('welcomer-templates', templates);
}

function getBuiltInWelcomerTemplates() {
    // Built-in templates were intentionally removed — every server
    // should design and save its own templates instead of falling
    // back to a generic stock library that doesn't fit the brand.
    // Returning `{}` keeps the loader UI rendering an empty section
    // gracefully (it already handles "no templates" via user-only
    // listings).
    return {};
}

function loadConfig() {
    if (!jsonStore.has('welcomer')) {
        jsonStore.write('welcomer', {});
        return {};
    }
    try {
        return jsonStore.read('welcomer');
    } catch (e) {
        console.error('Welcomer: Error reading config:', e.message);
        return {};
    }
}

function saveConfig(config) {
    jsonStore.write('welcomer', config);
}

function getDefaultConfig() {
    return {
        enabled: false,
        channelId: null,
        mode: 'components',
        content: 'Welcome {user} to **{server}**! We now have {membercount} members.',
        title: null,
        description: null,
        color: '#bcf1e4',
        image: null,
        thumbnail: null,
        footer: null,
        author: null,
        pingUser: false,
        dmWelcome: { enabled: false, content: 'Welcome to **{server}**! We are glad to have you here.' },
        autoDelete: 0,
        buttons: [],
        actionButtons: [],
        buttonPosition: 'bottom',
        imagePosition: 'bottom',
        canvas: { enabled: false, backgroundColor: null, accentColor: null, customMessage: null },
        leave: {
            enabled: false,
            channelId: null,
            mode: 'components',
            content: 'Goodbye **{username}**! We now have {membercount} members.',
            title: null,
            description: null,
            color: '#ED4245',
            image: null,
            thumbnail: null,
            footer: null,
            author: null,
            buttons: [],
            actionButtons: [],
            buttonPosition: 'bottom',
            imagePosition: 'bottom'
        }
    };
}

function normalizeHexColor(input, fallback = '#bcf1e4') {
    let c = (input || '').trim();
    if (/^[0-9a-fA-F]{3,6}$/.test(c)) c = '#' + c;
    return /^#[0-9a-fA-F]{3,6}$/.test(c) ? c : fallback;
}

function buildMainPanel(guildConfig, guildId) {
    const mode = guildConfig.mode || 'components';
    const isComponents = mode === 'components';

    // Consistent status glyphs
    const ON = '<:Toggleon:1521227758011809964>';
    const OFF = '<:Toggleoff:1521227763816595559>';
    const YES = '<:Checkedbox:1521227734943269077>';
    const NO = '<:Cancel:1521227723916181644>';
    const toggle = v => (v ? ON : OFF);
    const mark = v => (v ? YES : NO);

    const statusText = guildConfig.enabled ? `${ON} Enabled` : `${OFF} Disabled`;
    const channelText = guildConfig.channelId ? `<#${guildConfig.channelId}>` : '`Not set`';
    const modeText = isComponents ? '<:Fire:1521227907647668374> Components V2' : '<:Document:1521227875016114266> Embed';

    const btnCount = (guildConfig.buttons?.length || 0) + (guildConfig.actionButtons?.length || 0);
    const imgPos = guildConfig.imagePosition || 'bottom';
    const posLabel = imgPos === 'top' ? 'Top' : imgPos === 'side' ? 'Side' : 'Bottom';

    let content = `# <:Userplus:1521227719621218477> Welcomer\n`;
    content += `-# Greet new members with a custom message, image card, or embed.\n\n`;
    content += `**Status** ${statusText}   **Channel** ${channelText}   **Mode** ${modeText}\n`;

    content += `\n### <:Picture:1521227954191995024> Appearance\n`;
    if (isComponents) {
        const welcomeBtnPos = guildConfig.buttonPosition || 'bottom';
        content += `${mark(guildConfig.image)} Media Gallery   ${mark(guildConfig.thumbnail)} Thumbnail   \`Image: ${posLabel}\`\n`;
        content += `${mark(btnCount > 0)} Buttons${btnCount > 0 ? ` \`${btnCount} · ${welcomeBtnPos === 'top' ? 'Top' : 'Bottom'}\`` : ''}   ${toggle(guildConfig.canvas?.enabled)} Canvas\n`;
        content += `${toggle(guildConfig.colorless)} Colorless   \`Accent: ${guildConfig.colorless ? 'None' : (guildConfig.color || '#bcf1e4')}\`\n`;
    } else {
        const title = guildConfig.title ? guildConfig.title.substring(0, 30) + (guildConfig.title.length > 30 ? '…' : '') : '';
        content += `${mark(guildConfig.title)} Title${title ? ` \`${title}\`` : ''}   ${mark(guildConfig.image)} Image   ${mark(guildConfig.thumbnail)} Thumbnail\n`;
        content += `${mark(guildConfig.footer)} Footer   \`Color: ${guildConfig.color || '#bcf1e4'}\`\n`;
    }

    content += `\n### <:Settings:1521227767780343879> Extras\n`;
    const autoDel = guildConfig.autoDelete > 0 ? `\`${guildConfig.autoDelete}s\`` : OFF;
    content += `${toggle(guildConfig.pingUser)} Ping User   ${toggle(guildConfig.dmWelcome?.enabled)} DM Welcome   ${autoDel} Auto-Delete\n`;

    content += `\n### <:Hashtag:1521227771957870604> Message Preview\n`;
    const preview = (guildConfig.content || guildConfig.message || 'Welcome {user} to {server}!');
    content += `> ${preview.substring(0, 240).split('\n').join('\n> ')}${preview.length > 240 ? ' …' : ''}`;

    return content;
}

function buildVariablesPanel() {
    return `# <:Clipboard:1521228175298920448> Available Variables\n\n` +
        `### <:User:1521227714227343380> User Variables\n` +
        `\`{user}\` \`{username}\` \`{displayname}\` \`{userid}\` \`{useravatar}\` \`{userbanner}\` \`{usercreated}\` \`{userjoined}\` \`{joinposition}\`\n\n` +
        `### <:Server:1521228371051413546> Server Variables\n` +
        `\`{server}\` \`{servername}\` \`{serverid}\` \`{servericon}\` \`{serverowner}\` \`{serverdescription}\` \`{servercreated}\`\n\n` +
        `### <:Userplus:1521227719621218477> Member Variables\n` +
        `\`{membercount}\` \`{members}\` \`{onlinecount}\` \`{botcount}\` \`{humancount}\`\n\n` +
        `### <:Bullhorn:1521227936575914016> Channel Variables\n` +
        `\`{channel}\` \`{channelmention}\` \`{channelname}\` \`{textchannels}\` \`{voicechannels}\`\n\n` +
        `### <:Sketch:1521228025365004471> Boost Variables\n` +
        `\`{boostcount}\` \`{boostlevel}\` \`{boosttier}\`\n\n` +
        `### <:Userplus:1521227719621218477> Role Variables\n` +
        `\`{roles}\` \`{rolecount}\` \`{highestrole}\`\n\n` +
        `### <:Plus:1521228180877217864> Separators (Components V2)\n` +
        `\`{separator}\` \`{separator:small}\` \`{separator:medium}\` \`{separator:large}\`\n\n` +
        `### <:Picture:1521227954191995024> URL Variables\n` +
        `Use \`{useravatar}\` or \`{servericon}\` in Thumbnail/Image fields!`;
}

function createModeRow(currentMode) {
    const isComponents = currentMode === 'components';
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('welcomer_mode_components')
                .setLabel('Components V2')
                .setStyle(isComponents ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setEmoji('<:Fire:1521227907647668374>')
                .setDisabled(isComponents),
            new ButtonBuilder()
                .setCustomId('welcomer_mode_embed')
                .setLabel('Embed Mode')
                .setStyle(!isComponents ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setEmoji('<:Document:1521227875016114266>')
                .setDisabled(!isComponents)
        );
}

function createSetupRow1(guildConfig) {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('welcomer_set_channel')
                .setLabel('Channel')
                .setStyle(guildConfig.channelId ? ButtonStyle.Success : ButtonStyle.Primary)
                .setEmoji('<:Bullhorn:1521227936575914016>'),
            new ButtonBuilder()
                .setCustomId('welcomer_set_message')
                .setLabel('Message')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('<:Hashtag:1521227771957870604>'),
            new ButtonBuilder()
                .setCustomId('welcomer_set_styling')
                .setLabel('Styling')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('<:Palette:1521227950601539755>'),
            new ButtonBuilder()
                .setCustomId('welcomer_set_media')
                .setLabel('Media')
                .setStyle(guildConfig.image || guildConfig.thumbnail ? ButtonStyle.Success : ButtonStyle.Primary)
                .setEmoji('<:Picture:1521227954191995024>'),
            new ButtonBuilder()
                .setCustomId('welcomer_set_buttons')
                .setLabel(`Buttons${(guildConfig.buttons?.length || guildConfig.actionButtons?.length) ? ' (' + ((guildConfig.buttons?.length || 0) + (guildConfig.actionButtons?.length || 0)) + ')' : ''}`)
                .setStyle((guildConfig.buttons?.length || guildConfig.actionButtons?.length) ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setEmoji('<:Attach:1521228039135170722>')
        );
}

function createSetupRow2(guildConfig) {
    const mode = guildConfig.mode || 'components';
    const isComponents = mode === 'components';

    if (isComponents) {
        return new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('welcomer_canvas_setup')
                    .setLabel('Canvas Setup')
                    .setStyle(guildConfig.canvas?.enabled ? ButtonStyle.Success : ButtonStyle.Secondary)
                    .setEmoji('<:Picture:1521227954191995024>'),
                new ButtonBuilder()
                    .setCustomId('welcomer_autorole_humans')
                    .setLabel('AutoRole Humans')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('<:User:1521227714227343380>'),
                new ButtonBuilder()
                    .setCustomId('welcomer_autorole_bots')
                    .setLabel('AutoRole Bots')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('<:bots:1521227848101396610>'),
                new ButtonBuilder()
                    .setCustomId('welcomer_leave_setup')
                    .setLabel('Leave Setup')
                    .setStyle(guildConfig.leave?.enabled ? ButtonStyle.Success : ButtonStyle.Secondary)
                    .setEmoji('<:Userplus:1521227719621218477>')
            );
    } else {
        return new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('welcomer_embed_author')
                    .setLabel('Author')
                    .setStyle(guildConfig.author ? ButtonStyle.Success : ButtonStyle.Secondary)
                    .setEmoji('<:Editalt:1521227921673556019>'),
                new ButtonBuilder()
                    .setCustomId('welcomer_embed_footer')
                    .setLabel('Footer')
                    .setStyle(guildConfig.footer ? ButtonStyle.Success : ButtonStyle.Secondary)
                    .setEmoji('<:Edit:1521227886634205298>'),
                new ButtonBuilder()
                    .setCustomId('welcomer_autorole_humans')
                    .setLabel('AutoRole Humans')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('<:User:1521227714227343380>'),
                new ButtonBuilder()
                    .setCustomId('welcomer_autorole_bots')
                    .setLabel('AutoRole Bots')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('<:bots:1521227848101396610>')
            );
    }
}

function buildCanvasPanel(canvasConfig) {
    const statusEmoji = canvasConfig?.enabled ? '<:Toggleon:1521227758011809964>' : '<:Toggleoff:1521227763816595559>';

    let content = `# <:Picture:1521227954191995024> Welcome Canvas Setup\n\n`;
    content += `**Status:** ${statusEmoji} ${canvasConfig?.enabled ? 'Enabled' : 'Disabled'}\n\n`;
    content += `### <:Palette:1521227950601539755> Current Settings\n`;
    content += `\`\`\`\n`;
    content += `Background    │ ${canvasConfig?.backgroundColor || '#23272a'}\n`;
    content += `Accent        │ ${canvasConfig?.accentColor || '#bcf1e4'}\n`;
    content += `Text          │ ${canvasConfig?.textColor || '#ffffff'}\n`;
    content += `\`\`\`\n\n`;
    content += `<:Picture:1521227954191995024> **Background Image:** ${canvasConfig?.backgroundImage ? '<:Checkedbox:1521227734943269077> Set' : '<:Cancel:1521227723916181644> Default'}\n`;
    content += `<:Edit:1521227886634205298> **Custom Message:** ${canvasConfig?.customMessage || '\`Member #{count}\`'}\n\n`;
    content += `### <:Bookopen:1521227911137595605> About Canvas Mode\n`;
    content += `Canvas mode generates a beautiful welcome image card featuring:\n`;
    content += `• User's avatar with accent ring\n`;
    content += `• "WELCOME" header text\n`;
    content += `• Username display\n`;
    content += `• Custom message or member count\n`;
    content += `• Server name footer`;

    return content;
}

function createCanvasSetupRow1(canvasConfig) {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('canvas_set_bgcolor')
                .setLabel('BG Color')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('<:Palette:1521227950601539755>'),
            new ButtonBuilder()
                .setCustomId('canvas_set_accent')
                .setLabel('Accent')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('<:Star:1521227981685526568>'),
            new ButtonBuilder()
                .setCustomId('canvas_set_text')
                .setLabel('Text Color')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('<:Editalt:1521227921673556019>'),
            new ButtonBuilder()
                .setCustomId('canvas_set_background')
                .setLabel('Background')
                .setStyle(canvasConfig?.backgroundImage ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setEmoji('<:Picture:1521227954191995024>')
        );
}

function createCanvasSetupRow2(canvasConfig) {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('canvas_set_message')
                .setLabel('Custom Message')
                .setStyle(canvasConfig?.customMessage ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setEmoji('<:Edit:1521227886634205298>'),
            new ButtonBuilder()
                .setCustomId('canvas_preview')
                .setLabel('Preview')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('<:Eye:1521227940480815156>'),
            new ButtonBuilder()
                .setCustomId('canvas_reset')
                .setLabel('Reset')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('<:Trash:1521227750420254820>')
        );
}

function createCanvasControlRow(canvasConfig) {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('canvas_toggle')
                .setLabel(canvasConfig?.enabled ? 'Disable Canvas' : 'Enable Canvas')
                .setStyle(canvasConfig?.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
                .setEmoji(canvasConfig?.enabled ? '<:Toggleoff:1521227763816595559>' : '<:Toggleon:1521227758011809964>'),
            new ButtonBuilder()
                .setCustomId('canvas_back')
                .setLabel('Back to Welcomer')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('<:Caretleft:1521227977495543838>')
        );
}

function buildCanvasContainer(canvasConfig) {
    const colorValue = canvasConfig?.accentColor ? parseInt(canvasConfig.accentColor.replace('#', ''), 16) : 0xCAD7E6;

    const container = new ContainerBuilder()
        .setAccentColor(isNaN(colorValue) ? 0xCAD7E6 : colorValue);

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(safeContent(buildCanvasPanel(canvasConfig)))
    );

    container.addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    );

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent('### <:Settings:1521227767780343879> Customization')
    );
    container.addActionRowComponents(createCanvasSetupRow1(canvasConfig));
    container.addActionRowComponents(createCanvasSetupRow2(canvasConfig));

    container.addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    );

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent('### <:Lightningalt:1521227851796447472> Controls')
    );
    container.addActionRowComponents(createCanvasControlRow(canvasConfig));

    return container;
}

function buildLeavePanel(leaveConfig) {
    const mode = leaveConfig?.mode || 'components';
    const isComponents = mode === 'components';
    const statusEmoji = leaveConfig?.enabled ? '<:Toggleon:1521227758011809964>' : '<:Toggleoff:1521227763816595559>';
    const channelText = leaveConfig?.channelId ? `<#${leaveConfig.channelId}>` : '*Not set*';
    const modeText = isComponents ? '**Components V2**' : '**Embed**';
    const modeEmoji = isComponents ? '<:Fire:1521227907647668374>' : '<:Document:1521227875016114266>';

    let content = `# <:Userplus:1521227719621218477> Leave Message Setup\n\n`;
    content += `**Status:** ${statusEmoji} ${leaveConfig?.enabled ? 'Enabled' : 'Disabled'}\n`;
    content += `**Channel:** ${channelText}\n`;
    content += `**Mode:** ${modeEmoji} ${modeText}\n`;
    content += `**Canvas Card:** ${leaveConfig?.canvas?.enabled ? '<:Toggleon:1521227758011809964> Enabled' : '<:Toggleoff:1521227763816595559> Disabled'}\n\n`;

    if (isComponents) {
        const btnCount = (leaveConfig?.buttons?.length || 0) + (leaveConfig?.actionButtons?.length || 0);
        const imgPos = leaveConfig?.imagePosition || 'bottom';
        content += `### Components V2 Features:\n`;
        content += `- **Media Gallery:** ${leaveConfig?.image ? '<:Checkedbox:1521227734943269077> Set' : '<:Cancel:1521227723916181644> Not set'}\n`;
        content += `- **Thumbnail:** ${leaveConfig?.thumbnail ? '<:Checkedbox:1521227734943269077> Set' : '<:Cancel:1521227723916181644> Not set'}\n`;
        content += `- **Image Position:** ${imgPos === 'top' ? '<:Upload:1521228365120405537> Top' : imgPos === 'side' ? '<:Caretright:1521227704953864202> Side' : '<:Download:1521228191899975810> Bottom'}\n`;
        const leaveBtnPos = leaveConfig?.buttonPosition || 'bottom';
        content += `- **Buttons:** ${btnCount > 0 ? '<:Checkedbox:1521227734943269077> ' + btnCount + ' button' + (btnCount > 1 ? 's' : '') + ' · ' + (leaveBtnPos === 'top' ? '<:Upload:1521228365120405537> Top' : '<:Download:1521228191899975810> Bottom') : '<:Cancel:1521227723916181644> None'}\n`;
        content += `- **Colorless:** ${leaveConfig?.colorless ? '<:Toggleon:1521227758011809964> Enabled' : '<:Toggleoff:1521227763816595559> Disabled'}\n`;
        content += `- **Accent Color:** ${leaveConfig?.colorless ? '*None (colorless)*' : (leaveConfig?.color || '#ED4245')}\n\n`;
    } else {
        content += `### Embed Features:\n`;
        content += `- **Title:** ${leaveConfig?.title || '*Not set*'}\n`;
        content += `- **Color:** ${leaveConfig?.color || '#ED4245'}\n`;
        content += `- **Image:** ${leaveConfig?.image ? '<:Checkedbox:1521227734943269077> Set' : '<:Cancel:1521227723916181644> Not set'}\n`;
        content += `- **Thumbnail:** ${leaveConfig?.thumbnail ? '<:Checkedbox:1521227734943269077> Set' : '<:Cancel:1521227723916181644> Not set'}\n`;
        content += `- **Footer:** ${leaveConfig?.footer || '*Not set*'}\n\n`;
    }

    content += `### Message Preview:\n\`\`\`\n${(leaveConfig?.content || 'Goodbye {username}!').substring(0, 200)}${(leaveConfig?.content || '').length > 200 ? '...' : ''}\n\`\`\``;

    return content;
}

function buildLeaveCanvasPanel(canvasConfig) {
    const statusEmoji = canvasConfig?.enabled ? '<:Toggleon:1521227758011809964>' : '<:Toggleoff:1521227763816595559>';

    let content = `# <:Palette:1521227950601539755> Leave Canvas Card Setup\n\n`;
    content += `**Status:** ${statusEmoji} ${canvasConfig?.enabled ? 'Enabled' : 'Disabled'}\n\n`;
    content += `### Current Settings:\n`;
    content += `- **Background Color:** ${canvasConfig?.backgroundColor || '#23272a'}\n`;
    content += `- **Accent Color:** ${canvasConfig?.accentColor || '#ed4245'}\n`;
    content += `- **Text Color:** ${canvasConfig?.textColor || '#ffffff'}\n`;
    content += `- **Background Image:** ${canvasConfig?.backgroundImage ? '<:Checkedbox:1521227734943269077> Set' : '<:Cancel:1521227723916181644> Not set'}\n`;
    content += `- **Custom Message:** ${canvasConfig?.customMessage || '*Not set*'}\n\n`;
    content += `-# Canvas cards generate a beautiful image with the user's avatar when they leave.`;

    return content;
}

function createLeaveCanvasSettingsRow() {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('leave_canvas_set_bgcolor')
                .setLabel('Background')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('<:Palette:1521227950601539755>'),
            new ButtonBuilder()
                .setCustomId('leave_canvas_set_accent')
                .setLabel('Accent')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('<:Heart:1521228100652765247>'),
            new ButtonBuilder()
                .setCustomId('leave_canvas_set_text')
                .setLabel('Text')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('<:Edit:1521227886634205298>'),
            new ButtonBuilder()
                .setCustomId('leave_canvas_set_background')
                .setLabel('Image URL')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('<:Picture:1521227954191995024>')
        );
}

function createLeaveCanvasExtraRow() {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('leave_canvas_set_message')
                .setLabel('Custom Message')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('<:Hashtag:1521227771957870604>'),
            new ButtonBuilder()
                .setCustomId('leave_canvas_preview')
                .setLabel('Preview')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('<:Eye:1521227940480815156>'),
            new ButtonBuilder()
                .setCustomId('leave_canvas_reset')
                .setLabel('Reset')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('<:History:1521227863079256278>')
        );
}

function createLeaveCanvasControlRow(canvasConfig) {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('leave_canvas_toggle')
                .setLabel(canvasConfig?.enabled ? 'Disable Canvas' : 'Enable Canvas')
                .setStyle(canvasConfig?.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
                .setEmoji(canvasConfig?.enabled ? '<:Toggleoff:1521227763816595559>' : '<:Toggleon:1521227758011809964>'),
            new ButtonBuilder()
                .setCustomId('leave_canvas_back')
                .setLabel('Back to Leave Setup')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('<:Caretleft:1521227977495543838>')
        );
}

function buildLeaveCanvasContainer(canvasConfig) {
    const container = new ContainerBuilder()
        .setAccentColor(0xED4245);

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(safeContent(buildLeaveCanvasPanel(canvasConfig)))
    );

    container.addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    );

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent('### <:Palette:1521227950601539755> Color Settings')
    );
    container.addActionRowComponents(createLeaveCanvasSettingsRow());

    container.addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    );

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent('### <:Settings:1521227767780343879> Options')
    );
    container.addActionRowComponents(createLeaveCanvasExtraRow());

    container.addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    );

    container.addActionRowComponents(createLeaveCanvasControlRow(canvasConfig));

    return container;
}

function createLeaveModeRow(currentMode) {
    const isComponents = currentMode === 'components';
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('leave_mode_components')
                .setLabel('Components V2')
                .setStyle(isComponents ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setEmoji('<:Fire:1521227907647668374>')
                .setDisabled(isComponents),
            new ButtonBuilder()
                .setCustomId('leave_mode_embed')
                .setLabel('Embed Mode')
                .setStyle(!isComponents ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setEmoji('<:Document:1521227875016114266>')
                .setDisabled(!isComponents)
        );
}

function createLeaveSetupRow(leaveConfig) {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('leave_set_channel')
                .setLabel('Channel')
                .setStyle(leaveConfig?.channelId ? ButtonStyle.Success : ButtonStyle.Primary)
                .setEmoji('<:Bullhorn:1521227936575914016>'),
            new ButtonBuilder()
                .setCustomId('leave_set_message')
                .setLabel('Message')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('<:Hashtag:1521227771957870604>'),
            new ButtonBuilder()
                .setCustomId('leave_set_media')
                .setLabel('Media')
                .setStyle(leaveConfig?.image || leaveConfig?.thumbnail ? ButtonStyle.Success : ButtonStyle.Primary)
                .setEmoji('<:Picture:1521227954191995024>'),
            new ButtonBuilder()
                .setCustomId('leave_set_styling')
                .setLabel('Styling')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('<:Palette:1521227950601539755>'),
            new ButtonBuilder()
                .setCustomId('leave_colorless')
                .setLabel(leaveConfig?.colorless ? 'Disable Colorless' : 'Enable Colorless')
                .setStyle(leaveConfig?.colorless ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setEmoji(leaveConfig?.colorless ? '<:Checkedbox:1521227734943269077>' : '<:Commentblock:1521227898101432331>')
        );
}

function createLeaveControlRow(leaveConfig) {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('leave_preview')
                .setLabel('Preview')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('<:Eye:1521227940480815156>'),
            new ButtonBuilder()
                .setCustomId('leave_canvas_setup')
                .setLabel('Canvas Card')
                .setStyle(leaveConfig?.canvas?.enabled ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setEmoji('<:Picture:1521227954191995024>'),
            new ButtonBuilder()
                .setCustomId('leave_templates')
                .setLabel('Templates')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('<:Document:1521227875016114266>'),
            new ButtonBuilder()
                .setCustomId('leave_toggle')
                .setLabel(leaveConfig?.enabled ? 'Disable Leave' : 'Enable Leave')
                .setStyle(leaveConfig?.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
                .setEmoji(leaveConfig?.enabled ? '<:Toggleoff:1521227763816595559>' : '<:Toggleon:1521227758011809964>'),
            new ButtonBuilder()
                .setCustomId('leave_back')
                .setLabel('Back')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('<:Caretleft:1521227977495543838>')
        );
}

function createLeaveExtraRow(leaveConfig) {
    const imgPos = leaveConfig?.imagePosition || 'bottom';
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('leave_image_position')
                .setLabel(`Image: ${imgPos === 'top' ? 'Top' : imgPos === 'side' ? 'Side' : 'Bottom'}`)
                .setStyle(imgPos === 'bottom' ? ButtonStyle.Secondary : ButtonStyle.Primary)
                .setEmoji(imgPos === 'top' ? '<:Upload:1521228365120405537>' : imgPos === 'side' ? '<:Caretright:1521227704953864202>' : '<:Download:1521228191899975810>'),
            new ButtonBuilder()
                .setCustomId('leave_set_buttons')
                .setLabel(`Buttons${leaveConfig?.buttons?.length ? ' (' + leaveConfig.buttons.length + ')' : ''}`)
                .setStyle(leaveConfig?.buttons?.length ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setEmoji('<:Attach:1521228039135170722>')
        );
}

function buildLeaveContainer(leaveConfig) {
    const container = new ContainerBuilder();
    if (!leaveConfig?.colorless) {
        container.setAccentColor(0xED4245);
    }

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(safeContent(buildLeavePanel(leaveConfig)))
    );

    container.addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    );

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent('### <:Settings:1521227767780343879> Configuration')
    );
    container.addActionRowComponents(createLeaveModeRow(leaveConfig?.mode));
    container.addActionRowComponents(createLeaveSetupRow(leaveConfig));
    container.addActionRowComponents(createLeaveExtraRow(leaveConfig));

    container.addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    );

    container.addActionRowComponents(createLeaveControlRow(leaveConfig));

    return container;
}

function buildWelcomerContainer(guildConfig, guildId) {
    const mode = guildConfig.mode || 'components';
    const isComponents = mode === 'components';

    const colorValue = guildConfig.color ? parseInt(guildConfig.color.replace('#', ''), 16) : 0xCAD7E6;

    const container = new ContainerBuilder();
    if (!guildConfig.colorless) {
        container.setAccentColor(isNaN(colorValue) ? 0xCAD7E6 : colorValue);
    }

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(safeContent(buildMainPanel(guildConfig, guildId)))
    );

    container.addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    );

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent('### <:Settings:1521227767780343879> Configuration')
    );
    container.addActionRowComponents(createModeRow(mode));
    container.addActionRowComponents(createSetupRow1(guildConfig));
    container.addActionRowComponents(createSetupRow2(guildConfig));

    container.addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    );

    // Extra features row
    const imgPos = guildConfig.imagePosition || 'bottom';
    const extraRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('welcomer_ping_user')
                .setLabel(guildConfig.pingUser ? 'Ping: ON' : 'Ping: OFF')
                .setStyle(guildConfig.pingUser ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setEmoji('<:Bullhorn:1521227936575914016>'),
            new ButtonBuilder()
                .setCustomId('welcomer_dm_welcome')
                .setLabel(guildConfig.dmWelcome?.enabled ? 'DM: ON' : 'DM: OFF')
                .setStyle(guildConfig.dmWelcome?.enabled ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setEmoji('<:Hashtag:1521227771957870604>'),
            new ButtonBuilder()
                .setCustomId('welcomer_dm_edit')
                .setLabel('Edit DM')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('<:Edit:1521227886634205298>')
                .setDisabled(!guildConfig.dmWelcome?.enabled),
            new ButtonBuilder()
                .setCustomId('welcomer_auto_delete')
                .setLabel(guildConfig.autoDelete > 0 ? `Delete: ${guildConfig.autoDelete}s` : 'Auto-Delete')
                .setStyle(guildConfig.autoDelete > 0 ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setEmoji('<:Trash:1521227750420254820>'),
            new ButtonBuilder()
                .setCustomId('welcomer_image_position')
                .setLabel(`Image: ${imgPos === 'top' ? 'Top' : imgPos === 'side' ? 'Side' : 'Bottom'}`)
                .setStyle(imgPos === 'bottom' ? ButtonStyle.Secondary : ButtonStyle.Primary)
                .setEmoji(imgPos === 'top' ? '<:Upload:1521228365120405537>' : imgPos === 'side' ? '<:Caretright:1521227704953864202>' : '<:Download:1521228191899975810>')
        );

    container.addActionRowComponents(extraRow);

    const extraRow2 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('welcomer_test')
                .setLabel('Test Welcome')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('<:Lightningalt:1521227851796447472>')
        );

    container.addActionRowComponents(extraRow2);

    const controlRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('welcomer_toggle')
                .setLabel(guildConfig.enabled ? 'Disable Welcomer' : 'Enable Welcomer')
                .setStyle(guildConfig.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
                .setEmoji(guildConfig.enabled ? '<:Toggleoff:1521227763816595559>' : '<:Toggleon:1521227758011809964>'),
            new ButtonBuilder()
                .setCustomId('welcomer_colorless')
                .setLabel(guildConfig.colorless ? 'Disable Colorless' : 'Enable Colorless')
                .setStyle(guildConfig.colorless ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setEmoji(guildConfig.colorless ? '<:Checkedbox:1521227734943269077>' : '<:Commentblock:1521227898101432331>'),
            new ButtonBuilder()
                .setCustomId('welcomer_preview')
                .setLabel('Preview')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('<:Eye:1521227940480815156>'),
            new ButtonBuilder()
                .setCustomId('welcomer_show_variables')
                .setLabel('Variables')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('<:Clipboard:1521228175298920448>'),
            new ButtonBuilder()
                .setCustomId('welcomer_templates')
                .setLabel('Templates')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('<:Document:1521227875016114266>')
        );

    container.addActionRowComponents(controlRow);

    return container;
}

function buildTemplateManagementPanel(userId) {
    const templates = loadTemplates();
    const userTemplates = templates[userId] || {};
    const templateCount = Object.keys(userTemplates).length;
    const builtInTemplates = getBuiltInWelcomerTemplates();
    const builtInEntries = Object.values(builtInTemplates);
    const builtInCount = builtInEntries.length;
    const builtInComponentsCount = builtInEntries.filter(t => t.template?.mode === 'components').length;
    const builtInEmbedCount = builtInEntries.filter(t => t.template?.mode === 'embed').length;

    let content = `# <:Document:1521227875016114266> Welcomer Templates\n\n`;
    content += `You have **${templateCount}** saved template(s).\n`;
    content += `Built-in templates: **${builtInCount}** (**${builtInComponentsCount}** Components V2 + **${builtInEmbedCount}** Embed).\n\n`;
    content += `### <:Star:1521227981685526568> Built-in Starter Templates\n`;
    for (const item of builtInEntries) {
        const modeIcon = item.template?.mode === 'components' ? '<:Fire:1521227907647668374>' : '<:Invoice:1521227903956811836>';
        content += `• **${item.name}** ${modeIcon}\n`;
    }
    content += `\n`;

    if (templateCount > 0) {
        content += `### <:Clipboard:1521228175298920448> Your Templates:\n`;
        for (const [name, template] of Object.entries(userTemplates)) {
            const mode = template.mode === 'components' ? '<:Fire:1521227907647668374>' : '<:Document:1521227875016114266>';
            const canvas = template.canvas?.enabled ? '<:Picture:1521227954191995024>' : '';
            content += `• **${name}** ${mode} ${canvas}\n`;
        }
        content += `\n### <:Infocircle:1521227700835057685> Instructions:\n`;
        content += `- Use the dropdown below to **load** a template\n`;
        content += `- Click **Save Current** to save your current configuration\n`;
        content += `- Click **Delete** to remove a template\n`;
    } else {
        content += `### <:Lightbulbalt:1521227880703463675> Getting Started\n`;
        content += `Templates allow you to save your current welcomer configuration and quickly apply it later.\n\n`;
        content += `Click **Save Current** below to save your first template!`;
    }

    return content;
}

function createTemplateSelectMenu(userId) {
    const templates = loadTemplates();
    const userTemplates = templates[userId] || {};
    const builtInTemplates = getBuiltInWelcomerTemplates();
    const builtInEntries = Object.entries(builtInTemplates);
    const entries = Object.entries(userTemplates);

    if (entries.length === 0 && builtInEntries.length === 0) {
        return null;
    }

    const select = new StringSelectMenuBuilder()
        .setCustomId('welcomer_template_select')
        .setPlaceholder('Select a template to load...')
        .setMaxValues(1)
        .setMinValues(1);

    builtInEntries.slice(0, 25).forEach(([key, payload]) => {
        const template = payload.template || {};
        const mode = template.mode === 'components' ? 'Built-in • Components V2' : 'Built-in • Embed';
        const canvas = template.canvas?.enabled ? ' • Canvas' : '';
        select.addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel(payload.name.substring(0, 100))
                .setValue(`default:${key}`)
                .setDescription(`${mode}${canvas}`.substring(0, 100))
        );
    });

    entries.slice(0, Math.max(0, 25 - builtInEntries.length)).forEach(([name, template]) => {
        const mode = template.mode === 'components' ? 'Saved • Components V2' : 'Saved • Embed';
        const canvas = template.canvas?.enabled ? ' • Canvas' : '';
        select.addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel(name.substring(0, 100))
                .setValue(`user:${name}`)
                .setDescription(`${mode}${canvas}`.substring(0, 100))
        );
    });

    return new ActionRowBuilder().addComponents(select);
}

function createTemplateManagementRow() {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('welcomer_template_save')
                .setLabel('Save Current')
                .setStyle(ButtonStyle.Success)
                .setEmoji('<:Save:1521228186229276734>'),
            new ButtonBuilder()
                .setCustomId('welcomer_template_delete')
                .setLabel('Delete')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('<:Trash:1521227750420254820>'),
            new ButtonBuilder()
                .setCustomId('welcomer_template_back')
                .setLabel('Back')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('<:Caretleft:1521227977495543838>')
        );
}

function getBuiltInLeaveTemplates() {
    // Built-in leave templates were intentionally removed — every
    // server should design its own farewell message. The leave panel
    // gracefully handles an empty template list.
    return {};
}

function buildLeaveTemplateManagementPanel() {
    const builtInTemplates = getBuiltInLeaveTemplates();
    const entries = Object.values(builtInTemplates);
    const componentsCount = entries.filter(t => t.template?.mode === 'components').length;
    const embedCount = entries.filter(t => t.template?.mode === 'embed').length;

    let content = `# <:Document:1521227875016114266> Leave Templates\n\n`;
    content += `Built-in templates: **${entries.length}** (**${componentsCount}** Components V2 + **${embedCount}** Embed).\n\n`;
    content += `### <:Star:1521227981685526568> Built-in Leave Templates\n`;
    for (const item of entries) {
        const modeIcon = item.template?.mode === 'components' ? '<:Fire:1521227907647668374>' : '<:Invoice:1521227903956811836>';
        const canvasIcon = item.template?.canvas?.enabled ? ' <:Picture:1521227954191995024>' : '';
        content += `• **${item.name}** ${modeIcon}${canvasIcon}\n`;
    }
    content += `\n### <:Infocircle:1521227700835057685> Instructions\n`;
    content += `- Use the dropdown below to apply a leave template\n`;
    content += `- Leave channel and leave enabled state are preserved\n`;
    content += `- You can still edit message/media/styling after applying`;

    return content;
}

function createLeaveTemplateSelectMenu() {
    const builtInTemplates = getBuiltInLeaveTemplates();
    const entries = Object.entries(builtInTemplates);
    if (entries.length === 0) return null;

    const select = new StringSelectMenuBuilder()
        .setCustomId('leave_template_select')
        .setPlaceholder('Select a leave template to apply...')
        .setMaxValues(1)
        .setMinValues(1);

    entries.slice(0, 25).forEach(([key, payload]) => {
        const template = payload.template || {};
        const mode = template.mode === 'components' ? 'Built-in • Components V2' : 'Built-in • Embed';
        const canvas = template.canvas?.enabled ? ' • Canvas' : '';
        select.addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel(payload.name.substring(0, 100))
                .setValue(`leave_default:${key}`)
                .setDescription(`${mode}${canvas}`.substring(0, 100))
        );
    });

    return new ActionRowBuilder().addComponents(select);
}

function createLeaveTemplateControlRow() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('leave_template_back')
            .setLabel('Back')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('<:Caretleft:1521227977495543838>')
    );
}

/**
 * Delegates to utils/messagePlaceholders — the single placeholder engine.
 *
 * This backed the PREVIEW while index.js used interactionHandlers' version for
 * the actual send. The two supported different placeholder sets, so a preview
 * could render {separator} (only implemented here) or fail to render {usertag},
 * {nickname}, {date} and the `:variant` forms (only implemented there). Both
 * now resolve identically, so the preview matches what members receive.
 */
function replacePlaceholders(text, member, guild, memberCount, { skipSeparators = false } = {}) {
    return require('../../utils/messagePlaceholders')
        .replacePlaceholders(text, member, guild, memberCount, { skipSeparators });
}

async function createPreviewEmbed(guildConfig, member, guild, memberCount) {
    const embed = new EmbedBuilder()
        .setColor(guildConfig.color || '#bcf1e4')
        .setDescription(replacePlaceholders(guildConfig.description || guildConfig.content || guildConfig.message || '', member, guild, memberCount));

    if (guildConfig.title) embed.setTitle(replacePlaceholders(guildConfig.title, member, guild, memberCount));
    if (guildConfig.image) {
        const url = replacePlaceholders(guildConfig.image, member, guild, memberCount);
        if (url.startsWith('http')) embed.setImage(url);
    }
    if (guildConfig.thumbnail) {
        const url = replacePlaceholders(guildConfig.thumbnail, member, guild, memberCount);
        if (url.startsWith('http')) embed.setThumbnail(url);
    }
    if (guildConfig.footer) embed.setFooter({ text: replacePlaceholders(guildConfig.footer, member, guild, memberCount) });
    if (guildConfig.author) embed.setAuthor({ name: replacePlaceholders(guildConfig.author, member, guild, memberCount) });

    return embed;
}

async function createPreviewContainer(guildConfig, member, guild, memberCount, guildId) {
    const colorValue = guildConfig.color ? parseInt(guildConfig.color.replace('#', ''), 16) : 0xCAD7E6;
    const imagePosition = guildConfig.imagePosition || 'bottom';

    const container = new ContainerBuilder();
    if (!guildConfig.colorless) {
        container.setAccentColor(isNaN(colorValue) ? 0xCAD7E6 : colorValue);
    }

    // Process content with skipSeparators so {separator} tags remain in the text
    const rawContent = replacePlaceholders(guildConfig.content || guildConfig.message || 'Welcome!', member, guild, memberCount, { skipSeparators: true }) || 'Welcome!';

    // Thumbnail URL
    let thumbnailUrl = null;
    if (guildConfig.thumbnail) {
        const url = replacePlaceholders(guildConfig.thumbnail, member, guild, memberCount);
        if (url.startsWith('http')) thumbnailUrl = url;
    }

    // Prepare image URL for gallery or side placement
    let processedImageUrl = null;
    if (!guildConfig.canvas?.enabled && (guildConfig.image || guildConfig.mediaUrl)) {
        const imgSrc = guildConfig.image || guildConfig.mediaUrl;
        const url = replacePlaceholders(imgSrc, member, guild, memberCount);
        if (url.startsWith('http')) processedImageUrl = url;
    }

    // Build image gallery component (not used for 'side' mode)
    let imageGallery = null;
    if (processedImageUrl && imagePosition !== 'side') {
        imageGallery = new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(processedImageUrl));
    }

    // For 'side' mode, image is shown as thumbnail accessory alongside text (overrides separate thumbnail)
    const sideImageUrl = (imagePosition === 'side' && processedImageUrl) ? processedImageUrl : null;
    // Normal thumbnail (only if not in 'side' mode or no main image)
    const effectiveThumbUrl = sideImageUrl || thumbnailUrl;

    // Button position helper — defined early so it can be called before or after content
    const wBtnPos = guildConfig.buttonPosition || 'bottom';
    function renderWelcomeButtons() {
        if (guildConfig.buttons?.length > 0) {
            const buttonRow = new ActionRowBuilder();
            for (const btn of guildConfig.buttons.slice(0, 5)) {
                if (!btn.label || !btn.url) continue;
                const b = new ButtonBuilder()
                    .setLabel(safeLabel(btn.label))
                    .setStyle(ButtonStyle.Link)
                    .setURL(btn.url);
                if (btn.emoji) b.setEmoji(btn.emoji);
                buttonRow.addComponents(b);
            }
            if (buttonRow.components.length > 0) container.addActionRowComponents(buttonRow);
        }
        if (guildConfig.actionButtons?.length > 0 && guildId) {
            const actionRows = buildActionButtonRows(guildConfig.actionButtons, guildId);
            for (const row of actionRows) container.addActionRowComponents(row);
        }
    }

    // Add image at top if imagePosition is 'top'
    if (imagePosition === 'top' && imageGallery) {
        container.addMediaGalleryComponents(imageGallery);
    }

    // Buttons at top — placed before content
    if (wBtnPos === 'top') {
        renderWelcomeButtons();
    }

    // Split content by {separator} tags and render as real V2 SeparatorBuilder components
    // Pre-calculate extra components to cap at 10 total
    const extraPreviewComponents = (imagePosition === 'top' && imageGallery ? 1 : 0) + (imagePosition === 'bottom' && imageGallery ? 1 : 0) + (guildConfig.canvas?.enabled ? 1 : 0) + (guildConfig.footer ? 2 : 0) + (guildConfig.buttons?.length > 0 ? 1 : 0);
    const maxPreviewContentComponents = 10 - extraPreviewComponents;
    let previewComponentCount = imagePosition === 'top' && imageGallery ? 1 : 0;

    if (rawContent) {
        const spacingMap = {
            'SMALL': SeparatorSpacingSize.Small,
            'MEDIUM': SeparatorSpacingSize.Large,
            'LARGE': SeparatorSpacingSize.Large
        };
        const markedContent = rawContent
            .replace(/\{separator:small\}/gi, '---SEPARATOR:SMALL---')
            .replace(/\{separator:medium\}/gi, '---SEPARATOR:MEDIUM---')
            .replace(/\{separator:large\}/gi, '---SEPARATOR:LARGE---')
            .replace(/\{separator\}/gi, '---SEPARATOR:SMALL---');
        const parts = markedContent.split(/---SEPARATOR:(SMALL|MEDIUM|LARGE)---/);

        let isFirstTextPart = true;
        for (let i = 0; i < parts.length; i++) {
            if (previewComponentCount >= maxPreviewContentComponents) break;
            const part = parts[i];
            // Size tokens inserted by the split regex capture group
            if (part === 'SMALL' || part === 'MEDIUM' || part === 'LARGE') {
                const spacing = spacingMap[part] ?? SeparatorSpacingSize.Small;
                container.addSeparatorComponents(
                    new SeparatorBuilder().setSpacing(spacing).setDivider(true)
                );
                previewComponentCount++;
                continue;
            }
            const trimmed = part.trim();
            if (!trimmed) continue;
            // First text part gets the thumbnail/side-image (if present)
            if (isFirstTextPart && effectiveThumbUrl) {
                const section = new SectionBuilder()
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(safeContent(trimmed)))
                    .setThumbnailAccessory(new ThumbnailBuilder().setURL(effectiveThumbUrl));
                container.addSectionComponents(section);
                isFirstTextPart = false;
            } else {
                container.addTextDisplayComponents(new TextDisplayBuilder().setContent(safeContent(trimmed)));
                isFirstTextPart = false;
            }
            previewComponentCount++;
        }
    }

    // Add image at bottom if imagePosition is 'bottom' (default)
    if (imagePosition === 'bottom' && imageGallery) {
        container.addMediaGalleryComponents(imageGallery);
    }

    // Canvas note (can't generate in ephemeral preview — no file attachments)
    if (guildConfig.canvas?.enabled) {
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent('-# \ud83c\udfa8 *Canvas card will be generated in the actual welcome message*')
        );
    }

    if (guildConfig.footer) {
        container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(safeContent(`-# ${replacePlaceholders(guildConfig.footer, member, guild, memberCount)}`)));
    }

    // Buttons at bottom (default)
    if (wBtnPos !== 'top') {
        renderWelcomeButtons();
    }

    return container;
}

module.exports = {
    category: 'automation',
    data: new SlashCommandBuilder()
        .setName('welcomer')
        .setDescription('Configure welcome messages and autoroles')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(interaction) {
        if (!interaction.guild) return;

        const config = loadConfig();
        const guildConfig = { ...getDefaultConfig(), ...config[interaction.guild.id] };

        const container = buildWelcomerContainer(guildConfig, interaction.guild.id);

        const reply = await interaction.reply({
            components: [container],
            flags: MessageFlags.IsComponentsV2,
            fetchReply: true
        });

        // Track session for user-only access
        if (!global.welcomerSessions) global.welcomerSessions = new Map();
        const now = Date.now();
        global.welcomerSessions.set(reply.id, {
            userId: interaction.user.id,
            guildId: interaction.guild.id,
            channelId: interaction.channel.id,
            createdAt: now
        });

        // Register panel expiration session
        registerSession(reply.id, {
            channelId: interaction.channel.id,
            guildId: interaction.guild.id,
            type: 'config',
            userId: interaction.user.id,
        });

        // Auto-expire after 10 minutes
        setTimeout(() => {
            if (global.welcomerSessions && global.welcomerSessions.has(reply.id)) {
                global.welcomerSessions.delete(reply.id);
            }
        }, 600000);
    },

    async executePrefix(message) {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return message.reply('<:Cancel:1521227723916181644> You need Manage Guild permission!');
        }

        const config = loadConfig();
        const guildConfig = { ...getDefaultConfig(), ...config[message.guild.id] };

        const container = buildWelcomerContainer(guildConfig, message.guild.id);

        const reply = await message.reply({
            components: [container],
            flags: MessageFlags.IsComponentsV2
        });

        // Track session for user-only access
        if (!global.welcomerSessions) global.welcomerSessions = new Map();
        const now = Date.now();
        global.welcomerSessions.set(reply.id, {
            userId: message.author.id,
            guildId: message.guild.id,
            channelId: message.channel.id,
            createdAt: now
        });

        // Auto-expire after 10 minutes
        setTimeout(() => {
            if (global.welcomerSessions && global.welcomerSessions.has(reply.id)) {
                global.welcomerSessions.delete(reply.id);
            }
        }, 600000);
    },

    async handleInteraction(interaction) {
        if (!interaction.guild || !interaction.member) return false;

        const customId = interaction.customId;
        if (!customId.startsWith('welcomer_') && !customId.startsWith('leave_') && !customId.startsWith('canvas_')) return false;

        try {
            return await this._handleInteractionInner(interaction, customId);
        } catch (error) {
            console.error(`Welcomer handleInteraction error [${customId}]:`, error);
            // Send a user-friendly error reply if the interaction hasn't been responded to
            if (!interaction.replied && !interaction.deferred) {
                try {
                    await interaction.reply({
                        content: `<:Cancel:1521227723916181644> An error occurred while processing this action: ${error.message || 'Unknown error'}`,
                        flags: MessageFlags.Ephemeral
                    });
                } catch (replyError) {
                    // Interaction may have expired — nothing we can do
                }
            }
            return true; // Return true to prevent fallback handler from running
        }
    },

    async _handleInteractionInner(interaction, customId) {

        // Check if config session has expired
        if (await checkAndExpire(interaction, 'config')) return true;

        // Check session ownership (skip if interaction has no source message, e.g., modal submits)
        const sourceMessageId = interaction.message?.id;
        if (!global.welcomerSessions) global.welcomerSessions = new Map();
        const session = sourceMessageId ? global.welcomerSessions.get(sourceMessageId) : null;

        // If no session exists for this panel, auto-create one (handles bot restarts / old panels)
        // Only block if another user owns the session
        if (sourceMessageId && !session) {
            // Auto-recover session: treat the interacting user as the owner
            const newSession = {
                userId: interaction.user.id,
                guildId: interaction.guild.id,
                channelId: interaction.channel?.id,
                createdAt: Date.now()
            };
            global.welcomerSessions.set(sourceMessageId, newSession);
        }

        // Re-fetch session after potential auto-create
        const activeSession = sourceMessageId ? global.welcomerSessions.get(sourceMessageId) : null;

        if (activeSession && activeSession.userId !== interaction.user.id) {
            await interaction.reply({
                content: '<:Cancel:1521227723916181644> This setup panel belongs to someone else. Use `/welcomer` to open your own.',
                flags: MessageFlags.Ephemeral
            });
            return true;
        }

        // Refresh session timestamp on any valid interaction to keep it alive while in use
        if (activeSession && sourceMessageId) {
            activeSession.createdAt = Date.now();
            global.welcomerSessions.set(sourceMessageId, activeSession);
        }

        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            await interaction.reply({
                content: '<:Cancel:1521227723916181644> You need Manage Guild permission!',
                flags: MessageFlags.Ephemeral
            });
            return true;
        }

        const config = loadConfig();
        const guildId = interaction.guild.id;
        let guildConfig = { ...getDefaultConfig(), ...config[guildId] };

        if (customId === 'welcomer_mode_components') {
            guildConfig.mode = 'components';
            config[guildId] = guildConfig;
            saveConfig(config);
            const container = buildWelcomerContainer(guildConfig, guildId);
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
            return true;
        }

        if (customId === 'welcomer_mode_embed') {
            guildConfig.mode = 'embed';
            config[guildId] = guildConfig;
            saveConfig(config);
            const container = buildWelcomerContainer(guildConfig, guildId);
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
            return true;
        }

        if (customId === 'welcomer_set_channel') {
            const currentCh = guildConfig.channelId ? `<#${guildConfig.channelId}>` : '`None`';
            const row = new ActionRowBuilder().addComponents(
                new ChannelSelectMenuBuilder()
                    .setCustomId('welcomer_select_channel_unified')
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
            return true;
        }

        if (customId === 'welcomer_set_message') {
            const modal = new ModalBuilder()
                .setCustomId('welcomer_modal_message_unified')
                .setTitle('Configure Welcome Message');

            const contentInput = new TextInputBuilder()
                .setCustomId('content')
                .setLabel('Welcome Message')
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder('Welcome {user} to {server}! We now have {membercount} members.')
                .setValue(typeof guildConfig.content === 'string' ? guildConfig.content : (typeof guildConfig.message === 'string' ? guildConfig.message : ''))
                .setMaxLength(2000)
                .setRequired(true);

            const titleInput = new TextInputBuilder()
                .setCustomId('title')
                .setLabel('Title (for embed mode)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Welcome to the server!')
                .setValue(typeof guildConfig.title === 'string' ? guildConfig.title : '')
                .setRequired(false);

            modal.addComponents(
                new ActionRowBuilder().addComponents(contentInput),
                new ActionRowBuilder().addComponents(titleInput)
            );
            await interaction.showModal(modal);
            return true;
        }

        if (customId === 'welcomer_set_styling') {
            const modal = new ModalBuilder()
                .setCustomId('welcomer_modal_styling_unified')
                .setTitle('Configure Styling');

            const colorInput = new TextInputBuilder()
                .setCustomId('color')
                .setLabel('Accent Color (hex)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('#bcf1e4')
                .setValue(typeof guildConfig.color === 'string' ? guildConfig.color : '#bcf1e4')
                .setRequired(false);

            const footerInput = new TextInputBuilder()
                .setCustomId('footer')
                .setLabel('Footer Text')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Thanks for joining!')
                .setValue(typeof guildConfig.footer === 'string' ? guildConfig.footer : '')
                .setRequired(false);

            const authorInput = new TextInputBuilder()
                .setCustomId('author')
                .setLabel('Author Text (embed mode)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('{username} just joined!')
                .setValue(typeof guildConfig.author === 'string' ? guildConfig.author : '')
                .setRequired(false);

            modal.addComponents(
                new ActionRowBuilder().addComponents(colorInput),
                new ActionRowBuilder().addComponents(footerInput),
                new ActionRowBuilder().addComponents(authorInput)
            );
            await interaction.showModal(modal);
            return true;
        }

        if (customId === 'welcomer_set_media') {
            const modal = new ModalBuilder()
                .setCustomId('welcomer_modal_media_unified')
                .setTitle('Configure Media');

            const imageInput = new TextInputBuilder()
                .setCustomId('image')
                .setLabel('Image URL (large image/gallery)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('https://example.com/welcome-banner.png')
                .setValue(typeof guildConfig.image === 'string' ? guildConfig.image : '')
                .setRequired(false);

            const thumbnailInput = new TextInputBuilder()
                .setCustomId('thumbnail')
                .setLabel('Thumbnail URL (small image)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('https://example.com/server-icon.png')
                .setValue(typeof guildConfig.thumbnail === 'string' ? guildConfig.thumbnail : '')
                .setRequired(false);

            modal.addComponents(
                new ActionRowBuilder().addComponents(imageInput),
                new ActionRowBuilder().addComponents(thumbnailInput)
            );
            await interaction.showModal(modal);
            return true;
        }

        if (customId === 'welcomer_set_buttons') {
            const currentButtons = guildConfig.buttons || [];
            const currentActionBtns = guildConfig.actionButtons || [];
            const modal = new ModalBuilder()
                .setCustomId('welcomer_modal_buttons')
                .setTitle('Configure Welcome Buttons');

            const buttonsInput = new TextInputBuilder()
                .setCustomId('buttons')
                .setLabel('Link Buttons (Label | Emoji | URL)')
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder('Join Us | \ud83d\udc4b | https://discord.gg/example\nWebsite | https://example.com')
                .setValue(currentButtons.map(b => b.emoji ? `${b.label} | ${b.emoji} | ${b.url}` : `${b.label} | ${b.url}`).join('\n'))
                .setMaxLength(1000)
                .setRequired(false);

            const actionInput = new TextInputBuilder()
                .setCustomId('action_buttons')
                .setLabel('Action Buttons (button-maker IDs, comma sep)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('verify, rules, roles')
                .setValue(currentActionBtns.join(', '))
                .setMaxLength(500)
                .setRequired(false);

            const positionInput = new TextInputBuilder()
                .setCustomId('button_position')
                .setLabel('Button Position (top / bottom)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('top or bottom')
                .setValue(guildConfig.buttonPosition || 'bottom')
                .setMaxLength(6)
                .setRequired(false);

            modal.addComponents(
                new ActionRowBuilder().addComponents(buttonsInput),
                new ActionRowBuilder().addComponents(actionInput),
                new ActionRowBuilder().addComponents(positionInput)
            );
            await interaction.showModal(modal);
            return true;
        }

        if (customId === 'welcomer_image_position') {
            const current = guildConfig.imagePosition || 'bottom';
            guildConfig.imagePosition = current === 'bottom' ? 'top' : current === 'top' ? 'side' : 'bottom';
            config[guildId] = guildConfig;
            saveConfig(config);
            const container = buildWelcomerContainer(guildConfig, guildId);
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
            return true;
        }

        if (customId === 'welcomer_embed_author') {
            const modal = new ModalBuilder()
                .setCustomId('welcomer_modal_embed_author')
                .setTitle('Set Author (Embed Mode)');

            const authorInput = new TextInputBuilder()
                .setCustomId('author')
                .setLabel('Author Text')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('{username} just joined!')
                .setValue(typeof guildConfig.author === 'string' ? guildConfig.author : '')
                .setRequired(false);

            modal.addComponents(new ActionRowBuilder().addComponents(authorInput));
            await interaction.showModal(modal);
            return true;
        }

        if (customId === 'welcomer_embed_footer') {
            const modal = new ModalBuilder()
                .setCustomId('welcomer_modal_embed_footer')
                .setTitle('Set Footer (Embed Mode)');

            const footerInput = new TextInputBuilder()
                .setCustomId('footer')
                .setLabel('Footer Text')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Thanks for joining!')
                .setValue(typeof guildConfig.footer === 'string' ? guildConfig.footer : '')
                .setRequired(false);

            modal.addComponents(new ActionRowBuilder().addComponents(footerInput));
            await interaction.showModal(modal);
            return true;
        }

        if (customId === 'welcomer_canvas_setup') {
            if (!guildConfig.canvas) guildConfig.canvas = { enabled: false };
            const container = buildCanvasContainer(guildConfig.canvas);
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
            return true;
        }

        if (customId === 'canvas_back') {
            const container = buildWelcomerContainer(guildConfig, guildId);
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
            return true;
        }

        if (customId === 'canvas_toggle') {
            if (!guildConfig.canvas) guildConfig.canvas = { enabled: false };
            guildConfig.canvas.enabled = !guildConfig.canvas.enabled;
            config[guildId] = guildConfig;
            saveConfig(config);
            const container = buildCanvasContainer(guildConfig.canvas);
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
            return true;
        }

        if (customId === 'canvas_reset') {
            guildConfig.canvas = { enabled: guildConfig.canvas?.enabled || false };
            config[guildId] = guildConfig;
            saveConfig(config);
            await interaction.reply({ content: '<:Trash:1521227750420254820> Canvas settings have been reset to defaults!', flags: MessageFlags.Ephemeral });
            const container = buildCanvasContainer(guildConfig.canvas);
            await updatePanelMessage(interaction, container, MessageFlags.IsComponentsV2);
            return true;
        }

        if (customId === 'canvas_set_bgcolor') {
            const modal = new ModalBuilder()
                .setCustomId('canvas_bgcolor_modal')
                .setTitle('Set Canvas Background Color');

            const colorInput = new TextInputBuilder()
                .setCustomId('bgcolor_hex')
                .setLabel('Hex Color Code')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('#23272a')
                .setValue(guildConfig.canvas?.backgroundColor || '#23272a')
                .setRequired(true)
                .setMinLength(4)
                .setMaxLength(7);

            modal.addComponents(new ActionRowBuilder().addComponents(colorInput));
            await interaction.showModal(modal);
            return true;
        }

        if (customId === 'canvas_set_accent') {
            const modal = new ModalBuilder()
                .setCustomId('canvas_accent_modal')
                .setTitle('Set Canvas Accent Color');

            const colorInput = new TextInputBuilder()
                .setCustomId('accent_hex')
                .setLabel('Hex Color Code')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('#bcf1e4')
                .setValue(guildConfig.canvas?.accentColor || '#bcf1e4')
                .setRequired(true)
                .setMinLength(4)
                .setMaxLength(7);

            modal.addComponents(new ActionRowBuilder().addComponents(colorInput));
            await interaction.showModal(modal);
            return true;
        }

        if (customId === 'canvas_set_text') {
            const modal = new ModalBuilder()
                .setCustomId('canvas_textcolor_modal')
                .setTitle('Set Canvas Text Color');

            const colorInput = new TextInputBuilder()
                .setCustomId('textcolor_hex')
                .setLabel('Hex Color Code')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('#ffffff')
                .setValue(guildConfig.canvas?.textColor || '#ffffff')
                .setRequired(true)
                .setMinLength(4)
                .setMaxLength(7);

            modal.addComponents(new ActionRowBuilder().addComponents(colorInput));
            await interaction.showModal(modal);
            return true;
        }

        if (customId === 'canvas_set_background') {
            const modal = new ModalBuilder()
                .setCustomId('canvas_background_modal')
                .setTitle('Set Canvas Background Image');

            const urlInput = new TextInputBuilder()
                .setCustomId('background_url')
                .setLabel('Background Image URL (leave empty to reset)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('https://i.imgur.com/example.png')
                .setValue(guildConfig.canvas?.backgroundImage || '')
                .setRequired(false);

            modal.addComponents(new ActionRowBuilder().addComponents(urlInput));
            await interaction.showModal(modal);
            return true;
        }

        if (customId === 'canvas_set_message') {
            const modal = new ModalBuilder()
                .setCustomId('canvas_message_modal')
                .setTitle('Set Canvas Custom Message');

            const msgInput = new TextInputBuilder()
                .setCustomId('custom_message')
                .setLabel('Custom message (use {membercount} for count)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('You are member #{membercount}')
                .setValue(guildConfig.canvas?.customMessage || '')
                .setRequired(false)
                .setMaxLength(100);

            modal.addComponents(new ActionRowBuilder().addComponents(msgInput));
            await interaction.showModal(modal);
            return true;
        }

        if (customId === 'canvas_preview') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            try {
                const WelcomeCard = require('../../utils/welcomeCard');
                const card = new WelcomeCard();

                if (guildConfig.canvas?.backgroundColor) card.setBackground(guildConfig.canvas.backgroundColor);
                if (guildConfig.canvas?.accentColor) card.setAccentColor(guildConfig.canvas.accentColor);
                if (guildConfig.canvas?.textColor) card.setTextColor(guildConfig.canvas.textColor);
                if (guildConfig.canvas?.backgroundImage) card.setBackgroundImage(guildConfig.canvas.backgroundImage);

                const customMsg = guildConfig.canvas?.customMessage?.replace('{membercount}', interaction.guild.memberCount.toLocaleString()) || null;
                const buffer = await card.generate(interaction.user, interaction.guild, interaction.guild.memberCount, customMsg);

                const attachment = new AttachmentBuilder(buffer, { name: 'welcome-preview.png' });

                await interaction.editReply({
                    content: '<:Eye:1521227940480815156> **Canvas Preview** - This is how your welcome card will look!',
                    files: [attachment]
                });
            } catch (error) {
                console.error('Canvas preview error:', error);
                await interaction.editReply({ content: '<:Cancel:1521227723916181644> Failed to generate preview. Please try again!' });
            }
            return true;
        }

        if (customId === 'welcomer_colorless') {
            guildConfig.colorless = !guildConfig.colorless;
            config[guildId] = guildConfig;
            saveConfig(config);

            const container = buildWelcomerContainer(guildConfig, guildId);
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
            return true;
        }

        if (customId === 'welcomer_show_variables') {
            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(buildVariablesPanel()));

            await interaction.reply({
                components: [container],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
            });
            return true;
        }

        if (customId === 'welcomer_leave_setup') {
            if (!guildConfig.leave) guildConfig.leave = getDefaultConfig().leave;
            const container = buildLeaveContainer(guildConfig.leave);
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
            return true;
        }

        if (customId === 'leave_back') {
            const container = buildWelcomerContainer(guildConfig, guildId);
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
            return true;
        }

        if (customId === 'leave_mode_components') {
            if (!guildConfig.leave) guildConfig.leave = getDefaultConfig().leave;
            guildConfig.leave.mode = 'components';
            config[guildId] = guildConfig;
            saveConfig(config);
            const container = buildLeaveContainer(guildConfig.leave);
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
            return true;
        }

        if (customId === 'leave_mode_embed') {
            if (!guildConfig.leave) guildConfig.leave = getDefaultConfig().leave;
            guildConfig.leave.mode = 'embed';
            config[guildId] = guildConfig;
            saveConfig(config);
            const container = buildLeaveContainer(guildConfig.leave);
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
            return true;
        }

        if (customId === 'leave_toggle') {
            if (!guildConfig.leave) guildConfig.leave = getDefaultConfig().leave;
            guildConfig.leave.enabled = !guildConfig.leave.enabled;
            config[guildId] = guildConfig;
            saveConfig(config);
            const container = buildLeaveContainer(guildConfig.leave);
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
            return true;
        }

        if (customId === 'leave_canvas_setup') {
            if (!guildConfig.leave) guildConfig.leave = getDefaultConfig().leave;
            if (!guildConfig.leave.canvas) guildConfig.leave.canvas = { enabled: false };
            const container = buildLeaveCanvasContainer(guildConfig.leave.canvas);
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
            return true;
        }

        if (customId === 'leave_templates') {
            const panelContent = buildLeaveTemplateManagementPanel();
            const selectMenu = createLeaveTemplateSelectMenu();
            const controlRow = createLeaveTemplateControlRow();

            const tplContainer = new ContainerBuilder().setAccentColor(0xED4245);
            tplContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent(panelContent));
            tplContainer.addSeparatorComponents(
                new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
            );
            if (selectMenu) tplContainer.addActionRowComponents(selectMenu);
            tplContainer.addActionRowComponents(controlRow);

            await interaction.reply({
                components: [tplContainer],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
            });
            return true;
        }

        if (customId === 'leave_template_back') {
            const closedContainer = new ContainerBuilder()
                .setAccentColor(0xED4245)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent('<:Checkedbox:1521227734943269077> Leave template menu closed.'));
            await interaction.update({ components: [closedContainer], flags: MessageFlags.IsComponentsV2 });
            return true;
        }

        if (customId === 'leave_template_select') {
            if (!guildConfig.leave) guildConfig.leave = getDefaultConfig().leave;

            const selectedValue = interaction.values[0] || '';
            const builtInTemplates = getBuiltInLeaveTemplates();
            let templateName = selectedValue;
            let template = null;

            if (selectedValue.startsWith('leave_default:')) {
                const key = selectedValue.slice('leave_default:'.length);
                const builtIn = builtInTemplates[key];
                if (builtIn) {
                    templateName = builtIn.name;
                    template = builtIn.template;
                }
            }

            if (!template) {
                const errContainer = new ContainerBuilder()
                    .setAccentColor(0xED4245)
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent('<:Cancel:1521227723916181644> Leave template not found!'));
                await interaction.update({ components: [errContainer], flags: MessageFlags.IsComponentsV2 });
                return true;
            }

            const keepEnabled = guildConfig.leave.enabled || false;
            const keepChannelId = guildConfig.leave.channelId || null;

            const mergedLeave = { ...getDefaultConfig().leave, ...guildConfig.leave };
            const styleFields = ['mode', 'content', 'title', 'description', 'color', 'colorless', 'image', 'thumbnail', 'footer', 'author', 'imagePosition', 'buttons', 'actionButtons'];
            for (const field of styleFields) {
                if (template[field] !== undefined) {
                    mergedLeave[field] = template[field];
                }
            }
            if (template.canvas) {
                mergedLeave.canvas = { ...(mergedLeave.canvas || {}), ...template.canvas };
            }

            mergedLeave.enabled = keepEnabled;
            mergedLeave.channelId = keepChannelId;

            guildConfig.leave = mergedLeave;
            config[guildId] = guildConfig;
            saveConfig(config);

            // Update the *original* leave panel — the select menu lives on an
            // ephemeral picker, so interaction.update won't refresh the real one.
            const updatedLeavePanel = buildLeaveContainer(guildConfig.leave);
            try { await updatePanelMessage(interaction, updatedLeavePanel); } catch (e) { }

            // Replace the ephemeral picker with a success confirmation.
            const successContainer = new ContainerBuilder()
                .setAccentColor(0x57F287)
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# <:Checkedbox:1521227734943269077> Leave Template Loaded\n\n` +
                        `**${templateName}** has been applied to your leave panel.\n\n` +
                        `-# Server-specific settings (channel, enabled state) were preserved.`
                    )
                );
            await interaction.update({ components: [successContainer], flags: MessageFlags.IsComponentsV2 });
            return true;
        }

        if (customId === 'leave_canvas_back') {
            const container = buildLeaveContainer(guildConfig.leave);
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
            return true;
        }

        if (customId === 'leave_canvas_toggle') {
            if (!guildConfig.leave) guildConfig.leave = getDefaultConfig().leave;
            if (!guildConfig.leave.canvas) guildConfig.leave.canvas = { enabled: false };
            guildConfig.leave.canvas.enabled = !guildConfig.leave.canvas.enabled;
            config[guildId] = guildConfig;
            saveConfig(config);
            const container = buildLeaveCanvasContainer(guildConfig.leave.canvas);
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
            return true;
        }

        if (customId === 'leave_canvas_reset') {
            if (!guildConfig.leave) guildConfig.leave = getDefaultConfig().leave;
            guildConfig.leave.canvas = { enabled: guildConfig.leave.canvas?.enabled || false };
            config[guildId] = guildConfig;
            saveConfig(config);
            const container = buildLeaveCanvasContainer(guildConfig.leave.canvas);
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
            return true;
        }

        if (customId === 'leave_canvas_set_bgcolor') {
            const modal = new ModalBuilder()
                .setCustomId('leave_canvas_bgcolor_modal')
                .setTitle('Set Canvas Background Color');
            const input = new TextInputBuilder()
                .setCustomId('color')
                .setLabel('Background Color (hex)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('#23272a')
                .setValue(guildConfig.leave?.canvas?.backgroundColor || '')
                .setRequired(false);
            modal.addComponents(new ActionRowBuilder().addComponents(input));
            await interaction.showModal(modal);
            return true;
        }

        if (customId === 'leave_canvas_set_accent') {
            const modal = new ModalBuilder()
                .setCustomId('leave_canvas_accent_modal')
                .setTitle('Set Canvas Accent Color');
            const input = new TextInputBuilder()
                .setCustomId('color')
                .setLabel('Accent Color (hex)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('#ed4245')
                .setValue(guildConfig.leave?.canvas?.accentColor || '')
                .setRequired(false);
            modal.addComponents(new ActionRowBuilder().addComponents(input));
            await interaction.showModal(modal);
            return true;
        }

        if (customId === 'leave_canvas_set_text') {
            const modal = new ModalBuilder()
                .setCustomId('leave_canvas_text_modal')
                .setTitle('Set Canvas Text Color');
            const input = new TextInputBuilder()
                .setCustomId('color')
                .setLabel('Text Color (hex)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('#ffffff')
                .setValue(guildConfig.leave?.canvas?.textColor || '')
                .setRequired(false);
            modal.addComponents(new ActionRowBuilder().addComponents(input));
            await interaction.showModal(modal);
            return true;
        }

        if (customId === 'leave_canvas_set_background') {
            const modal = new ModalBuilder()
                .setCustomId('leave_canvas_bgimage_modal')
                .setTitle('Set Canvas Background Image');
            const input = new TextInputBuilder()
                .setCustomId('url')
                .setLabel('Background Image URL')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('https://example.com/background.png')
                .setValue(guildConfig.leave?.canvas?.backgroundImage || '')
                .setRequired(false);
            modal.addComponents(new ActionRowBuilder().addComponents(input));
            await interaction.showModal(modal);
            return true;
        }

        if (customId === 'leave_canvas_set_message') {
            const modal = new ModalBuilder()
                .setCustomId('leave_canvas_message_modal')
                .setTitle('Set Canvas Custom Message');
            const input = new TextInputBuilder()
                .setCustomId('message')
                .setLabel('Custom Message')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('We hope to see you again! Use {membercount}')
                .setValue(guildConfig.leave?.canvas?.customMessage || '')
                .setMaxLength(50)
                .setRequired(false);
            modal.addComponents(new ActionRowBuilder().addComponents(input));
            await interaction.showModal(modal);
            return true;
        }

        if (customId === 'leave_canvas_preview') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            try {
                const LeaveCard = require('../../utils/leaveCard');
                const card = new LeaveCard();
                const canvasConfig = guildConfig.leave?.canvas || {};
                if (canvasConfig.backgroundColor) card.setBackground(canvasConfig.backgroundColor);
                if (canvasConfig.accentColor) card.setAccentColor(canvasConfig.accentColor);
                if (canvasConfig.textColor) card.setTextColor(canvasConfig.textColor);
                if (canvasConfig.backgroundImage) card.setBackgroundImage(canvasConfig.backgroundImage);
                const customMsg = canvasConfig.customMessage?.replace('{membercount}', interaction.guild.memberCount.toLocaleString()) || null;
                const buffer = await card.generate(interaction.user, interaction.guild, interaction.guild.memberCount, customMsg);
                const attachment = new AttachmentBuilder(buffer, { name: 'leave-preview.png' });
                await interaction.editReply({ content: '<:Eye:1521227940480815156> **Leave Canvas Preview** - This is how your leave card will look!', files: [attachment] });
            } catch (error) {
                console.error('Leave canvas preview error:', error);
                await interaction.editReply({ content: '<:Cancel:1521227723916181644> Failed to generate preview. Please try again!' });
            }
            return true;
        }

        if (customId === 'leave_set_channel') {
            const currentCh = guildConfig.leave?.channelId ? `<#${guildConfig.leave.channelId}>` : '`None`';
            const row = new ActionRowBuilder().addComponents(
                new ChannelSelectMenuBuilder()
                    .setCustomId('leave_select_channel_unified')
                    .setPlaceholder('Select the leave channel')
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
            return true;
        }

        if (customId === 'leave_set_message') {
            const modal = new ModalBuilder()
                .setCustomId('leave_modal_message')
                .setTitle('Set Leave Message');

            const contentInput = new TextInputBuilder()
                .setCustomId('content')
                .setLabel('Leave Message')
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder('Goodbye {username}!\n{separator}\nWe now have {membercount} members.')
                .setValue(typeof guildConfig.leave?.content === 'string' ? guildConfig.leave.content : '')
                .setMaxLength(4000)
                .setRequired(true);

            const titleInput = new TextInputBuilder()
                .setCustomId('title')
                .setLabel('Title (for embed mode)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Member Left')
                .setValue(typeof guildConfig.leave?.title === 'string' ? guildConfig.leave.title : '')
                .setRequired(false);

            modal.addComponents(
                new ActionRowBuilder().addComponents(contentInput),
                new ActionRowBuilder().addComponents(titleInput)
            );
            await interaction.showModal(modal);
            return true;
        }

        if (customId === 'leave_set_media') {
            const modal = new ModalBuilder()
                .setCustomId('leave_modal_media')
                .setTitle('Configure Leave Media');

            const imageInput = new TextInputBuilder()
                .setCustomId('image')
                .setLabel('Image URL (large image/gallery)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('https://example.com/goodbye-banner.png')
                .setValue(typeof guildConfig.leave?.image === 'string' ? guildConfig.leave.image : '')
                .setRequired(false);

            const thumbnailInput = new TextInputBuilder()
                .setCustomId('thumbnail')
                .setLabel('Thumbnail URL (small image)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('https://example.com/server-icon.png')
                .setValue(typeof guildConfig.leave?.thumbnail === 'string' ? guildConfig.leave.thumbnail : '')
                .setRequired(false);

            modal.addComponents(
                new ActionRowBuilder().addComponents(imageInput),
                new ActionRowBuilder().addComponents(thumbnailInput)
            );
            await interaction.showModal(modal);
            return true;
        }

        if (customId === 'leave_set_styling') {
            const modal = new ModalBuilder()
                .setCustomId('leave_modal_styling')
                .setTitle('Configure Leave Styling');

            const colorInput = new TextInputBuilder()
                .setCustomId('color')
                .setLabel('Accent Color (hex)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('#ED4245')
                .setValue(typeof guildConfig.leave?.color === 'string' ? guildConfig.leave.color : '#ED4245')
                .setRequired(false);

            const footerInput = new TextInputBuilder()
                .setCustomId('footer')
                .setLabel('Footer Text')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('We will miss you!')
                .setValue(typeof guildConfig.leave?.footer === 'string' ? guildConfig.leave.footer : '')
                .setRequired(false);

            const authorInput = new TextInputBuilder()
                .setCustomId('author')
                .setLabel('Author Text (embed mode)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('{username} has left!')
                .setValue(typeof guildConfig.leave?.author === 'string' ? guildConfig.leave.author : '')
                .setRequired(false);

            modal.addComponents(
                new ActionRowBuilder().addComponents(colorInput),
                new ActionRowBuilder().addComponents(footerInput),
                new ActionRowBuilder().addComponents(authorInput)
            );
            await interaction.showModal(modal);
            return true;
        }

        if (customId === 'leave_colorless') {
            if (!guildConfig.leave) guildConfig.leave = getDefaultConfig().leave;
            guildConfig.leave.colorless = !guildConfig.leave.colorless;
            config[guildId] = guildConfig;
            saveConfig(config);

            const container = buildLeaveContainer(guildConfig.leave);
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
            return true;
        }

        if (customId === 'leave_image_position') {
            if (!guildConfig.leave) guildConfig.leave = getDefaultConfig().leave;
            const current = guildConfig.leave.imagePosition || 'bottom';
            guildConfig.leave.imagePosition = current === 'bottom' ? 'top' : current === 'top' ? 'side' : 'bottom';
            config[guildId] = guildConfig;
            saveConfig(config);
            const container = buildLeaveContainer(guildConfig.leave);
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
            return true;
        }

        if (customId === 'leave_set_buttons') {
            if (!guildConfig.leave) guildConfig.leave = getDefaultConfig().leave;
            const currentButtons = guildConfig.leave.buttons || [];
            const currentActionBtns = guildConfig.leave.actionButtons || [];
            const modal = new ModalBuilder()
                .setCustomId('leave_modal_buttons')
                .setTitle('Configure Leave Buttons');

            const buttonsInput = new TextInputBuilder()
                .setCustomId('buttons')
                .setLabel('Link Buttons (Label | Emoji | URL)')
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder('Join Support | https://discord.gg/example\nWebsite | https://example.com')
                .setValue(currentButtons.map(b => b.emoji ? `${b.label} | ${b.emoji} | ${b.url}` : `${b.label} | ${b.url}`).join('\n'))
                .setMaxLength(1000)
                .setRequired(false);

            const actionInput = new TextInputBuilder()
                .setCustomId('action_buttons')
                .setLabel('Action Buttons (button-maker IDs, comma sep)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('verify, rules, roles')
                .setValue(currentActionBtns.join(', '))
                .setMaxLength(500)
                .setRequired(false);

            const positionInput = new TextInputBuilder()
                .setCustomId('button_position')
                .setLabel('Button Position (top / bottom)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('top or bottom')
                .setValue(guildConfig.leave.buttonPosition || 'bottom')
                .setMaxLength(6)
                .setRequired(false);

            modal.addComponents(
                new ActionRowBuilder().addComponents(buttonsInput),
                new ActionRowBuilder().addComponents(actionInput),
                new ActionRowBuilder().addComponents(positionInput)
            );
            await interaction.showModal(modal);
            return true;
        }

        if (customId === 'leave_modal_buttons') {
            if (!guildConfig.leave) guildConfig.leave = getDefaultConfig().leave;
            const rawButtons = interaction.fields.getTextInputValue('buttons') || '';
            const buttons = rawButtons.split('\n')
                .map(line => line.trim())
                .filter(line => line.includes('|'))
                .map(line => {
                    const parts = line.split('|').map(p => p.trim());
                    if (parts.length >= 3 && (parts[2].startsWith('http://') || parts[2].startsWith('https://'))) {
                        return { label: parts[0].substring(0, 80), emoji: parts[1] || null, url: parts[2] };
                    } else if (parts.length >= 2) {
                        const url = parts.slice(1).join('|').trim();
                        return { label: parts[0].substring(0, 80), emoji: null, url: url };
                    }
                    return null;
                })
                .filter(b => b && b.label && b.url && (b.url.startsWith('http://') || b.url.startsWith('https://')))
                .slice(0, 5);

            const rawAction = interaction.fields.getTextInputValue('action_buttons') || '';
            const actionButtons = rawAction.split(',').map(s => s.trim()).filter(Boolean).slice(0, 25);

            const rawLeaveBtnPos = (interaction.fields.getTextInputValue('button_position') || '').trim().toLowerCase();

            guildConfig.leave.buttons = buttons;
            guildConfig.leave.actionButtons = actionButtons;
            guildConfig.leave.buttonPosition = rawLeaveBtnPos === 'top' ? 'top' : 'bottom';
            config[guildId] = guildConfig;
            saveConfig(config);

            const total = buttons.length + actionButtons.length;
            const container = buildLeaveContainer(guildConfig.leave);
            try {
                await updatePanelMessage(interaction, container);
            } catch (e) { }

            await interaction.reply({
                content: `<:Checkedbox:1521227734943269077> ${total > 0 ? total + ' leave button' + (total > 1 ? 's' : '') + ' configured!' : 'Leave buttons cleared!'}`,
                flags: MessageFlags.Ephemeral
            });
            return true;
        }

        if (customId === 'leave_preview') {
            if (!guildConfig.leave) guildConfig.leave = getDefaultConfig().leave;
            const mode = guildConfig.leave.mode || 'components';
            if (mode === 'components') {
                const container = await createPreviewContainer(guildConfig.leave, interaction.member, interaction.guild, interaction.guild.memberCount, interaction.guild.id);
                await interaction.reply({
                    components: [container],
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
                });
            } else {
                const embed = await createPreviewEmbed(guildConfig.leave, interaction.member, interaction.guild, interaction.guild.memberCount);
                await interaction.reply({
                    content: '<:Eye:1521227940480815156> **Preview (Embed) - Leave Message**',
                    embeds: [embed],
                    flags: MessageFlags.Ephemeral
                });
            }
            return true;
        }

        if (customId === 'welcomer_ping_user') {
            guildConfig.pingUser = !guildConfig.pingUser;
            config[guildId] = guildConfig;
            saveConfig(config);
            const container = buildWelcomerContainer(guildConfig, guildId);
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
            return true;
        }

        if (customId === 'welcomer_dm_welcome') {
            if (!guildConfig.dmWelcome) guildConfig.dmWelcome = { enabled: false, content: 'Welcome to **{server}**! We are glad to have you here.' };

            if (guildConfig.dmWelcome.enabled) {
                // Toggle off
                guildConfig.dmWelcome.enabled = false;
                config[guildId] = guildConfig;
                saveConfig(config);
                const container = buildWelcomerContainer(guildConfig, guildId);
                await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
            } else {
                // Show modal to set DM content and enable
                const modal = new ModalBuilder()
                    .setCustomId('welcomer_modal_dm_welcome')
                    .setTitle('DM Welcome Message');

                const contentInput = new TextInputBuilder()
                    .setCustomId('dm_content')
                    .setLabel('DM Message Content')
                    .setStyle(TextInputStyle.Paragraph)
                    .setPlaceholder('Welcome to {server}! Check out our rules.')
                    .setValue(guildConfig.dmWelcome.content || '')
                    .setMaxLength(2000)
                    .setRequired(true);

                modal.addComponents(new ActionRowBuilder().addComponents(contentInput));
                await interaction.showModal(modal);
            }
            return true;
        }

        if (customId === 'welcomer_dm_edit') {
            if (!guildConfig.dmWelcome) guildConfig.dmWelcome = { enabled: true, content: 'Welcome to **{server}**! We are glad to have you here.' };

            const modal = new ModalBuilder()
                .setCustomId('welcomer_modal_dm_welcome')
                .setTitle('Edit DM Welcome Message');

            const contentInput = new TextInputBuilder()
                .setCustomId('dm_content')
                .setLabel('DM Message Content')
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder('Welcome to {server}! Check out our rules.')
                .setValue(guildConfig.dmWelcome.content || '')
                .setMaxLength(2000)
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(contentInput));
            await interaction.showModal(modal);
            return true;
        }

        if (customId === 'welcomer_auto_delete') {
            const modal = new ModalBuilder()
                .setCustomId('welcomer_modal_auto_delete')
                .setTitle('Auto-Delete Welcome Message');

            const durationInput = new TextInputBuilder()
                .setCustomId('duration')
                .setLabel('Delete after (seconds) — 0 to disable')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('0 = disabled, 10, 30, 60, 120...')
                .setValue(String(guildConfig.autoDelete || 0))
                .setMaxLength(5)
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(durationInput));
            await interaction.showModal(modal);
            return true;
        }

        if (customId === 'welcomer_test') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            try {
                let channel = interaction.guild.channels.cache.get(guildConfig.channelId);
                if (!channel && guildConfig.channelId) {
                    channel = await interaction.guild.channels.fetch(guildConfig.channelId).catch(() => null);
                }
                if (!channel) {
                    await interaction.editReply({ content: '<:Cancel:1521227723916181644> No welcome channel set! Set a channel first.' });
                    return true;
                }

                const mode = guildConfig.mode || 'components';
                const rawContent = guildConfig.content || 'Welcome {user} to **{server}**!';
                const processedContent = replacePlaceholders(rawContent, interaction.member, interaction.guild, interaction.guild.memberCount);
                const colorStr = typeof guildConfig.color === 'string' ? guildConfig.color : '#bcf1e4';
                const colorValue = parseInt(colorStr.replace('#', ''), 16);

                if (mode === 'embed') {
                    const embed = new EmbedBuilder()
                        .setColor(isNaN(colorValue) ? 0xCAD7E6 : colorValue)
                        .setDescription(processedContent)
                        .setTimestamp();

                    if (guildConfig.title) embed.setTitle(replacePlaceholders(guildConfig.title, interaction.member, interaction.guild, interaction.guild.memberCount));
                    if (guildConfig.image) {
                        const imageUrl = replacePlaceholders(guildConfig.image, interaction.member, interaction.guild, interaction.guild.memberCount);
                        if (imageUrl.startsWith('http')) embed.setImage(imageUrl);
                    }
                    if (guildConfig.thumbnail) {
                        const thumbUrl = replacePlaceholders(guildConfig.thumbnail, interaction.member, interaction.guild, interaction.guild.memberCount);
                        if (thumbUrl.startsWith('http')) embed.setThumbnail(thumbUrl);
                    }
                    if (guildConfig.footer) embed.setFooter({ text: replacePlaceholders(guildConfig.footer, interaction.member, interaction.guild, interaction.guild.memberCount) });
                    if (guildConfig.author) embed.setAuthor({ name: replacePlaceholders(guildConfig.author, interaction.member, interaction.guild, interaction.guild.memberCount), iconURL: interaction.user.displayAvatarURL({ size: 64 }) });

                    const sent = await channel.send({ content: guildConfig.pingUser ? `<@${interaction.user.id}>` : undefined, embeds: [embed] });
                    if (guildConfig.autoDelete > 0) setTimeout(() => sent.delete().catch(() => { }), guildConfig.autoDelete * 1000);
                } else {
                    const container = await createPreviewContainer(guildConfig, interaction.member, interaction.guild, interaction.guild.memberCount, interaction.guild.id);
                    let pingMsg = null;
                    if (guildConfig.pingUser) {
                        pingMsg = await channel.send({ content: `<@${interaction.user.id}>` });
                    }
                    const sent = await channel.send({ components: [container], flags: MessageFlags.IsComponentsV2 });
                    if (guildConfig.autoDelete > 0 && pingMsg) setTimeout(() => pingMsg.delete().catch(() => { }), guildConfig.autoDelete * 1000);
                    if (guildConfig.autoDelete > 0) setTimeout(() => sent.delete().catch(() => { }), guildConfig.autoDelete * 1000);
                }

                await interaction.editReply({ content: `<:Checkedbox:1521227734943269077> Test welcome sent to <#${guildConfig.channelId}>!` });
            } catch (error) {
                console.error('Test welcome error:', error);
                await interaction.editReply({ content: `<:Cancel:1521227723916181644> Test failed: ${error.message}` });
            }
            return true;
        }

        if (customId === 'welcomer_toggle') {
            guildConfig.enabled = !guildConfig.enabled;
            config[guildId] = guildConfig;
            saveConfig(config);
            const container = buildWelcomerContainer(guildConfig, guildId);
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
            return true;
        }

        if (customId === 'welcomer_preview') {
            try {
                const mode = guildConfig.mode || 'components';
                if (mode === 'components') {
                    const container = await createPreviewContainer(guildConfig, interaction.member, interaction.guild, interaction.guild.memberCount, interaction.guild.id);
                    await interaction.reply({
                        components: [container],
                        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
                    });
                } else {
                    const embed = await createPreviewEmbed(guildConfig, interaction.member, interaction.guild, interaction.guild.memberCount);
                    await interaction.reply({
                        content: '<:Eye:1521227940480815156> **Preview (Embed)**',
                        embeds: [embed],
                        flags: MessageFlags.Ephemeral
                    });
                }
            } catch (error) {
                console.error('Preview error:', error);
                await interaction.reply({
                    content: `<:Cancel:1521227723916181644> Preview failed: ${error.message || 'Unknown error'}. Check your welcomer configuration.`,
                    flags: MessageFlags.Ephemeral
                }).catch(() => { });
            }
            return true;
        }

        if (customId === 'welcomer_templates') {
            const userId = interaction.user.id;
            const panelContent = buildTemplateManagementPanel(userId);
            const selectMenu = createTemplateSelectMenu(userId);
            const managementRow = createTemplateManagementRow();

            const tplContainer = new ContainerBuilder()
                ;

            tplContainer.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(panelContent)
            );
            tplContainer.addSeparatorComponents(
                new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
            );
            if (selectMenu) tplContainer.addActionRowComponents(selectMenu);
            tplContainer.addActionRowComponents(managementRow);

            await interaction.reply({
                components: [tplContainer],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
            });
            return true;
        }

        if (customId === 'welcomer_template_back') {
            const closedContainer = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent('<:Checkedbox:1521227734943269077> Template menu closed.'));
            await interaction.update({ components: [closedContainer], flags: MessageFlags.IsComponentsV2 });
            return true;
        }

        if (customId === 'welcomer_template_save') {
            const modal = new ModalBuilder()
                .setCustomId('welcomer_template_save_modal')
                .setTitle('Save Welcomer Template');

            const nameInput = new TextInputBuilder()
                .setCustomId('template_name')
                .setLabel('Template Name')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('My Awesome Template')
                .setMaxLength(100)
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(nameInput));
            await interaction.showModal(modal);
            return true;
        }

        if (customId === 'welcomer_template_delete') {
            const userId = interaction.user.id;
            const templates = loadTemplates();
            const userTemplates = templates[userId] || {};
            const templateNames = Object.keys(userTemplates);

            if (templateNames.length === 0) {
                const noTplContainer = new ContainerBuilder()
                    .setAccentColor(0xED4245)
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent('<:Cancel:1521227723916181644> You have no templates to delete!'));
                await interaction.update({ components: [noTplContainer], flags: MessageFlags.IsComponentsV2 });
                return true;
            }

            const select = new StringSelectMenuBuilder()
                .setCustomId('welcomer_template_delete_select')
                .setPlaceholder('Select template(s) to delete...')
                .setMaxValues(Math.min(templateNames.length, 25))
                .setMinValues(1);

            templateNames.slice(0, 25).forEach(name => {
                select.addOptions(
                    new StringSelectMenuOptionBuilder()
                        .setLabel(name.substring(0, 100))
                        .setValue(name)
                );
            });

            const delContainer = new ContainerBuilder()
                .setAccentColor(0xED4245);
            delContainer.addTextDisplayComponents(
                new TextDisplayBuilder().setContent('### <:Trash:1521227750420254820> Select template(s) to delete:')
            );
            delContainer.addActionRowComponents(new ActionRowBuilder().addComponents(select));
            delContainer.addActionRowComponents(
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('welcomer_template_back')
                        .setLabel('Cancel')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('<:Caretleft:1521227977495543838>')
                )
            );

            await interaction.update({ components: [delContainer], flags: MessageFlags.IsComponentsV2 });
            return true;
        }

        if (customId === 'welcomer_template_select') {
            const selectedValue = interaction.values[0];
            const userId = interaction.user.id;
            const templates = loadTemplates();
            const builtInTemplates = getBuiltInWelcomerTemplates();
            let templateName = selectedValue;
            let template = null;
            let templateSource = 'saved';

            if (selectedValue.startsWith('default:')) {
                const key = selectedValue.slice('default:'.length);
                const builtIn = builtInTemplates[key];
                if (builtIn) {
                    templateName = builtIn.name;
                    template = builtIn.template;
                    templateSource = 'built-in';
                }
            } else if (selectedValue.startsWith('user:')) {
                templateName = selectedValue.slice('user:'.length);
                template = templates[userId]?.[templateName];
            } else {
                template = templates[userId]?.[templateName] || builtInTemplates[templateName]?.template;
                if (!templates[userId]?.[templateName] && builtInTemplates[templateName]) {
                    templateName = builtInTemplates[templateName].name;
                    templateSource = 'built-in';
                }
            }

            if (!template) {
                const errContainer = new ContainerBuilder()
                    .setAccentColor(0xED4245)
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent('<:Cancel:1521227723916181644> Template not found!'));
                await interaction.update({ components: [errContainer], flags: MessageFlags.IsComponentsV2 });
                return true;
            }

            // Apply template field by field — same logic as message-builder modals
            const guildId = interaction.guild.id;
            const config = loadConfig();
            const currentConfig = config[guildId] || getDefaultConfig();
            const mergedConfig = { ...getDefaultConfig(), ...currentConfig };

            // Overwrite style/content fields from template (NOT server-specific)
            const styleFields = ['mode', 'content', 'message', 'title', 'description', 'color', 'colorless', 'image', 'mediaUrl', 'thumbnail', 'footer', 'author'];
            for (const field of styleFields) {
                if (template[field] !== undefined) {
                    mergedConfig[field] = template[field];
                }
            }

            // Deep merge canvas from template
            if (template.canvas) {
                mergedConfig.canvas = { ...(getDefaultConfig().canvas), ...template.canvas };
            }

            // Deep merge leave — preserve server-specific leave.enabled & leave.channelId
            if (template.leave) {
                const keepLeaveEnabled = mergedConfig.leave?.enabled || false;
                const keepLeaveChannelId = mergedConfig.leave?.channelId || null;
                if (!mergedConfig.leave) mergedConfig.leave = { ...getDefaultConfig().leave };

                const leaveStyleFields = ['mode', 'content', 'title', 'description', 'color', 'colorless', 'image', 'thumbnail', 'footer', 'author'];
                for (const field of leaveStyleFields) {
                    if (template.leave[field] !== undefined) {
                        mergedConfig.leave[field] = template.leave[field];
                    }
                }
                if (template.leave.canvas) {
                    mergedConfig.leave.canvas = { ...template.leave.canvas };
                }
                mergedConfig.leave.enabled = keepLeaveEnabled;
                mergedConfig.leave.channelId = keepLeaveChannelId;
            }

            // Always preserve server-specific top-level fields
            mergedConfig.enabled = currentConfig.enabled || false;
            mergedConfig.channelId = currentConfig.channelId || null;

            config[guildId] = mergedConfig;
            saveConfig(config);

            // Update the *original* welcomer panel (this select lives on an ephemeral
            // message — interaction.update would only refresh the ephemeral one).
            const updatedPanel = buildWelcomerContainer(mergedConfig, guildId);
            try { await updatePanelMessage(interaction, updatedPanel); } catch (e) { }

            // Replace the ephemeral template-picker with a success confirmation so
            // the user gets clear feedback that the template was loaded.
            const sourceLabel = templateSource === 'built-in' ? 'Built-in' : 'Saved';
            const successContainer = new ContainerBuilder()
                .setAccentColor(0x57F287)
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# <:Checkedbox:1521227734943269077> Template Loaded\n\n` +
                        `**${templateName}** (${sourceLabel}) has been applied to your welcomer panel.\n\n` +
                        `-# Server-specific settings (channel, enabled state) were preserved.`
                    )
                );
            await interaction.update({ components: [successContainer], flags: MessageFlags.IsComponentsV2 });
            return true;
        }

        if (customId === 'welcomer_template_delete_select') {
            const templateNames = interaction.values;
            const userId = interaction.user.id;
            const templates = loadTemplates();

            if (!templates[userId]) {
                const errContainer = new ContainerBuilder()
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent('<:Cancel:1521227723916181644> No templates found!'));
                await interaction.update({ components: [errContainer], flags: MessageFlags.IsComponentsV2 });
                return true;
            }

            let deleted = 0;
            for (const name of templateNames) {
                if (templates[userId][name]) {
                    delete templates[userId][name];
                    deleted++;
                }
            }

            saveTemplatesFile(templates);

            const doneContainer = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`<:Checkedbox:1521227734943269077> Deleted **${deleted}** template(s) successfully!`)
                );
            await interaction.update({ components: [doneContainer], flags: MessageFlags.IsComponentsV2 });
            return true;
        }

        if (customId === 'welcomer_select_channel_unified') {
            const channelId = interaction.values[0];
            const channel = interaction.guild.channels.cache.get(channelId);
            if (!channel) {
                await interaction.reply({
                    content: '<:Cancel:1521227723916181644> Selected channel not found!',
                    flags: MessageFlags.Ephemeral
                });
                return true;
            }

            guildConfig.channelId = channelId;
            config[guildId] = guildConfig;
            saveConfig(config);

            const container = buildWelcomerContainer(guildConfig, guildId);
            try {
                await updatePanelMessage(interaction, container);
            } catch (e) { }

            await interaction.reply({
                content: `<:Checkedbox:1521227734943269077> Welcome channel set to <#${channelId}>!`,
                flags: MessageFlags.Ephemeral
            });
            return true;
        }

        if (customId === 'welcomer_template_save_modal') {
            const templateName = interaction.fields.getTextInputValue('template_name').trim();

            if (!templateName || templateName.length === 0) {
                await interaction.reply({
                    content: '<:Cancel:1521227723916181644> Please provide a valid template name!',
                    flags: MessageFlags.Ephemeral
                });
                return true;
            }

            const userId = interaction.user.id;
            const guildId = interaction.guild.id;
            const config = loadConfig();
            const guildConfig = config[guildId] || getDefaultConfig();

            const templates = loadTemplates();
            if (!templates[userId]) templates[userId] = {};

            // Save ALL builder fields (same as what the message-builder modals set)
            // Exclude server-specific: enabled, channelId, leave.enabled, leave.channelId
            const templateData = {
                mode: guildConfig.mode,
                content: guildConfig.content,
                message: guildConfig.message,
                title: guildConfig.title,
                description: guildConfig.description,
                color: guildConfig.color,
                colorless: guildConfig.colorless || false,
                image: guildConfig.image,
                mediaUrl: guildConfig.mediaUrl || null,
                thumbnail: guildConfig.thumbnail,
                footer: guildConfig.footer,
                author: guildConfig.author,
                canvas: guildConfig.canvas ? { ...guildConfig.canvas } : { enabled: false },
                leave: guildConfig.leave ? {
                    mode: guildConfig.leave.mode,
                    content: guildConfig.leave.content,
                    title: guildConfig.leave.title,
                    description: guildConfig.leave.description,
                    color: guildConfig.leave.color,
                    colorless: guildConfig.leave.colorless || false,
                    image: guildConfig.leave.image,
                    thumbnail: guildConfig.leave.thumbnail,
                    footer: guildConfig.leave.footer,
                    author: guildConfig.leave.author,
                    canvas: guildConfig.leave.canvas ? { ...guildConfig.leave.canvas } : null
                } : null
            };

            templates[userId][templateName] = templateData;
            saveTemplatesFile(templates);

            await interaction.reply({
                content: `<:Checkedbox:1521227734943269077> Template **${templateName}** saved successfully!`,
                flags: MessageFlags.Ephemeral
            });
            return true;
        }

        if (customId === 'welcomer_modal_message_unified') {
            const content = interaction.fields.getTextInputValue('content');
            const title = interaction.fields.getTextInputValue('title') || null;

            guildConfig.content = content;
            guildConfig.message = content;
            guildConfig.title = title;
            config[guildId] = guildConfig;
            saveConfig(config);

            const container = buildWelcomerContainer(guildConfig, guildId);
            try {
                await updatePanelMessage(interaction, container);
            } catch (e) { }

            await interaction.reply({
                content: '<:Checkedbox:1521227734943269077> Welcome message configured!',
                flags: MessageFlags.Ephemeral
            });
            return true;
        }

        if (customId === 'welcomer_modal_styling_unified') {
            const rawColor = interaction.fields.getTextInputValue('color') || '#bcf1e4';
            const color = normalizeHexColor(rawColor, '#bcf1e4');
            const footer = interaction.fields.getTextInputValue('footer') || null;
            const author = interaction.fields.getTextInputValue('author') || null;

            guildConfig.color = color;
            guildConfig.footer = footer;
            guildConfig.author = author;
            config[guildId] = guildConfig;
            saveConfig(config);

            const container = buildWelcomerContainer(guildConfig, guildId);
            try {
                await updatePanelMessage(interaction, container);
            } catch (e) { }

            await interaction.reply({
                content: '<:Checkedbox:1521227734943269077> Styling configured!',
                flags: MessageFlags.Ephemeral
            });
            return true;
        }

        if (customId === 'welcomer_modal_media_unified') {
            const image = interaction.fields.getTextInputValue('image') || null;
            const thumbnail = interaction.fields.getTextInputValue('thumbnail') || null;

            guildConfig.image = image;
            guildConfig.mediaUrl = image;
            guildConfig.thumbnail = thumbnail;
            config[guildId] = guildConfig;
            saveConfig(config);

            const container = buildWelcomerContainer(guildConfig, guildId);
            try {
                await updatePanelMessage(interaction, container);
            } catch (e) { }

            await interaction.reply({
                content: '<:Checkedbox:1521227734943269077> Media configured!',
                flags: MessageFlags.Ephemeral
            });
            return true;
        }

        if (customId === 'welcomer_modal_buttons') {
            const rawButtons = interaction.fields.getTextInputValue('buttons') || '';
            const buttons = rawButtons.split('\n')
                .map(line => line.trim())
                .filter(line => line.includes('|'))
                .map(line => {
                    const parts = line.split('|').map(p => p.trim());
                    if (parts.length >= 3 && (parts[2].startsWith('http://') || parts[2].startsWith('https://'))) {
                        return { label: parts[0].substring(0, 80), emoji: parts[1] || null, url: parts[2] };
                    } else if (parts.length >= 2) {
                        const url = parts.slice(1).join('|').trim();
                        return { label: parts[0].substring(0, 80), emoji: null, url: url };
                    }
                    return null;
                })
                .filter(b => b && b.label && b.url && (b.url.startsWith('http://') || b.url.startsWith('https://')))
                .slice(0, 5);

            const rawAction = interaction.fields.getTextInputValue('action_buttons') || '';
            const actionButtons = rawAction.split(',').map(s => s.trim()).filter(Boolean).slice(0, 25);

            const rawPos = (interaction.fields.getTextInputValue('button_position') || '').trim().toLowerCase();
            const buttonPosition = rawPos === 'top' ? 'top' : 'bottom';

            guildConfig.buttons = buttons;
            guildConfig.actionButtons = actionButtons;
            guildConfig.buttonPosition = buttonPosition;
            config[guildId] = guildConfig;
            saveConfig(config);

            const total = buttons.length + actionButtons.length;
            const container = buildWelcomerContainer(guildConfig, guildId);
            try {
                await updatePanelMessage(interaction, container);
            } catch (e) { }

            await interaction.reply({
                content: `<:Checkedbox:1521227734943269077> ${total > 0 ? total + ' button' + (total > 1 ? 's' : '') + ' configured!' : 'Buttons cleared!'}`,
                flags: MessageFlags.Ephemeral
            });
            return true;
        }

        if (customId === 'welcomer_modal_embed_author') {
            const author = interaction.fields.getTextInputValue('author') || null;

            guildConfig.author = author;
            config[guildId] = guildConfig;
            saveConfig(config);

            const container = buildWelcomerContainer(guildConfig, guildId);
            try {
                await updatePanelMessage(interaction, container);
            } catch (e) { }

            await interaction.reply({
                content: '<:Checkedbox:1521227734943269077> Author text configured!',
                flags: MessageFlags.Ephemeral
            });
            return true;
        }

        if (customId === 'welcomer_modal_embed_footer') {
            const footer = interaction.fields.getTextInputValue('footer') || null;

            guildConfig.footer = footer;
            config[guildId] = guildConfig;
            saveConfig(config);

            const container = buildWelcomerContainer(guildConfig, guildId);
            try {
                await updatePanelMessage(interaction, container);
            } catch (e) { }

            await interaction.reply({
                content: '<:Checkedbox:1521227734943269077> Footer text configured!',
                flags: MessageFlags.Ephemeral
            });
            return true;
        }

        if (customId === 'leave_modal_channel') {
            let channelId = interaction.fields.getTextInputValue('channel_id').trim();
            channelId = channelId.replace(/<#|>/g, '');

            const channel = interaction.guild.channels.cache.get(channelId);
            if (!channel) {
                await interaction.reply({
                    content: '<:Cancel:1521227723916181644> Invalid channel! Please provide a valid channel ID.',
                    flags: MessageFlags.Ephemeral
                });
                return true;
            }

            if (!guildConfig.leave) guildConfig.leave = getDefaultConfig().leave;
            guildConfig.leave.channelId = channelId;
            config[guildId] = guildConfig;
            saveConfig(config);

            const container = buildLeaveContainer(guildConfig.leave);
            try { await updatePanelMessage(interaction, container); } catch (e) { }

            await interaction.reply({
                content: `<:Checkedbox:1521227734943269077> Leave channel set to <#${channelId}>!`,
                flags: MessageFlags.Ephemeral
            });
            return true;
        }

        if (customId === 'leave_select_channel_unified') {
            const channelId = interaction.values[0];
            const channel = interaction.guild.channels.cache.get(channelId);
            if (!channel) {
                await interaction.reply({
                    content: '<:Cancel:1521227723916181644> Selected channel not found!',
                    flags: MessageFlags.Ephemeral
                });
                return true;
            }

            if (!guildConfig.leave) guildConfig.leave = getDefaultConfig().leave;
            guildConfig.leave.channelId = channelId;
            config[guildId] = guildConfig;
            saveConfig(config);

            const container = buildLeaveContainer(guildConfig.leave);
            try { await updatePanelMessage(interaction, container); } catch (e) { }

            await interaction.reply({
                content: `<:Checkedbox:1521227734943269077> Leave channel set to <#${channelId}>!`,
                flags: MessageFlags.Ephemeral
            });
            return true;
        }

        if (customId === 'leave_modal_message') {
            const content = interaction.fields.getTextInputValue('content');
            const title = interaction.fields.getTextInputValue('title') || null;

            if (!guildConfig.leave) guildConfig.leave = getDefaultConfig().leave;
            guildConfig.leave.content = content;
            guildConfig.leave.title = title || null;
            config[guildId] = guildConfig;
            saveConfig(config);

            const container = buildLeaveContainer(guildConfig.leave);
            try { await updatePanelMessage(interaction, container); } catch (e) { }

            await interaction.reply({
                content: '<:Checkedbox:1521227734943269077> Leave message configured!',
                flags: MessageFlags.Ephemeral
            });
            return true;
        }

        if (customId === 'leave_modal_media') {
            const image = interaction.fields.getTextInputValue('image') || null;
            const thumbnail = interaction.fields.getTextInputValue('thumbnail') || null;

            if (!guildConfig.leave) guildConfig.leave = getDefaultConfig().leave;
            guildConfig.leave.image = image;
            guildConfig.leave.thumbnail = thumbnail;
            config[guildId] = guildConfig;
            saveConfig(config);

            const container = buildLeaveContainer(guildConfig.leave);
            try { await updatePanelMessage(interaction, container); } catch (e) { }

            await interaction.reply({
                content: '<:Checkedbox:1521227734943269077> Leave media configured!',
                flags: MessageFlags.Ephemeral
            });
            return true;
        }

        if (customId === 'leave_modal_styling') {
            const rawColor = interaction.fields.getTextInputValue('color') || '#ED4245';
            const color = normalizeHexColor(rawColor, '#ED4245');
            const footer = interaction.fields.getTextInputValue('footer') || null;
            const author = interaction.fields.getTextInputValue('author') || null;

            if (!guildConfig.leave) guildConfig.leave = getDefaultConfig().leave;
            guildConfig.leave.color = color;
            guildConfig.leave.footer = footer;
            guildConfig.leave.author = author;
            config[guildId] = guildConfig;
            saveConfig(config);

            const container = buildLeaveContainer(guildConfig.leave);
            try { await updatePanelMessage(interaction, container); } catch (e) { }

            await interaction.reply({
                content: '<:Checkedbox:1521227734943269077> Leave styling configured!',
                flags: MessageFlags.Ephemeral
            });
            return true;
        }

        if (customId === 'welcomer_autorole_humans' || customId === 'welcomer_autorole_bots') {
            const isBots = customId.includes('bots');
            let autoroleConfig = {};
            if (jsonStore.has('autorole')) {
                autoroleConfig = jsonStore.read('autorole');
            }
            if (!autoroleConfig[guildId]) {
                autoroleConfig[guildId] = { humans: [], bots: [] };
            }
            const currentRoles = (isBots ? autoroleConfig[guildId].bots : autoroleConfig[guildId].humans) || [];
            const currentDisplay = currentRoles.length > 0
                ? currentRoles.map(id => `<@&${id}>`).join(', ')
                : '`None`';

            const row = new ActionRowBuilder().addComponents(
                new RoleSelectMenuBuilder()
                    .setCustomId(isBots ? 'welcomer_select_autorole_bots_unified' : 'welcomer_select_autorole_humans_unified')
                    .setPlaceholder(`Select roles for ${isBots ? 'bots' : 'humans'} (up to 10)`)
                    .setMinValues(0)
                    .setMaxValues(10)
            );
            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `## <:Settings:1521227767780343879> AutoRole for ${isBots ? 'Bots' : 'Humans'}\nCurrent: ${currentDisplay}\n\nSelect roles to assign automatically when ${isBots ? 'bots' : 'humans'} join. Leave empty to clear.`
                ))
                .addActionRowComponents(row);
            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            return true;
        }

        if (customId === 'welcomer_select_autorole_humans_unified' || customId === 'welcomer_select_autorole_bots_unified') {
            const isBots = customId.includes('bots');
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
            return true;
        }

        // ===== Canvas Modal Submissions =====
        if (customId === 'canvas_bgcolor_modal') {
            const color = interaction.fields.getTextInputValue('bgcolor_hex').trim();
            if (!/^#?([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(color)) {
                await interaction.reply({ content: '<:Cancel:1521227723916181644> Invalid hex color! Use format like #23272a or #FFF', flags: MessageFlags.Ephemeral });
                return true;
            }
            if (!guildConfig.canvas) guildConfig.canvas = { enabled: false };
            guildConfig.canvas.backgroundColor = color.startsWith('#') ? color : `#${color}`;
            config[guildId] = guildConfig;
            saveConfig(config);
            await interaction.reply({ content: `<:Checkedbox:1521227734943269077> Canvas background color set to \`${guildConfig.canvas.backgroundColor}\`!`, flags: MessageFlags.Ephemeral });
            try { const container = buildCanvasContainer(guildConfig.canvas); await updatePanelMessage(interaction, container, MessageFlags.IsComponentsV2); } catch (e) { }
            return true;
        }

        if (customId === 'canvas_accent_modal') {
            const color = interaction.fields.getTextInputValue('accent_hex').trim();
            if (!/^#?([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(color)) {
                await interaction.reply({ content: '<:Cancel:1521227723916181644> Invalid hex color! Use format like #bcf1e4 or #FFF', flags: MessageFlags.Ephemeral });
                return true;
            }
            if (!guildConfig.canvas) guildConfig.canvas = { enabled: false };
            guildConfig.canvas.accentColor = color.startsWith('#') ? color : `#${color}`;
            config[guildId] = guildConfig;
            saveConfig(config);
            await interaction.reply({ content: `<:Checkedbox:1521227734943269077> Canvas accent color set to \`${guildConfig.canvas.accentColor}\`!`, flags: MessageFlags.Ephemeral });
            try { const container = buildCanvasContainer(guildConfig.canvas); await updatePanelMessage(interaction, container, MessageFlags.IsComponentsV2); } catch (e) { }
            return true;
        }

        if (customId === 'canvas_textcolor_modal') {
            const color = interaction.fields.getTextInputValue('textcolor_hex').trim();
            if (!/^#?([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(color)) {
                await interaction.reply({ content: '<:Cancel:1521227723916181644> Invalid hex color! Use format like #ffffff or #FFF', flags: MessageFlags.Ephemeral });
                return true;
            }
            if (!guildConfig.canvas) guildConfig.canvas = { enabled: false };
            guildConfig.canvas.textColor = color.startsWith('#') ? color : `#${color}`;
            config[guildId] = guildConfig;
            saveConfig(config);
            await interaction.reply({ content: `<:Checkedbox:1521227734943269077> Canvas text color set to \`${guildConfig.canvas.textColor}\`!`, flags: MessageFlags.Ephemeral });
            try { const container = buildCanvasContainer(guildConfig.canvas); await updatePanelMessage(interaction, container, MessageFlags.IsComponentsV2); } catch (e) { }
            return true;
        }

        if (customId === 'canvas_background_modal') {
            const url = (interaction.fields.getTextInputValue('background_url') || '').trim();
            if (!guildConfig.canvas) guildConfig.canvas = { enabled: false };
            if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
                guildConfig.canvas.backgroundImage = url;
            } else {
                delete guildConfig.canvas.backgroundImage;
            }
            config[guildId] = guildConfig;
            saveConfig(config);
            await interaction.reply({ content: url ? `<:Checkedbox:1521227734943269077> Canvas background image set!` : '<:Checkedbox:1521227734943269077> Canvas background image removed!', flags: MessageFlags.Ephemeral });
            try { const container = buildCanvasContainer(guildConfig.canvas); await updatePanelMessage(interaction, container, MessageFlags.IsComponentsV2); } catch (e) { }
            return true;
        }

        if (customId === 'canvas_message_modal') {
            const msg = (interaction.fields.getTextInputValue('custom_message') || '').trim();
            if (!guildConfig.canvas) guildConfig.canvas = { enabled: false };
            guildConfig.canvas.customMessage = msg || null;
            config[guildId] = guildConfig;
            saveConfig(config);
            await interaction.reply({ content: msg ? `<:Checkedbox:1521227734943269077> Canvas custom message set to: \`${msg}\`!` : '<:Checkedbox:1521227734943269077> Canvas custom message cleared!', flags: MessageFlags.Ephemeral });
            try { const container = buildCanvasContainer(guildConfig.canvas); await updatePanelMessage(interaction, container, MessageFlags.IsComponentsV2); } catch (e) { }
            return true;
        }

        // ===== Leave Canvas Modal Submissions =====
        if (customId === 'leave_canvas_bgcolor_modal') {
            const color = (interaction.fields.getTextInputValue('color') || '').trim();
            if (!guildConfig.leave) guildConfig.leave = getDefaultConfig().leave;
            if (!guildConfig.leave.canvas) guildConfig.leave.canvas = { enabled: false };
            if (color && /^#?([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(color)) {
                guildConfig.leave.canvas.backgroundColor = color.startsWith('#') ? color : `#${color}`;
            } else {
                delete guildConfig.leave.canvas.backgroundColor;
            }
            config[guildId] = guildConfig;
            saveConfig(config);
            await interaction.reply({ content: `<:Checkedbox:1521227734943269077> Leave canvas background color updated!`, flags: MessageFlags.Ephemeral });
            try { const container = buildLeaveCanvasContainer(guildConfig.leave.canvas); await updatePanelMessage(interaction, container); } catch (e) { }
            return true;
        }

        if (customId === 'leave_canvas_accent_modal') {
            const color = (interaction.fields.getTextInputValue('color') || '').trim();
            if (!guildConfig.leave) guildConfig.leave = getDefaultConfig().leave;
            if (!guildConfig.leave.canvas) guildConfig.leave.canvas = { enabled: false };
            if (color && /^#?([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(color)) {
                guildConfig.leave.canvas.accentColor = color.startsWith('#') ? color : `#${color}`;
            } else {
                delete guildConfig.leave.canvas.accentColor;
            }
            config[guildId] = guildConfig;
            saveConfig(config);
            await interaction.reply({ content: `<:Checkedbox:1521227734943269077> Leave canvas accent color updated!`, flags: MessageFlags.Ephemeral });
            try { const container = buildLeaveCanvasContainer(guildConfig.leave.canvas); await updatePanelMessage(interaction, container); } catch (e) { }
            return true;
        }

        if (customId === 'leave_canvas_text_modal') {
            const color = (interaction.fields.getTextInputValue('color') || '').trim();
            if (!guildConfig.leave) guildConfig.leave = getDefaultConfig().leave;
            if (!guildConfig.leave.canvas) guildConfig.leave.canvas = { enabled: false };
            if (color && /^#?([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(color)) {
                guildConfig.leave.canvas.textColor = color.startsWith('#') ? color : `#${color}`;
            } else {
                delete guildConfig.leave.canvas.textColor;
            }
            config[guildId] = guildConfig;
            saveConfig(config);
            await interaction.reply({ content: `<:Checkedbox:1521227734943269077> Leave canvas text color updated!`, flags: MessageFlags.Ephemeral });
            try { const container = buildLeaveCanvasContainer(guildConfig.leave.canvas); await updatePanelMessage(interaction, container); } catch (e) { }
            return true;
        }

        if (customId === 'leave_canvas_bgimage_modal') {
            const url = (interaction.fields.getTextInputValue('url') || '').trim();
            if (!guildConfig.leave) guildConfig.leave = getDefaultConfig().leave;
            if (!guildConfig.leave.canvas) guildConfig.leave.canvas = { enabled: false };
            if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
                guildConfig.leave.canvas.backgroundImage = url;
            } else {
                delete guildConfig.leave.canvas.backgroundImage;
            }
            config[guildId] = guildConfig;
            saveConfig(config);
            await interaction.reply({ content: url ? '<:Checkedbox:1521227734943269077> Leave canvas background image set!' : '<:Checkedbox:1521227734943269077> Leave canvas background image removed!', flags: MessageFlags.Ephemeral });
            try { const container = buildLeaveCanvasContainer(guildConfig.leave.canvas); await updatePanelMessage(interaction, container); } catch (e) { }
            return true;
        }

        if (customId === 'leave_canvas_message_modal') {
            const msg = (interaction.fields.getTextInputValue('message') || '').trim();
            if (!guildConfig.leave) guildConfig.leave = getDefaultConfig().leave;
            if (!guildConfig.leave.canvas) guildConfig.leave.canvas = { enabled: false };
            guildConfig.leave.canvas.customMessage = msg || null;
            config[guildId] = guildConfig;
            saveConfig(config);
            await interaction.reply({ content: msg ? `<:Checkedbox:1521227734943269077> Leave canvas custom message set!` : '<:Checkedbox:1521227734943269077> Leave canvas custom message cleared!', flags: MessageFlags.Ephemeral });
            try { const container = buildLeaveCanvasContainer(guildConfig.leave.canvas); await updatePanelMessage(interaction, container); } catch (e) { }
            return true;
        }

        // ===== Extra Features Modal Submissions =====
        if (customId === 'welcomer_modal_dm_welcome') {
            const dmContent = (interaction.fields.getTextInputValue('dm_content') || '').trim();
            if (!guildConfig.dmWelcome) guildConfig.dmWelcome = { enabled: false, content: '' };
            guildConfig.dmWelcome.enabled = true;
            guildConfig.dmWelcome.content = dmContent || 'Welcome to **{server}**! We are glad to have you here.';
            config[guildId] = guildConfig;
            saveConfig(config);

            const container = buildWelcomerContainer(guildConfig, guildId);
            try { await updatePanelMessage(interaction, container); } catch (e) { }

            await interaction.reply({
                content: '<:Checkedbox:1521227734943269077> DM Welcome enabled! New members will receive a DM.',
                flags: MessageFlags.Ephemeral
            });
            return true;
        }

        if (customId === 'welcomer_modal_auto_delete') {
            const raw = (interaction.fields.getTextInputValue('duration') || '0').trim();
            const seconds = parseInt(raw, 10);

            if (isNaN(seconds) || seconds < 0 || seconds > 3600) {
                await interaction.reply({
                    content: '<:Cancel:1521227723916181644> Invalid duration! Enter a number between 0-3600 seconds.',
                    flags: MessageFlags.Ephemeral
                });
                return true;
            }

            guildConfig.autoDelete = seconds;
            config[guildId] = guildConfig;
            saveConfig(config);

            const container = buildWelcomerContainer(guildConfig, guildId);
            try { await updatePanelMessage(interaction, container); } catch (e) { }

            await interaction.reply({
                content: seconds > 0
                    ? `<:Checkedbox:1521227734943269077> Welcome messages will auto-delete after **${seconds}** seconds.`
                    : '<:Checkedbox:1521227734943269077> Auto-delete disabled.',
                flags: MessageFlags.Ephemeral
            });
            return true;
        }

        // No handler matched. Return WITHOUT acknowledging.
        //
        // This used to call interaction.deferUpdate() first, to avoid the user
        // seeing "This interaction failed". That was actively harmful: index.js
        // routes welcomer_/leave_/canvas_ here first and falls back to
        // interactionHandlers.handleWelcomerButtons on a falsy return — but the
        // interaction was already acknowledged by then, so every reply() and
        // showModal() in the fallback threw 40060 (already acknowledged).
        //
        // That is why three of /leave-setup's four buttons did nothing at all:
        // leave_setup_channel, welcomer_leave_msg and welcomer_leave_toggle are
        // only implemented in that fallback. Acknowledging on behalf of a
        // handler we have not run is never correct — the caller decides.
        return false;
    },

    async handleModalSubmit(interaction) {
        // Reuse the same handler logic for modal submissions
        return this.handleInteraction(interaction);
    },

    loadConfig,
    saveConfig,
    getDefaultConfig,
    replacePlaceholders,
    createPreviewContainer,
    createPreviewEmbed,
    buildWelcomerContainer,
    // Exported so /leave-setup can open THIS panel instead of maintaining its
    // own copy. The duplicate it used to render read flat `leaveEnabled` /
    // `leaveChannelId` / `leaveMessage` fields that nothing in the codebase ever
    // wrote, so it always displayed "Disabled / Not set / default message".
    buildLeaveContainer
};
