'use strict';

const { SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder, StringSelectMenuBuilder, ActionRowBuilder, SeparatorBuilder, SeparatorSpacingSize, ButtonBuilder, ButtonStyle, SectionBuilder, ThumbnailBuilder, MediaGalleryBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { isOwner } = require('../../utils/helpers');
const ui = require('../../utils/basicUI');
const {
    NEW_COMMANDS,
    CATEGORY_GROUP_RULES,
    COMMAND_CATEGORY_MAP,
    FOLDER_FALLBACK,
    CATEGORY_META,
    CATEGORY_OPTIONS,
    CATEGORY_ALIASES,
} = require('../../utils/helpCategories');

const BANNER_URL = process.env.HELP_BANNER_URL || 'https://cdn.discordapp.com/attachments/1457289768462188677/1517460672818974750/file_0000000099d8720696beb125a10eb38c.png?ex=6a365ce1&is=6a350b61&hm=153b72d872e3e0d3eef56560dde3e44969eb9ce605b3f856b5a89ede15730721';
const SUPPORT_URL = process.env.SUPPORT_SERVER || 'https://discord.gg/Zs35X7Umak';
const INVITE_URL = `https://discord.com/oauth2/authorize?client_id=${process.env.CLIENT_ID}&permissions=8&scope=bot%20applications.commands`;
const VOTE_URL = process.env.VOTE_LINK || 'https://top.gg/bot/1409926557430190100/vote';
const WEBSITE_URL = 'https://thenico.vercel.app';
const MAX_HELP_SESSIONS = 500;

const NEW_EMOJI = '<:New:1521228236967907369>';
const BOT_LOGO_URL = process.env.BOT_LOGO_URL || 'https://cdn.discordapp.com/avatars/1409926557430190100/a_placeholder.png';

/* ─────────────────────────────────────────────────────────────
   HELPERS
   ───────────────────────────────────────────────────────────── */

function matchCommandByPatterns(commandName, group) {
    if (!group._set) group._set = new Set(group.cmds);
    return group._set.has(commandName);
}

/* ─────────────────────────────────────────────────────────────
   DYNAMIC CONTENT GENERATORS
   ───────────────────────────────────────────────────────────── */

function getCommandsByCategory(client) {
    const byCategory = {};
    const seen = new Set();

    for (const [name, cmd] of client.commands) {
        if (seen.has(cmd)) continue;
        seen.add(cmd);

        const cmdName = cmd.data?.name || cmd.prefix || name;
        const helpCat = COMMAND_CATEGORY_MAP.get(cmdName)
            || FOLDER_FALLBACK[cmd.category]
            || cmd.category
            || 'basic';

        if (!byCategory[helpCat]) byCategory[helpCat] = new Map();
        byCategory[helpCat].set(cmdName, cmd);
    }

    return byCategory;
}

/* ─────────────────────────────────────────────────────────────
   HOME PAGE — xNico-style vertical category list
   ───────────────────────────────────────────────────────────── */

function buildHomeContent(client, user) {
    const uniqueCommands = new Set(client.commands.values());
    const total = uniqueCommands.size;
    const guilds = client.guilds?.cache?.size ?? 0;
    const prefix = process.env.PREFIX || '-';

    const lines = [
        `## <:xnico:1521228240440660180>  xNico — Help Center`,
        `-# A Smarter Way to Manage Your Discord Community.`,
        ``,
        `<:Bookopen:1521227911137595605> **Getting Started**`,
        `<:Caretright:1521227704953864202> Pick a category from the dropdown below to view its commands.`,
        `<:Caretright:1521227704953864202> Both **slash** (\`/help\`) and **prefix** (\`${prefix}help\`) work everywhere.`,
        `<:Caretright:1521227704953864202> Hit **Search** to jump straight to any command by name.`,
        `<:Settings:1521227767780343879> **Need help?**`,
        `<:Caretright:1521227704953864202> Tap the **More options** menu for support, invite, vote, and search.`,
        ``,
    ];

    return lines.join('\n');
}


function buildCategoryPages(category, client) {
    const meta = CATEGORY_META[category];
    if (!meta) return [];

    const prefix = process.env.PREFIX || '-';
    const byCategory = getCommandsByCategory(client);
    const allCmds = byCategory[category] || new Map();
    const groupRules = CATEGORY_GROUP_RULES[category] || [];

    const header = `## ${meta.emoji}  ${meta.title}\n`;
    const subHeader = meta.footer
        ? `${meta.footer.replace('-# ', '| ')}\n`
        : '';
    const cmdCountLine = `-# ${allCmds.size} commands\n\n`;

    // Build command lines: `.command` · Description
    const lines = [];
    const assigned = new Set();
    const sortedNames = [...allCmds.keys()].sort((a, b) => a.localeCompare(b));

    for (const group of groupRules) {
        const cmdsInGroup = sortedNames.filter(name => !assigned.has(name) && matchCommandByPatterns(name, group));
        if (cmdsInGroup.length === 0) continue;
        cmdsInGroup.forEach(name => assigned.add(name));

        for (const name of cmdsInGroup) {
            const cmd = allCmds.get(name);
            const desc = cmd?.description || '';
            const newTag = NEW_COMMANDS.has(name) ? ` ${NEW_EMOJI}` : '';
            const shortDesc = desc.length > 65 ? desc.substring(0, 62) + '...' : desc;
            lines.push(`\`${prefix}${name}\` · ${shortDesc}${newTag}`);
        }
    }

    // Catch any unassigned commands
    const remaining = sortedNames.filter(n => !assigned.has(n));
    for (const name of remaining) {
        const cmd = allCmds.get(name);
        const desc = cmd?.description || '';
        const newTag = NEW_COMMANDS.has(name) ? ` ${NEW_EMOJI}` : '';
        const shortDesc = desc.length > 65 ? desc.substring(0, 62) + '...' : desc;
        lines.push(`\`${prefix}${name}\` · ${shortDesc}${newTag}`);
    }

    // Paginate — keep each page short for clean, easy-to-read display
    const MAX_LEN = 1200;
    const pages = [];
    let currentLines = [];
    let currentLen = header.length + subHeader.length + cmdCountLine.length + 10;

    for (const line of lines) {
        if (currentLen + line.length + 1 > MAX_LEN && currentLines.length > 0) {
            pages.push(header + subHeader + cmdCountLine + currentLines.join('\n'));
            currentLines = [];
            currentLen = header.length + subHeader.length + cmdCountLine.length + 10;
        }
        currentLines.push(line);
        currentLen += line.length + 1;
    }

    if (currentLines.length > 0) {
        pages.push(header + subHeader + cmdCountLine + currentLines.join('\n'));
    }

    return pages.length > 0 ? pages : [header + subHeader + cmdCountLine];
}

/* ─────────────────────────────────────────────────────────────
   ALL COMMANDS PAGE — every command across all categories
   ───────────────────────────────────────────────────────────── */

function buildAllCommandsPages(client, prefix, showOwner) {
    const byCategory = getCommandsByCategory(client);
    const pages = [];
    const catKeys = Object.keys(CATEGORY_META).filter(k => k !== 'owner' || showOwner);

    let currentLines = [];
    let currentLen = 0;
    const MAX_LEN = 1200;

    for (const cat of catKeys) {
        const meta = CATEGORY_META[cat];
        const cmds = byCategory[cat] || new Map();
        if (cmds.size === 0) continue;

        const sectionHeader = `\n${meta.emoji} **${meta.title}** — ${cmds.size}\n`;
        const cmdNames = [...cmds.keys()].sort();
        const cmdLine = cmdNames.map(n => `\`${n}\``).join(', ');

        const block = sectionHeader + cmdLine;

        if (currentLen + block.length + 1 > MAX_LEN && currentLines.length > 0) {
            pages.push(`## <:xnico:1521228240440660180>  All Commands\n` + currentLines.join('\n'));
            currentLines = [];
            currentLen = 0;
        }
        currentLines.push(block);
        currentLen += block.length + 1;
    }

    if (currentLines.length > 0) {
        pages.push(`## <:xnico:1521228240440660180>  All Commands\n` + currentLines.join('\n'));
    }

    return pages;
}

/* ─────────────────────────────────────────────────────────────
   PAGE ROUTER
   ───────────────────────────────────────────────────────────── */

function getCategoryPages(category, client, prefix, showOwner, user) {
    switch (category) {
        case 'home':
            return [buildHomeContent(client, user)];
        case 'all_commands':
            return buildAllCommandsPages(client, prefix, showOwner);
        default: {
            const pages = buildCategoryPages(category, client);
            return pages.length > 0 ? pages : [buildHomeContent(client, user)];
        }
    }
}

/* ─────────────────────────────────────────────────────────────
   UI BUILDER — Fluorine-inspired container layout
   ───────────────────────────────────────────────────────────── */

function buildHelpContainer(content, user, client, isHome = false, showOwner = false, pageInfo = null) {
    const container = new ContainerBuilder();

    // Main content with bot avatar thumbnail
    const avatarURL = isHome
        ? (client?.user?.displayAvatarURL?.({ size: 256 }) || user.displayAvatarURL({ size: 256 }))
        : user.displayAvatarURL({ size: 256 });

    const section = new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(avatarURL));
    container.addSectionComponents(section);

    // Separator
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

    // Banner (home only)
    if (isHome) {
        try {
            container.addMediaGalleryComponents(
                new MediaGalleryBuilder().addItems(item => item.setURL(BANNER_URL))
            );
        } catch { }
    }

    // Category dropdowns — split into two emoji-less menus for a cleaner look.
    const baseOptions = (showOwner ? CATEGORY_OPTIONS : CATEGORY_OPTIONS.filter(o => o.value !== 'owner'))
        .map(o => ({ label: o.label, description: o.description, value: o.value })); // strip emojis

    const home = baseOptions.find(o => o.value === 'home');
    const cats = baseOptions.filter(o => o.value !== 'home');
    const mid = Math.ceil(cats.length / 2);
    const firstHalf = cats.slice(0, mid);
    const secondHalf = cats.slice(mid);

    // Menu 1: Home + first half
    const menu1Options = home ? [home, ...firstHalf] : firstHalf;
    const selectMenu1 = new StringSelectMenuBuilder()
        .setCustomId('help_category')
        .setPlaceholder('Categories (1/2) — Music, Mod, Server…')
        .addOptions(menu1Options.slice(0, 25));
    container.addActionRowComponents(new ActionRowBuilder().addComponents(selectMenu1));

    // Menu 2: second half
    if (secondHalf.length > 0) {
        const selectMenu2 = new StringSelectMenuBuilder()
            .setCustomId('help_category2')
            .setPlaceholder('Categories (2/2) — Games, Anime, Economy…')
            .addOptions(secondHalf.slice(0, 25));
        container.addActionRowComponents(new ActionRowBuilder().addComponents(selectMenu2));
    }

    if (isHome) {
        // "More options" dropdown (home only — replaces buttons)
        const moreOptions = new StringSelectMenuBuilder()
            .setCustomId('help_more_options')
            .setPlaceholder('More options')
            .addOptions([
                { label: 'All Commands', description: 'View every command in one list', value: 'all_commands', emoji: { id: '1521228240440660180' } },
                { label: 'Search', description: 'Search for a specific command', value: 'search', emoji: { id: '1521228231263387738' } },
                { label: 'Website', description: 'Visit the xNico website', value: 'website', emoji: { id: '1521228339736482056' } },
                { label: 'Invite Bot', description: 'Add xNico to your server', value: 'invite', emoji: { id: '1521227936575914016' } },
                { label: 'Support Server', description: 'Join our support community', value: 'support', emoji: { id: '1521228008285929532' } },
                { label: 'Vote', description: 'Vote for xNico on top.gg', value: 'vote', emoji: { id: '1521228286813012169' } },
            ]);
        container.addActionRowComponents(new ActionRowBuilder().addComponents(moreOptions));
    } else {
        // Pagination (if multi-page)
        if (pageInfo && pageInfo.totalPages > 1) {
            container.addActionRowComponents(new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('help_prev').setLabel('Previous').setEmoji('<:Caretleft:1521227977495543838>').setStyle(ButtonStyle.Secondary).setDisabled(pageInfo.page === 0),
                new ButtonBuilder().setCustomId('help_page_indicator').setLabel(`${pageInfo.page + 1} / ${pageInfo.totalPages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
                new ButtonBuilder().setCustomId('help_next').setLabel('Next').setEmoji('<:Caretright:1521227704953864202>').setStyle(ButtonStyle.Secondary).setDisabled(pageInfo.page >= pageInfo.totalPages - 1),
            ));
        }

        // Category page action buttons
        container.addActionRowComponents(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('help_home').setLabel('Back').setEmoji('↩').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('help_search').setLabel('Search').setEmoji('<:Search:1521228231263387738>').setStyle(ButtonStyle.Primary),
        ));
    }

    // Branding footer with requester + timestamp
    const now = Math.floor(Date.now() / 1000);
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `-# <:xnico:1521228240440660180> xNico · Requested by ${user.username} · <t:${now}:R>`
    ));

    return container;
}

/* ─────────────────────────────────────────────────────────────
   SESSION TRACKING
   ───────────────────────────────────────────────────────────── */

const HELP_SESSION_TIMEOUT = 300000; // 5 minutes

function trackHelpSession(messageId, userId, channelId, showOwner = false, category = 'home', page = 0, editRef = null) {
    if (!global.helpMenuSessions) global.helpMenuSessions = new Map();
    if (!global.helpMenuTimeouts) global.helpMenuTimeouts = new Map();
    if (global.helpMenuSessions.size >= MAX_HELP_SESSIONS) {
        const oldest = [...global.helpMenuSessions.entries()]
            .sort((a, b) => a[1].createdAt - b[1].createdAt)
            .slice(0, Math.floor(MAX_HELP_SESSIONS / 4));
        for (const [key] of oldest) {
            global.helpMenuSessions.delete(key);
            const tid = global.helpMenuTimeouts.get(key);
            if (tid) { clearTimeout(tid); global.helpMenuTimeouts.delete(key); }
        }
    }
    // Clear any pre-existing timeout for this message
    const existingTimeout = global.helpMenuTimeouts.get(messageId);
    if (existingTimeout) clearTimeout(existingTimeout);

    global.helpMenuSessions.set(messageId, { createdAt: Date.now(), userId, channelId, showOwner, category, page, editRef });
    const timeoutId = setTimeout(async () => {
        await autoExpireHelpMessage(messageId);
    }, HELP_SESSION_TIMEOUT);
    global.helpMenuTimeouts.set(messageId, timeoutId);
}

function refreshHelpSession(messageId) {
    if (!global.helpMenuSessions || !global.helpMenuTimeouts) return;
    const session = global.helpMenuSessions.get(messageId);
    if (!session) return;

    // Reset the creation time so isSessionExpired won't trigger
    session.createdAt = Date.now();

    // Clear the old cleanup timer and start a new one
    const existingTimeout = global.helpMenuTimeouts.get(messageId);
    if (existingTimeout) clearTimeout(existingTimeout);
    const timeoutId = setTimeout(async () => {
        await autoExpireHelpMessage(messageId);
    }, HELP_SESSION_TIMEOUT);
    global.helpMenuTimeouts.set(messageId, timeoutId);
}

async function autoExpireHelpMessage(messageId) {
    const session = global.helpMenuSessions?.get(messageId);
    const editRef = session?.editRef;
    try {
        const expiredContainer = buildExpiredContainer();
        if (editRef) {
            if (typeof editRef.editReply === 'function') {
                await editRef.editReply({ components: [expiredContainer], flags: MessageFlags.IsComponentsV2 });
            } else if (typeof editRef.edit === 'function') {
                await editRef.edit({ components: [expiredContainer], flags: MessageFlags.IsComponentsV2 });
            }
        }
    } catch { }
    global.helpMenuSessions?.delete(messageId);
    global.helpMenuTimeouts?.delete(messageId);
}

function isSessionExpired(session) {
    return session && (Date.now() - session.createdAt > HELP_SESSION_TIMEOUT);
}

function buildExpiredContainer() {
    const now = Math.floor(Date.now() / 1000);
    const container = new ContainerBuilder();
    container.addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    );
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `## <:Lightning:1521227915537285150>  Help Menu Expired\n` +
            `This session timed out after **5 minutes** of inactivity.\n` +
            `-# Run \`/help\` or \`-help\` to open a fresh menu anytime.`
        )
    );
    container.addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    );
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `-# <:xnico:1521228240440660180> xNico · Expired <t:${now}:R>`
        )
    );
    return container;
}

