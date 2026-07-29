const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, SectionBuilder, ThumbnailBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, EmbedBuilder, MessageFlags, AttachmentBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');


const jsonStore = require('../../utils/jsonStore');
const { checkAndExpire } = require('../../utils/panelExpiration');

function loadButtonsConfig() {
    if (!jsonStore.has('button-commands')) return {};
    try { return jsonStore.read('button-commands'); } catch { return {}; }
}

function getButtonStyleMap(style) {
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
            .setStyle(getButtonStyleMap(btnData.style));
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

/**
 * In-progress drafts, keyed by the PANEL MESSAGE they belong to.
 *
 * This was a bare `new Map()` keyed `${guildId}-${userId}`, written in ten
 * places and deleted in none — an unbounded leak holding embed content, field
 * arrays, button definitions and image URLs for every user who ever opened the
 * builder in any guild. The per-(guild,user) key also meant one person with two
 * panels open in the same guild had both editing a single draft, so typing in
 * one silently rewrote the other.
 *
 * DraftStore expires and caps entries; keying by message id isolates panels.
 * The TTL is taken from the panel-expiration timeout for builders so a draft can
 * never expire while its panel is still usable (and the two cannot drift).
 */
const DraftStore = require('../../utils/draftStore');
const { TIMEOUTS: PANEL_TIMEOUTS } = require('../../utils/panelExpiration');
const builderData = new DraftStore({
    name: 'message-builder',
    ttlMs: PANEL_TIMEOUTS.builder,
});
const builderSessions = new Map();

/**
 * Key a draft to its panel message.
 *
 * Falls back to a (guild, user) key only when there is no message context,
 * which is why the fallback is namespaced separately — it must never collide
 * with a real panel's key.
 */
function draftKey(interaction) {
    const messageId = interaction?.message?.id;
    if (messageId) return `msg:${messageId}`;
    return `user:${interaction?.guild?.id}-${interaction?.user?.id}`;
}


// Built-in starter templates were intentionally removed — every server
// should design and save its own templates instead of falling back to
// generic stock library content. Returning `{}` keeps the loader UI
// rendering an empty section gracefully.
/**
 * Pull link buttons out of an ActionRow (raw component data, either
 * a built/serialized component or the raw payload from a fetched
 * message) and merge them into the builder's `data.buttons` slot.
 *
 * Why only link buttons? Non-link buttons require a custom_id wired
 * to a live interaction handler. The builder has no way to round-trip
 * those (the user would need to re-select the action button by ID
 * from the configured list), so we leave them alone — the load handler
 * still preserves their existence on the message via "Push Edit"
 * which only updates the V2 container, not the buttons row.
 */
function extractButtonsFromActionRow(row, existingData) {
    const components = row?.components || row?.data?.components || [];
    if (!Array.isArray(components) || components.length === 0) return;
    if (!Array.isArray(existingData.buttons)) existingData.buttons = [];

    for (const child of components) {
        const ctype = child.type ?? child.data?.type;
        if (ctype !== 2) continue; // 2 = Button
        const style = child.style ?? child.data?.style;
        // Style 5 = Link button — the only kind we can faithfully
        // round-trip through the builder. Custom-id buttons (1-4 +
        // primary/secondary/success/danger) need an action handler.
        if (style !== 5) continue;

        const url = child.url || child.data?.url;
        if (!url) continue;

        const labelRaw = child.label || child.data?.label || 'Link';
        const label = String(labelRaw).slice(0, 80);

        // Discord button emojis come in either shape:
        //   { id, name, animated }   (from API payloads)
        //   string                   (Unicode emoji name)
        let emoji = null;
        const rawEmoji = child.emoji || child.data?.emoji;
        if (rawEmoji) {
            if (typeof rawEmoji === 'string') {
                emoji = rawEmoji;
            } else if (rawEmoji.id) {
                emoji = rawEmoji.animated
                    ? `<a:${rawEmoji.name || '_'}:${rawEmoji.id}>`
                    : `<:${rawEmoji.name || '_'}:${rawEmoji.id}>`;
            } else if (rawEmoji.name) {
                emoji = rawEmoji.name;
            }
        }

        // Builder caps at 5 link buttons per message — drop overflow
        // silently rather than crashing on the next render.
        if (existingData.buttons.length >= 5) break;
        existingData.buttons.push({ label, url, emoji });
    }
}

function getDefaultData() {
    return {
        mode: 'components',
        content: '',
        title: '',
        description: '',
        color: '#bcf1e4',
        images: [],
        thumbnail: '',
        footer: '',
        footerIcon: '',
        author: '',
        authorIcon: '',
        fields: [],
        colorless: false,
        imagePosition: 'bottom',
        buttonPosition: 'bottom',
        buttons: [],
        actionButtons: [],
        actionMenus: [],
        editingMessageId: null,
        editingChannelId: null
    };
}

function normalizeImages(data) {
    if (data.image && !data.images?.length) {
        data.images = typeof data.image === 'string' && data.image ? [data.image] : [];
        delete data.image;
    }
    if (!data.images) data.images = [];
    return data;
}

/**
 * Delegates to utils/messagePlaceholders — the single placeholder engine.
 *
 * The previous body supported ~17 placeholders and rendered {date}/{time} as
 * server-locale strings (showing the host's clock to every viewer) and
 * {timestamp} as <t:..:F> where the runtime used <t:..:R>.
 */
function replacePlaceholders(text, user, guild, channel) {
    return require('../../utils/messagePlaceholders').replacePlaceholders(text, user, guild, channel);
}

/* ═══════════════════════════════════════════════════════════════════════════
 * PANEL CONTROLS — one select menu per row
 *
 * The panel previously stacked five action rows holding 22 buttons and ~15
 * different decorative emojis, and it swapped its own contents based on mode.
 * That hid options rather than disabling them: msgbuilder_set_buttons appeared
 * only in components mode, so an embed could not be given buttons at all, and
 * Clear Fields appeared only in embed mode AND only once fields existed.
 *
 * Four select menus replace all of it. Conventions match welcomer.js:
 *   - ids are `msgbuilder:<control>`; discrete setters are
 *     `msgbuilder:set:<field>:<value>`
 *   - the ONLY emojis are the enable/disable pair, used to mark which choice in
 *     a group is active. State is never carried by a button colour
 *   - option VALUES on the edit/send/data menus are the action ids the handler
 *     chain already implements, so mapping is the identity function and no
 *     lookup table can drift out of sync
 * ═══════════════════════════════════════════════════════════════════════════ */

const B_ON = '<:Toggleon:1521227758011809964>';
const B_OFF = '<:Toggleoff:1521227763816595559>';

const BID = {
    mode: 'msgbuilder:mode',
    content: 'msgbuilder:content',
    parts: 'msgbuilder:parts',
    send: 'msgbuilder:send',
    utility: 'msgbuilder:utility',
    // kept so panels already posted keep routing
    edit: 'msgbuilder:edit',
    layout: 'msgbuilder:layout',
    data: 'msgbuilder:data',
};

const bMark = (active) => (active ? B_ON : B_OFF);

function bMenuRow(customId, placeholder, options) {
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(customId)
            .setPlaceholder(placeholder)
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(options.slice(0, 25).map((o) => {
                const opt = new StringSelectMenuOptionBuilder().setValue(o.value).setLabel(o.label);
                if (o.description) opt.setDescription(o.description.slice(0, 100));
                if (o.emoji) opt.setEmoji(o.emoji);
                return opt;
            }))
    );
}

/* ── Live preview ──
 * Same approach as welcomer.js: the whole preview is folded into ONE text
 * display plus at most one media gallery.
 *
 * The previous panel called buildPreviewSection, which added a component per
 * content chunk, per image, per field and per separator. A draft with content,
 * two images, a title, a field and a button produced THIRTEEN children in one
 * container - Discord's limit is 10, so the panel failed to render at all once a
 * draft got rich enough. Folding it into one text display makes the cost
 * constant no matter how much is configured. */
