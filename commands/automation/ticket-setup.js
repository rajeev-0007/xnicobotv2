const {
    SlashCommandBuilder, PermissionFlagsBits, ContainerBuilder, TextDisplayBuilder,
    ActionRowBuilder, StringSelectMenuBuilder, MessageFlags, ChannelType,
    SeparatorBuilder, SeparatorSpacingSize, EmbedBuilder
} = require('discord.js');
const {
    startMessageBuilderSession, handleButtonInteraction,
    handleModalSubmit: handleMsgBuilderModal,
    buildMessageBuilderPanel, extractPrefixFromCustomId,
    replacePlaceholders: msgReplace, buildComponentsV2Message,
} = require('../../utils/actionMessageBuilder');
const { checkAndExpire } = require('../../utils/panelExpiration');
const {
    readAll, saveAll, ensureMigrated, newPanelId,
    resolvePanelCategories,
} = require('../../utils/ticketPanels');

/* ───────────────────────────── presets ─────────────────────────── */

// Curated category presets — picked when admin runs `/ticket-setup style`.
// Each preset gives the panel its own personality plus appropriate categories.
const TICKET_PRESETS = {
    purchase: {
        label: 'Purchase / Sales Support',
        description: 'Optimized for storefronts, product help and billing tickets.',
        categories: [
            { id: 'purchase', label: 'Purchase Help',    emoji: '🛒', description: 'Help with buying or product info' },
            { id: 'billing',  label: 'Billing Issue',    emoji: '💳', description: 'Payment, invoices and refunds' },
            { id: 'product',  label: 'Product Support',  emoji: '📦', description: 'Issues with a delivered product' },
            { id: 'general',  label: 'General Question', emoji: '<:Hashtag:1521227771957870604>', description: 'Anything else we can help with' }
        ]
    },
    general: {
        label: 'General Server Support',
        description: 'Balanced setup for community servers.',
        categories: [
            { id: 'general', label: 'General Support', emoji: '<:Hashtag:1521227771957870604>',  description: 'General questions and help' },
            { id: 'bug',     label: 'Bug Report',      emoji: '🐛',                          description: 'Report a bug or glitch' },
            { id: 'feature', label: 'Feature Request', emoji: '<:Star:1521227981685526568>', description: 'Suggest an improvement' },
            { id: 'report',  label: 'User Report',     emoji: '🚨',                          description: 'Report a member or behavior' },
            { id: 'other',   label: 'Other',           emoji: '<:Edit:1521227886634205298>', description: "Anything that doesn't fit above" }
        ]
    },
    random: {
        label: 'Casual / Random',
        description: 'Light tone — for community/fun servers.',
        categories: [
            { id: 'chat',   label: 'Just Chat',      emoji: '💬', description: 'Hop in and chat with us' },
            { id: 'fun',    label: 'Fun Stuff',      emoji: '🎉', description: 'Suggestions, games, events' },
            { id: 'help',   label: 'Need Help',      emoji: '🆘', description: 'I need a hand with something' },
            { id: 'random', label: 'Other / Random', emoji: '<:Edit:1521227886634205298>', description: 'Whatever else you need' }
        ]
    },
    minimal: {
        label: 'Minimal',
        description: 'Just one button — opens a generic ticket.',
        categories: [
            { id: 'general', label: 'Open Ticket', emoji: '🎫', description: 'Open a private support ticket' }
        ]
    }
};

/* ─────────────────────── panel rendering ───────────────────────── */

/* ─────────────────────── safe coercers ─────────────────────────── */

// Discord.js builders throw "Received one or more errors" when given
// invalid colors or URLs. The values we feed them come from the V2
// message builder which is user-editable, so we sanitize aggressively
// — the alternative is that `/ticket-setup` (and any path that calls
// `buildPanelMessage`) crashes for the whole guild.

function safeColor(raw, fallback = 0xCAD7E6) {
    if (raw === null || raw === undefined || raw === '') return fallback;
    if (typeof raw === 'number') {
        return Number.isInteger(raw) && raw >= 0 && raw <= 0xFFFFFF ? raw : fallback;
    }
    const hex = String(raw).replace(/^#|^0x/i, '');
    if (!/^[0-9a-f]{6}$/i.test(hex) && !/^[0-9a-f]{3}$/i.test(hex)) return fallback;
    const expanded = hex.length === 3
        ? hex.split('').map(c => c + c).join('')
        : hex;
    const parsed = parseInt(expanded, 16);
    return Number.isInteger(parsed) && parsed >= 0 && parsed <= 0xFFFFFF ? parsed : fallback;
}

function safeUrl(raw) {
    if (!raw || typeof raw !== 'string') return undefined;
    try {
        const u = new URL(raw);
        return (u.protocol === 'http:' || u.protocol === 'https:') ? raw : undefined;
    } catch { return undefined; }
}

function safeFooter(opts) {
    if (!opts) return null;
    const text = (opts.text ?? '').toString().slice(0, 2048);
    if (!text) return null;
    const out = { text };
    const icon = safeUrl(opts.iconURL);
    if (icon) out.iconURL = icon;
    return out;
}

function safeAuthor(opts) {
    if (!opts) return null;
    const name = (opts.name ?? '').toString().slice(0, 256);
    if (!name) return null;
    const out = { name };
    const icon = safeUrl(opts.iconURL);
    if (icon) out.iconURL = icon;
    return out;
}

/**
 * Build a clean, validated select-menu option for a stored category.
 * Returns `null` if the category is unusable (missing id/label) so the
 * caller can skip it instead of letting discord.js throw a bulk validation
 * error that takes the whole panel down.
 */
function buildCategoryOption(cat) {
    if (!cat || typeof cat !== 'object') return null;
    const id = typeof cat.id === 'string' ? cat.id.trim() : '';
    const label = typeof cat.label === 'string' ? cat.label.trim() : '';
    if (!id || !label) return null;

    const opt = {
        label: label.slice(0, 100),
        value: id.slice(0, 100),
    };

    // Description is optional. Empty strings ARE rejected by Discord, so we
    // omit the field entirely when there's nothing meaningful to show.
    const description = typeof cat.description === 'string' ? cat.description.trim() : '';
    if (description) opt.description = description.slice(0, 100);

    const parsed = parseEmoji(cat.emoji);
    if (parsed) opt.emoji = parsed;

    return opt;
}

/**
 * Render the panel message body. Used for both initial send and live updates.
 * Returns a discord.js send/edit payload (with components + flags).
 *
 * Wrapped in a fallback so a corrupt user-saved `panelMessage` or category
 * never bricks the whole `/ticket-setup` flow: if the custom builder fails
 * for any reason, we strip the customizations and try again with the
 * default panel body.
 */
function buildPanelMessage(args) {
    try {
        return _buildPanelMessageInner(args);
    } catch (err) {
        console.error(`[ticket-setup] buildPanelMessage failed, falling back to default: ${err.message}`);
        const fallbackArgs = {
            ...args,
            panel:        { ...(args.panel || {}), panelMessage: null },
            guildConfig:  { ...args.guildConfig,   panelMessage: null },
        };
        return _buildPanelMessageInner(fallbackArgs);
    }
}

function _buildPanelMessageInner({ guildConfig, panel, panelId, supportRole, guild }) {
    const categories = resolvePanelCategories(guildConfig, panel);

    // Custom-id encodes the panel id so a single bot can host many panels.
    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`ticket_select:${panelId}`);

    // Sanitize every category up-front. Anything malformed is dropped so we
    // never hand discord.js an option it will reject.
    const validOptions = categories
        .slice(0, 25)
        .map(buildCategoryOption)
        .filter(Boolean);

    if (validOptions.length === 0) {
        // Either no categories yet, or every category we have is corrupt.
        // Surface a clear placeholder so the panel still renders, but block
        // ticket creation until admins add some.
        selectMenu
            .setPlaceholder('Please create new categories to add here')
            .setDisabled(true)
            .addOptions([{
                label: 'No categories available',
                value: '__none__',
                description: 'Admins: run /ticket-categories add'
            }]);
    } else {
        selectMenu
            .setPlaceholder('Select a ticket category to get help')
            .addOptions(validOptions);
    }

    const row = new ActionRowBuilder().addComponents(selectMenu);

    // Build the visible body — either a custom V2/embed/simple panel or our default.
    const panelConfig = panel?.panelMessage || guildConfig?.panelMessage || null;

    if (panelConfig?.mode === 'components') {
        const container = buildComponentsV2Message(panelConfig, null, guild, null);
        container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
        container.addActionRowComponents(row);
        return { components: [container], flags: MessageFlags.IsComponentsV2 };
    }

    if (panelConfig?.mode === 'embed') {
        const embed = new EmbedBuilder();
        if (panelConfig.title)       embed.setTitle(String(msgReplace(panelConfig.title, null, guild) || '').slice(0, 256));
        if (panelConfig.description) embed.setDescription(String(msgReplace(panelConfig.description, null, guild) || '').slice(0, 4096));
        embed.setColor(safeColor(panelConfig.color));
        const img   = safeUrl(panelConfig.image);     if (img)   embed.setImage(img);
        const thumb = safeUrl(panelConfig.thumbnail); if (thumb) embed.setThumbnail(thumb);
        if (panelConfig.author) {
            const author = safeAuthor({ name: msgReplace(panelConfig.author, null, guild), iconURL: panelConfig.authorIcon });
            if (author) embed.setAuthor(author);
        }
        if (panelConfig.footer) {
            const footer = safeFooter({ text: msgReplace(panelConfig.footer, null, guild), iconURL: panelConfig.footerIcon });
            if (footer) embed.setFooter(footer);
        }
        if (panelConfig.fields?.length) {
            for (const f of panelConfig.fields.slice(0, 25)) {
                embed.addFields({
                    name:  String(msgReplace(f.name, null, guild) || '\u200b').slice(0, 256),
                    value: String(msgReplace(f.value, null, guild) || '\u200b').slice(0, 1024),
                    inline: !!f.inline,
                });
            }
        }
        return { embeds: [embed], components: [row] };
    }

    if (panelConfig?.mode === 'simple' && panelConfig.content) {
        // Honor a custom panel color if the admin set one in the V2 builder.
        const accent = safeColor(panelConfig.color);
        const container = new ContainerBuilder()
            .setAccentColor(accent)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(msgReplace(panelConfig.content, null, guild)))
            .addActionRowComponents(row);
        return { components: [container], flags: MessageFlags.IsComponentsV2 };
    }

    // Default body
    const body = buildDefaultPanelContent({ supportRole, categories, panelLabel: panel?.label });
    const container = new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(body))
        .addActionRowComponents(row);
    return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