/* ─────────────────────────────────────────────────────────────
   COMMAND MODULE
   ───────────────────────────────────────────────────────────── */

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Display bot commands and features')

        .addStringOption(option =>
            option.setName('category')
                .setDescription('Jump to a specific category')
                .setRequired(false)
                .addChoices(
                    { name: 'Music', value: 'music' },
                    { name: 'Voice', value: 'voice' },
                    { name: 'Moderation', value: 'moderation' },
                    { name: 'Security', value: 'security' },
                    { name: 'Messages', value: 'msgmod' },
                    { name: 'Server Mgmt', value: 'server' },
                    { name: 'Settings', value: 'settings' },
                    { name: 'Trust System', value: 'trust' },
                    { name: 'Automation', value: 'automation' },
                    { name: 'Components', value: 'components' },
                    { name: 'Invites', value: 'invites' },
                    { name: 'Members & Info', value: 'info' },
                    { name: 'Basic & Misc', value: 'basic' },
                    { name: 'Stats', value: 'stats' },
                    { name: 'Images', value: 'image' },
                    { name: 'Text & Encoding', value: 'encoding' },
                    { name: 'Fun', value: 'fun' },
                    { name: 'Action', value: 'action' },
                    { name: 'Economy', value: 'economy' },
                    { name: 'Social', value: 'social' },
                    { name: 'Leveling', value: 'leveling' },
                    { name: 'Backup & DB', value: 'backup' },
                    { name: 'Webhook', value: 'webhook' },
                )),

    prefix: 'help',
    aliases: ['h', 'commands', 'cmds'],
    description: 'Display bot commands and features',
    usage: 'help [category]',
    category: 'basic',
    dmAllowed: true,

    async execute(interaction) {
        try {
            if (!interaction.deferred && !interaction.replied) {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            }
        } catch (error) {
            return;
        }

        const prefix = process.env.PREFIX || '-';
        const showOwner = isOwner(interaction.user.id);
        const chosenCategory = interaction.options?.getString('category') ?? 'home';
        const pages = getCategoryPages(chosenCategory, interaction.client, prefix, showOwner, interaction.user);
        const pageInfo = pages.length > 1 ? { page: 0, totalPages: pages.length } : null;
        const container = buildHelpContainer(pages[0], interaction.user, interaction.client, chosenCategory === 'home', showOwner, pageInfo);

        try {
            await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            const reply = await interaction.fetchReply();
            trackHelpSession(reply.id, interaction.user.id, interaction.channelId || interaction.user.id, showOwner, chosenCategory, 0, interaction);
        } catch (error) {
            // Reply failed silently
        }
    },

    async executePrefix(message, args) {
        try {
            const prefix = message._guildPrefix || process.env.PREFIX || '-';
            const showOwner = isOwner(message.author.id);

            const validCategories = Object.keys(CATEGORY_META);

            let category = null;
            if (args.length > 0) {
                const input = args[0].toLowerCase();
                if (validCategories.includes(input)) {
                    category = input;
                } else if (CATEGORY_ALIASES[input]) {
                    category = CATEGORY_ALIASES[input];
                }

                if (category === 'owner' && !showOwner) {
                    category = null;
                }
            }

            const effectiveCategory = category || 'home';
            const pages = getCategoryPages(effectiveCategory, message.client, prefix, showOwner, message.author);
            const pageInfo = pages.length > 1 ? { page: 0, totalPages: pages.length } : null;
            const container = buildHelpContainer(pages[0], message.author, message.client, effectiveCategory === 'home', showOwner, pageInfo);

            const reply = await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            trackHelpSession(reply.id, message.author.id, message.channelId || message.author.id, showOwner, effectiveCategory, 0, reply);
        } catch (error) {
            console.error('[Help Prefix Error]', error.message);
            await message.reply('<:Cancel:1521227723916181644> Failed to load help menu. Please try `/help` instead.').catch(() => { });
        }
    },

    async handleButton(interaction) {
        const customId = interaction.customId;
        if (!customId.startsWith('help_')) return false;

        if (!global.helpMenuSessions) global.helpMenuSessions = new Map();
        const session = global.helpMenuSessions.get(interaction.message.id);

        // If session exists, only the original user can interact
        if (session && session.userId !== interaction.user.id) {
            await interaction.reply({
                content: '<:Cancel:1521227723916181644> This menu belongs to someone else. Use `/help` to open your own.',
                flags: MessageFlags.Ephemeral,
            });
            return true;
        }

        // No session (cleaned up by timeout) or session expired → show expired
        if (!session || isSessionExpired(session)) {
            if (customId === 'help_search') {
                // Search modal requires showing modal as first response, but menu is expired
                await interaction.reply({
                    content: '<:Cancel:1521227723916181644> This help menu has expired. Use `/help` to open a new one.',
                    flags: MessageFlags.Ephemeral,
                });
            } else {
                await interaction.update({ components: [buildExpiredContainer()], flags: MessageFlags.IsComponentsV2 }).catch(() => { });
            }
            if (session) {
                global.helpMenuSessions.delete(interaction.message.id);
                const tid = global.helpMenuTimeouts?.get(interaction.message.id);
                if (tid) { clearTimeout(tid); global.helpMenuTimeouts.delete(interaction.message.id); }
            }
            return true;
        }

        // Refresh session timer on every valid interaction
        refreshHelpSession(interaction.message.id);

        // Search modal must be shown as first response (cannot defer)
        if (customId === 'help_search') {
            const modal = new ModalBuilder()
                .setCustomId('help_search_modal')
                .setTitle('Search Commands');

            const searchInput = new TextInputBuilder()
                .setCustomId('search_query')
                .setLabel('Enter command name or keyword')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('e.g. ban, music, welcome, play...')
                .setMaxLength(100)
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(searchInput));
            await interaction.showModal(modal);
            return true;
        }

        const prefix = process.env.PREFIX || '-';
        const showOwner = session?.showOwner || isOwner(interaction.user.id);
        const currentSession = global.helpMenuSessions.get(interaction.message.id);

        // Pagination buttons
        if (customId === 'help_prev' || customId === 'help_next') {
            const cat = currentSession?.category || 'home';
            const curPage = currentSession?.page || 0;
            const pages = getCategoryPages(cat, interaction.client, prefix, showOwner, interaction.user);
            const newPage = customId === 'help_prev' ? Math.max(0, curPage - 1) : Math.min(pages.length - 1, curPage + 1);
            if (currentSession) { currentSession.page = newPage; }
            const pageInfo = pages.length > 1 ? { page: newPage, totalPages: pages.length } : null;
            const isHome = cat === 'home';
            const container = buildHelpContainer(pages[newPage] || pages[0], interaction.user, interaction.client, isHome, showOwner, pageInfo);
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
            return true;
        }

        let category = 'home';
        if (customId === 'help_home') category = 'home';
        else if (customId === 'help_allcmds') category = 'all_commands';

        const pages = getCategoryPages(category, interaction.client, prefix, showOwner, interaction.user);
        if (currentSession) { currentSession.category = category; currentSession.page = 0; }
        const pageInfo = pages.length > 1 ? { page: 0, totalPages: pages.length } : null;
        const container = buildHelpContainer(pages[0], interaction.user, interaction.client, category === 'home', showOwner, pageInfo);
        await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
        return true;
    },

    async handleSelectMenu(interaction) {
        try {
            if (!global.helpMenuSessions) global.helpMenuSessions = new Map();
            const session = global.helpMenuSessions.get(interaction.message.id);

            // If session exists, only the original user can interact
            if (session && session.userId !== interaction.user.id) {
                await interaction.reply({
                    content: '<:Cancel:1521227723916181644> This menu belongs to someone else. Use `/help` to open your own.',
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }

            // No session (cleaned up by timeout) or session expired → show expired
            if (!session || isSessionExpired(session)) {
                await interaction.update({ components: [buildExpiredContainer()], flags: MessageFlags.IsComponentsV2 }).catch(() => { });
                if (session) {
                    global.helpMenuSessions.delete(interaction.message.id);
                    const tid = global.helpMenuTimeouts?.get(interaction.message.id);
                    if (tid) { clearTimeout(tid); global.helpMenuTimeouts.delete(interaction.message.id); }
                }
                return;
            }

            // Refresh session timer on every valid interaction
            refreshHelpSession(interaction.message.id);

            const category = interaction.values[0];
            const showOwner = session?.showOwner || isOwner(interaction.user.id);

            if (category === 'owner' && !showOwner) {
                await interaction.reply({
                    content: '<:Cancel:1521227723916181644> This category is restricted to bot owners.',
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }

            const prefix = process.env.PREFIX || '-';
            const pages = getCategoryPages(category, interaction.client, prefix, showOwner, interaction.user);
            const currentSession = global.helpMenuSessions.get(interaction.message.id);
            if (currentSession) { currentSession.category = category; currentSession.page = 0; }
            const pageInfo = pages.length > 1 ? { page: 0, totalPages: pages.length } : null;
            const container = buildHelpContainer(pages[0], interaction.user, interaction.client, category === 'home', showOwner, pageInfo);
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: '<:Cancel:1521227723916181644> Something went wrong. Use `/help` to open a new menu.',
                    flags: MessageFlags.Ephemeral,
                }).catch(() => { });
            }
        }
    },

    async handleMoreOptions(interaction) {
        try {
            if (!global.helpMenuSessions) global.helpMenuSessions = new Map();
            const session = global.helpMenuSessions.get(interaction.message.id);

            // If session exists, only the original user can interact
            if (session && session.userId !== interaction.user.id) {
                await interaction.reply({
                    content: '<:Cancel:1521227723916181644> This menu belongs to someone else. Use `/help` to open your own.',
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }

            // No session or expired → show expired
            if (!session || isSessionExpired(session)) {
                await interaction.update({ components: [buildExpiredContainer()], flags: MessageFlags.IsComponentsV2 }).catch(() => { });
                if (session) {
                    global.helpMenuSessions.delete(interaction.message.id);
                    const tid = global.helpMenuTimeouts?.get(interaction.message.id);
                    if (tid) { clearTimeout(tid); global.helpMenuTimeouts.delete(interaction.message.id); }
                }
                return;
            }

            refreshHelpSession(interaction.message.id);

            const selected = interaction.values?.[0];
            if (!selected) return;
            const showOwner = session?.showOwner || isOwner(interaction.user.id);

            // Search — open modal
            if (selected === 'search') {
                const modal = new ModalBuilder()
                    .setCustomId('help_search_modal')
                    .setTitle('Search Commands');

                const searchInput = new TextInputBuilder()
                    .setCustomId('search_query')
                    .setLabel('Enter command name or keyword')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('e.g. ban, music, welcome, play...')
                    .setMaxLength(100)
                    .setRequired(true);

                modal.addComponents(new ActionRowBuilder().addComponents(searchInput));
                await interaction.showModal(modal);
                return;
            }

            // Link options — reply with clickable button
            const linkMap = {
                website: { label: 'Visit Website', url: WEBSITE_URL },
                invite: { label: 'Invite xNico', url: INVITE_URL },
                support: { label: 'Join Support', url: SUPPORT_URL },
                vote: { label: 'Vote for xNico', url: VOTE_URL },
            };

            if (linkMap[selected]) {
                const { label, url } = linkMap[selected];
                const linkContainer = new ContainerBuilder();
                linkContainer.addActionRowComponents(new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setURL(url).setLabel(label).setStyle(ButtonStyle.Link),
                ));
                await interaction.reply({
                    components: [linkContainer],
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                });
                return;
            }

            // All Commands — navigate to all commands page
            if (selected === 'all_commands') {
                const prefix = process.env.PREFIX || '-';
                const pages = getCategoryPages('all_commands', interaction.client, prefix, showOwner, interaction.user);
                const currentSession = global.helpMenuSessions.get(interaction.message.id);
                if (currentSession) { currentSession.category = 'all_commands'; currentSession.page = 0; }
                const pageInfo = pages.length > 1 ? { page: 0, totalPages: pages.length } : null;
                const container = buildHelpContainer(pages[0], interaction.user, interaction.client, false, showOwner, pageInfo);
                await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
                return;
            }
        } catch (error) {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: '<:Cancel:1521227723916181644> Something went wrong. Use `/help` to open a new menu.',
                    flags: MessageFlags.Ephemeral,
                }).catch(() => { });
            }
        }
    },

    async handleModalSubmit(interaction) {
        if (interaction.customId !== 'help_search_modal') return false;

        const query = (interaction.fields.getTextInputValue('search_query') || '').trim().toLowerCase();
        if (!query) {
            await interaction.reply(ui.payload(ui.warn(interaction.guild?.id, 'Empty Search', 'Please enter a search query.'), true));
            return true;
        }

        const categoryLabels = {};
        for (const [key, meta] of Object.entries(CATEGORY_META)) {
            categoryLabels[key] = `${meta.emoji} ${meta.title.replace(' Commands', '').replace(' & Roleplay', '')}`;
        }

        const results = [];
        const seen = new Set();
        const cmdObjects = new Set();

        const commands = interaction.client?.commands;
        if (commands) {
            for (const [name, cmd] of commands) {
                if (cmdObjects.has(cmd)) continue;
                cmdObjects.add(cmd);

                const cmdName = cmd.data?.name || cmd.prefix || name;
                const matchesName = cmdName.includes(query);
                const matchesDesc = cmd.description?.toLowerCase().includes(query);
                const matchesAlias = cmd.aliases?.some(a => a.includes(query));

                if (matchesName || matchesDesc || matchesAlias) {
                    if (seen.has(cmdName)) continue;
                    seen.add(cmdName);

                    const helpCat = COMMAND_CATEGORY_MAP.get(cmdName) || FOLDER_FALLBACK[cmd.category] || cmd.category || 'basic';
                    const aliases = cmd.aliases?.length ? ` (${cmd.aliases.map(a => `\`${a}\``).join(', ')})` : '';
                    const desc = cmd.description ? ` — ${cmd.description.substring(0, 60)}` : '';
                    const hasSlash = cmd.data && cmd.data !== null && typeof cmd.execute === 'function' && !cmd.prefixOnly;
                    const hasPrefix = typeof cmd.executePrefix === 'function';
                    const typeTag = hasSlash && hasPrefix ? '`/` `-`' : hasSlash ? '`/`' : '`-`';
                    results.push(`${categoryLabels[helpCat] || helpCat} › \`${cmdName}\`${aliases} ${typeTag}${desc}`);
                }
            }
        }

        const unique = results.slice(0, 20);

        const container = new ContainerBuilder();
        let searchContent = `## <:Search:1521228231263387738>  Search Results\n`;
        searchContent += `-# Query: \`${query}\`\n\n`;

        if (unique.length > 0) {
            searchContent += `**Found ${unique.length} result${unique.length > 1 ? 's' : ''}**\n`;
            searchContent += unique.map(r => `> ${r}`).join('\n');
        } else {
            searchContent += `<:Cancel:1521227723916181644> No commands found matching \`${query}\`\n\n`;
            searchContent += `-# Try a different keyword or browse categories with \`/help\``;
        }

        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(searchContent));

        await interaction.reply({
            components: [container],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        });
        return true;
    },
};