function buildBuilderPreview(data, ctx) {
    const user = ctx?.user || null;
    const guild = ctx?.guild || null;
    const channel = ctx?.channel || null;
    const resolve = (v) => {
        if (!v) return '';
        try { return replacePlaceholders(v, user, guild, channel) || ''; } catch { return v; }
    };

    const isComponents = (data.mode || 'components') === 'components';
    const lines = [];

    if (!isComponents && data.author) lines.push(`-# ${resolve(data.author)}`);
    if (data.title) lines.push(`**${resolve(data.title)}**`);
    if (data.content) lines.push(resolve(data.content));
    if (data.description) lines.push(resolve(data.description));

    for (const f of (data.fields || []).slice(0, 3)) {
        lines.push(`**${resolve(f.name)}**`);
        lines.push(resolve(f.value));
    }
    const moreFields = (data.fields || []).length - 3;
    if (moreFields > 0) lines.push(`-# +${moreFields} more field${moreFields > 1 ? 's' : ''}`);

    if (data.footer) lines.push(`-# ${resolve(data.footer)}`);

    const parts = [];
    const linkN = (data.buttons || []).length;
    const actN = (data.actionButtons || []).length;
    const menuN = (data.actionMenus || []).length;
    const imgN = (data.images || []).length;
    if (linkN) parts.push(`${linkN} link button${linkN > 1 ? 's' : ''}`);
    if (actN) parts.push(`${actN} action button${actN > 1 ? 's' : ''}`);
    if (menuN) parts.push(`${menuN} select menu${menuN > 1 ? 's' : ''}`);
    if (imgN > 1) parts.push(`${imgN} images`);
    if (data.thumbnail) parts.push('thumbnail');

    let imageUrl = null;
    const firstImg = (data.images || [])[0] || data.image;
    if (firstImg) {
        const u = resolve(firstImg);
        if (/^https?:\/\//.test(u)) imageUrl = u;
    }

    let text = lines.join('\n');
    if (parts.length) text += `\n-# attached: ${parts.join(', ')}`;
    return { text: text || '*nothing added yet*', imageUrl };
}

function builderModeOptions(d) {
    const mode = d.mode || 'components';
    return [
        { value: 'msgbuilder:set:mode:components', label: 'Components V2', description: 'Rich container layout with images and separators', emoji: bMark(mode === 'components') },
        { value: 'msgbuilder:set:mode:embed', label: 'Embed', description: 'Classic embed with title, author and footer', emoji: bMark(mode === 'embed') },
    ];
}

function builderContentOptions(d) {
    const img = d.imagePosition || 'bottom';
    const fieldN = (d.fields || []).length;
    const imgN = (d.images || []).length;
    const opts = [
        { value: 'msgbuilder_set_content', label: 'Message text', description: d.content ? 'Set' : 'Empty' },
        { value: 'msgbuilder_set_basic', label: 'Title and description', description: (d.title || d.description) ? 'Set' : 'Not set' },
        { value: 'msgbuilder_set_styling', label: 'Accent colour and footer', description: d.colorless ? 'Colour hidden' : (d.color || '#bcf1e4') },
        { value: 'msgbuilder_set_media', label: 'Attachment: images and thumbnail', description: (imgN || d.thumbnail) ? `${imgN} image(s)${d.thumbnail ? ' + thumbnail' : ''}` : 'No attachment set' },
        { value: 'msgbuilder:set:imgpos:top', label: 'Attachment position: top', emoji: bMark(img === 'top') },
        { value: 'msgbuilder:set:imgpos:side', label: 'Attachment position: side thumbnail', emoji: bMark(img === 'side') },
        { value: 'msgbuilder:set:imgpos:bottom', label: 'Attachment position: bottom', emoji: bMark(img === 'bottom') },
        { value: 'msgbuilder_add_field', label: 'Add a field', description: `${fieldN} field(s) so far` },
        { value: 'msgbuilder:set:colorless:on', label: 'Hide the accent colour', description: 'Remove the coloured bar', emoji: bMark(!!d.colorless) },
        { value: 'msgbuilder:set:colorless:off', label: 'Show the accent colour', description: 'Keep the coloured bar', emoji: bMark(!d.colorless) },
    ];
    if (fieldN > 0) {
        opts.push({ value: 'msgbuilder_clear_fields', label: 'Clear all fields', description: `Removes all ${fieldN}` });
    }
    return opts;
}

function builderPartsOptions(d) {
    const btn = d.buttonPosition || 'bottom';
    const linkN = (d.buttons || []).length;
    const actN = (d.actionButtons || []).length;
    const menuN = (d.actionMenus || []).length;
    return [
        { value: 'msgbuilder_set_buttons', label: 'Link buttons', description: linkN ? `${linkN} configured` : 'None. Buttons that open a URL' },
        { value: 'msgbuilder:parts:actionbtns', label: 'Action buttons', description: actN ? `${actN} attached` : 'None. Attach buttons from /button-maker' },
        { value: 'msgbuilder:parts:menus', label: 'Select menus', description: menuN ? `${menuN} attached` : 'None. Attach menus from /select-menu-maker' },
        { value: 'msgbuilder:set:btnpos:top', label: 'Components above the text', emoji: bMark(btn === 'top') },
        { value: 'msgbuilder:set:btnpos:bottom', label: 'Components below the text', emoji: bMark(btn === 'bottom') },
    ];
}

function builderSendOptions(d) {
    return [
        { value: 'msgbuilder_preview', label: 'Preview privately', description: 'See it exactly as it will be posted' },
        { value: 'msgbuilder_send_here', label: 'Send in this channel', description: 'Post it where the panel is' },
        { value: 'msgbuilder_send_channel', label: 'Send to another channel', description: 'Pick a destination' },
        { value: 'msgbuilder_edit_message', label: 'Load an existing message', description: 'Pull one in by id to edit it' },
        {
            value: 'msgbuilder_push_edit',
            label: 'Push edit to the loaded message',
            description: d.editingMessageId ? `Updates ${d.editingMessageId}` : 'Load a message first',
            emoji: bMark(!!d.editingMessageId),
        },
    ];
}

function builderUtilityOptions() {
    return [
        { value: 'msgbuilder_show_variables', label: 'Placeholder reference', description: 'Every {placeholder} you can use' },
        { value: 'msgbuilder_export_json', label: 'Export JSON', description: 'Copy this design out' },
        { value: 'msgbuilder_import_json', label: 'Import JSON', description: 'Paste a design in' },
        { value: 'msgbuilder_reset', label: 'Reset everything', description: 'Back to an empty draft' },
    ];
}

function builderSendOptions(d) {
    return [
        { value: 'msgbuilder_preview', label: 'Preview', description: 'Show it privately before sending' },
        { value: 'msgbuilder_send_here', label: 'Send in this channel', description: 'Post it where the panel is' },
        { value: 'msgbuilder_send_channel', label: 'Send to another channel', description: 'Pick a destination' },
        { value: 'msgbuilder_edit_message', label: 'Load an existing message', description: 'Pull one in by id to edit it' },
        {
            value: 'msgbuilder_push_edit',
            label: 'Push edit to the loaded message',
            description: d.editingMessageId ? `Updates message ${d.editingMessageId}` : 'Load a message first',
            emoji: bMark(!!d.editingMessageId),
        },
    ];
}

/**
 * Translates a new-panel interaction into the action id the existing handler
 * chain understands, or null when the id is not ours. The edit/send/data menus
 * carry legacy action ids as their values, so this is a pass-through.
 */
function mapBuilderInteraction(interaction) {
    const id = interaction.customId;
    if (typeof id !== 'string' || !id.startsWith('msgbuilder:')) return null;
    if (id === BID.edit || id === BID.send || id === BID.data || id === BID.layout
        || id === BID.mode || id === BID.content || id === BID.parts || id === BID.utility) {
        const chosen = interaction.values && interaction.values[0];
        return chosen || id;
    }
    return id;
}

// Sanitize a URL for the in-builder live preview.
// - If a context is provided, unresolved placeholders are resolved.
// - Strings still containing unresolved {placeholders} or that don't start
//   with http(s):// or attachment:// are dropped (returned as null) so the
//   preview never feeds an invalid URL into a discord.js builder.
function safePreviewUrl(url, ctx) {
    if (!url || typeof url !== 'string') return null;
    let value = url.trim();
    if (!value) return null;
    if (ctx && (ctx.user || ctx.guild || ctx.channel)) {
        value = replacePlaceholders(value, ctx.user, ctx.guild, ctx.channel);
    }
    if (!value) return null;
    if (/\{[^}]+\}/.test(value)) return null;
    if (!/^(https?:|attachment:)/i.test(value)) return null;
    return value;
}