function buildDefaultPanelContent({ supportRole, categories, panelLabel }) {
    let content = `# <:Document:1521227875016114266> Support Tickets`;
    if (panelLabel && panelLabel !== 'Default') content += ` — ${panelLabel}`;
    content += `\n\n`;

    if (categories.length === 0) {
        content += `<:Inforect:1521228008285929532> **No ticket categories configured yet.**\n\n`;
        content += `Admins, add some with:\n`;
        content += `> \`/ticket-categories add <id> <label> <emoji> <description>\`\n\n`;
        content += `Or apply a preset with \`/ticket-setup style preset:<purchase|general|random|minimal>\`.\n\n`;
        if (supportRole) content += `**Support Team:** ${supportRole}`;
        return content;
    }

    content += `Need a hand? Pick a category from the dropdown below and we'll spin up a private channel for you.\n\n`;
    content += `### <:Bookopen:1521227911137595605> Available Categories\n`;
    for (const cat of categories) {
        const cleanLabel = cat.label.replace(/<:[^>]+>/g, '').trim();
        const showEmoji  = cat.emoji && !cat.emoji.startsWith('<') ? cat.emoji : '<:Caretright:1521227704953864202>';
        content += `${showEmoji} **${cleanLabel}**\n`;
        content += `> *${cat.description}*\n\n`;
    }
    content += `### <:Lightbulbalt:1521227880703463675> How It Works\n`;
    content += `<:Caretright:1521227704953864202> **1.** Select a category from the dropdown menu below\n`;
    content += `<:Caretright:1521227704953864202> **2.** A private channel is created — only you and staff can see it\n`;
    content += `<:Caretright:1521227704953864202> **3.** Describe your issue and our team will assist you\n\n`;
    if (supportRole) content += `**Support Team:** ${supportRole}`;
    return content;
}

/**
 * Parse a stored emoji string into a Discord select-option emoji shape.
 * Accepts unicode strings ("🐛"), custom emojis ("<:Name:123>" / "<a:Name:123>"),
 * or raw snowflake IDs ("123…"). Returns `null` for anything else so the
 * option is built without an emoji rather than with a value Discord will
 * reject (e.g. ":bug:", random text, empty string).
 *
 * Discord's restrictions:
 *   - Custom emojis MUST come with a snowflake `id`.
 *   - Built-in unicode emojis go in `name` only — but `name` for a custom
 *     emoji name without an `id` will throw "Invalid Form Body".
 */
function parseEmoji(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;

    // Custom emoji `<:name:id>` or animated `<a:name:id>`
    const customMatch = trimmed.match(/^<(a)?:([A-Za-z0-9_~]+):(\d{15,})>$/);
    if (customMatch) {
        return { id: customMatch[3], name: customMatch[2], animated: !!customMatch[1] };
    }

    // Bare snowflake id
    if (/^\d{15,}$/.test(trimmed)) return { id: trimmed };

    // Unicode emoji — accept anything that contains at least one char outside
    // the basic ASCII range (covers virtually every emoji codepoint), but
    // reject text-only strings like "bug" or ":bug:" which Discord rejects.
    if (/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2B00}-\u{2BFF}\u{1F900}-\u{1F9FF}]/u.test(trimmed)) {
        return { name: trimmed };
    }

    return null;
}

/* ────────────────── confirmation / status messages ───────────────── */

function buildSetupConfirmation({ panelChannel, ticketCategory, supportRole, panelLabel }) {
    return `# <:Checkedbox:1521227734943269077> Ticket Panel Created\n\n` +
        `Your panel is live. Users can open tickets from it as soon as you add categories.\n\n` +
        `### <:Document:1521227875016114266> Panel Summary\n` +
        `<:Caretright:1521227704953864202> **Panel Label:** \`${panelLabel}\`\n` +
        `<:Caretright:1521227704953864202> **Panel Channel:** ${panelChannel}\n` +
        `<:Caretright:1521227704953864202> **Ticket Category:** ${ticketCategory}\n` +
        `<:Caretright:1521227704953864202> **Support Role:** ${supportRole}\n\n` +
        `### <:Star:1521227981685526568> Next Steps\n` +
        `<:Caretright:1521227704953864202> Add categories: \`/ticket-categories add <id> <label> <emoji> <description>\`\n` +
        `<:Caretright:1521227704953864202> Or apply a preset: \`/ticket-setup style preset:purchase\`\n` +
        `<:Caretright:1521227704953864202> Configure transcripts: \`/ticket-setup transcript mode:auto log-channel:#logs\`\n\n` +
        `### <:Bookopen:1521227911137595605> Multiple Panels\n` +
        `<:Caretright:1521227704953864202> Add another panel: \`/ticket-setup panel-add channel:#sales label:Sales\`\n` +
        `<:Caretright:1521227704953864202> List panels: \`/ticket-setup panel-list\`\n` +
        `<:Caretright:1521227704953864202> Tie panel to specific categories: \`/ticket-setup panel-categories\``;
}

/* ─────────────────────── command builder ──────────────────────── */

