const {
    SlashCommandBuilder, PermissionFlagsBits, MessageFlags,
    ContainerBuilder, TextDisplayBuilder,
    ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');

const jsonStore = require('../../utils/jsonStore');
const { ensureMigrated } = require('../../utils/ticketPanels');
const {
    E, COLOR, errorContainer, infoContainer, v2Reply,
} = require('../../utils/ticketUI');

/* ───────────────────────── store helpers ───────────────────────── */

function loadConfig() {
    if (!jsonStore.has('tickets')) {
        jsonStore.write('tickets', {});
        return {};
    }
    const data = jsonStore.read('tickets');
    if (Array.isArray(data)) {
        jsonStore.write('tickets', {});
        return {};
    }
    return data;
}

function saveConfig(config) {
    jsonStore.write('tickets', config);
}

const CATEGORY_ID_RE = /^[a-z0-9_-]{2,32}$/i;
const MAX_CATEGORIES = 25; // Discord select-menu hard cap

/* ──────────────────────── panel refresh ────────────────────────── */

/**
 * Refreshes every panel in this guild. Returns
 *   { total, refreshed, failed: [panelId, ...] }
 * so the caller can tell the admin exactly what happened.
 */
async function updateAllPanels(client, guildId) {
    // Lazy-require to avoid the circular import:
    //   ticket-setup → ticketPanels → ticket-categories.
    const { updatePanelMessage } = require('./ticket-setup');
    const config = loadConfig();
    const guildConfig = ensureMigrated(config[guildId]);
    const result = { total: 0, refreshed: 0, failed: [] };
    if (!guildConfig?.panels) return result;

    const panelIds = Object.keys(guildConfig.panels);
    result.total = panelIds.length;
    for (const panelId of panelIds) {
        const ok = await updatePanelMessage(client, guildId, panelId).catch(() => false);
        if (ok) result.refreshed++;
        else    result.failed.push(panelId);
    }
    return result;
}

/* ───────────────── panel-scoping awareness ─────────────────────── */

/**
 * For a newly added category, classify every panel into one of:
 *   - 'showing'   : panel.categoryIds is empty (so it shows the whole pool)
 *                   OR the panel already whitelisted this id
 *   - 'hidden'    : panel has a whitelist that doesn't include this id
 *
 * Returns { showing: [{id, label}], hidden: [{id, label}] }
 */
function classifyPanelsForCategory(guildConfig, categoryId) {
    const out = { showing: [], hidden: [] };
    for (const [panelId, panel] of Object.entries(guildConfig.panels || {})) {
        const entry = { id: panelId, label: panel.label || 'Untitled' };
        const wl = panel.categoryIds;
        if (!wl || wl.length === 0)        out.showing.push(entry);
        else if (wl.includes(categoryId))  out.showing.push(entry);
        else                               out.hidden.push(entry);
    }
    return out;
}

function panelLine(p) {
    return `${E.pin} **${p.label}** \`${p.id}\``;
}

/* ───────────────────────── render helpers ──────────────────────── */

function panelStatusLine(result) {
    if (!result || result.total === 0) {
        return `\n\n${E.info} *No panels exist yet — run \`/ticket-setup create\` to post your first panel.*`;
    }
    if (result.refreshed === result.total) {
        return `\n\n${E.ok} Refreshed **${result.refreshed}/${result.total}** panel${result.total === 1 ? '' : 's'}.`;
    }
    if (result.refreshed === 0) {
        return `\n\n${E.warn} *Couldn't refresh any panel. Check bot permissions in the panel channels, or re-run \`/ticket-setup create\`.*`;
    }
    return `\n\n${E.warn} Refreshed **${result.refreshed}/${result.total}** panels. Failed: ${result.failed.map(id => `\`${id}\``).join(', ')}.`;
}

function panelScopeBlock(guildConfig, categoryId) {
    const { showing, hidden } = classifyPanelsForCategory(guildConfig, categoryId);
    const lines = [];
    if (showing.length) {
        lines.push(`### ${E.ok} Showing on these panels (${showing.length})`);
        showing.forEach(p => lines.push(panelLine(p)));
    } else {
        lines.push(`### ${E.warn} Showing on **0** panels`);
    }
    if (hidden.length) {
        lines.push('');
        lines.push(`### ${E.info} Hidden on these panels (${hidden.length})`);
        lines.push(`*These panels have a category whitelist that doesn't include this category.*`);
        hidden.forEach(p => lines.push(panelLine(p)));
        lines.push('');
        lines.push(`${E.bulb} *Use* \`/ticket-categories assign category-id:${categoryId} panel-id:<id>\` *to add it to a specific panel.*`);
    }
    return lines.join('\n');
}