function buildContainer(data, ctx = null) {
    const colorValue = data.color ? parseInt(data.color.replace('#', ''), 16) : 0xCAD7E6;
    const container = new ContainerBuilder();
    if (!data.colorless) {
        container.setAccentColor(isNaN(colorValue) ? 0xCAD7E6 : colorValue);
    }

    /* COMPONENT BUDGET: a Components V2 container holds at most 10 children.
     * 1 text + 1 optional image + 1 separator + 5 rows = 7 or 8, whatever the
     * draft contains. The previous layout grew with the draft and hit 13. */
    const isComponents = (data.mode || 'components') === 'components';
    const preview = buildBuilderPreview(data, ctx);

    let head = '# Message builder\n';
    head += '-# Compose a message or embed, watch it update live, then send it\n';
    head += '-# anywhere or use it to edit an existing message.\n\n';
    head += 'mode `' + (isComponents ? 'Components V2' : 'Embed') + '`  \u00b7  colour `' + (data.colorless ? 'hidden' : (data.color || '#bcf1e4')) + '`';
    if (data.editingMessageId) {
        head += '\n' + B_ON + ' editing message `' + data.editingMessageId + '`';
    }
    head += '\n\n### Live preview\n' + preview.text;

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(head));

    if (preview.imageUrl) {
        container.addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(preview.imageUrl))
        );
    }

    container.addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    );

    container.addActionRowComponents(bMenuRow(BID.mode, 'Display mode', builderModeOptions(data)));
    container.addActionRowComponents(bMenuRow(BID.content, 'Message and attachment', builderContentOptions(data)));
    container.addActionRowComponents(bMenuRow(BID.parts, 'Buttons and select menus', builderPartsOptions(data)));
    container.addActionRowComponents(bMenuRow(BID.send, 'Preview or send', builderSendOptions(data)));
    container.addActionRowComponents(bMenuRow(BID.utility, 'Utility', builderUtilityOptions()));

    return container;
}

function createPreviewEmbed(data, user, guild, channel) {
    const colorValue = data.color ? parseInt(data.color.replace('#', ''), 16) : 0xCAD7E6;
    const embed = new EmbedBuilder()
        .setColor(isNaN(colorValue) ? 0xCAD7E6 : colorValue)
        .setTimestamp();

    if (data.title) {
        embed.setTitle(replacePlaceholders(data.title, user, guild, channel));
    }

    if (data.description) {
        embed.setDescription(replacePlaceholders(data.description, user, guild, channel));
    }

    const embedImage = data.images?.length ? data.images[0] : (data.image || '');
    if (embedImage) {
        const processedImage = replacePlaceholders(embedImage, user, guild, channel);
        if (processedImage) embed.setImage(processedImage);
    }

    if (data.thumbnail) {
        const processedThumb = replacePlaceholders(data.thumbnail, user, guild, channel);
        if (processedThumb) embed.setThumbnail(processedThumb);
    }

    if (data.footer) {
        const footerOpts = { text: replacePlaceholders(data.footer, user, guild, channel) };
        if (data.footerIcon) footerOpts.iconURL = replacePlaceholders(data.footerIcon, user, guild, channel);
        embed.setFooter(footerOpts);
    }

    if (data.author) {
        const authorOpts = { name: replacePlaceholders(data.author, user, guild, channel) };
        authorOpts.iconURL = data.authorIcon
            ? replacePlaceholders(data.authorIcon, user, guild, channel)
            : user.displayAvatarURL({ size: 64 });
        embed.setAuthor(authorOpts);
    }

    if (data.fields?.length) {
        for (const field of data.fields.slice(0, 25)) {
            embed.addFields({
                name: replacePlaceholders(field.name, user, guild, channel),
                value: replacePlaceholders(field.value, user, guild, channel),
                inline: field.inline || false
            });
        }
    }

    return embed;
}

function processSeparators(content) {
    return content
        .replace(/\{separator:small\}/gi, '---SEPARATOR:SMALL---')
        .replace(/\{separator:medium\}/gi, '---SEPARATOR:MEDIUM---')
        .replace(/\{separator:large\}/gi, '---SEPARATOR:LARGE---')
        .replace(/\{separator\}/gi, '---SEPARATOR:SMALL---');
}

/**
 * Builds the message that actually gets sent.
 *
 * A Components V2 container accepts at most 10 children. This builder had no cap,
 * so a rich draft (content + images + fields + buttons) produced a container
 * Discord rejects outright. addCapped() drops anything past the limit rather than
 * letting the send fail, and the panel's preview warns when that happens.
 */