module.exports = {
    /**
     * Premium-gated feature. `premiumOnly` is read by the
     * command dispatcher in index.js — non-premium users get a
     * polite premium-gate message instead of execution.
     *
     * Component-level guards (button / modal / select handlers) live
     * inside `handleInteraction` and `handleModalSubmit` below to
     * cover the case where premium expires while a panel is open.
     */
    premiumOnly: true,

    category: 'automation',
    data: new SlashCommandBuilder()
        .setName('ticket-setup')
        .setDescription('Setup the ticket support system with categorized ticket creation')
        .addSubcommand(s => s
            .setName('create')
            .setDescription('Create the first ticket panel (no categories until you add them)')
            .addChannelOption(o => o.setName('channel').setDescription('Channel where the ticket panel will be displayed').setRequired(true))
            .addChannelOption(o => o.setName('category').setDescription('Discord category where ticket channels will be created').setRequired(true))
            .addRoleOption(o => o.setName('support-role').setDescription('Role that can view and manage tickets').setRequired(true)))
        .addSubcommand(s => s
            .setName('panel-add')
            .setDescription('Add another ticket panel in a different channel (with its own categories)')
            .addChannelOption(o => o.setName('channel').setDescription('Channel where this panel will be posted').setRequired(true))
            .addStringOption(o => o.setName('label').setDescription('Short label so admins can identify this panel').setRequired(true))
            .addStringOption(o => o.setName('categories').setDescription('Comma-separated category IDs to expose (default: all)').setRequired(false))
            .addRoleOption(o => o.setName('support-role').setDescription('Override support role for this panel only').setRequired(false))
            .addChannelOption(o => o.setName('ticket-category').setDescription('Override Discord category for tickets opened from this panel').setRequired(false)))
        .addSubcommand(s => s
            .setName('panel-list')
            .setDescription('List all ticket panels configured in this server'))
        .addSubcommand(s => s
            .setName('panel-remove')
            .setDescription('Remove a ticket panel (deletes the panel message)')
            .addStringOption(o => o.setName('panel-id').setDescription('The panel ID (see /ticket-setup panel-list)').setRequired(true)))
        .addSubcommand(s => s
            .setName('panel-categories')
            .setDescription('Choose which categories a specific panel exposes')
            .addStringOption(o => o.setName('panel-id').setDescription('The panel ID (see /ticket-setup panel-list)').setRequired(true))
            .addStringOption(o => o.setName('categories').setDescription('Comma-separated category IDs (empty = show all)').setRequired(false)))
        .addSubcommand(s => s
            .setName('help')
            .setDescription('View detailed guide on the ticket system'))
        .addSubcommand(s => s
            .setName('message')
            .setDescription('Customize the welcome message sent when a ticket is opened'))
        .addSubcommand(s => s
            .setName('reset-message')
            .setDescription('Reset the ticket welcome message to default'))
        .addSubcommand(s => s
            .setName('panel')
            .setDescription('Customize the panel message displayed in the panel channel'))
        .addSubcommand(s => s
            .setName('reset-panel')
            .setDescription('Reset the ticket panel message to default'))
        .addSubcommand(s => s
            .setName('style')
            .setDescription('Apply a category preset to the category pool')
            .addStringOption(o => o.setName('preset').setDescription('Which category style to apply').setRequired(true)
                .addChoices(
                    { name: 'Purchase / Sales Support', value: 'purchase' },
                    { name: 'General Server Support',   value: 'general' },
                    { name: 'Casual / Random',          value: 'random' },
                    { name: 'Minimal (single button)',  value: 'minimal' }
                )))
        .addSubcommand(s => s
            .setName('transcript')
            .setDescription('Configure transcript saving for closed tickets')
            .addStringOption(o => o.setName('mode').setDescription('When to save transcripts').setRequired(true)
                .addChoices(
                    { name: 'Auto — save automatically when a ticket closes', value: 'auto' },
                    { name: 'Manual — only when staff click "Save Transcript"', value: 'manual' },
                    { name: 'Both — auto-save plus the manual button',         value: 'both' },
                    { name: 'Off — disable transcripts entirely',              value: 'off' }
                ))
            .addChannelOption(o => o.setName('log-channel').setDescription('Channel where transcripts are posted').setRequired(false)))
        .addSubcommand(s => s
            .setName('status')
            .setDescription('Inspect the current ticket system configuration'))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    /* ───────────────────────── routing ─────────────────────────── */

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        switch (subcommand) {
            case 'create':           return this.handleCreate(interaction);
            case 'panel-add':        return this.handlePanelAdd(interaction);
            case 'panel-list':       return this.handlePanelList(interaction);
            case 'panel-remove':     return this.handlePanelRemove(interaction);
            case 'panel-categories': return this.handlePanelCategories(interaction);
            case 'help':             return this.handleHelp(interaction);
            case 'message':          return this.handleMessage(interaction);
            case 'reset-message':    return this.handleResetMessage(interaction);
            case 'panel':            return this.handlePanel(interaction);
            case 'reset-panel':      return this.handleResetPanel(interaction);
            case 'style':            return this.handleStyle(interaction);
            case 'transcript':       return this.handleTranscript(interaction);
            case 'status':           return this.handleStatus(interaction);
        }
    },

    /* ────────────────────────── create ─────────────────────────── */

    async handleCreate(interaction) {
        const channel = interaction.options.getChannel('channel');
        const ticketCategory = interaction.options.getChannel('category');
        const supportRole = interaction.options.getRole('support-role');

        if (ticketCategory.type !== ChannelType.GuildCategory) {
            return interaction.reply({
                content: '<:Cancel:1521227723916181644> The **category** option must be a Discord category (folder icon), not a text channel.',
                flags: MessageFlags.Ephemeral
            });
        }

        if (![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) {
            return interaction.reply({
                content: '<:Cancel:1521227723916181644> The **channel** option must be a text channel.',
                flags: MessageFlags.Ephemeral
            });
        }

        // Preflight permission check — bail early before we mutate config.
        // Avoids the "old panel deleted, new panel never posted" trap when the
        // bot can't actually send messages in the target channel.
        const me = interaction.guild.members.me;
        const panelPerms = channel.permissionsFor(me);
        const required = ['ViewChannel', 'SendMessages', 'EmbedLinks'];
        const missing = required.filter(p => !panelPerms?.has(p));
        if (missing.length) {
            return interaction.reply({
                content: `<:Cancel:1521227723916181644> I'm missing **${missing.join(', ')}** in ${channel}. Grant those and try again.`,
                flags: MessageFlags.Ephemeral
            });
        }
        if (!me.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return interaction.reply({
                content: '<:Cancel:1521227723916181644> I need server-wide **Manage Channels** permission to create ticket channels.',
                flags: MessageFlags.Ephemeral
            });
        }

        const config = readAll();
        const existing = ensureMigrated(config[interaction.guild.id]);

        const guildConfig = {
            // Guild-level defaults (fall-throughs for panels that don't override)
            categoryId:     ticketCategory.id,
            supportRoleId:  supportRole.id,
            tickets:        existing?.tickets        || {},
            nextTicketNumber: existing?.nextTicketNumber || 0,
            // Fresh setup → empty category pool. Admins fill it via
            // /ticket-categories add or /ticket-setup style.
            categories:     existing?.categories     || [],
            transcriptMode: existing?.transcriptMode || 'manual',
            transcriptChannelId: existing?.transcriptChannelId || null,
            welcomeMessage: existing?.welcomeMessage,
            panelMessage:   existing?.panelMessage,
            panels:         existing?.panels || {},
        };

        // Reset any previously orphaned legacy single-panel data — the new
        // `panels` map is the source of truth from now on.
        delete guildConfig.channelId;
        delete guildConfig.panelMessageId;

        // The "default" panel is created on first setup; subsequent creates
        // overwrite it (re-posts the panel) but leave any other panels alone.
        const panelId = 'default';
        const renderArgs = {
            guildConfig,
            panel: {
                channelId: channel.id,
                label: 'Default',
                categoryIds: [],          // empty = expose entire pool
                supportRoleId: null,      // fall back to guild
                channelCategoryId: null,
                panelMessage: null,
            },
            panelId,
            supportRole,
            guild: interaction.guild,
        };

        // Send the *new* panel before tearing down the old one. If sending
        // fails, the old panel is still live and we can show an error.
        let panelMessage;
        try {
            panelMessage = await channel.send(buildPanelMessage(renderArgs));
        } catch (err) {
            return interaction.reply({
                content: `<:Cancel:1521227723916181644> Failed to post the panel in ${channel}: ${err.message}`,
                flags: MessageFlags.Ephemeral
            });
        }

        // Now tear down the old default panel (if any) — best-effort.
        const old = guildConfig.panels[panelId];
        if (old?.channelId && old?.messageId && old.messageId !== panelMessage.id) {
            try {
                const oldChan = await interaction.guild.channels.fetch(old.channelId).catch(() => null);
                const oldMsg  = oldChan ? await oldChan.messages.fetch(old.messageId).catch(() => null) : null;
                if (oldMsg) await oldMsg.delete().catch(() => null);
            } catch { /* non-fatal */ }
        }

        guildConfig.panels[panelId] = {
            channelId: channel.id,
            messageId: panelMessage.id,
            label: 'Default',
            categoryIds: [],
            supportRoleId: null,
            channelCategoryId: null,
            panelMessage: null,
        };

        config[interaction.guild.id] = guildConfig;
        saveAll(config);

        const setupContainer = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                buildSetupConfirmation({
                    panelChannel: channel,
                    ticketCategory,
                    supportRole,
                    panelLabel: 'Default',
                })
            ));
        await interaction.reply({ components: [setupContainer], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    },

    /* ───────────────────────── panel-add ───────────────────────── */

    async handlePanelAdd(interaction) {
        const channel = interaction.options.getChannel('channel');
        const label   = interaction.options.getString('label').trim().slice(0, 50);
        const catsRaw = interaction.options.getString('categories') || '';
        const supportRole = interaction.options.getRole('support-role');
        const ticketCategory = interaction.options.getChannel('ticket-category');

        if (![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) {
            return interaction.reply({
                content: '<:Cancel:1521227723916181644> The panel **channel** must be a text channel.',
                flags: MessageFlags.Ephemeral
            });
        }
        if (ticketCategory && ticketCategory.type !== ChannelType.GuildCategory) {
            return interaction.reply({
                content: '<:Cancel:1521227723916181644> **ticket-category** must be a Discord category.',
                flags: MessageFlags.Ephemeral
            });
        }

        // Preflight permissions in the panel channel
        const me = interaction.guild.members.me;
        const panelPerms = channel.permissionsFor(me);
        const required = ['ViewChannel', 'SendMessages', 'EmbedLinks'];
        const missing = required.filter(p => !panelPerms?.has(p));
        if (missing.length) {
            return interaction.reply({
                content: `<:Cancel:1521227723916181644> I'm missing **${missing.join(', ')}** in ${channel}. Grant those and try again.`,
                flags: MessageFlags.Ephemeral
            });
        }

        const config = readAll();
        const guildConfig = ensureMigrated(config[interaction.guild.id]);
        if (!guildConfig) {
            return interaction.reply({
                content: '<:Cancel:1521227723916181644> Run `/ticket-setup create` first to configure the base ticket system.',
                flags: MessageFlags.Ephemeral
            });
        }

        // Validate requested category IDs against the pool (silently drop unknowns)
        const pool = (guildConfig.categories || []).map(c => c.id);
        const requested = catsRaw.split(',').map(s => s.trim()).filter(Boolean);
        const categoryIds = requested.filter(id => pool.includes(id));
        const unknown = requested.filter(id => !pool.includes(id));

        const panelId = newPanelId();
        const panel = {
            channelId: channel.id,
            messageId: null,                    // populated after send
            label,
            categoryIds,                        // [] = expose all
            supportRoleId: supportRole?.id || null,
            channelCategoryId: ticketCategory?.id || null,
            panelMessage: null,
        };

        const guildSupportRole = guildConfig.supportRoleId ? interaction.guild.roles.cache.get(guildConfig.supportRoleId) : null;
        const panelSupportRole = supportRole || guildSupportRole;

        let sent;
        try {
            sent = await channel.send(buildPanelMessage({
                guildConfig,
                panel,
                panelId,
                supportRole: panelSupportRole,
                guild: interaction.guild,
            }));
        } catch (err) {
            return interaction.reply({
                content: `<:Cancel:1521227723916181644> Failed to send panel in ${channel}: ${err.message}`,
                flags: MessageFlags.Ephemeral
            });
        }

        panel.messageId = sent.id;
        guildConfig.panels = guildConfig.panels || {};
        guildConfig.panels[panelId] = panel;
        config[interaction.guild.id] = guildConfig;
        saveAll(config);

        const summary = new ContainerBuilder()
            .setAccentColor(0x57F287)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `# <:Checkedbox:1521227734943269077> Panel Added\n\n` +
                `### <:Document:1521227875016114266> Panel Details\n` +
                `<:Caretright:1521227704953864202> **ID:** \`${panelId}\`\n` +
                `<:Caretright:1521227704953864202> **Label:** \`${label}\`\n` +
                `<:Caretright:1521227704953864202> **Channel:** ${channel}\n` +
                `<:Caretright:1521227704953864202> **Categories:** ${categoryIds.length ? categoryIds.map(c => `\`${c}\``).join(', ') : '*all*'}\n` +
                `<:Caretright:1521227704953864202> **Support Role Override:** ${supportRole || '*none (uses default)*'}\n` +
                `<:Caretright:1521227704953864202> **Ticket Category Override:** ${ticketCategory || '*none (uses default)*'}\n` +
                (unknown.length ? `\n<:Inforect:1521228008285929532> Skipped unknown category IDs: ${unknown.map(c => `\`${c}\``).join(', ')}\n` : '') +
                `\n### <:Lightbulbalt:1521227880703463675> Next\n` +
                `<:Caretright:1521227704953864202> Edit which categories show: \`/ticket-setup panel-categories panel-id:${panelId}\`\n` +
                `<:Caretright:1521227704953864202> Remove panel: \`/ticket-setup panel-remove panel-id:${panelId}\``
            ));
        await interaction.reply({ components: [summary], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    },

    /* ──────────────────────── panel-list ───────────────────────── */

    async handlePanelList(interaction) {
        const config = readAll();
        const guildConfig = ensureMigrated(config[interaction.guild.id]);
        if (!guildConfig) {
            return interaction.reply({
                content: '<:Cancel:1521227723916181644> Ticket system is not set up yet — run `/ticket-setup create` first.',
                flags: MessageFlags.Ephemeral
            });
        }

        const panels = Object.entries(guildConfig.panels || {});
        const pool = guildConfig.categories || [];
        let body = `# <:Bookopen:1521227911137595605> Ticket Panels (${panels.length})\n\n`;

        if (!panels.length) {
            body += `*No panels yet. Run \`/ticket-setup create\` to add the first one.*`;
        } else {
            body += `*Each panel can show **all** categories or a curated subset. Use* \`/ticket-categories assign\` *to scope categories.*\n\n`;
            for (const [id, p] of panels) {
                // Resolve which categories are actually visible on this panel
                const visibleIds = (p.categoryIds && p.categoryIds.length)
                    ? p.categoryIds
                    : pool.map(c => c.id);
                const visibleCats = visibleIds
                    .map(cid => pool.find(c => c.id === cid))
                    .filter(Boolean);

                body += `### <:Caretright:1521227704953864202> ${p.label || 'Untitled'} \`${id}\`\n`;
                body += `<:Caretright:1521227704953864202> **Channel:** <#${p.channelId}>\n`;
                body += `<:Caretright:1521227704953864202> **Scope:** ${(p.categoryIds && p.categoryIds.length) ? `Custom (${p.categoryIds.length})` : '*All categories*'}\n`;
                if (visibleCats.length) {
                    body += `<:Caretright:1521227704953864202> **Showing:**\n`;
                    body += visibleCats.map(c => `  • ${c.emoji} **${c.label}** \`${c.id}\``).join('\n');
                    body += `\n`;
                } else {
                    body += `<:Inforect:1521228008285929532> *No categories visible — add some via* \`/ticket-categories add\` *or* \`/ticket-categories assign\`.\n`;
                }
                if (p.supportRoleId)     body += `<:Caretright:1521227704953864202> **Role Override:** <@&${p.supportRoleId}>\n`;
                if (p.channelCategoryId) body += `<:Caretright:1521227704953864202> **Ticket Category Override:** <#${p.channelCategoryId}>\n`;
                body += `\n`;
            }
        }

        await interaction.reply({
            components: [new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(body))],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
        });
    },

    /* ──────────────────────── panel-remove ─────────────────────── */

    async handlePanelRemove(interaction) {
        const panelId = interaction.options.getString('panel-id');
        const config = readAll();
        const guildConfig = ensureMigrated(config[interaction.guild.id]);
        if (!guildConfig?.panels?.[panelId]) {
            return interaction.reply({
                content: `<:Cancel:1521227723916181644> No panel found with ID \`${panelId}\`. Use \`/ticket-setup panel-list\` to see panels.`,
                flags: MessageFlags.Ephemeral
            });
        }

        const panel = guildConfig.panels[panelId];

        // Best-effort cleanup of the panel message
        try {
            const ch = await interaction.guild.channels.fetch(panel.channelId).catch(() => null);
            const msg = ch ? await ch.messages.fetch(panel.messageId).catch(() => null) : null;
            if (msg) await msg.delete().catch(() => null);
        } catch { /* non-fatal */ }

        delete guildConfig.panels[panelId];
        config[interaction.guild.id] = guildConfig;
        saveAll(config);

        const removedContainer = new ContainerBuilder()
            .setAccentColor(0xED4245)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `# <:Checkedbox:1521227734943269077> Panel Removed\n\n` +
                `<:Caretright:1521227704953864202> **Label:** \`${panel.label || 'Untitled'}\`\n` +
                `<:Caretright:1521227704953864202> **ID:** \`${panelId}\`\n` +
                `<:Caretright:1521227704953864202> **Channel:** <#${panel.channelId}>`
            ));
        await interaction.reply({
            components: [removedContainer],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        });
    },

    /* ───────────────────── panel-categories ────────────────────── */

    async handlePanelCategories(interaction) {
        const panelId = interaction.options.getString('panel-id');
        const catsRaw = interaction.options.getString('categories') || '';

        const config = readAll();
        const guildConfig = ensureMigrated(config[interaction.guild.id]);
        if (!guildConfig?.panels?.[panelId]) {
            return interaction.reply({
                content: `<:Cancel:1521227723916181644> No panel found with ID \`${panelId}\`.`,
                flags: MessageFlags.Ephemeral
            });
        }

        const pool = (guildConfig.categories || []).map(c => c.id);
        const requested = catsRaw.split(',').map(s => s.trim()).filter(Boolean);
        const categoryIds = requested.filter(id => pool.includes(id));
        const unknown = requested.filter(id => !pool.includes(id));

        guildConfig.panels[panelId].categoryIds = categoryIds;
        config[interaction.guild.id] = guildConfig;
        saveAll(config);

        // Live update
        const updated = await updatePanelMessage(interaction.client, interaction.guild.id, panelId);

        const exposing = categoryIds.length
            ? categoryIds.map(c => `\`${c}\``).join(', ')
            : '**all categories**';
        const lines = [
            `# <:Checkedbox:1521227734943269077> Panel Categories Updated\n`,
            `<:Caretright:1521227704953864202> **Panel:** \`${panelId}\``,
            `<:Caretright:1521227704953864202> **Now Exposing:** ${exposing}`,
        ];
        if (unknown.length) {
            lines.push(`\n<:Inforect:1521228008285929532> Ignored unknown IDs: ${unknown.map(c => `\`${c}\``).join(', ')}`);
        }
        if (!updated) {
            lines.push(`\n<:Inforect:1521228008285929532> *Couldn't auto-refresh the panel message — re-run \`/ticket-setup create\` if it looks stale.*`);
        }
        await interaction.reply({
            components: [new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')))],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        });
    },

    /* ─────────────────── style / transcript / status ───────────── */

    async handleStyle(interaction) {
        const config = readAll();
        const guildConfig = ensureMigrated(config[interaction.guild.id]);
        if (!guildConfig) {
            return interaction.reply({
                content: '<:Cancel:1521227723916181644> Run `/ticket-setup create` first.',
                flags: MessageFlags.Ephemeral
            });
        }
        const presetKey = interaction.options.getString('preset');
        const preset = TICKET_PRESETS[presetKey];
        if (!preset) {
            return interaction.reply({ content: '<:Cancel:1521227723916181644> Unknown preset.', flags: MessageFlags.Ephemeral });
        }

        guildConfig.categories = JSON.parse(JSON.stringify(preset.categories));

        // Drop any per-panel category-ID whitelist entries that no longer
        // exist in the pool. Otherwise panels keep referencing dead IDs
        // and silently render an empty dropdown.
        const newPoolIds = new Set(guildConfig.categories.map(c => c.id));
        for (const panel of Object.values(guildConfig.panels || {})) {
            if (panel.categoryIds?.length) {
                panel.categoryIds = panel.categoryIds.filter(id => newPoolIds.has(id));
            }
        }

        config[interaction.guild.id] = guildConfig;
        saveAll(config);

        // Refresh every panel — they may have shown empty placeholders
        let refreshed = 0;
        for (const panelId of Object.keys(guildConfig.panels || {})) {
            if (await updatePanelMessage(interaction.client, interaction.guild.id, panelId)) refreshed++;
        }

        const catList = guildConfig.categories
            .map(c => `${c.emoji} **${c.label}** — ${c.description}`)
            .join('\n');

        await interaction.reply({
            components: [new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# <:Checkedbox:1521227734943269077> Style Applied\n\n` +
                    `**Preset:** ${preset.label}\n` +
                    `${preset.description}\n\n` +
                    `### <:Bookopen:1521227911137595605> Category Pool\n${catList}\n\n` +
                    `<:Checkedbox:1521227734943269077> Refreshed **${refreshed}** panel${refreshed === 1 ? '' : 's'}.`
                ))],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
        });
    },

    async handleTranscript(interaction) {
        const config = readAll();
        const guildConfig = ensureMigrated(config[interaction.guild.id]);
        if (!guildConfig) {
            return interaction.reply({
                content: '<:Cancel:1521227723916181644> Run `/ticket-setup create` first.',
                flags: MessageFlags.Ephemeral
            });
        }
        const mode = interaction.options.getString('mode');
        const logChannel = interaction.options.getChannel('log-channel');

        if (logChannel && ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(logChannel.type)) {
            return interaction.reply({
                content: '<:Cancel:1521227723916181644> Transcript log channel must be a **text** channel.',
                flags: MessageFlags.Ephemeral
            });
        }

        // Validate channel + permissions for auto/both modes BEFORE saving.
        // Otherwise admins enable auto-transcripts that silently fail on
        // every close because the bot can't send/attach in the log channel.
        const wantsAuto = mode === 'auto' || mode === 'both';
        if (wantsAuto) {
            // No new channel passed AND no existing one set
            if (!logChannel && !guildConfig.transcriptChannelId) {
                return interaction.reply({
                    content: '<:Cancel:1521227723916181644> Auto-transcript needs a `log-channel`. Pass one with `log-channel:#channel`.',
                    flags: MessageFlags.Ephemeral
                });
            }

            // Verify the channel we're about to use is reachable + permissioned
            const targetId = logChannel?.id || guildConfig.transcriptChannelId;
            const target = await interaction.guild.channels.fetch(targetId).catch(() => null);
            if (!target) {
                return interaction.reply({
                    content: `<:Cancel:1521227723916181644> The configured transcript channel (\`${targetId}\`) was not found. Pass a fresh \`log-channel:\` to fix it.`,
                    flags: MessageFlags.Ephemeral
                });
            }
            const me = interaction.guild.members.me;
            const perms = target.permissionsFor(me);
            const required = ['ViewChannel', 'SendMessages', 'AttachFiles', 'EmbedLinks'];
            const missing = required.filter(p => !perms?.has(p));
            if (missing.length) {
                return interaction.reply({
                    content: `<:Cancel:1521227723916181644> I'm missing **${missing.join(', ')}** in ${target}. Grant those before enabling auto-transcripts.`,
                    flags: MessageFlags.Ephemeral
                });
            }
        }

        guildConfig.transcriptMode = mode;
        if (logChannel) guildConfig.transcriptChannelId = logChannel.id;
        config[interaction.guild.id] = guildConfig;
        saveAll(config);

        const desc = {
            auto:   'Transcripts are saved **automatically** when any ticket is closed.',
            manual: 'Transcripts are saved only when staff press the **Save Transcript** button.',
            both:   'Transcripts are saved **automatically on close** *and* via the manual button.',
            off:    'Transcript saving is **disabled**.',
        }[mode];
        const target = (mode === 'auto' || mode === 'both')
            ? `**Log Channel:** <#${guildConfig.transcriptChannelId}>`
            : `**Log Channel:** *(not used in this mode)*`;

        await interaction.reply({
            components: [new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# <:Checkedbox:1521227734943269077> Transcript Settings Saved\n\n` +
                    `**Mode:** \`${mode}\`\n` +
                    `${target}\n\n` +
                    `${desc}\n\n` +
                    `### <:Document:1521227875016114266> Output Format\n` +
                    `Transcripts are delivered as both \`.md\` and \`.html\`. All messages, attachments, and embeds are captured up to a 2,000-message limit.`
                ))],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
        });
    },

    async handleStatus(interaction) {
        const config = readAll();
        const guildConfig = ensureMigrated(config[interaction.guild.id]);
        if (!guildConfig) {
            return interaction.reply({
                content: '<:Cancel:1521227723916181644> Ticket system is not set up yet. Use `/ticket-setup create`.',
                flags: MessageFlags.Ephemeral
            });
        }

        // Resolve once so we can flag deleted/missing channels and roles
        const resolveChannel = (id) => {
            if (!id) return '*missing*';
            const ch = interaction.guild.channels.cache.get(id);
            return ch ? `<#${id}>` : `\`${id}\` *(deleted)*`;
        };
        const resolveRole = (id) => {
            if (!id) return '*missing*';
            const r = interaction.guild.roles.cache.get(id);
            return r ? `<@&${id}>` : `\`${id}\` *(deleted)*`;
        };

        const panels = Object.entries(guildConfig.panels || {});
        const panelLines = panels.length
            ? panels.map(([id, p]) => {
                const ch = interaction.guild.channels.cache.get(p.channelId);
                const chRef = ch ? `<#${p.channelId}>` : `\`${p.channelId}\` *(deleted)*`;
                const catCount = p.categoryIds?.length ? `${p.categoryIds.length} cats` : 'all cats';
                return `<:Caretright:1521227704953864202> **${p.label || 'Untitled'}** \`${id}\` → ${chRef} · ${catCount}`;
            }).join('\n')
            : '*none*';

        const cat        = resolveChannel(guildConfig.categoryId);
        const role       = resolveRole(guildConfig.supportRoleId);
        const tMode      = guildConfig.transcriptMode || 'manual';
        const tLog       = guildConfig.transcriptChannelId ? resolveChannel(guildConfig.transcriptChannelId) : '*not set*';
        const openTickets = Object.keys(guildConfig.tickets || {}).length;
        const totalIssued = guildConfig.nextTicketNumber || 0;

        const categoriesList = (guildConfig.categories || [])
            .map(c => `<:Caretright:1521227704953864202> ${c.emoji} **${c.label}** \`${c.id}\``)
            .join('\n') || '*none — add some with /ticket-categories add*';

        const welcomeStatus = guildConfig.welcomeMessage ? '<:Checkedbox:1521227734943269077> Custom' : '<:Edit:1521227886634205298> Default';
        const panelMsgStatus = guildConfig.panelMessage ? '<:Checkedbox:1521227734943269077> Custom' : '<:Edit:1521227886634205298> Default';

        await interaction.reply({
            components: [new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# <:Document:1521227875016114266> Ticket System Status\n\n` +
                    `### <:Settings:1521227767780343879> Defaults\n` +
                    `<:Caretright:1521227704953864202> **Ticket Category:** ${cat}\n` +
                    `<:Caretright:1521227704953864202> **Support Role:** ${role}\n\n` +
                    `### <:Bookopen:1521227911137595605> Panels (${panels.length})\n${panelLines}\n\n` +
                    `### <:Star:1521227981685526568> Category Pool (${(guildConfig.categories || []).length})\n${categoriesList}\n\n` +
                    `### <:Clipboardalt:1521228169753923755> Transcripts\n` +
                    `<:Caretright:1521227704953864202> **Mode:** \`${tMode}\`\n` +
                    `<:Caretright:1521227704953864202> **Log Channel:** ${tLog}\n\n` +
                    `### <:Edit:1521227886634205298> Customization\n` +
                    `<:Caretright:1521227704953864202> **Welcome Message:** ${welcomeStatus}\n` +
                    `<:Caretright:1521227704953864202> **Panel Message:** ${panelMsgStatus}\n\n` +
                    `### <:Hashtag:1521227771957870604> Activity\n` +
                    `<:Caretright:1521227704953864202> **Open Tickets:** \`${openTickets}\`\n` +
                    `<:Caretright:1521227704953864202> **Total Issued:** \`${totalIssued}\``
                ))],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
        });
    },

    /* ───────────────── welcome / panel builders ────────────────── */

    async handleMessage(interaction) {
        const config = readAll();
        const guildConfig = ensureMigrated(config[interaction.guild.id]);
        if (!guildConfig) {
            return interaction.reply({
                content: '<:Cancel:1521227723916181644> Run `/ticket-setup create` first.',
                flags: MessageFlags.Ephemeral
            });
        }
        const prefix = `ticketmsg:${interaction.guild.id}`;
        const data = startMessageBuilderSession(interaction.user.id, 'ticket', interaction.guild.id, 'welcome', 'Ticket Welcome Message');
        if (guildConfig.welcomeMessage) Object.assign(data, {
            mode: guildConfig.welcomeMessage.mode || 'simple',
            content: guildConfig.welcomeMessage.content || '',
            title: guildConfig.welcomeMessage.title || '',
            description: guildConfig.welcomeMessage.description || '',
            color: guildConfig.welcomeMessage.color || '#5865F2',
            image: guildConfig.welcomeMessage.image || '',
            thumbnail: guildConfig.welcomeMessage.thumbnail || '',
            footer: guildConfig.welcomeMessage.footer || '',
            footerIcon: guildConfig.welcomeMessage.footerIcon || '',
            author: guildConfig.welcomeMessage.author || '',
            authorIcon: guildConfig.welcomeMessage.authorIcon || '',
            fields: guildConfig.welcomeMessage.fields || [],
        });
        const container = buildMessageBuilderPanel(data, prefix, 'Ticket Welcome Message');
        await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    },

    async handlePanel(interaction) {
        const config = readAll();
        const guildConfig = ensureMigrated(config[interaction.guild.id]);
        if (!guildConfig) {
            return interaction.reply({
                content: '<:Cancel:1521227723916181644> Run `/ticket-setup create` first.',
                flags: MessageFlags.Ephemeral
            });
        }
        const prefix = `ticketpanel:${interaction.guild.id}`;
        const data = startMessageBuilderSession(interaction.user.id, 'ticketpanel', interaction.guild.id, 'panel', 'Ticket Panel Message');
        if (guildConfig.panelMessage) Object.assign(data, {
            mode: guildConfig.panelMessage.mode || 'simple',
            content: guildConfig.panelMessage.content || '',
            title: guildConfig.panelMessage.title || '',
            description: guildConfig.panelMessage.description || '',
            color: guildConfig.panelMessage.color || '#5865F2',
            image: guildConfig.panelMessage.image || '',
            thumbnail: guildConfig.panelMessage.thumbnail || '',
            footer: guildConfig.panelMessage.footer || '',
            footerIcon: guildConfig.panelMessage.footerIcon || '',
            author: guildConfig.panelMessage.author || '',
            authorIcon: guildConfig.panelMessage.authorIcon || '',
            fields: guildConfig.panelMessage.fields || [],
        });
        const container = buildMessageBuilderPanel(data, prefix, 'Ticket Panel Message');
        await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    },

    async handleResetPanel(interaction) {
        const config = readAll();
        const guildConfig = ensureMigrated(config[interaction.guild.id]);
        if (!guildConfig) {
            return interaction.reply({ content: '<:Cancel:1521227723916181644> Ticket system is not set up.', flags: MessageFlags.Ephemeral });
        }
        delete guildConfig.panelMessage;
        config[interaction.guild.id] = guildConfig;
        saveAll(config);
        let refreshed = 0;
        for (const panelId of Object.keys(guildConfig.panels || {})) {
            if (await updatePanelMessage(interaction.client, interaction.guild.id, panelId)) refreshed++;
        }
        await interaction.reply({
            components: [new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# <:Checkedbox:1521227734943269077> Panel Message Reset\n\n` +
                    `Panel message reverted to default. Refreshed **${refreshed}** panel${refreshed === 1 ? '' : 's'}.`
                ))],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
        });
    },

    async handleResetMessage(interaction) {
        const config = readAll();
        const guildConfig = ensureMigrated(config[interaction.guild.id]);
        if (!guildConfig) {
            return interaction.reply({ content: '<:Cancel:1521227723916181644> Ticket system is not set up.', flags: MessageFlags.Ephemeral });
        }
        delete guildConfig.welcomeMessage;
        config[interaction.guild.id] = guildConfig;
        saveAll(config);
        await interaction.reply({
            components: [new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# <:Checkedbox:1521227734943269077> Welcome Message Reset\n\n` +
                    `Default welcome will be used for all new tickets.`
                ))],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
        });
    },

    /* ──────────────────── builder button/modal routing ─────────── */

    async handleInteraction(interaction) {
        if (!interaction.isButton()) return false;

        // ── Premium gate (component-level) ─────────────────────────
        // The slash dispatcher gates `/ticket-setup` at command entry,
        // but the panel/welcome builder buttons live inside ephemeral
        // sessions that can outlive a guild's premium window. Re-validate
        // so the builder fails closed once the guild loses access.
        const prefixForPremium = extractPrefixFromCustomId(interaction.customId);
        if (prefixForPremium.startsWith('ticketpanel:') || prefixForPremium.startsWith('ticketmsg:')) {
            const premiumManager = require('../../utils/premiumManager');
            if (!premiumManager.hasPremiumAccess(interaction.user.id, interaction.guild?.id)) {
                const { buildPremiumGate } = require('../../utils/responseBuilder');
                await interaction.reply({
                    components: [buildPremiumGate('/ticket-setup')],
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                }).catch(() => {});
                return true;
            }
        }

        if (await checkAndExpire(interaction, 'config')) return true;
        const prefix = extractPrefixFromCustomId(interaction.customId);

        if (prefix.startsWith('ticketpanel:')) {
            const guildId = prefix.replace('ticketpanel:', '');
            const onSave = async (btnInteraction, data) => {
                const config = readAll();
                const guildConfig = ensureMigrated(config[guildId]);
                if (!guildConfig) {
                    return btnInteraction.update({ content: '<:Cancel:1521227723916181644> Ticket system not configured!', components: [] });
                }
                guildConfig.panelMessage = sanitizePanelMessageData(data);
                config[guildId] = guildConfig;
                saveAll(config);
                let refreshed = 0;
                for (const panelId of Object.keys(guildConfig.panels || {})) {
                    if (await updatePanelMessage(btnInteraction.client, guildId, panelId)) refreshed++;
                }
                await btnInteraction.update({
                    components: [new ContainerBuilder()
                        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                            `# <:Checkedbox:1521227734943269077> Panel Message Saved\n\n` +
                            `Refreshed **${refreshed}** panel${refreshed === 1 ? '' : 's'}.\n` +
                            `**Mode:** ${data.mode === 'embed' ? '<:Document:1521227875016114266> Embed' : data.mode === 'components' ? '<:Settings:1521227767780343879> Components V2' : '<:Hashtag:1521227771957870604> Simple'}\n\n` +
                            `Reset with \`/ticket-setup reset-panel\`.`
                        ))],
                    flags: MessageFlags.IsComponentsV2
                });
            };
            const onCancel = async (b) => b.update({ content: '<:Cancel:1521227723916181644> Panel builder cancelled.', components: [] });
            return await handleButtonInteraction(interaction, prefix, 'ticketpanel', guildId, 'panel', onSave, onCancel);
        }

        if (!prefix.startsWith('ticketmsg:')) return false;
        const guildId = prefix.replace('ticketmsg:', '');
        const onSave = async (btnInteraction, data) => {
            const config = readAll();
            const guildConfig = ensureMigrated(config[guildId]);
            if (!guildConfig) {
                return btnInteraction.update({ content: '<:Cancel:1521227723916181644> Ticket system not configured!', components: [] });
            }
            guildConfig.welcomeMessage = sanitizePanelMessageData(data);
            config[guildId] = guildConfig;
            saveAll(config);
            await btnInteraction.update({
                components: [new ContainerBuilder()
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                        `# <:Checkedbox:1521227734943269077> Welcome Message Saved\n\n` +
                        `**Mode:** ${data.mode === 'embed' ? '<:Document:1521227875016114266> Embed' : data.mode === 'components' ? '<:Settings:1521227767780343879> Components V2' : '<:Hashtag:1521227771957870604> Simple'}\n\n` +
                        `Will be sent on every new ticket.\n\n` +
                        `### <:Lightbulbalt:1521227880703463675> Placeholders\n` +
                        `\`{user}\` \`{username}\` \`{server}\` \`{timestamp}\` \`{membercount}\` \`{channel}\``
                    ))],
                flags: MessageFlags.IsComponentsV2
            });
        };
        const onCancel = async (b) => b.update({ content: '<:Cancel:1521227723916181644> Message builder cancelled.', components: [] });
        return await handleButtonInteraction(interaction, prefix, 'ticket', guildId, 'welcome', onSave, onCancel);
    },

    async handleModalSubmit(interaction) {
        const prefix = extractPrefixFromCustomId(interaction.customId);
        if (!prefix.startsWith('ticketpanel:') && !prefix.startsWith('ticketmsg:')) {
            return false;
        }

        // ── Premium gate (modal-level) ─────────────────────────────
        const premiumManager = require('../../utils/premiumManager');
        if (!premiumManager.hasPremiumAccess(interaction.user.id, interaction.guild?.id)) {
            const { buildPremiumGate } = require('../../utils/responseBuilder');
            await interaction.reply({
                components: [buildPremiumGate('/ticket-setup')],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            }).catch(() => {});
            return true;
        }

        if (prefix.startsWith('ticketpanel:')) {
            return handleMsgBuilderModal(interaction, prefix, 'ticketpanel', prefix.replace('ticketpanel:', ''), 'panel');
        }
        if (prefix.startsWith('ticketmsg:')) {
            return handleMsgBuilderModal(interaction, prefix, 'ticket', prefix.replace('ticketmsg:', ''), 'welcome');
        }
        return false;
    },

    /* ───────────────────────── help ─────────────────────────────── */

    async handleHelp(interaction) {
        await interaction.reply({
            components: [new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# <:Clipboard:1521228175298920448> Ticket System — Complete Guide\n\n` +
                    `Multi-panel ticket support with per-panel category scoping, presets, customizable messages, and full transcripts.\n\n` +
                    `### <:Settings:1521227767780343879> First-Time Setup\n` +
                    `<:Caretright:1521227704953864202> **1.** \`/ticket-setup create channel:#tickets category:Tickets support-role:@Support\`\n` +
                    `<:Caretright:1521227704953864202> **2.** Add categories: \`/ticket-categories add <id> <label> <emoji> <description>\`\n` +
                    `<:Caretright:1521227704953864202>      *(or)* \`/ticket-setup style preset:purchase\`\n` +
                    `<:Caretright:1521227704953864202> **3.** *(optional)* \`/ticket-setup transcript mode:auto log-channel:#logs\`\n\n` +
                    `### <:Bookopen:1521227911137595605> Multiple Panels\n` +
                    `<:Caretright:1521227704953864202> Add a second panel: \`/ticket-setup panel-add channel:#sales label:Sales categories:purchase,billing\`\n` +
                    `<:Caretright:1521227704953864202> List all panels (with their categories): \`/ticket-setup panel-list\`\n` +
                    `<:Caretright:1521227704953864202> Edit panel categories: \`/ticket-setup panel-categories panel-id:<id> categories:billing,product\`\n` +
                    `<:Caretright:1521227704953864202> Remove a panel: \`/ticket-setup panel-remove panel-id:<id>\`\n\n` +
                    `### <:Star:1521227981685526568> Per-Panel Category Scoping\n` +
                    `By default, every category in the pool is shown on **every** panel. To make a category appear only on a specific panel:\n` +
                    `<:Caretright:1521227704953864202> **Add to one panel only:** \`/ticket-categories add <id> <label> <emoji> <desc> panel-id:<id>\`\n` +
                    `<:Caretright:1521227704953864202> **Show existing on a panel:** \`/ticket-categories assign category-id:<cat> panel-id:<panel>\`\n` +
                    `<:Caretright:1521227704953864202> **Hide on a panel:** \`/ticket-categories unassign category-id:<cat> panel-id:<panel>\`\n` +
                    `<:Caretright:1521227704953864202> **See where each category appears:** \`/ticket-categories list\`\n\n` +
                    `### <:Star:1521227981685526568> Customize\n` +
                    `\`/ticket-setup style preset:<purchase|general|random|minimal>\`\n` +
                    `\`/ticket-setup panel\` — design the panel body (V2 builder)\n` +
                    `\`/ticket-setup message\` — design the in-ticket welcome\n` +
                    `\`/ticket-setup status\` — current configuration\n\n` +
                    `### <:Hashtag:1521227771957870604> User Flow\n` +
                    `<:Caretright:1521227704953864202> Pick a category from the dropdown\n` +
                    `<:Caretright:1521227704953864202> Get a private channel named \`category-username-N\` (e.g. \`general-rajeev-1\`)\n` +
                    `<:Caretright:1521227704953864202> Discuss with staff, share screenshots, etc.\n` +
                    `<:Caretright:1521227704953864202> Close → transcript saves automatically (if enabled)\n\n` +
                    `### <:Document:1521227875016114266> In-Ticket Commands\n` +
                    `\`/ticket-add @user\` — invite someone\n` +
                    `\`/ticket-remove @user\` — remove someone\n` +
                    `\`/ticket-close [reason]\` — close the ticket\n\n` +
                    `### <:Infotriangle:1521227710381428926> Required Bot Permissions\n` +
                    `Manage Channels • Manage Roles • Send Messages • Embed Links • Attach Files • Read Message History`
                ))],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
        });
    },

    /* ─────────────────────── prefix command ────────────────────── */

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return message.reply('<:Cancel:1521227723916181644> You need **Manage Guild** permission to use this command!');
        }
        const sub = args[0]?.toLowerCase();
        if (['message', 'panel', 'style', 'transcript', 'status', 'panel-add', 'panel-list', 'panel-remove', 'panel-categories'].includes(sub)) {
            return message.reply(`<:Inforect:1521228008285929532> The \`${sub}\` action is only available via slash command: \`/ticket-setup ${sub}\``);
        }
        if (sub === 'reset-message') {
            const config = readAll();
            const guildConfig = ensureMigrated(config[message.guild.id]);
            if (!guildConfig) return message.reply('<:Cancel:1521227723916181644> Ticket system is not set up.');
            delete guildConfig.welcomeMessage;
            config[message.guild.id] = guildConfig; saveAll(config);
            return message.reply({
                components: [new ContainerBuilder()
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                        `# <:Checkedbox:1521227734943269077> Welcome Message Reset\n\n` +
                        `Default welcome will be used for all new tickets.`
                    ))],
                flags: MessageFlags.IsComponentsV2,
            });
        }
        if (sub === 'reset-panel') {
            const config = readAll();
            const guildConfig = ensureMigrated(config[message.guild.id]);
            if (!guildConfig) return message.reply('<:Cancel:1521227723916181644> Ticket system is not set up.');
            delete guildConfig.panelMessage;
            config[message.guild.id] = guildConfig; saveAll(config);
            let refreshed = 0;
            for (const panelId of Object.keys(guildConfig.panels || {})) {
                if (await updatePanelMessage(message.client, message.guild.id, panelId)) refreshed++;
            }
            return message.reply({
                components: [new ContainerBuilder()
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                        `# <:Checkedbox:1521227734943269077> Panel Message Reset\n\n` +
                        `Panel reverted to default. Refreshed **${refreshed}** panel${refreshed === 1 ? '' : 's'}.`
                    ))],
                flags: MessageFlags.IsComponentsV2,
            });
        }
        if (!args.length || sub === 'help') {
            return message.reply({
                components: [new ContainerBuilder()
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                        `# <:Clipboard:1521228175298920448> Ticket System — Quick Setup\n\n` +
                        `### <:Document:1521227875016114266> Usage\n` +
                        `\`-ticket-setup #panel-channel #category @support-role\`\n\n` +
                        `Use \`/ticket-setup help\` for the full guide. Multi-panel features (\`panel-add\`, \`panel-list\`, etc.) are slash-only.`
                    ))],
                flags: MessageFlags.IsComponentsV2
            });
        }

        const channels = Array.from(message.mentions.channels.values());
        const role = message.mentions.roles.first();
        if (channels.length < 2 || !role) {
            return message.reply('<:Cancel:1521227723916181644> **Usage:** `-ticket-setup #panel-channel #category @support-role`');
        }
        const channel = channels[0];
        const category = channels[1];
        if (category.type !== ChannelType.GuildCategory) {
            return message.reply('<:Cancel:1521227723916181644> The second channel must be a **category** (folder icon).');
        }
        if (![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) {
            return message.reply('<:Cancel:1521227723916181644> The first channel must be a **text** channel.');
        }

        // Same preflight as the slash version: bail before mutating config
        // if the bot can't actually post in the panel channel.
        const me = message.guild.members.me;
        const panelPerms = channel.permissionsFor(me);
        const required = ['ViewChannel', 'SendMessages', 'EmbedLinks'];
        const missing = required.filter(p => !panelPerms?.has(p));
        if (missing.length) {
            return message.reply(`<:Cancel:1521227723916181644> I'm missing **${missing.join(', ')}** in ${channel}.`);
        }
        if (!me.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return message.reply('<:Cancel:1521227723916181644> I need server-wide **Manage Channels** permission to create ticket channels.');
        }

        const config = readAll();
        const existing = ensureMigrated(config[message.guild.id]);
        const guildConfig = {
            categoryId:    category.id,
            supportRoleId: role.id,
            tickets:           existing?.tickets || {},
            nextTicketNumber:  existing?.nextTicketNumber || 0,
            categories:        existing?.categories || [],
            transcriptMode:    existing?.transcriptMode || 'manual',
            transcriptChannelId: existing?.transcriptChannelId || null,
            welcomeMessage:    existing?.welcomeMessage,
            panelMessage:      existing?.panelMessage,
            panels:            existing?.panels || {},
        };

        // Send the new panel BEFORE deleting the old one, same trap-avoidance
        // as the slash-create handler.
        const renderArgs = {
            guildConfig,
            panel: { channelId: channel.id, label: 'Default', categoryIds: [], supportRoleId: null, channelCategoryId: null, panelMessage: null },
            panelId: 'default',
            supportRole: role,
            guild: message.guild,
        };
        let sent;
        try {
            sent = await channel.send(buildPanelMessage(renderArgs));
        } catch (err) {
            return message.reply(`<:Cancel:1521227723916181644> Failed to post the panel in ${channel}: ${err.message}`);
        }

        const old = guildConfig.panels.default;
        if (old?.channelId && old?.messageId && old.messageId !== sent.id) {
            try {
                const oldChan = await message.guild.channels.fetch(old.channelId).catch(() => null);
                const oldMsg  = oldChan ? await oldChan.messages.fetch(old.messageId).catch(() => null) : null;
                if (oldMsg) await oldMsg.delete().catch(() => null);
            } catch {}
        }

        guildConfig.panels.default = {
            channelId: channel.id,
            messageId: sent.id,
            label: 'Default',
            categoryIds: [],
            supportRoleId: null,
            channelCategoryId: null,
            panelMessage: null,
        };
        config[message.guild.id] = guildConfig;
        saveAll(config);

        await message.reply({
            components: [new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    buildSetupConfirmation({
                        panelChannel: channel, ticketCategory: category, supportRole: role, panelLabel: 'Default'
                    })
                ))],
            flags: MessageFlags.IsComponentsV2
        });
    },
};