function buildAdded(guildConfig, category, total, refreshResult) {
    const text =
        `# ${E.ok} Category Added\n\n` +
        `${category.emoji} **${category.label}** \`${category.id}\`\n` +
        `> *${category.description}*\n\n` +
        `${E.pin} **Total Categories:** \`${total}/${MAX_CATEGORIES}\`\n\n` +
        panelScopeBlock(guildConfig, category.id) +
        panelStatusLine(refreshResult);
    return new ContainerBuilder()
        .setAccentColor(COLOR.SUCCESS)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
}

function buildRemoved(removed, total, refreshResult) {
    const text =
        `# ${E.cancel} Category Removed\n\n` +
        `${removed.emoji} **${removed.label}** \`${removed.id}\`\n\n` +
        `${E.pin} **Remaining Categories:** \`${total}\`` +
        panelStatusLine(refreshResult);
    return new ContainerBuilder()
        .setAccentColor(COLOR.WARNING)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
}

function buildEdited(category, changes, refreshResult) {
    const text =
        `# ${E.ok} Category Updated\n\n` +
        `${category.emoji} **${category.label}** \`${category.id}\`\n\n` +
        `### ${E.edit} Changes\n${changes.join('\n')}` +
        panelStatusLine(refreshResult);
    return new ContainerBuilder()
        .setAccentColor(COLOR.SUCCESS)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
}

function buildList(guildConfig) {
    const categories = guildConfig.categories || [];
    let text = `# ${E.bookopen} Ticket Categories (${categories.length})\n\n`;

    if (!categories.length) {
        text += `*No categories configured. Add one with* \`/ticket-categories add\` *or apply a preset with* \`/ticket-setup style\`.`;
    } else {
        text += categories.map((cat, i) => {
            const { showing } = classifyPanelsForCategory(guildConfig, cat.id);
            const panelsBlurb = showing.length === 0
                ? `*${E.warn} not visible on any panel*`
                : `*visible on ${showing.length} panel${showing.length === 1 ? '' : 's'}*`;
            return `${E.pin} **${i + 1}.** ${cat.emoji} **${cat.label}** \`${cat.id}\`\n` +
                   `> *${cat.description}* — ${panelsBlurb}`;
        }).join('\n\n');
    }

    if (categories.length >= MAX_CATEGORIES) {
        text += `\n\n${E.warn} *Discord caps select menus at ${MAX_CATEGORIES} options.*`;
    }

    // Quick reference for panel scoping
    const panels = Object.entries(guildConfig.panels || {});
    if (panels.length > 1) {
        text += `\n\n### ${E.bookopen} Tip — Panel Scoping\n`;
        text += `You have **${panels.length} panels**. Each panel can show all categories OR a specific subset.\n`;
        text += `${E.pin} See per-panel scoping: \`/ticket-setup panel-list\`\n`;
        text += `${E.pin} Assign a category to a panel: \`/ticket-categories assign\``;
    }

    return new ContainerBuilder()
        .setAccentColor(COLOR.BRAND)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
}