function createPreviewContainer(data, user, guild, channel) {
    const colorValue = data.color ? parseInt(data.color.replace('#', ''), 16) : 0xCAD7E6;
    const content = data.content || 'No content set';
    let processedContent = replacePlaceholders(content, user, guild, channel);

    const container = new ContainerBuilder();

    // Only set accent color if not colorless mode
    if (!data.colorless && !isNaN(colorValue)) {
        container.setAccentColor(colorValue);
    }

    /* URLs must go through safePreviewUrl, not just .filter(Boolean).
     * A value that is not http(s)/attachment, or that still contains an
     * unresolved {placeholder}, makes MediaGalleryItemBuilder.setURL() throw -
     * which failed the whole SEND, not just the image. Previously only the
     * in-panel preview was guarded and the send path was not. */
    const ctx = { user, guild, channel };
    const processedThumb = safePreviewUrl(data.thumbnail, ctx);
    const imageList = (data.images?.length ? data.images : (data.image ? [data.image] : []))
        .map(url => safePreviewUrl(url, ctx))
        .filter(Boolean);

    const imgPos = data.imagePosition || 'bottom';

    // Build image gallery component if images exist (not used for 'side' mode)
    let imageGallery = null;
    if (imageList.length > 0 && imgPos !== 'side') {
        imageGallery = new MediaGalleryBuilder();
        for (const url of imageList) {
            imageGallery.addItems(new MediaGalleryItemBuilder().setURL(url));
        }
    }

    // For 'side' mode, first image becomes the thumbnail accessory
    const sideImageUrl = (imgPos === 'side' && imageList.length > 0) ? imageList[0] : null;
    const effectiveThumb = sideImageUrl || processedThumb;

    const btnPos = data.buttonPosition || 'bottom';

    // Helper: render all configured buttons into the container
    function renderButtons() {
        if (data.buttons?.length > 0) {
            const buttonRow = new ActionRowBuilder();
            for (const btn of data.buttons.slice(0, 5)) {
                const button = new ButtonBuilder()
                    .setLabel(btn.label)
                    .setStyle(ButtonStyle.Link)
                    .setURL(btn.url);
                if (btn.emoji) button.setEmoji(btn.emoji);
                buttonRow.addComponents(button);
            }
            container.addActionRowComponents(buttonRow);
        }
        if (data.actionButtons?.length > 0 && guild) {
            const actionRows = buildActionButtonRows(data.actionButtons, guild.id);
            for (const row of actionRows) {
                container.addActionRowComponents(row);
            }
        }
        // Select menus attached from /select-menu-maker. customId MUST be
        // select_cmd_ : that is the prefix index.js routes. Anything else shows
        // "This interaction failed" when a member picks an option.
        if (data.actionMenus?.length > 0 && guild) {
            const menuStore = jsonStore.has('select-menus') ? (jsonStore.peek('select-menus') || {}) : {};
            const guildMenus = menuStore[guild.id] || {};
            for (const menuId of data.actionMenus.slice(0, 5)) {
                const md = guildMenus[menuId];
                if (!md || !md.options?.length) continue;
                const sm = new StringSelectMenuBuilder()
                    .setCustomId(`select_cmd_${guild.id}_${menuId}`)
                    .setPlaceholder(md.placeholder || 'Select an option...')
                    .setMinValues(md.minValues ?? 1)
                    .setMaxValues(md.maxValues ?? 1);
                for (const o of md.options.slice(0, 25)) {
                    const label = String(o.label ?? '').slice(0, 100) || 'Option';
                    const opt = new StringSelectMenuOptionBuilder()
                        .setLabel(label)
                        .setValue(String(o.value ?? label).slice(0, 100));
                    const desc = String(o.description ?? '').trim().slice(0, 100);
                    if (desc) opt.setDescription(desc);
                    if (o.emoji) opt.setEmoji(o.emoji);
                    sm.addOptions(opt);
                }
                container.addActionRowComponents(new ActionRowBuilder().addComponents(sm));
            }
        }
    }

    // Add image gallery at top if position is 'top'
    if (imageGallery && imgPos === 'top') {
        container.addMediaGalleryComponents(imageGallery);
    }

    // Buttons at top — placed before content
    if (btnPos === 'top') {
        renderButtons();
    }

    const hasSeparators = /\{separator(:(small|medium|large))?\}/gi.test(content);

    if (hasSeparators) {
        const parts = processSeparators(processedContent).split(/---SEPARATOR:(SMALL|MEDIUM|LARGE)---/);
        let isFirst = true;

        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            if (part === 'SMALL' || part === 'MEDIUM' || part === 'LARGE') {
                const spacing = part === 'LARGE' ? SeparatorSpacingSize.Large :
                    part === 'MEDIUM' ? SeparatorSpacingSize.Medium : SeparatorSpacingSize.Small;
                container.addSeparatorComponents(
                    new SeparatorBuilder().setSpacing(spacing).setDivider(true)
                );
            } else if (part.trim()) {
                if (isFirst && effectiveThumb) {
                    const section = new SectionBuilder()
                        .addTextDisplayComponents(new TextDisplayBuilder().setContent(part))
                        .setThumbnailAccessory(new ThumbnailBuilder().setURL(effectiveThumb));
                    container.addSectionComponents(section);
                    isFirst = false;
                } else {
                    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(part));
                }
            }
        }
    } else {
        if (effectiveThumb) {
            const section = new SectionBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(processedContent))
                .setThumbnailAccessory(new ThumbnailBuilder().setURL(effectiveThumb));
            container.addSectionComponents(section);
        } else {
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent(processedContent));
        }
    }

    // Add image gallery at bottom if position is 'bottom' (default)
    if (imageGallery && imgPos === 'bottom') {
        container.addMediaGalleryComponents(imageGallery);
    }

    // Fields
    if (data.fields?.length > 0) {
        container.addSeparatorComponents(
            new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
        );
        for (const field of data.fields.slice(0, 25)) {
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `**${replacePlaceholders(field.name, user, guild, channel)}**\n${replacePlaceholders(field.value, user, guild, channel)}`
                )
            );
        }
    }

    if (data.footer) {
        container.addSeparatorComponents(
            new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
        );
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`-# ${replacePlaceholders(data.footer, user, guild, channel)}`)
        );
    }

    // Buttons at bottom (default)
    if (btnPos !== 'top') {
        renderButtons();
    }

    // Hard cap: Discord rejects a container with more than 10 children.
    const kids = container.data?.components;
    if (Array.isArray(kids) && kids.length > 10) {
        kids.length = 10;
    }

    return container;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('message-builder')
        .setDescription('Create custom messages with Embed or Components V2 mode')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    async execute(interaction) {
        // The draft is stored AFTER the reply so it can be keyed by the panel
        // message id. Nothing is needed from the store to render the first
        // frame — it is just the defaults.
        const data = { ...getDefaultData() };

        const ctx = { user: interaction.user, guild: interaction.guild, channel: interaction.channel };
        const container = buildContainer(data, ctx);

        const reply = await interaction.reply({
            components: [container],
            flags: MessageFlags.IsComponentsV2,
            fetchReply: true
        });

        const messageId = reply.id;

        // Seed the draft now that the panel message id exists.
        builderData.set(`msg:${messageId}`, data);

        builderSessions.set(messageId, {
            userId: interaction.user.id,
            channelId: interaction.channel.id,
            guildId: interaction.guild.id,
            createdAt: Date.now()
        });

        // Register panel expiration session
        const { registerSession } = require('../../utils/panelExpiration');
        registerSession(messageId, {
            channelId: interaction.channel.id,
            guildId: interaction.guild.id,
            type: 'builder',
            userId: interaction.user.id,
        });

        setTimeout(() => {
            if (builderSessions.has(messageId)) {
                builderSessions.delete(messageId);
            }
        }, 600000);
    },

    async executePrefix(message) {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
            return message.reply('<:Cancel:1521227723916181644> You need Manage Messages permission!');
        }

        const data = { ...getDefaultData() };

        const ctx = { user: message.author, guild: message.guild, channel: message.channel };
        const container = buildContainer(data, ctx);

        const reply = await message.reply({
            components: [container],
            flags: MessageFlags.IsComponentsV2
        });

        // Seed the draft now that the panel message id exists.
        builderData.set(`msg:${reply.id}`, data);

        builderSessions.set(reply.id, {
            userId: message.author.id,
            channelId: message.channel.id,
            guildId: message.guild.id,
            createdAt: Date.now()
        });

        setTimeout(() => {
            if (builderSessions.has(reply.id)) {
                builderSessions.delete(reply.id);
            }
        }, 600000);
    },

    async handleInteraction(interaction) {
        if (!interaction.guild || !interaction.member) return false;

        const rawId = interaction.customId;
        if (!rawId.startsWith('msgbuilder:') && !rawId.startsWith('msgbuilder_')) return false;

        // New select-menu panel ids become the action ids the chain below already
        // implements. Legacy button ids pass through untouched, so builder panels
        // already posted in channels keep working.
        const customId = mapBuilderInteraction(interaction) || rawId;

        // Check if builder session has expired
        if (await checkAndExpire(interaction, 'builder')) return true;

        const session = interaction.message ? builderSessions.get(interaction.message.id) : null;
        if (session && session.userId !== interaction.user.id) {
            await interaction.reply({
                content: '<:Cancel:1521227723916181644> This builder belongs to someone else. Use `/message-builder` to open your own.',
                flags: MessageFlags.Ephemeral
            });
            return true;
        }

        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
            await interaction.reply({
                content: '<:Cancel:1521227723916181644> You need Manage Messages permission!',
                flags: MessageFlags.Ephemeral
            });
            return true;
        }

        const key = draftKey(interaction);
        let data = builderData.get(key) || { ...getDefaultData() };
        const ctx = { user: interaction.user, guild: interaction.guild, channel: interaction.channel };

        /* ── New panel: discrete value setters ──
         * `msgbuilder:set:<field>:<value>`. Custom ids come from the client, so
         * field and value are both whitelisted rather than written through —
         * otherwise a crafted id could assign arbitrary draft keys. This also
         * replaces the old cycling Image button, which needed three clicks to
         * get back to 'bottom' and could not target a value directly. */
        /* ── Attach action buttons / select menus built with the maker commands ── */
        if (customId === 'msgbuilder:parts:actionbtns' || customId === 'msgbuilder:parts:menus') {
            const isMenus = customId.endsWith(':menus');
            const storeName = isMenus ? 'select-menus' : 'button-commands';
            const stored = jsonStore.has(storeName) ? (jsonStore.read(storeName)[interaction.guild.id] || {}) : {};
            const available = Object.keys(stored);
            if (available.length === 0) {
                await interaction.reply({
                    content: isMenus
                        ? '<:Cancel:1521227723916181644> No select menus exist yet. Create one with `/select-menu-maker create`, then attach it here.'
                        : '<:Cancel:1521227723916181644> No action buttons exist yet. Create one with `/button-maker create`, then attach it here.',
                    flags: MessageFlags.Ephemeral
                });
                return true;
            }
            const current = (isMenus ? data.actionMenus : data.actionButtons) || [];
            const row = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(isMenus ? 'msgbuilder:parts:menus:pick' : 'msgbuilder:parts:actionbtns:pick')
                    .setPlaceholder(isMenus ? 'Select menus to attach' : 'Action buttons to attach')
                    .setMinValues(0)
                    .setMaxValues(Math.min(available.length, isMenus ? 5 : 25))
                    .addOptions(available.slice(0, 25).map((id) => {
                        const o = new StringSelectMenuOptionBuilder()
                            .setValue(id)
                            .setLabel(id.slice(0, 100))
                            .setEmoji(current.includes(id) ? B_ON : B_OFF)
                            .setDefault(current.includes(id));
                        const d2 = isMenus ? stored[id]?.placeholder : stored[id]?.label;
                        if (d2) o.setDescription(String(d2).slice(0, 100));
                        return o;
                    }))
            );
            const c = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `### ${isMenus ? 'Select menus' : 'Action buttons'}\n-# Selected ones are attached to the message. Deselect to remove.`
                ))
                .addActionRowComponents(row);
            await interaction.reply({ components: [c], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            return true;
        }

        if (customId === 'msgbuilder:parts:menus:pick' || customId === 'msgbuilder:parts:actionbtns:pick') {
            const isMenus = customId.includes(':menus:');
            const picked = (interaction.values || []).slice(0, isMenus ? 5 : 25);
            if (isMenus) data.actionMenus = picked; else data.actionButtons = picked;
            builderData.set(key, data);
            await interaction.update({
                components: [new ContainerBuilder().addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        picked.length
                            ? `<:Checkedbox:1521227734943269077> Attached ${picked.length}: \`${picked.join('`, `')}\`\n-# The builder panel shows it in the live preview.`
                            : '<:Checkedbox:1521227734943269077> All removed.'
                    )
                )],
                flags: MessageFlags.IsComponentsV2
            });
            return true;
        }

        if (customId.startsWith('msgbuilder:set:')) {
            const parts = customId.split(':');
            const field = parts[2];
            const value = parts[3];

            const ALLOWED = {
                mode: ['components', 'embed'],
                imgpos: ['top', 'side', 'bottom'],
                btnpos: ['top', 'bottom'],
                colorless: ['on', 'off'],
            };
            if (!ALLOWED[field] || !ALLOWED[field].includes(value)) {
                await interaction.reply({
                    content: '<:Cancel:1521227723916181644> That option is not recognised. Re-open the builder with `/message-builder`.',
                    flags: MessageFlags.Ephemeral
                });
                return true;
            }

            if (field === 'mode') data.mode = value;
            else if (field === 'imgpos') data.imagePosition = value;
            else if (field === 'btnpos') data.buttonPosition = value;
            else if (field === 'colorless') data.colorless = (value === 'on');

            builderData.set(key, data);
            const ctx = { user: interaction.user, guild: interaction.guild, channel: interaction.channel };
            await interaction.update({
                components: [buildContainer(data, ctx)],
                flags: MessageFlags.IsComponentsV2
            });
            return true;
        }

        if (customId === 'msgbuilder_mode_components') {
            data.mode = 'components';
            builderData.set(key, data);
            const container = buildContainer(data, ctx);
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
            return true;
        }

        if (customId === 'msgbuilder_mode_embed') {
            data.mode = 'embed';
            builderData.set(key, data);
            const container = buildContainer(data, ctx);
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
            return true;
        }

        if (customId === 'msgbuilder_set_content') {
            const modal = new ModalBuilder()
                .setCustomId('msgbuilder_modal_content')
                .setTitle('Set Content');

            const contentInput = new TextInputBuilder()
                .setCustomId('content')
                .setLabel('Message Content')
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder('Welcome {user} to {server}!')
                .setValue(typeof data.content === 'string' ? data.content : '')
                .setMaxLength(4000)
                .setRequired(true);

            const footerInput = new TextInputBuilder()
                .setCustomId('footer')
                .setLabel('Footer Text (optional)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Powered by {server}')
                .setValue(typeof data.footer === 'string' ? data.footer : '')
                .setRequired(false);

            modal.addComponents(
                new ActionRowBuilder().addComponents(contentInput),
                new ActionRowBuilder().addComponents(footerInput)
            );
            await interaction.showModal(modal);
            return true;
        }

        if (customId === 'msgbuilder_set_basic') {
            const modal = new ModalBuilder()
                .setCustomId('msgbuilder_modal_basic')
                .setTitle('Set Title & Description');

            const titleInput = new TextInputBuilder()
                .setCustomId('title')
                .setLabel('Embed Title')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Welcome!')
                .setValue(typeof data.title === 'string' ? data.title : '')
                .setRequired(false);

            const descInput = new TextInputBuilder()
                .setCustomId('description')
                .setLabel('Embed Description')
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder('Welcome {user} to {server}!')
                .setValue(typeof data.description === 'string' ? data.description : '')
                .setMaxLength(4000)
                .setRequired(false);

            const authorInput = new TextInputBuilder()
                .setCustomId('author')
                .setLabel('Author Text (optional)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('{username}')
                .setValue(typeof data.author === 'string' ? data.author : '')
                .setRequired(false);

            const authorIconInput = new TextInputBuilder()
                .setCustomId('author_icon')
                .setLabel('Author Icon URL (optional)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('{useravatar}')
                .setValue(typeof data.authorIcon === 'string' ? data.authorIcon : '')
                .setRequired(false);

            modal.addComponents(
                new ActionRowBuilder().addComponents(titleInput),
                new ActionRowBuilder().addComponents(descInput),
                new ActionRowBuilder().addComponents(authorInput),
                new ActionRowBuilder().addComponents(authorIconInput)
            );
            await interaction.showModal(modal);
            return true;
        }

        if (customId === 'msgbuilder_set_media') {
            normalizeImages(data);
            const isComponents = (data.mode || 'components') === 'components';
            const modal = new ModalBuilder()
                .setCustomId('msgbuilder_modal_media')
                .setTitle('Set Media');

            const imageInput = new TextInputBuilder()
                .setCustomId('image')
                .setLabel(isComponents ? 'Image URLs (one per line, max 10)' : 'Image URL')
                .setStyle(isComponents ? TextInputStyle.Paragraph : TextInputStyle.Short)
                .setPlaceholder(isComponents ? 'https://example.com/image1.png\nhttps://example.com/image2.png\nhttps://example.com/image3.png' : 'https://example.com/image.png')
                .setValue(data.images?.length ? data.images.join('\n') : (typeof data.image === 'string' ? data.image : ''))
                .setRequired(false);

            const thumbInput = new TextInputBuilder()
                .setCustomId('thumbnail')
                .setLabel('Thumbnail URL')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('https://example.com/thumb.png')
                .setValue(typeof data.thumbnail === 'string' ? data.thumbnail : '')
                .setRequired(false);

            modal.addComponents(
                new ActionRowBuilder().addComponents(imageInput),
                new ActionRowBuilder().addComponents(thumbInput)
            );
            await interaction.showModal(modal);
            return true;
        }

        if (customId === 'msgbuilder_set_styling') {
            const modal = new ModalBuilder()
                .setCustomId('msgbuilder_modal_styling')
                .setTitle('Set Styling');

            const colorInput = new TextInputBuilder()
                .setCustomId('color')
                .setLabel('Color (hex)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('#bcf1e4')
                .setValue(typeof data.color === 'string' ? data.color : '#bcf1e4')
                .setRequired(false);

            const footerInput = new TextInputBuilder()
                .setCustomId('footer')
                .setLabel('Footer Text')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Thanks for reading!')
                .setValue(typeof data.footer === 'string' ? data.footer : '')
                .setRequired(false);

            const footerIconInput = new TextInputBuilder()
                .setCustomId('footer_icon')
                .setLabel('Footer Icon URL (optional)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('{servericon}')
                .setValue(typeof data.footerIcon === 'string' ? data.footerIcon : '')
                .setRequired(false);

            modal.addComponents(
                new ActionRowBuilder().addComponents(colorInput),
                new ActionRowBuilder().addComponents(footerInput),
                new ActionRowBuilder().addComponents(footerIconInput)
            );
            await interaction.showModal(modal);
            return true;
        }

        if (customId === 'msgbuilder_colorless') {
            data.colorless = !data.colorless;
            builderData.set(key, data);

            const container = buildContainer(data, ctx);
            try {
                await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
            } catch (e) {
                if (interaction.message) {
                    await interaction.message.edit({ components: [container], flags: MessageFlags.IsComponentsV2 });
                    await interaction.reply({ content: `<:Commentblock:1521227898101432331> Colorless mode ${data.colorless ? 'enabled' : 'disabled'}!`, flags: MessageFlags.Ephemeral });
                }
            }
            return true;
        }

        if (customId === 'msgbuilder_image_position') {
            const current = data.imagePosition || 'bottom';
            data.imagePosition = current === 'bottom' ? 'top' : current === 'top' ? 'side' : 'bottom';
            builderData.set(key, data);

            const container = buildContainer(data, ctx);
            try {
                await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
            } catch (e) {
                if (interaction.message) {
                    await interaction.message.edit({ components: [container], flags: MessageFlags.IsComponentsV2 });
                    const posLabel = data.imagePosition === 'top' ? '<:Upload:1521228365120405537> Top' : data.imagePosition === 'side' ? '<:Caretright:1521227704953864202> Side' : '<:Download:1521228191899975810> Bottom';
                    await interaction.reply({ content: `<:Commentblock:1521227898101432331> Image position set to **${posLabel}**!`, flags: MessageFlags.Ephemeral });
                }
            }
            return true;
        }

        if (customId === 'msgbuilder_set_buttons') {
            const currentButtons = data.buttons || [];
            const currentActionBtns = data.actionButtons || [];
            const modal = new ModalBuilder()
                .setCustomId('msgbuilder_modal_buttons')
                .setTitle('Configure Buttons');

            const buttonsInput = new TextInputBuilder()
                .setCustomId('buttons')
                .setLabel('Link Buttons (Label | Emoji | URL)')
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder('Join Support | \ud83d\udc4b | https://discord.gg/example\nWebsite | https://example.com')
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
                .setValue(data.buttonPosition || 'bottom')
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

        if (customId === 'msgbuilder_show_variables') {
            const varsContent = `# <:Clipboard:1521228175298920448> Available Variables\n\n` +
                `### <:User:1521227714227343380> User\n\`{user}\` \`{username}\` \`{displayname}\` \`{userid}\` \`{useravatar}\`\n\n` +
                `### <:Server:1521228371051413546> Server\n\`{server}\` \`{servername}\` \`{serverid}\` \`{servericon}\` \`{membercount}\`\n\n` +
                `### <:Bullhorn:1521227936575914016> Channel\n\`{channel}\` \`{channelname}\`\n\n` +
                `### <:Sketch:1521228025365004471> Boost\n\`{boostcount}\` \`{boostlevel}\`\n\n` +
                `### <:Alarm:1521227869047750689> Time\n\`{date}\` \`{time}\` \`{timestamp}\`\n\n` +
                `### <:Plus:1521228180877217864> Separators (Components V2)\n\`{separator}\` \`{separator:small}\` \`{separator:medium}\` \`{separator:large}\`\n\n` +
                `### <:Picture:1521227954191995024> URL Variables\nUse \`{useravatar}\` or \`{servericon}\` in Thumbnail/Image fields!`;

            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(varsContent));

            await interaction.reply({
                components: [container],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
            });
            return true;
        }

        if (customId === 'msgbuilder_preview') {
            const mode = data.mode || 'components';

            if (mode === 'components') {
                if (!data.content) {
                    await interaction.reply({ content: '<:Cancel:1521227723916181644> Set content first!', flags: MessageFlags.Ephemeral });
                    return true;
                }
                const container = createPreviewContainer(data, interaction.user, interaction.guild, interaction.channel);
                await interaction.reply({
                    components: [container],
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
                });
            } else {
                if (!data.title && !data.description) {
                    await interaction.reply({ content: '<:Cancel:1521227723916181644> Set title or description first!', flags: MessageFlags.Ephemeral });
                    return true;
                }
                const embed = createPreviewEmbed(data, interaction.user, interaction.guild, interaction.channel);
                await interaction.reply({
                    content: '**Preview (Embed):**',
                    embeds: [embed],
                    flags: MessageFlags.Ephemeral
                });
            }
            return true;
        }

        if (customId === 'msgbuilder_send_here') {
            const mode = data.mode || 'components';

            try {
                if (mode === 'components') {
                    if (!data.content) {
                        await interaction.reply({ content: '<:Cancel:1521227723916181644> Set content first!', flags: MessageFlags.Ephemeral });
                        return true;
                    }
                    const container = createPreviewContainer(data, interaction.user, interaction.guild, interaction.channel);
                    await interaction.channel.send({ components: [container], flags: MessageFlags.IsComponentsV2 });
                } else {
                    if (!data.title && !data.description) {
                        await interaction.reply({ content: '<:Cancel:1521227723916181644> Set title or description first!', flags: MessageFlags.Ephemeral });
                        return true;
                    }
                    const embed = createPreviewEmbed(data, interaction.user, interaction.guild, interaction.channel);
                    await interaction.channel.send({ embeds: [embed] });
                }
                await interaction.reply({ content: '<:Checkedbox:1521227734943269077> Message sent!', flags: MessageFlags.Ephemeral });
            } catch (error) {
                await interaction.reply({ content: '<:Cancel:1521227723916181644> Failed to send message!', flags: MessageFlags.Ephemeral });
            }
            return true;
        }

        if (customId === 'msgbuilder_send_channel') {
            const modal = new ModalBuilder()
                .setCustomId('msgbuilder_modal_send_channel')
                .setTitle('Send to Channel');

            const channelInput = new TextInputBuilder()
                .setCustomId('channel_id')
                .setLabel('Channel ID')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('123456789012345678')
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(channelInput));
            await interaction.showModal(modal);
            return true;
        }

        if (customId === 'msgbuilder_reset') {
            builderData.set(key, { ...getDefaultData() });
            const container = buildContainer(getDefaultData(), ctx);
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
            return true;
        }

        if (customId === 'msgbuilder_add_field') {
            if ((data.fields?.length || 0) >= 25) {
                await interaction.reply({ content: '<:Cancel:1521227723916181644> Maximum 25 fields reached! Clear some fields first.', flags: MessageFlags.Ephemeral });
                return true;
            }
            const modal = new ModalBuilder()
                .setCustomId('msgbuilder_modal_add_field')
                .setTitle('Add Field');

            const nameInput = new TextInputBuilder()
                .setCustomId('field_name')
                .setLabel('Field Name')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Field Title')
                .setMaxLength(256)
                .setRequired(true);

            const valueInput = new TextInputBuilder()
                .setCustomId('field_value')
                .setLabel('Field Value')
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder('Field content here...')
                .setMaxLength(1024)
                .setRequired(true);

            const inlineInput = new TextInputBuilder()
                .setCustomId('field_inline')
                .setLabel('Inline? (yes/no)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('yes or no')
                .setValue('no')
                .setRequired(false);

            modal.addComponents(
                new ActionRowBuilder().addComponents(nameInput),
                new ActionRowBuilder().addComponents(valueInput),
                new ActionRowBuilder().addComponents(inlineInput)
            );
            await interaction.showModal(modal);
            return true;
        }

        if (customId === 'msgbuilder_clear_fields') {
            data.fields = [];
            builderData.set(key, data);
            const container = buildContainer(data, ctx);
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
            return true;
        }

        if (customId === 'msgbuilder_export_json') {
            const exportData = { ...data };
            delete exportData._internal;
            const json = JSON.stringify(exportData, null, 2);

            if (json.length > 1900) {
                const attachment = new AttachmentBuilder(Buffer.from(json, 'utf-8'), { name: 'message-builder.json' });
                await interaction.reply({ content: '<:Upload:1521228365120405537> **Exported builder data:**', files: [attachment], flags: MessageFlags.Ephemeral });
            } else {
                await interaction.reply({ content: `<:Upload:1521228365120405537> **Exported builder data:**\n\`\`\`json\n${json}\n\`\`\``, flags: MessageFlags.Ephemeral });
            }
            return true;
        }

        if (customId === 'msgbuilder_import_json') {
            const modal = new ModalBuilder()
                .setCustomId('msgbuilder_modal_import_json')
                .setTitle('Import JSON');

            const jsonInput = new TextInputBuilder()
                .setCustomId('json_data')
                .setLabel('Paste JSON Data')
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder('{"mode":"components","content":"Hello!","color":"#bcf1e4",...}')
                .setMaxLength(4000)
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(jsonInput));
            await interaction.showModal(modal);
            return true;
        }

        if (customId === 'msgbuilder_edit_message') {
            const modal = new ModalBuilder()
                .setCustomId('msgbuilder_modal_edit_message')
                .setTitle('Load Message for Editing');

            const messageIdInput = new TextInputBuilder()
                .setCustomId('message_id')
                .setLabel('Message ID')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Right-click a bot message - Copy Message ID')
                .setRequired(true);

            const channelIdInput = new TextInputBuilder()
                .setCustomId('channel_id')
                .setLabel('Channel ID (Optional)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Leave empty for current channel')
                .setRequired(false);

            modal.addComponents(
                new ActionRowBuilder().addComponents(messageIdInput),
                new ActionRowBuilder().addComponents(channelIdInput)
            );
            await interaction.showModal(modal);
            return true;
        }

        if (customId === 'msgbuilder_push_edit') {
            if (!data.editingMessageId) {
                await interaction.reply({ content: '<:Cancel:1521227723916181644> No message is loaded. Pick **Load an existing message** from the Preview or send menu first.', flags: MessageFlags.Ephemeral });
                return true;
            }
            const channel = interaction.guild.channels.cache.get(data.editingChannelId);
            if (!channel) {
                await interaction.reply({ content: '<:Cancel:1521227723916181644> The original channel was not found!', flags: MessageFlags.Ephemeral });
                return true;
            }
            try {
                const message = await channel.messages.fetch(data.editingMessageId);
                if (!message) {
                    await interaction.reply({ content: '<:Cancel:1521227723916181644> The original message was not found!', flags: MessageFlags.Ephemeral });
                    return true;
                }
                const mode = data.mode || 'components';
                if (mode === 'components') {
                    if (!data.content) {
                        await interaction.reply({ content: '<:Cancel:1521227723916181644> Set content first!', flags: MessageFlags.Ephemeral });
                        return true;
                    }
                    const container = createPreviewContainer(data, interaction.user, interaction.guild, channel);
                    await message.edit({ components: [container], flags: MessageFlags.IsComponentsV2 });
                } else {
                    if (!data.title && !data.description) {
                        await interaction.reply({ content: '<:Cancel:1521227723916181644> Set title or description first!', flags: MessageFlags.Ephemeral });
                        return true;
                    }
                    const embed = createPreviewEmbed(data, interaction.user, interaction.guild, channel);
                    await message.edit({ content: '', components: [], embeds: [embed] });
                }
                await interaction.reply({ content: '<:Checkedbox:1521227734943269077> Message updated successfully!', flags: MessageFlags.Ephemeral });
            } catch (error) {
                console.error('Push Edit Error:', error);
                await interaction.reply({ content: `<:Cancel:1521227723916181644> Failed to update: ${error.message}`, flags: MessageFlags.Ephemeral });
            }
            return true;
        }

        return false;
    },

    async handleModalSubmit(interaction) {
        if (!interaction.guild) return false;

        const customId = interaction.customId;
        if (!customId.startsWith('msgbuilder_modal_')) return false;

        const key = draftKey(interaction);
        let data = builderData.get(key) || { ...getDefaultData() };
        const ctx = { user: interaction.user, guild: interaction.guild, channel: interaction.channel };

        if (customId === 'msgbuilder_modal_content') {
            data.content = interaction.fields.getTextInputValue('content') || '';
            data.footer = interaction.fields.getTextInputValue('footer') || '';
            builderData.set(key, data);

            const container = buildContainer(data, ctx);
            try {
                if (interaction.message) {
                    await interaction.message.edit({ components: [container], flags: MessageFlags.IsComponentsV2 });
                }
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp({ content: '<:Checkedbox:1521227734943269077> Content updated!', flags: MessageFlags.Ephemeral });
                } else {
                    await interaction.reply({ content: '<:Checkedbox:1521227734943269077> Content updated!', flags: MessageFlags.Ephemeral });
                }
            } catch (e) {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: '<:Checkedbox:1521227734943269077> Content updated!', flags: MessageFlags.Ephemeral });
                }
            }
            return true;
        }

        if (customId === 'msgbuilder_modal_basic') {
            data.title = interaction.fields.getTextInputValue('title') || '';
            data.description = interaction.fields.getTextInputValue('description') || '';
            data.author = interaction.fields.getTextInputValue('author') || '';
            data.authorIcon = interaction.fields.getTextInputValue('author_icon') || '';
            builderData.set(key, data);

            const container = buildContainer(data, ctx);
            try {
                if (interaction.message) {
                    await interaction.message.edit({ components: [container], flags: MessageFlags.IsComponentsV2 });
                }
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp({ content: '<:Checkedbox:1521227734943269077> Title & Description updated!', flags: MessageFlags.Ephemeral });
                } else {
                    await interaction.reply({ content: '<:Checkedbox:1521227734943269077> Title & Description updated!', flags: MessageFlags.Ephemeral });
                }
            } catch (e) {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: '<:Checkedbox:1521227734943269077> Title & Description updated!', flags: MessageFlags.Ephemeral });
                }
            }
            return true;
        }

        if (customId === 'msgbuilder_modal_media') {
            const rawImages = interaction.fields.getTextInputValue('image') || '';
            const isComponents = (data.mode || 'components') === 'components';

            if (isComponents) {
                const parsed = rawImages
                    .split('\n')
                    .map(url => url.trim())
                    .filter(url => url.length > 0)
                    .slice(0, 10);
                data.images = parsed;
                delete data.image;
            } else {
                const firstUrl = rawImages.split('\n')[0]?.trim() || '';
                data.images = firstUrl ? [firstUrl] : [];
                delete data.image;
            }

            data.thumbnail = interaction.fields.getTextInputValue('thumbnail') || '';
            builderData.set(key, data);

            const imgCount = data.images?.length || 0;
            const confirmText = isComponents && imgCount > 0
                ? `<:Checkedbox:1521227734943269077> Media updated! **${imgCount}** image${imgCount > 1 ? 's' : ''} in gallery.`
                : '<:Checkedbox:1521227734943269077> Media updated!';

            const container = buildContainer(data, ctx);
            try {
                if (interaction.message) {
                    await interaction.message.edit({ components: [container], flags: MessageFlags.IsComponentsV2 });
                }
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp({ content: confirmText, flags: MessageFlags.Ephemeral });
                } else {
                    await interaction.reply({ content: confirmText, flags: MessageFlags.Ephemeral });
                }
            } catch (e) {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: confirmText, flags: MessageFlags.Ephemeral });
                }
            }
            return true;
        }

        if (customId === 'msgbuilder_modal_styling') {
            let color = (interaction.fields.getTextInputValue('color') || '#bcf1e4').trim();
            if (/^[0-9a-fA-F]{3,6}$/.test(color)) color = '#' + color;
            if (!/^#[0-9a-fA-F]{3,6}$/.test(color)) color = '#bcf1e4';
            data.color = color;
            data.footer = interaction.fields.getTextInputValue('footer') || '';
            data.footerIcon = interaction.fields.getTextInputValue('footer_icon') || '';
            builderData.set(key, data);

            const container = buildContainer(data, ctx);
            try {
                if (interaction.message) {
                    await interaction.message.edit({ components: [container], flags: MessageFlags.IsComponentsV2 });
                }
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp({ content: '<:Checkedbox:1521227734943269077> Styling updated!', flags: MessageFlags.Ephemeral });
                } else {
                    await interaction.reply({ content: '<:Checkedbox:1521227734943269077> Styling updated!', flags: MessageFlags.Ephemeral });
                }
            } catch (e) {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: '<:Checkedbox:1521227734943269077> Styling updated!', flags: MessageFlags.Ephemeral });
                }
            }
            return true;
        }

        if (customId === 'msgbuilder_modal_buttons') {
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

            data.buttons = buttons;
            data.actionButtons = actionButtons;
            data.buttonPosition = buttonPosition;
            builderData.set(key, data);

            const total = buttons.length + actionButtons.length;
            const container = buildContainer(data, ctx);
            try {
                if (interaction.message) {
                    await interaction.message.edit({ components: [container], flags: MessageFlags.IsComponentsV2 });
                }
                const msg = total > 0 ? `<:Checkedbox:1521227734943269077> ${total} button${total > 1 ? 's' : ''} configured!` : '<:Checkedbox:1521227734943269077> Buttons cleared!';
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp({ content: msg, flags: MessageFlags.Ephemeral });
                } else {
                    await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
                }
            } catch (e) {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: '<:Checkedbox:1521227734943269077> Buttons updated!', flags: MessageFlags.Ephemeral });
                }
            }
            return true;
        }

        if (customId === 'msgbuilder_modal_send_channel') {
            let channelId = interaction.fields.getTextInputValue('channel_id').trim();
            channelId = channelId.replace(/<#|>/g, '');

            const channel = interaction.guild.channels.cache.get(channelId);
            if (!channel) {
                await interaction.reply({ content: '<:Cancel:1521227723916181644> Invalid channel ID!', flags: MessageFlags.Ephemeral });
                return true;
            }

            const mode = data.mode || 'components';

            try {
                if (mode === 'components') {
                    if (!data.content) {
                        await interaction.reply({ content: '<:Cancel:1521227723916181644> Set content first!', flags: MessageFlags.Ephemeral });
                        return true;
                    }
                    const container = createPreviewContainer(data, interaction.user, interaction.guild, channel);
                    await channel.send({ components: [container], flags: MessageFlags.IsComponentsV2 });
                } else {
                    if (!data.title && !data.description) {
                        await interaction.reply({ content: '<:Cancel:1521227723916181644> Set title or description first!', flags: MessageFlags.Ephemeral });
                        return true;
                    }
                    const embed = createPreviewEmbed(data, interaction.user, interaction.guild, channel);
                    await channel.send({ embeds: [embed] });
                }
                await interaction.reply({ content: `<:Checkedbox:1521227734943269077> Message sent to <#${channelId}>!`, flags: MessageFlags.Ephemeral });
            } catch (error) {
                await interaction.reply({ content: '<:Cancel:1521227723916181644> Failed to send message!', flags: MessageFlags.Ephemeral });
            }
            return true;
        }

        if (customId === 'msgbuilder_modal_edit_message') {
            const messageId = interaction.fields.getTextInputValue('message_id').trim();
            const channelId = interaction.fields.getTextInputValue('channel_id').trim() || interaction.channelId;

            const channel = interaction.guild.channels.cache.get(channelId);
            if (!channel) {
                await interaction.reply({ content: '<:Cancel:1521227723916181644> Invalid channel ID!', flags: MessageFlags.Ephemeral });
                return true;
            }

            try {
                const message = await channel.messages.fetch(messageId);
                if (!message) {
                    await interaction.reply({ content: '<:Cancel:1521227723916181644> Message not found!', flags: MessageFlags.Ephemeral });
                    return true;
                }

                if (message.author.id !== interaction.client.user.id) {
                    await interaction.reply({ content: '<:Cancel:1521227723916181644> I can only edit my own messages!', flags: MessageFlags.Ephemeral });
                    return true;
                }

                const existingData = getDefaultData();
                existingData.editingMessageId = messageId;
                existingData.editingChannelId = channelId;

                const hasV2Container = message.components?.some(c => c.type === 17 || c.data?.type === 17);

                if (hasV2Container) {
                    existingData.mode = 'components';
                    const textParts = [];
                    for (const comp of message.components) {
                        if (comp.type === 17 || comp.data?.type === 17) {
                            const children = comp.components || comp.data?.components || [];
                            if (comp.data?.accent_color || comp.data?.accentColor) {
                                const ac = comp.data.accent_color || comp.data.accentColor;
                                existingData.color = '#' + (typeof ac === 'number' ? ac.toString(16).padStart(6, '0') : ac);
                            }
                            for (const child of children) {
                                const t = child.type || child.data?.type;
                                if (t === 10) {
                                    textParts.push(child.content || child.data?.content || '');
                                } else if (t === 14) {
                                    textParts.push('{separator}');
                                } else if (t === 12) {
                                    const items = child.items || child.data?.items || [];
                                    existingData.images = items
                                        .map(item => item.media?.url || item.data?.media?.url || '')
                                        .filter(Boolean);
                                } else if (t === 9) {
                                    const secChildren = child.components || child.data?.components || [];
                                    for (const sc of secChildren) {
                                        if ((sc.type || sc.data?.type) === 10) {
                                            textParts.push(sc.content || sc.data?.content || '');
                                        }
                                    }
                                    const acc = child.accessory || child.data?.accessory;
                                    if (acc && (acc.type === 11 || acc.data?.type === 11)) {
                                        existingData.thumbnail = acc.media?.url || acc.data?.media?.url || '';
                                    }
                                } else if (t === 1) {
                                    // ActionRow nested INSIDE the V2 container — extract
                                    // any link buttons so the user keeps them in the
                                    // builder and the "Buttons" config slot reflects
                                    // what's actually on the message. We only care
                                    // about link buttons here because non-link buttons
                                    // belong to the bot's interaction system and can't
                                    // round-trip through the builder safely.
                                    extractButtonsFromActionRow(child, existingData);
                                }
                            }
                        } else if (comp.type === 1 || comp.data?.type === 1) {
                            // ActionRow at the top level (sibling of the container).
                            extractButtonsFromActionRow(comp, existingData);
                        }
                    }
                    existingData.content = textParts.filter(Boolean).join('\n') || '';
                } else if (message.embeds && message.embeds.length > 0) {
                    const embed = message.embeds[0];
                    existingData.mode = 'embed';
                    existingData.title = embed.title || '';
                    existingData.description = embed.description || '';
                    existingData.color = embed.hexColor || '#bcf1e4';
                    existingData.images = embed.image?.url ? [embed.image.url] : [];
                    existingData.thumbnail = embed.thumbnail?.url || '';
                    existingData.footer = embed.footer?.text || '';
                    existingData.footerIcon = embed.footer?.iconURL || '';
                    existingData.author = embed.author?.name || '';
                    existingData.authorIcon = embed.author?.iconURL || '';
                    if (embed.fields?.length) {
                        existingData.fields = embed.fields.map(f => ({
                            name: f.name || '',
                            value: f.value || '',
                            inline: f.inline || false
                        }));
                    }
                    // Embeds may sit alongside top-level action rows for
                    // link buttons — pull those out the same way.
                    for (const comp of message.components || []) {
                        if (comp.type === 1 || comp.data?.type === 1) {
                            extractButtonsFromActionRow(comp, existingData);
                        }
                    }
                } else {
                    existingData.mode = 'components';
                    existingData.content = message.content || '';
                    for (const comp of message.components || []) {
                        if (comp.type === 1 || comp.data?.type === 1) {
                            extractButtonsFromActionRow(comp, existingData);
                        }
                    }
                }

                builderData.set(key, existingData);
                const container = buildContainer(existingData, ctx);
                await interaction.message.edit({ components: [container], flags: MessageFlags.IsComponentsV2 });
                await interaction.reply({ content: '<:Checkedbox:1521227734943269077> Message loaded into builder! Make your changes, then click **Push Edit** to save.', flags: MessageFlags.Ephemeral });
            } catch (error) {
                console.error('Edit Message Error:', error);
                await interaction.reply({ content: `<:Cancel:1521227723916181644> Failed to load message: ${error.message}`, flags: MessageFlags.Ephemeral });
            }
            return true;
        }

        if (customId === 'msgbuilder_modal_add_field') {
            const fieldName = interaction.fields.getTextInputValue('field_name') || '';
            const fieldValue = interaction.fields.getTextInputValue('field_value') || '';
            const inlineStr = (interaction.fields.getTextInputValue('field_inline') || 'no').toLowerCase().trim();
            const inline = inlineStr === 'yes' || inlineStr === 'true' || inlineStr === 'y';

            if (!fieldName || !fieldValue) {
                await interaction.reply({ content: '<:Cancel:1521227723916181644> Field name and value are required!', flags: MessageFlags.Ephemeral });
                return true;
            }

            if (!data.fields) data.fields = [];
            if (data.fields.length >= 25) {
                await interaction.reply({ content: '<:Cancel:1521227723916181644> Maximum 25 fields reached!', flags: MessageFlags.Ephemeral });
                return true;
            }

            data.fields.push({ name: fieldName, value: fieldValue, inline });
            builderData.set(key, data);

            const container = buildContainer(data, ctx);
            try {
                if (interaction.message) {
                    await interaction.message.edit({ components: [container], flags: MessageFlags.IsComponentsV2 });
                }
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp({ content: `<:Checkedbox:1521227734943269077> Field **${fieldName}** added! (${data.fields.length}/25)`, flags: MessageFlags.Ephemeral });
                } else {
                    await interaction.reply({ content: `<:Checkedbox:1521227734943269077> Field **${fieldName}** added! (${data.fields.length}/25)`, flags: MessageFlags.Ephemeral });
                }
            } catch (e) {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: `<:Checkedbox:1521227734943269077> Field **${fieldName}** added! (${data.fields.length}/25)`, flags: MessageFlags.Ephemeral });
                }
            }
            return true;
        }

        if (customId === 'msgbuilder_modal_import_json') {
            const jsonStr = interaction.fields.getTextInputValue('json_data') || '';

            try {
                const imported = JSON.parse(jsonStr);

                const allowedKeys = ['mode', 'content', 'title', 'description', 'color', 'image', 'images', 'thumbnail', 'footer', 'footerIcon', 'author', 'authorIcon', 'fields', 'colorless'];
                const sanitized = { ...getDefaultData() };

                for (const k of allowedKeys) {
                    if (imported[k] !== undefined) {
                        if (k === 'fields' && Array.isArray(imported[k])) {
                            sanitized.fields = imported[k].slice(0, 25).map(f => ({
                                name: String(f.name || '').substring(0, 256),
                                value: String(f.value || '').substring(0, 1024),
                                inline: !!f.inline
                            })).filter(f => f.name && f.value);
                        } else if (k === 'colorless') {
                            sanitized[k] = !!imported[k];
                        } else if (k === 'mode') {
                            sanitized[k] = imported[k] === 'embed' ? 'embed' : 'components';
                        } else if (k === 'color') {
                            let c = String(imported[k]).trim();
                            if (/^[0-9a-fA-F]{3,6}$/.test(c)) c = '#' + c;
                            sanitized[k] = /^#[0-9a-fA-F]{3,6}$/.test(c) ? c : '#bcf1e4';
                        } else {
                            sanitized[k] = String(imported[k]).substring(0, 4000);
                        }
                    }
                }

                builderData.set(key, sanitized);
                const container = buildContainer(sanitized, ctx);

                try {
                    if (interaction.message) {
                        await interaction.message.edit({ components: [container], flags: MessageFlags.IsComponentsV2 });
                    }
                    if (interaction.replied || interaction.deferred) {
                        await interaction.followUp({ content: '<:Checkedbox:1521227734943269077> JSON imported successfully!', flags: MessageFlags.Ephemeral });
                    } else {
                        await interaction.reply({ content: '<:Checkedbox:1521227734943269077> JSON imported successfully!', flags: MessageFlags.Ephemeral });
                    }
                } catch (e) {
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: '<:Checkedbox:1521227734943269077> JSON imported successfully!', flags: MessageFlags.Ephemeral });
                    }
                }
            } catch (e) {
                await interaction.reply({ content: '<:Cancel:1521227723916181644> Invalid JSON! Make sure it\'s valid JSON format.', flags: MessageFlags.Ephemeral });
            }
            return true;
        }

        return false;
    },
    builderData,
    builderSessions
};