/* ────────────────────────── helpers ────────────────────────────── */

function sanitizePanelMessageData(data) {
    return {
        mode:        data.mode,
        content:     data.content     || '',
        title:       data.title       || '',
        description: data.description || '',
        color:       data.color       || '#5865F2',
        image:       data.image       || '',
        thumbnail:   data.thumbnail   || '',
        footer:      data.footer      || '',
        footerIcon:  data.footerIcon  || '',
        author:      data.author      || '',
        authorIcon:  data.authorIcon  || '',
        fields:      data.fields      || [],
    };
}

/**
 * Re-render a specific panel's message with the latest config + categories.
 * Returns true on success. Stale or deleted panel messages are dropped from
 * the config so we don't keep retrying forever.
 *
 * Discord refuses `edit()` when a message changes shape (e.g. switching from
 * IsComponentsV2 to a regular embed message, or vice versa). In that case we
 * detect the API error, delete the stale panel, repost the new one, and
 * persist the new message id.
 */
async function updatePanelMessage(client, guildId, panelId) {
    const config = readAll();
    const guildConfig = ensureMigrated(config[guildId]);
    if (!guildConfig?.panels?.[panelId]) return false;

    const panel = guildConfig.panels[panelId];
    if (!panel.channelId || !panel.messageId) return false;

    try {
        const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
        if (!guild) {
            console.warn(`[ticket-setup] updatePanelMessage: guild ${guildId} unavailable`);
            return false;
        }
        const channel = await guild.channels.fetch(panel.channelId).catch(() => null);
        if (!channel || !channel.isTextBased()) {
            console.warn(`[ticket-setup] updatePanelMessage: channel ${panel.channelId} missing or non-text in guild ${guildId}`);
            return false;
        }

        // Editing the bot's own message only needs ViewChannel.
        // (SendMessages is checked separately when we have to delete+repost.)
        const me = guild.members.me;
        const perms = me ? channel.permissionsFor(me) : null;
        if (!perms?.has('ViewChannel')) {
            console.warn(`[ticket-setup] updatePanelMessage: missing ViewChannel in #${channel.name} (${guildId})`);
            return false;
        }

        const msg = await channel.messages.fetch(panel.messageId).catch(() => null);
        if (!msg) {
            // Message was deleted — clean up and tell the caller so the
            // admin can be informed and re-run /ticket-setup create.
            delete guildConfig.panels[panelId];
            config[guildId] = guildConfig;
            saveAll(config);
            console.warn(`[ticket-setup] updatePanelMessage: panel message ${panel.messageId} was deleted, dropping panel ${panelId}`);
            return false;
        }

        const supportRoleId = panel.supportRoleId || guildConfig.supportRoleId;
        const supportRole = supportRoleId ? await guild.roles.fetch(supportRoleId).catch(() => null) : null;

        const payload = buildPanelMessage({ guildConfig, panel, panelId, supportRole, guild });

        try {
            await msg.edit(payload);
            return true;
        } catch (editErr) {
            // Discord rejects edit() when the message changes shape between
            // IsComponentsV2 and a classic embed/content message. Detect
            // those error codes and fall back to delete+repost.
            const code = editErr?.code;
            const ml = String(editErr?.message || '').toLowerCase();
            const isShapeChange =
                code === 50006 || code === 50083 ||
                code === 200000 || code === 200001 ||
                ml.includes('components_v2') ||
                ml.includes('cannot edit') ||
                ml.includes('immutable');

            if (!isShapeChange) {
                console.error(`[ticket-setup] updatePanelMessage: edit failed in guild ${guildId} panel ${panelId}: ${editErr.message}`);
                return false;
            }

            // Re-post requires SendMessages too
            if (!perms?.has('SendMessages')) {
                console.warn(`[ticket-setup] updatePanelMessage: shape change required in guild ${guildId} but missing SendMessages in #${channel.name}`);
                return false;
            }

            await msg.delete().catch(() => null);
            const sent = await channel.send(payload).catch(err => {
                console.error(`[ticket-setup] updatePanelMessage: re-post failed in guild ${guildId} panel ${panelId}: ${err.message}`);
                return null;
            });
            if (!sent) return false;
            panel.messageId = sent.id;
            config[guildId] = guildConfig;
            saveAll(config);
            return true;
        }
    } catch (err) {
        console.error(`[ticket-setup] updatePanelMessage: unexpected error in guild ${guildId} panel ${panelId}: ${err.message}`);
        return false;
    }
}

// Export internals so commands/automation/ticket-categories.js can call updatePanelMessage
module.exports.updatePanelMessage = updatePanelMessage;
module.exports.TICKET_PRESETS = TICKET_PRESETS;


// Exported so the dashboard→bot action runner (utils/dashActionRunner.js) can
// post the ticket panel on the dashboard's behalf, reusing the exact builder
// the slash `create` path uses.
module.exports.buildPanelMessage = buildPanelMessage;