function buildAssignResult({ category, panel, action, refreshResult }) {
    const verb = action === 'assigned' ? 'Assigned to' : 'Unassigned from';
    const accent = action === 'assigned' ? COLOR.SUCCESS : COLOR.WARNING;
    const text =
        `# ${E.ok} Category ${action === 'assigned' ? 'Assigned' : 'Unassigned'}\n\n` +
        `${category.emoji} **${category.label}** \`${category.id}\`\n` +
        `${E.pin} **${verb}:** **${panel.label}** \`${panel.id}\`` +
        panelStatusLine(refreshResult);
    return new ContainerBuilder()
        .setAccentColor(accent)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
}

/* ──────────────── per-panel scoping logic ──────────────────────── */

/**
 * Add a category id to a single panel's whitelist.
 *
 * If the panel is currently using "all categories" (whitelist empty), we
 * snapshot the *current pool* into the whitelist before removing this
 * one, so that turning a panel into a scoped panel doesn't accidentally
 * expose every category.
 */
function panelHas(panel, categoryId) {
    if (!panel.categoryIds || panel.categoryIds.length === 0) return true; // implicit-all
    return panel.categoryIds.includes(categoryId);
}

function assignCategoryToPanel(guildConfig, panel, categoryId) {
    panel.categoryIds = panel.categoryIds || [];
    if (panel.categoryIds.length === 0) {
        // Panel was implicit-all. Adding a category to its whitelist is
        // a no-op semantically — it would still show. Make sure the
        // whitelist stays empty.
        return false;
    }
    if (!panel.categoryIds.includes(categoryId)) {
        panel.categoryIds.push(categoryId);
        return true;
    }
    return false;
}

function unassignCategoryFromPanel(guildConfig, panel, categoryId) {
    if (!panel.categoryIds || panel.categoryIds.length === 0) {
        // Panel was implicit-all. Switch it to an explicit whitelist of
        // the rest of the pool, minus the one we're removing.
        const pool = (guildConfig.categories || []).map(c => c.id).filter(id => id !== categoryId);
        panel.categoryIds = pool;
        return true;
    }
    const before = panel.categoryIds.length;
    panel.categoryIds = panel.categoryIds.filter(id => id !== categoryId);
    return panel.categoryIds.length !== before;
}

/* ─────────────────────────── command ──────────────────────────── */

module.exports = {
    category: 'automation',

    data: new SlashCommandBuilder()
        .setName('ticket-categories')
        .setDescription('Manage the categories shown in your ticket panels')
        .addSubcommand(s => s
            .setName('list')
            .setDescription('List all configured ticket categories and where they appear'))
        .addSubcommand(s => s
            .setName('add')
            .setDescription('Add a new ticket category to the pool (or to a specific panel)')
            .addStringOption(o => o.setName('id').setDescription('Unique ID (letters, numbers, dash, underscore)').setRequired(true))
            .addStringOption(o => o.setName('label').setDescription('Display label shown to users').setRequired(true))
            .addStringOption(o => o.setName('emoji').setDescription('Emoji prefix (unicode or custom)').setRequired(true))
            .addStringOption(o => o.setName('description').setDescription('Short description shown in the dropdown').setRequired(true))
            .addStringOption(o => o.setName('panel-id').setDescription('(Optional) Add only to this panel — see /ticket-setup panel-list').setRequired(false)))
        .addSubcommand(s => s
            .setName('remove')
            .setDescription('Remove a ticket category from the pool')
            .addStringOption(o => o.setName('id').setDescription('ID of the category to remove').setRequired(true)))
        .addSubcommand(s => s
            .setName('edit')
            .setDescription('Edit an existing ticket category')
            .addStringOption(o => o.setName('id').setDescription('ID of the category to edit').setRequired(true))
            .addStringOption(o => o.setName('label').setDescription('New display label').setRequired(false))
            .addStringOption(o => o.setName('emoji').setDescription('New emoji').setRequired(false))
            .addStringOption(o => o.setName('description').setDescription('New description').setRequired(false)))
        .addSubcommand(s => s
            .setName('assign')
            .setDescription('Show a category on a specific panel')
            .addStringOption(o => o.setName('category-id').setDescription('Category ID').setRequired(true))
            .addStringOption(o => o.setName('panel-id').setDescription('Panel ID — see /ticket-setup panel-list').setRequired(true)))
        .addSubcommand(s => s
            .setName('unassign')
            .setDescription('Hide a category on a specific panel')
            .addStringOption(o => o.setName('category-id').setDescription('Category ID').setRequired(true))
            .addStringOption(o => o.setName('panel-id').setDescription('Panel ID — see /ticket-setup panel-list').setRequired(true)))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .setDMPermission(false),

    async execute(interaction) {
        const config = loadConfig();
        const guildConfig = ensureMigrated(config[interaction.guild.id]);

        if (!guildConfig) {
            return interaction.reply({
                ...v2Reply(errorContainer('Ticket system is not configured. Run `/ticket-setup create` first.'), true),
            });
        }

        guildConfig.categories = guildConfig.categories || [];
        const subcommand = interaction.options.getSubcommand();

        /* ───────────── list ───────────── */
        if (subcommand === 'list') {
            return interaction.reply({
                components: [buildList(guildConfig)],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            });
        }

        /* ───────────── add ───────────── */
        if (subcommand === 'add') {
            const id          = interaction.options.getString('id').toLowerCase().trim();
            const label       = interaction.options.getString('label').trim().slice(0, 100);
            const emoji       = interaction.options.getString('emoji').trim();
            const description = interaction.options.getString('description').trim().slice(0, 100);
            const panelId     = interaction.options.getString('panel-id')?.trim() || null;

            if (!CATEGORY_ID_RE.test(id)) {
                return interaction.reply({
                    ...v2Reply(errorContainer('Category ID must be 2–32 chars and contain only letters, numbers, `-` and `_`.'), true),
                });
            }
            if (guildConfig.categories.length >= MAX_CATEGORIES) {
                return interaction.reply({
                    ...v2Reply(errorContainer(`You've reached the limit of **${MAX_CATEGORIES}** categories. Remove one before adding another.`), true),
                });
            }
            if (guildConfig.categories.find(cat => cat.id === id)) {
                return interaction.reply({
                    ...v2Reply(errorContainer(`A category with ID \`${id}\` already exists. Use \`/ticket-categories edit\` to change it.`), true),
                });
            }
            if (panelId && !guildConfig.panels?.[panelId]) {
                const list = Object.keys(guildConfig.panels || {}).map(p => `\`${p}\``).join(', ') || '*none*';
                return interaction.reply({
                    ...v2Reply(errorContainer(
                        `No panel found with ID \`${panelId}\`. Available panels: ${list}\n` +
                        `Use \`/ticket-setup panel-list\` to view details.`
                    ), true),
                });
            }

            const category = { id, label, emoji, description };
            guildConfig.categories.push(category);

            const panelEntries = Object.entries(guildConfig.panels || {});
            const panelCount = panelEntries.length;

            // If the admin scoped this to a specific panel, restrict every
            // *other* panel from showing it.
            if (panelId) {
                for (const [pid, panel] of panelEntries) {
                    if (pid === panelId) {
                        assignCategoryToPanel(guildConfig, panel, id);
                    } else {
                        if (!panel.categoryIds || panel.categoryIds.length === 0) {
                            // implicit-all → freeze to current pool minus this new id
                            panel.categoryIds = guildConfig.categories.map(c => c.id).filter(c => c !== id);
                        }
                    }
                }
                saveConfig(config);
                const refreshResult = await updateAllPanels(interaction.client, interaction.guild.id);
                return interaction.reply({
                    components: [buildAdded(guildConfig, category, guildConfig.categories.length, refreshResult)],
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                });
            }

            // No panel-id passed.
            //   - 0 panels → just save (no panels exist yet to update)
            //   - 1 panel  → save + update silently (the only panel shows it)
            //   - 2+ panels → save and prompt admin to pick which panels see it
            if (panelCount <= 1) {
                saveConfig(config);
                const refreshResult = await updateAllPanels(interaction.client, interaction.guild.id);
                return interaction.reply({
                    components: [buildAdded(guildConfig, category, guildConfig.categories.length, refreshResult)],
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                });
            }

            // Multiple panels exist — show a picker. We persist the new
            // category in the pool now (so it's not lost if the picker
            // times out) and let the picker tweak each panel's whitelist.
            saveConfig(config);

            const select = new StringSelectMenuBuilder()
                .setCustomId(`tcat_pick:${id}`)
                .setPlaceholder('Select which panel(s) should show this category')
                .setMinValues(0)
                .setMaxValues(panelCount)
                .addOptions(
                    panelEntries.map(([pid, p]) => {
                        const isImplicitAll = !p.categoryIds || p.categoryIds.length === 0;
                        return {
                            label: (p.label || 'Untitled').slice(0, 100),
                            value: pid,
                            description: `Channel: #${p.channelId} · ${isImplicitAll ? 'shows all categories' : `${p.categoryIds.length} cats`}`.slice(0, 100),
                            default: true, // pre-check all panels by default
                        };
                    })
                );

            const buttons = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`tcat_pick_all:${id}`)
                    .setLabel('Add to All Panels')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji(E.ok),
                new ButtonBuilder()
                    .setCustomId(`tcat_pick_cancel:${id}`)
                    .setLabel('Skip Scoping')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji(E.info),
            );

            return interaction.reply({
                components: [
                    new ContainerBuilder()
                        .setAccentColor(COLOR.BRAND)
                        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                            `# ${E.ok} Category Added to Pool\n\n` +
                            `${category.emoji} **${category.label}** \`${category.id}\`\n` +
                            `> *${category.description}*\n\n` +
                            `### ${E.bookopen} You have **${panelCount} panels**\n` +
                            `Choose which panel(s) should show this category. By default it will appear on **all panels** that show "all categories".\n\n` +
                            `${E.bulb} *Click* **Add to All Panels** *if you don't need scoping, or* **Skip Scoping** *to leave panel whitelists untouched.*`
                        )),
                    new ActionRowBuilder().addComponents(select),
                    buttons,
                ],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            });
        }

        /* ───────────── remove ───────────── */
        if (subcommand === 'remove') {
            const id = interaction.options.getString('id').toLowerCase().trim();
            const index = guildConfig.categories.findIndex(cat => cat.id === id);
            if (index === -1) {
                return interaction.reply({
                    ...v2Reply(errorContainer(`Category with ID \`${id}\` not found. Use \`/ticket-categories list\` to view IDs.`), true),
                });
            }

            const removed = guildConfig.categories.splice(index, 1)[0];

            // Drop the removed id from any per-panel whitelist so the
            // panel doesn't try to render a ghost option.
            for (const panel of Object.values(guildConfig.panels || {})) {
                if (panel.categoryIds?.length) {
                    panel.categoryIds = panel.categoryIds.filter(c => c !== id);
                }
            }
            saveConfig(config);

            const refreshResult = await updateAllPanels(interaction.client, interaction.guild.id);
            return interaction.reply({
                components: [buildRemoved(removed, guildConfig.categories.length, refreshResult)],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            });
        }

        /* ───────────── edit ───────────── */
        if (subcommand === 'edit') {
            const id          = interaction.options.getString('id').toLowerCase().trim();
            const newLabel    = interaction.options.getString('label');
            const newEmoji    = interaction.options.getString('emoji');
            const newDesc     = interaction.options.getString('description');

            const category = guildConfig.categories.find(cat => cat.id === id);
            if (!category) {
                return interaction.reply({
                    ...v2Reply(errorContainer(`Category with ID \`${id}\` not found.`), true),
                });
            }
            if (!newLabel && !newEmoji && !newDesc) {
                return interaction.reply({
                    ...v2Reply(errorContainer('Provide at least one of `label`, `emoji`, or `description` to update.'), true),
                });
            }

            const changes = [];
            if (newLabel) { category.label = newLabel.trim().slice(0, 100); changes.push(`${E.pin} **Label:** ${category.label}`); }
            if (newEmoji) { category.emoji = newEmoji.trim();                changes.push(`${E.pin} **Emoji:** ${category.emoji}`); }
            if (newDesc)  { category.description = newDesc.trim().slice(0, 100); changes.push(`${E.pin} **Description:** ${category.description}`); }

            saveConfig(config);
            const refreshResult = await updateAllPanels(interaction.client, interaction.guild.id);
            return interaction.reply({
                components: [buildEdited(category, changes, refreshResult)],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            });
        }

        /* ───────────── assign / unassign ───────────── */
        if (subcommand === 'assign' || subcommand === 'unassign') {
            const categoryId = interaction.options.getString('category-id').toLowerCase().trim();
            const panelId    = interaction.options.getString('panel-id').trim();

            const category = guildConfig.categories.find(c => c.id === categoryId);
            if (!category) {
                return interaction.reply({
                    ...v2Reply(errorContainer(`Category \`${categoryId}\` not found. See \`/ticket-categories list\`.`), true),
                });
            }
            const panel = guildConfig.panels?.[panelId];
            if (!panel) {
                const list = Object.keys(guildConfig.panels || {}).map(p => `\`${p}\``).join(', ') || '*none*';
                return interaction.reply({
                    ...v2Reply(errorContainer(
                        `Panel \`${panelId}\` not found. Available: ${list}\n` +
                        `See \`/ticket-setup panel-list\`.`
                    ), true),
                });
            }

            if (subcommand === 'assign') {
                // If the panel is implicit-all (no whitelist), assigning is a
                // no-op semantically — be honest about it so the admin doesn't
                // think they did something.
                const wasImplicitAll = !panel.categoryIds || panel.categoryIds.length === 0;
                if (wasImplicitAll) {
                    return interaction.reply({
                        ...v2Reply(infoContainer(
                            `Panel **${panel.label || panelId}** already shows **all** categories — \`${categoryId}\` is visible by default.\n\n` +
                            `*Use* \`/ticket-categories unassign\` *first if you want to switch this panel to a custom whitelist.*`
                        ), true),
                    });
                }
                const changed = assignCategoryToPanel(guildConfig, panel, categoryId);
                if (!changed) {
                    return interaction.reply({
                        ...v2Reply(infoContainer(
                            `Panel **${panel.label || panelId}** already shows \`${categoryId}\`.`
                        ), true),
                    });
                }
            } else {
                if (!panelHas(panel, categoryId)) {
                    return interaction.reply({
                        ...v2Reply(infoContainer(
                            `Panel **${panel.label || panelId}** doesn't currently show \`${categoryId}\`.`
                        ), true),
                    });
                }
                unassignCategoryFromPanel(guildConfig, panel, categoryId);
            }
            saveConfig(config);
            const refreshResult = await updateAllPanels(interaction.client, interaction.guild.id);
            return interaction.reply({
                components: [buildAssignResult({
                    category,
                    panel: { id: panelId, label: panel.label || 'Untitled' },
                    action: subcommand === 'assign' ? 'assigned' : 'unassigned',
                    refreshResult,
                })],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            });
        }
    },

    /* ────────────────────────── prefix ────────────────────────── */

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return message.reply({ ...v2Reply(errorContainer('You need **Manage Guild** permission to use this command.')) });
        }

        const config = loadConfig();
        const guildConfig = ensureMigrated(config[message.guild.id]);

        if (!guildConfig) {
            return message.reply({ ...v2Reply(errorContainer('Ticket system is not configured. Run `-ticket-setup` first.')) });
        }
        guildConfig.categories = guildConfig.categories || [];

        const subcommand = (args[0] || 'list').toLowerCase();

        /* ───────────── list ───────────── */
        if (subcommand === 'list') {
            return message.reply({
                components: [buildList(guildConfig)],
                flags: MessageFlags.IsComponentsV2,
            });
        }

        /* ───────────── add ───────────── */
        if (subcommand === 'add') {
            // Usage: -ticket-categories add <id> <emoji> "<label>" <description...>
            if (args.length < 5) {
                return message.reply({
                    ...v2Reply(infoContainer(
                        '**Usage:** `-ticket-categories add <id> <emoji> <label> <description>`\n' +
                        '**Example:** `-ticket-categories add billing 💰 "Billing Help" Refunds and invoices`\n\n' +
                        '*To scope to a specific panel, use the slash command:* `/ticket-categories add panel-id:<id>`'
                    )),
                });
            }

            const id    = args[1].toLowerCase();
            const emoji = args[2];
            // Allow quoted labels: `add billing 💰 "Billing Help" desc...`
            let labelArg = args[3];
            let descStart = 4;
            if (labelArg?.startsWith('"')) {
                const joined = args.slice(3).join(' ');
                const closing = joined.indexOf('"', 1);
                if (closing !== -1) {
                    labelArg = joined.slice(1, closing);
                    const consumed = (joined.slice(0, closing + 1).split(/\s+/) || []).length;
                    descStart = 3 + consumed;
                }
            }
            const label = labelArg.replace(/^"|"$/g, '').trim().slice(0, 100);
            const description = args.slice(descStart).join(' ').trim().slice(0, 100);

            if (!CATEGORY_ID_RE.test(id)) {
                return message.reply({
                    ...v2Reply(errorContainer('Category ID must be 2–32 chars and contain only letters, numbers, `-` and `_`.')),
                });
            }
            if (!description) {
                return message.reply({
                    ...v2Reply(errorContainer('Description is required.')),
                });
            }
            if (guildConfig.categories.length >= MAX_CATEGORIES) {
                return message.reply({
                    ...v2Reply(errorContainer(`You've reached the limit of **${MAX_CATEGORIES}** categories. Remove one before adding another.`)),
                });
            }
            if (guildConfig.categories.find(cat => cat.id === id)) {
                return message.reply({
                    ...v2Reply(errorContainer(`A category with ID \`${id}\` already exists.`)),
                });
            }

            const category = { id, label, emoji, description };
            guildConfig.categories.push(category);
            saveConfig(config);
            const refreshResult = await updateAllPanels(message.client, message.guild.id);

            return message.reply({
                components: [buildAdded(guildConfig, category, guildConfig.categories.length, refreshResult)],
                flags: MessageFlags.IsComponentsV2,
            });
        }

        /* ───────────── remove ───────────── */
        if (subcommand === 'remove') {
            if (args.length < 2) {
                return message.reply({ ...v2Reply(infoContainer('**Usage:** `-ticket-categories remove <id>`')) });
            }
            const id = args[1].toLowerCase();
            const index = guildConfig.categories.findIndex(cat => cat.id === id);
            if (index === -1) {
                return message.reply({ ...v2Reply(errorContainer(`Category with ID \`${id}\` not found.`)) });
            }
            const removed = guildConfig.categories.splice(index, 1)[0];

            for (const panel of Object.values(guildConfig.panels || {})) {
                if (panel.categoryIds?.length) {
                    panel.categoryIds = panel.categoryIds.filter(c => c !== id);
                }
            }
            saveConfig(config);
            const refreshResult = await updateAllPanels(message.client, message.guild.id);

            return message.reply({
                components: [buildRemoved(removed, guildConfig.categories.length, refreshResult)],
                flags: MessageFlags.IsComponentsV2,
            });
        }

        return message.reply({
            ...v2Reply(infoContainer(
                '**Subcommands:** `list`, `add`, `remove`\n' +
                '*Use `/ticket-categories edit | assign | unassign` for inline editing and panel scoping.*'
            )),
        });
    },

    /* ──────────────────── picker interaction handler ──────────── */

    /**
     * Called by index.js when the admin clicks the "Add to All Panels"
     * button, the "Skip Scoping" button, or finalizes the panel select
     * menu launched by `/ticket-categories add`.
     *
     * Returns true when the interaction was handled (so index.js can
     * stop dispatching), false otherwise.
     */
    async handleInteraction(interaction) {
        const id = interaction.customId || '';
        if (!id.startsWith('tcat_pick')) return false;

        const config = loadConfig();
        const guildConfig = ensureMigrated(config[interaction.guild.id]);
        if (!guildConfig) {
            await interaction.reply({
                ...v2Reply(errorContainer('Ticket system is not configured.'), true),
            }).catch(() => {});
            return true;
        }
        guildConfig.categories = guildConfig.categories || [];
        guildConfig.panels = guildConfig.panels || {};

        // tcat_pick:<categoryId>           — select menu
        // tcat_pick_all:<categoryId>       — "Add to All" button
        // tcat_pick_cancel:<categoryId>    — "Skip Scoping" button
        const [action, categoryId] = id.split(':');
        const category = guildConfig.categories.find(c => c.id === categoryId);
        if (!category) {
            await interaction.update({
                components: [errorContainer(`Category \`${categoryId}\` no longer exists.`)],
            }).catch(() => {});
            return true;
        }

        const panelEntries = Object.entries(guildConfig.panels);

        let chosen = [];
        if (action === 'tcat_pick_all') {
            chosen = panelEntries.map(([pid]) => pid);
        } else if (action === 'tcat_pick_cancel') {
            await interaction.update({
                components: [new ContainerBuilder()
                    .setAccentColor(COLOR.BRAND)
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                        `# ${E.ok} Category Added\n\n` +
                        `${category.emoji} **${category.label}** \`${category.id}\` is now in the pool.\n\n` +
                        `*Panel scoping was left untouched. Use* \`/ticket-categories assign\` *to surface it on a specific panel later.*`
                    ))],
            }).catch(() => {});
            return true;
        } else if (action === 'tcat_pick' && interaction.isStringSelectMenu()) {
            chosen = interaction.values || [];
        } else {
            return true;
        }

        // Apply scoping:
        //   - panels in `chosen`     → ensure category is visible
        //   - panels NOT in `chosen` → ensure category is hidden
        for (const [pid, panel] of panelEntries) {
            if (chosen.includes(pid)) {
                // Was implicit-all, leave as-is (it already shows everything)
                if (!panel.categoryIds || panel.categoryIds.length === 0) continue;
                if (!panel.categoryIds.includes(categoryId)) panel.categoryIds.push(categoryId);
            } else {
                // Hide
                if (!panel.categoryIds || panel.categoryIds.length === 0) {
                    // implicit-all → snapshot rest of pool
                    panel.categoryIds = guildConfig.categories.map(c => c.id).filter(c => c !== categoryId);
                } else {
                    panel.categoryIds = panel.categoryIds.filter(c => c !== categoryId);
                }
            }
        }
        saveConfig(config);

        // Refresh
        const refreshResult = await updateAllPanels(interaction.client, interaction.guild.id);

        await interaction.update({
            components: [new ContainerBuilder()
                .setAccentColor(COLOR.SUCCESS)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# ${E.ok} Category Scoped\n\n` +
                    `${category.emoji} **${category.label}** \`${category.id}\`\n\n` +
                    `${E.pin} **Visible on:** ${chosen.length === panelEntries.length
                        ? '*all panels*'
                        : (chosen.length === 0
                            ? '*no panels — admins can use* `/ticket-categories assign` *to surface it later*'
                            : chosen.map(p => `\`${p}\``).join(', '))}` +
                    panelStatusLine(refreshResult)
                ))],
        }).catch(() => {});
        return true;
    },
};
