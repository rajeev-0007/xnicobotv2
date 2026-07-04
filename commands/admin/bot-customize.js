'use strict';

/**
 * /bot-customize — Per-guild bot personalisation panel.
 *
 * Every setting on this panel is per-guild and stored in the shared
 * `bot-customize` jsonStore. The bot's runtime layers (slash response
 * patcher, prefix command pipeline, member-join handler, home/help
 * panels, /botprofile, etc.) all read this same store via the
 * `utils/botCustomize.js` helper, so changes here are reflected
 * everywhere within one cache TTL (5s) — and we invalidate the cache
 * inline on every save so the effect is instant.
 *
 * Settings overview
 * ─────────────────
 *  • Nickname           → Discord guild member nickname (live PATCH)
 *  • Per-server Avatar  → guild member avatar (live PATCH /guilds/{id}/members/@me)
 *  • Banner URL         → per-guild data field; surfaced as a media gallery
 *                         in /botprofile and any other consumer
 *  • About / Bio        → per-guild data field; rendered as the "about"
 *                         line on the bot's home/help panel and inside
 *                         /botprofile
 *  • Custom Prefix      → mirrored to the prefixes store; takes effect
 *                         immediately for prefix command parsing
 *  • Embed Color        → applied to every CV2 container & classic embed
 *                         the bot sends in this guild
 *  • Footer Text/Icon   → embedded into CV2 containers (as a `-# …` line)
 *                         and classic embeds (as the embed footer)
 *  • Language tag       → metadata only — wired for future translations,
 *                         clearly labelled in the UI as "stored only"
 *  • DM on Join         → toggle + customisable welcome DM with
 *                         {user}, {server}, {memberCount} placeholders
 *  • Cooldown / Delete  → enforced inside the prefix command pipeline
 *  • Ephemeral          → forces every slash reply ephemeral
 *
 * © Rajeev (Rexzy) — xNico
 */

const {
    SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder,
    ButtonBuilder, ButtonStyle, ActionRowBuilder, SeparatorBuilder, SeparatorSpacingSize,
    ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder,
    SectionBuilder, ThumbnailBuilder, MediaGalleryBuilder, PermissionFlagsBits,
} = require('discord.js');

const premiumManager = require('../../utils/premiumManager');
const botCustomizeUtil = require('../../utils/botCustomize');
const jsonStore = require('../../utils/jsonStore');
const { checkAndExpire } = require('../../utils/panelExpiration');

/* ─────────────────────────── Custom emojis ─────────────────────────── */
const E = {
    palette:   '<:Palette:1521227950601539755>',
    settings:  '<:Settings:1521227767780343879>',
    success:   '<:Checkedbox:1521227734943269077>',
    cancel:    '<:Cancel:1521227723916181644>',
    edit:      '<:Edit:1521227886634205298>',
    editAlt:   '<:Editalt:1521227921673556019>',
    document:  '<:Document:1521227875016114266>',
    book:      '<:Bookopen:1521227911137595605>',
    picture:   '<:Picture:1521227954191995024>',
    copy:      '<:Copy:1521227960554881084>',
    eye:       '<:Eye:1521227940480815156>',
    image:     '<:Image:1521227966435037255>',
    timer:     '<:Timer:1521227971590095070>',
    lightbulb: '<:Lightbulbalt:1521227880703463675>',
    history:   '<:History:1521227863079256278>',
    trash:     '<:Trash:1521227750420254820>',
    block:     '<:Commentblock:1521227898101432331>',
    caretLeft: '<:Caretleft:1521227977495543838>',
    toggleOn:  '<:Toggleon:1521227758011809964>',
    toggleOff: '<:Toggleoff:1521227763816595559>',
    star:      '<:Star:1521227981685526568>',
    bots:      '<:bots:1521227848101396610>',
    refresh:   '<:Refresh:1521227946441052420>',
};

const EMBED_COLORS = {
    'colorless': { name: 'Colorless (None)', color: null,     emoji: '🚫' },
    'default': { name: 'Default Blue', color: 0xCAD7E6, emoji: '🔵' },
    'red':     { name: 'Red',          color: 0xED4245, emoji: '🔴' },
    'green':   { name: 'Green',        color: 0x57F287, emoji: '🟢' },
    'yellow':  { name: 'Yellow',       color: 0xFEE75C, emoji: '🟡' },
    'purple':  { name: 'Purple',       color: 0x9B59B6, emoji: '🟣' },
    'pink':    { name: 'Pink',         color: 0xEB459E, emoji: '💗' },
    'orange':  { name: 'Orange',       color: 0xE67E22, emoji: '🟠' },
    'teal':    { name: 'Teal',         color: 0x1ABC9C, emoji: '🩵' },
    'gold':    { name: 'Gold',         color: 0xF1C40F, emoji: E.star },
    'navy':    { name: 'Navy',         color: 0x34495E, emoji: '🌑' },
    'black':   { name: 'Black',        color: 0x23272A, emoji: '⬛' },
    'white':   { name: 'White',        color: 0xFFFFFF, emoji: '⬜' },
};

const LANGUAGES = {
    'en': { name: 'English',    emoji: '🇬🇧' },
    'es': { name: 'Español',    emoji: '🇪🇸' },
    'fr': { name: 'Français',   emoji: '🇫🇷' },
    'de': { name: 'Deutsch',    emoji: '🇩🇪' },
    'pt': { name: 'Português',  emoji: '🇧🇷' },
    'ru': { name: 'Русский',    emoji: '🇷🇺' },
    'ja': { name: '日本語',      emoji: '🇯🇵' },
    'ko': { name: '한국어',      emoji: '🇰🇷' },
    'zh': { name: '中文',        emoji: '🇨🇳' },
    'ar': { name: 'العربية',     emoji: '🇸🇦' },
    'hi': { name: 'हिन्दी',       emoji: '🇮🇳' },
    'tr': { name: 'Türkçe',     emoji: '🇹🇷' },
};

const ABOUT_LIMIT  = 500;
const BANNER_LIMIT = 200;     // safety cap for the URL string
const NICK_LIMIT   = 32;
const PREFIX_LIMIT = 5;
const FOOTER_LIMIT = 100;
const COOLDOWN_MAX = 60;

/* ─────────────────────────── Storage ─────────────────────────── */

function loadConfig() {
    try {
        if (!jsonStore.has('bot-customize')) {
            jsonStore.write('bot-customize', {});
            return {};
        }
        return jsonStore.read('bot-customize');
    } catch { return {}; }
}

function saveConfig(config) {
    // Persist immediately — bot-customize holds the per-guild prefix and
    // branding; the debounced write risked losing it on a quick restart.
    jsonStore.writeImmediate('bot-customize', config).catch(() => {});
    // Burn the 5s TTL cache so live readers (slash patcher, prefix
    // pipeline, /botprofile, home panel) pick up the change instantly
    // instead of after the next cache miss.
    botCustomizeUtil.invalidateCache();
}

function syncPrefixToFile(guildId, prefix) {
    try {
        const prefixes = jsonStore.has('prefixes') ? jsonStore.read('prefixes') : {};
        if (prefix) prefixes[guildId] = prefix;
        else        delete prefixes[guildId];
        jsonStore.writeImmediate('prefixes', prefixes).catch(() => {});
    } catch {}
}

function getDefaultGuildConfig() {
    return {
        nickname: null,
        avatarUrl: null,
        bannerUrl: null,
        aboutText: null,
        prefix: null,
        embedColor: 'default',
        footerText: null,
        footerIcon: null,
        language: 'en',
        dmOnJoin: false,
        dmMessage: null,
        commandCooldown: 3,
        deleteCommands: false,
        ephemeralResponses: false,
    };
}

function getGuildConfig(guildId) {
    const config = loadConfig();
    if (!config[guildId]) {
        config[guildId] = getDefaultGuildConfig();
        saveConfig(config);
    }
    // Backfill any newer fields onto older configs
    const defaults = getDefaultGuildConfig();
    for (const k of Object.keys(defaults)) {
        if (config[guildId][k] === undefined) config[guildId][k] = defaults[k];
    }
    return config[guildId];
}

/* ─────────────────────────── Discord API ─────────────────────────── */
// Per-server avatar AND banner are written through discord.js's
// `guild.members.editMe({ avatar, banner })`, which:
//   1. Hits PATCH /guilds/{id}/members/@me using the client's own REST
//      stack (no separate auth instance, no token-loading races).
//   2. Patches the cached `guild.members.me` object so the next call to
//      `botMember.displayAvatarURL()` returns the new asset immediately.
//   3. Resolves URL strings, Buffers and data URIs uniformly through
//      discord.js's `resolveImage`, so we don't need a separate base64
//      pipeline for image uploads.
//
// On failure we propagate the original error so the UI can tell the
// user exactly why Discord rejected the change (most common reasons:
// the URL isn't reachable, the file is too big, the server boost level
// doesn't allow per-guild banners, or the bot was kicked between the
// modal opening and submission).
//
// Bio:
//   Discord exposes a per-guild bot bio through the same endpoint as
//   avatar/banner: PATCH /guilds/{guild.id}/members/@me with `{ bio }`.
//   discord.js 14.x's `editMe()` already passes that field through, so
//   we set it on the guild member, not on the global application
//   description. The local `aboutText` is still the source of truth
//   for our own surfaces (/botprofile, /botinfo, home panel) so the
//   rendering stays consistent even on guilds where Discord rejects
//   the API call (e.g. account flags, transient outages).

const BIO_LIMIT = 190; // Discord's server profile bio cap

async function setGuildAvatar(guild, imageUrl) {
    try {
        const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
        if (!me) return { success: false, error: 'Bot member not found in this guild.' };
        await guild.members.editMe({ avatar: imageUrl });
        // Force-refresh so any subsequent read of `me.avatarURL()` is hot.
        await guild.members.fetchMe({ force: true }).catch(() => {});
        return { success: true };
    } catch (error) {
        return { success: false, error: prettyApiError(error) };
    }
}

async function resetGuildAvatar(guild) {
    try {
        await guild.members.editMe({ avatar: null });
        await guild.members.fetchMe({ force: true }).catch(() => {});
        return { success: true };
    } catch (error) {
        return { success: false, error: prettyApiError(error) };
    }
}

/**
 * Push a per-guild banner to Discord. Same endpoint as avatar, just
 * targeting the `banner` field. Returns `{ success, applied, error? }`
 * where `applied` is true only when Discord accepted the change.
 *
 * On failure we still consider the operation a partial success at the
 * caller level: the URL is saved into our store, and our own commands
 * (`/botprofile`, `/botinfo`, the home panel) render the banner from
 * that field — so even if Discord declines, the user's panels still
 * show the new banner.
 */
async function setGuildBanner(guild, imageUrl) {
    try {
        await guild.members.editMe({ banner: imageUrl });
        await guild.members.fetchMe({ force: true }).catch(() => {});
        return { success: true, applied: true };
    } catch (error) {
        return { success: false, applied: false, error: prettyApiError(error) };
    }
}

async function resetGuildBanner(guild) {
    try {
        await guild.members.editMe({ banner: null });
        await guild.members.fetchMe({ force: true }).catch(() => {});
        return { success: true, applied: true };
    } catch (error) {
        return { success: false, applied: false, error: prettyApiError(error) };
    }
}

/**
 * Push a bio to the bot's per-guild member. Same endpoint as the
 * avatar/banner setters, just targeting the `bio` field. Returns
 * `{ success, applied, error? }`.
 *
 * Discord enforces a 190-char cap on the server profile bio; we slice
 * defensively so we never send something the API will reject. The
 * local per-guild `aboutText` (which we render up to 500 chars on our
 * own panels) is independent of this — Discord just won't show the
 * tail beyond 190.
 */
async function setGuildBio(guild, text) {
    try {
        const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
        if (!me) return { success: false, applied: false, error: 'Bot member not found in this guild.' };
        const trimmed = String(text ?? '').slice(0, BIO_LIMIT);
        await guild.members.editMe({ bio: trimmed.length ? trimmed : null });
        await guild.members.fetchMe({ force: true }).catch(() => {});
        return { success: true, applied: true };
    } catch (error) {
        return { success: false, applied: false, error: prettyApiError(error) };
    }
}

async function resetGuildBio(guild) {
    try {
        await guild.members.editMe({ bio: null });
        await guild.members.fetchMe({ force: true }).catch(() => {});
        return { success: true, applied: true };
    } catch (error) {
        return { success: false, applied: false, error: prettyApiError(error) };
    }
}

/**
 * Surface the most useful piece of a discord.js / DiscordAPIError so
 * the panel can show "Image too large" instead of a generic stack.
 */
function prettyApiError(err) {
    if (!err) return 'unknown';
    if (err.rawError?.errors) {
        try {
            // DiscordAPIError shapes errors as a deeply nested map; pull
            // the first leaf message we can find.
            const findLeaf = (obj) => {
                if (!obj || typeof obj !== 'object') return null;
                if (Array.isArray(obj._errors) && obj._errors[0]?.message) return obj._errors[0].message;
                for (const v of Object.values(obj)) {
                    const r = findLeaf(v);
                    if (r) return r;
                }
                return null;
            };
            const leaf = findLeaf(err.rawError.errors);
            if (leaf) return leaf;
        } catch {}
    }
    return err.message || 'unknown';
}

function isValidImageUrl(url) {
    if (!url) return false;
    if (!/^https?:\/\/.+/i.test(url)) return false;
    if (/\.(mp4|mov|avi|mkv|webm|mp3|wav|ogg|pdf|zip|exe)(\?.*)?$/i.test(url)) return false;
    return true;
}

/* ─────────────────────────── UI builder ─────────────────────────── */

function buildCustomizePanel(guildConfig, guild, client, page = 'main') {
    const accent = EMBED_COLORS[guildConfig.embedColor]?.color ?? null;
    const container = new ContainerBuilder();
    if (accent != null) container.setAccentColor(accent);

    const botMember = guild.members.me;
    const currentNick = botMember?.nickname || client.user.username;
    const hasGuildAvatar = !!guildConfig.avatarUrl;
    const hasBanner = !!guildConfig.bannerUrl;
    const hasAbout = !!guildConfig.aboutText;

    if (page === 'main') {
        const headerSection = new SectionBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `# ${E.palette} Bot Customization\n` +
                `-# Personalise how **${client.user.username}** behaves in **${guild.name}**`
            ))
            .setThumbnailAccessory(new ThumbnailBuilder({
                media: { url: botMember?.displayAvatarURL({ size: 256 }) || client.user.displayAvatarURL({ size: 256 }) },
            }));
        container.addSectionComponents(headerSection);

        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

        const dot = (b) => b ? E.toggleOn : E.toggleOff;
        const val = (v) => v ? `\`${v}\`` : '*Default*';

        let summary = `### ${E.settings} Current Configuration\n`;
        summary += `${E.copy} **Nickname** — ${currentNick}\n`;
        summary += `${E.picture} **Per-Server Avatar** — ${hasGuildAvatar ? '`Custom`' : '*Global*'}\n`;
        summary += `${E.picture} **Banner** — ${hasBanner ? '`Custom`' : '*Not set*'}\n`;
        summary += `${E.document} **About / Bio** — ${hasAbout ? '`Configured`' : '*Not set*'}\n`;
        summary += `${E.edit} **Prefix** — ${val(guildConfig.prefix)}\n`;
        summary += `${E.palette} **Embed Color** — ${EMBED_COLORS[guildConfig.embedColor]?.name || 'Default'}\n`;
        summary += `${E.document} **Footer** — ${guildConfig.footerText ? '`Custom`' : '*Default*'}\n`;
        summary += `${E.book} **Language Tag** — ${LANGUAGES[guildConfig.language]?.name || 'English'} *(stored only)*\n\n`;
        summary += `${E.timer} **Cooldown** \`${guildConfig.commandCooldown}s\`  •  `;
        summary += `${E.trash} **Auto-Delete** ${dot(guildConfig.deleteCommands)}  •  `;
        summary += `${E.block} **Ephemeral** ${dot(guildConfig.ephemeralResponses)}  •  `;
        summary += `${E.editAlt} **DM on Join** ${dot(guildConfig.dmOnJoin)}`;

        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(summary));
        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ${E.document} Choose a category`));

        const categorySelect = new StringSelectMenuBuilder()
            .setCustomId('botcustom_category')
            .setPlaceholder('Pick what to customise…')
            .addOptions([
                { label: 'Appearance',  description: 'Nickname, avatar, embed color',         value: 'appearance', emoji: E.copy },
                { label: 'Profile',     description: 'Banner, About / Bio (per-server)',      value: 'profile',    emoji: E.book },
                { label: 'Behavior',    description: 'Prefix, cooldown, response settings',   value: 'behavior',   emoji: E.settings },
                { label: 'Messages',    description: 'Footer, DM on join, language tag',      value: 'messages',   emoji: E.edit },
                { label: 'Reset All',   description: 'Restore every setting to default',      value: 'reset_all',  emoji: E.history },
            ]);
        container.addActionRowComponents(new ActionRowBuilder().addComponents(categorySelect));

        const quickRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('botcustom_preview').setLabel('Preview').setStyle(ButtonStyle.Secondary).setEmoji(E.eye),
            new ButtonBuilder().setCustomId('botcustom_export').setLabel('Export Config').setStyle(ButtonStyle.Secondary).setEmoji(E.image),
            new ButtonBuilder().setCustomId('botcustom_help').setLabel('Help').setStyle(ButtonStyle.Secondary).setEmoji(E.lightbulb),
        );
        container.addActionRowComponents(quickRow);
    }

    else if (page === 'appearance') {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `# ${E.copy} Appearance Settings\n` +
            `-# Customise how **${client.user.username}** looks in **${guild.name}**`
        ));
        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

        let body = `${E.copy} **Nickname**\n-# ${currentNick}\n\n`;
        body    += `${E.picture} **Per-Server Avatar**\n-# ${hasGuildAvatar ? 'Custom avatar active' : 'Using global avatar'}\n\n`;
        body    += `${E.palette} **Embed Color**\n-# ${EMBED_COLORS[guildConfig.embedColor]?.name || 'Default Blue'}`;
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));

        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

        container.addActionRowComponents(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('botcustom_nickname').setLabel('Nickname').setStyle(ButtonStyle.Primary).setEmoji(E.copy),
            new ButtonBuilder().setCustomId('botcustom_avatar').setLabel('Server Avatar').setStyle(ButtonStyle.Primary).setEmoji(E.picture),
            new ButtonBuilder().setCustomId('botcustom_color').setLabel('Embed Color').setStyle(ButtonStyle.Primary).setEmoji(E.palette),
        ));
        container.addActionRowComponents(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('botcustom_reset_nick').setLabel('Reset Nickname').setStyle(ButtonStyle.Danger).setEmoji(E.history),
            new ButtonBuilder().setCustomId('botcustom_reset_avatar').setLabel('Reset Avatar').setStyle(ButtonStyle.Danger).setEmoji(E.trash),
            new ButtonBuilder().setCustomId('botcustom_back').setLabel('Back').setStyle(ButtonStyle.Secondary).setEmoji(E.caretLeft),
        ));
    }

    else if (page === 'profile') {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `# ${E.book} Profile Settings\n` +
            `-# Per-server banner & about — surfaced on \`/botprofile\` and the bot's home panel`
        ));
        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

        // Live banner preview if set
        if (hasBanner) {
            try {
                container.addMediaGalleryComponents(
                    new MediaGalleryBuilder().addItems(item => item.setURL(guildConfig.bannerUrl))
                );
                container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
            } catch {}
        }

        let body = `${E.picture} **Banner**\n`;
        body += hasBanner
            ? `-# [Custom banner set](<${guildConfig.bannerUrl}>)\n\n`
            : `-# No banner configured. Set one to customise the bot's profile look.\n\n`;
        body += `${E.document} **About / Bio**\n`;
        if (hasAbout) {
            const preview = guildConfig.aboutText.length > 240
                ? guildConfig.aboutText.slice(0, 240) + '…'
                : guildConfig.aboutText;
            body += `> ${preview}\n`;
            body += `> -# ${guildConfig.aboutText.length}/${ABOUT_LIMIT} characters used`;
        } else {
            body += `-# No about text set. Add a description for the bot in this server.`;
        }
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));

        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

        container.addActionRowComponents(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('botcustom_banner').setLabel('Set Banner').setStyle(ButtonStyle.Primary).setEmoji(E.picture),
            new ButtonBuilder().setCustomId('botcustom_about').setLabel('Set About').setStyle(ButtonStyle.Primary).setEmoji(E.document),
        ));
        container.addActionRowComponents(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('botcustom_reset_banner').setLabel('Reset Banner').setStyle(ButtonStyle.Danger).setEmoji(E.trash),
            new ButtonBuilder().setCustomId('botcustom_reset_about').setLabel('Reset About').setStyle(ButtonStyle.Danger).setEmoji(E.trash),
            new ButtonBuilder().setCustomId('botcustom_back').setLabel('Back').setStyle(ButtonStyle.Secondary).setEmoji(E.caretLeft),
        ));
    }

    else if (page === 'behavior') {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `# ${E.settings} Behavior Settings\n` +
            `-# Control how **${client.user.username}** responds in **${guild.name}**`
        ));
        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

        let body = `${E.edit} **Custom Prefix**\n-# ${guildConfig.prefix ? `\`${guildConfig.prefix}\`` : 'Using default prefix'}\n\n`;
        body    += `${E.timer} **Command Cooldown**\n-# \`${guildConfig.commandCooldown}s\` between commands\n\n`;
        body    += `${E.trash} **Auto-Delete Commands** — ${guildConfig.deleteCommands ? '`Enabled`' : '`Disabled`'}\n`;
        body    += `${E.block} **Ephemeral Responses** — ${guildConfig.ephemeralResponses ? '`Enabled`' : '`Disabled`'}`;
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));

        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

        container.addActionRowComponents(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('botcustom_prefix').setLabel('Set Prefix').setStyle(ButtonStyle.Primary).setEmoji(E.edit),
            new ButtonBuilder().setCustomId('botcustom_cooldown').setLabel('Cooldown').setStyle(ButtonStyle.Primary).setEmoji(E.timer),
            new ButtonBuilder().setCustomId('botcustom_toggle_delete')
                .setLabel(guildConfig.deleteCommands ? 'Disable Auto-Delete' : 'Enable Auto-Delete')
                .setStyle(guildConfig.deleteCommands ? ButtonStyle.Danger : ButtonStyle.Success)
                .setEmoji(E.trash),
        ));
        container.addActionRowComponents(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('botcustom_toggle_ephemeral')
                .setLabel(guildConfig.ephemeralResponses ? 'Disable Ephemeral' : 'Enable Ephemeral')
                .setStyle(guildConfig.ephemeralResponses ? ButtonStyle.Danger : ButtonStyle.Success)
                .setEmoji(E.block),
            new ButtonBuilder().setCustomId('botcustom_reset_prefix').setLabel('Reset Prefix').setStyle(ButtonStyle.Danger).setEmoji(E.history),
            new ButtonBuilder().setCustomId('botcustom_back').setLabel('Back').setStyle(ButtonStyle.Secondary).setEmoji(E.caretLeft),
        ));
    }

    else if (page === 'messages') {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `# ${E.edit} Message Settings\n` +
            `-# Customise bot messages and responses in **${guild.name}**`
        ));
        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

        let body = `${E.book} **Language Tag**\n-# ${LANGUAGES[guildConfig.language]?.name || 'English'} — *stored only, not yet enforced*\n\n`;
        body    += `${E.document} **Custom Footer**\n-# ${guildConfig.footerText ? `"${guildConfig.footerText}"` : 'Using default footer'}\n\n`;
        body    += `${E.picture} **Footer Icon**\n-# ${guildConfig.footerIcon ? 'Custom icon set' : 'Using default'}\n\n`;
        body    += `${E.editAlt} **DM on Join** — ${guildConfig.dmOnJoin ? '`Enabled`' : '`Disabled`'}\n`;
        body    += `${E.editAlt} **DM Message** — ${guildConfig.dmMessage ? '`Custom`' : '*Default*'}`;
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));

        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

        container.addActionRowComponents(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('botcustom_language').setLabel('Language Tag').setStyle(ButtonStyle.Primary).setEmoji(E.book),
            new ButtonBuilder().setCustomId('botcustom_footer').setLabel('Set Footer').setStyle(ButtonStyle.Primary).setEmoji(E.document),
            new ButtonBuilder().setCustomId('botcustom_footer_icon').setLabel('Footer Icon').setStyle(ButtonStyle.Primary).setEmoji(E.picture),
        ));
        container.addActionRowComponents(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('botcustom_toggle_dm')
                .setLabel(guildConfig.dmOnJoin ? 'Disable Join DM' : 'Enable Join DM')
                .setStyle(guildConfig.dmOnJoin ? ButtonStyle.Danger : ButtonStyle.Success)
                .setEmoji(E.editAlt),
            new ButtonBuilder().setCustomId('botcustom_dm_message')
                .setLabel('DM Message')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji(E.editAlt)
                .setDisabled(!guildConfig.dmOnJoin),
            new ButtonBuilder().setCustomId('botcustom_reset_messages').setLabel('Reset Messages').setStyle(ButtonStyle.Danger).setEmoji(E.history),
        ));
        container.addActionRowComponents(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('botcustom_back').setLabel('Back').setStyle(ButtonStyle.Secondary).setEmoji(E.caretLeft),
        ));
    }

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `-# ${E.bots} xNico • Per-guild configuration • Cache TTL 5s`
    ));

    return container;
}

/* ─────────────────────────── Permission helpers ─────────────────────────── */

function denyEphemeral(interaction, reason) {
    return interaction.reply({
        content: `${E.cancel} ${reason}`,
        flags: MessageFlags.Ephemeral,
    });
}

function checkAccess(interaction) {
    if (!interaction.member?.permissions?.has?.(PermissionFlagsBits.ManageGuild)) {
        return denyEphemeral(interaction, 'You need **Manage Server** permission to customise the bot.');
    }
    if (!premiumManager.hasPremiumAccess(interaction.user.id, interaction.guild?.id)) {
        return denyEphemeral(interaction, 'This feature requires **Premium**. Use `/redeemkey` or activate server premium.');
    }
    return null;
}

/* ─────────────────────────── Module export ─────────────────────────── */

module.exports = {
    description: 'Customise the bot\'s appearance, profile, behavior, and messages per server',
    usage: 'bot-customize',
    category: 'admin',
    data: new SlashCommandBuilder()
        .setName('bot-customize')
        .setDescription('Customise the bot\'s appearance and behavior in this server'),
    premiumOnly: true,

    async execute(interaction) {
        const denied = checkAccess(interaction);
        if (denied) return denied;

        const guildConfig = getGuildConfig(interaction.guild.id);
        const container = buildCustomizePanel(guildConfig, interaction.guild, interaction.client, 'main');
        await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    },

    async executePrefix(message) {
        if (!message.member?.permissions?.has?.(PermissionFlagsBits.ManageGuild)) {
            return message.reply(`${E.cancel} You need **Manage Server** permission to customise the bot.`);
        }
        if (!premiumManager.hasPremiumAccess(message.author.id, message.guild?.id)) {
            return message.reply(`${E.cancel} This feature requires **Premium**. Use \`redeemkey\` or activate server premium.`);
        }
        const guildConfig = getGuildConfig(message.guild.id);
        const container = buildCustomizePanel(guildConfig, message.guild, message.client, 'main');
        await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    },

    // Exports used elsewhere (dashboard, storeSync, /botprofile, etc.)
    getGuildConfig,
    loadConfig,
    saveConfig,
    EMBED_COLORS,
    LANGUAGES,
    setGuildAvatar,
    resetGuildAvatar,
    setGuildBanner,
    resetGuildBanner,
    setGuildBio,
    resetGuildBio,

    /* ───────────────────── Interaction handler ───────────────────── */

    async handleInteraction(interaction) {
        if (!interaction.isButton() && !interaction.isModalSubmit() && !interaction.isStringSelectMenu()) return false;
        const customId = interaction.customId;
        if (!customId.startsWith('botcustom_')) return false;

        if (await checkAndExpire(interaction, 'config')) return true;

        const denied = checkAccess(interaction);
        if (denied) return true;

        const config = loadConfig();
        const guildId = interaction.guild.id;
        if (!config[guildId]) config[guildId] = getDefaultGuildConfig();
        const guildConfig = config[guildId];

        // Re-render the original panel into the message that was interacted with
        const rerender = async (page = 'main') => {
            try {
                const panel = buildCustomizePanel(guildConfig, interaction.guild, interaction.client, page);
                await interaction.message.edit({ components: [panel], flags: MessageFlags.IsComponentsV2 });
            } catch {}
        };

        /* ── CATEGORY SELECT ── */
        if (customId === 'botcustom_category' && interaction.isStringSelectMenu()) {
            const selected = interaction.values[0];

            if (selected === 'reset_all') {
                config[guildId] = getDefaultGuildConfig();
                saveConfig(config);
                syncPrefixToFile(guildId, null);

                // Reset live state too: clear the bot's per-server nickname
                // and avatar via the Discord API. The banner/about live in
                // our store and were already reset above.
                try { await interaction.guild.members.me.setNickname(null); } catch {}
                try { await resetGuildAvatar(interaction.guild); } catch {}

                await interaction.reply({ content: `${E.success} All bot customisation settings have been reset.`, flags: MessageFlags.Ephemeral });
                await rerender('main');
                return true;
            }

            const container = buildCustomizePanel(guildConfig, interaction.guild, interaction.client, selected);
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
            return true;
        }

        if (customId === 'botcustom_back') {
            await interaction.update({
                components: [buildCustomizePanel(guildConfig, interaction.guild, interaction.client, 'main')],
                flags: MessageFlags.IsComponentsV2,
            }).catch(() => {});
            return true;
        }

        /* ── NICKNAME ── */
        if (customId === 'botcustom_nickname') {
            const modal = new ModalBuilder().setCustomId('botcustom_nickname_modal').setTitle('Change Bot Nickname');
            const input = new TextInputBuilder()
                .setCustomId('nickname')
                .setLabel(`New nickname (max ${NICK_LIMIT} chars)`)
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Leave blank to clear and use bot username')
                .setMaxLength(NICK_LIMIT)
                .setRequired(false);
            if (interaction.guild.members.me?.nickname) input.setValue(interaction.guild.members.me.nickname);
            modal.addComponents(new ActionRowBuilder().addComponents(input));
            await interaction.showModal(modal);
            return true;
        }

        if (customId === 'botcustom_nickname_modal' && interaction.isModalSubmit()) {
            const newNick = interaction.fields.getTextInputValue('nickname').trim() || null;
            try {
                await interaction.guild.members.me.setNickname(newNick);
                guildConfig.nickname = newNick;
                saveConfig(config);
                await interaction.reply({
                    content: newNick
                        ? `${E.success} Nickname changed to **${newNick}**.`
                        : `${E.success} Nickname cleared — using bot's global name.`,
                    flags: MessageFlags.Ephemeral,
                });
                await rerender('appearance');
            } catch (error) {
                await interaction.reply({ content: `${E.cancel} Failed to change nickname: ${error.message}`, flags: MessageFlags.Ephemeral });
            }
            return true;
        }

        /* ── AVATAR ── */
        if (customId === 'botcustom_avatar') {
            const modal = new ModalBuilder().setCustomId('botcustom_avatar_modal').setTitle('Change Server Avatar');
            const input = new TextInputBuilder()
                .setCustomId('avatar_url')
                .setLabel('Image URL (PNG, JPG, GIF, WebP)')
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder('https://example.com/image.png')
                .setRequired(true);
            modal.addComponents(new ActionRowBuilder().addComponents(input));
            await interaction.showModal(modal);
            return true;
        }

        if (customId === 'botcustom_avatar_modal' && interaction.isModalSubmit()) {
            const avatarUrl = interaction.fields.getTextInputValue('avatar_url').trim();
            if (!isValidImageUrl(avatarUrl)) {
                await interaction.reply({ content: `${E.cancel} Please provide a valid image URL (PNG, JPG, GIF, or WebP).`, flags: MessageFlags.Ephemeral });
                return true;
            }
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const result = await setGuildAvatar(interaction.guild, avatarUrl);
            if (result.success) {
                guildConfig.avatarUrl = avatarUrl;
                saveConfig(config);
                await interaction.editReply({ content: `${E.success} Bot avatar for this server has been updated.` });
                await rerender('appearance');
            } else {
                await interaction.editReply({ content: `${E.cancel} Failed to set avatar: ${result.error}` });
            }
            return true;
        }

        /* ── EMBED COLOR ── */
        if (customId === 'botcustom_color') {
            const colorSelect = new StringSelectMenuBuilder()
                .setCustomId('botcustom_color_select')
                .setPlaceholder('Select an embed color…')
                .addOptions(Object.entries(EMBED_COLORS).map(([key, value]) => ({
                    label: value.name, value: key, emoji: value.emoji,
                    default: guildConfig.embedColor === key,
                })));
            await interaction.reply({
                components: [new ContainerBuilder()
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`${E.palette} Select a new embed color:`))
                    .addActionRowComponents(new ActionRowBuilder().addComponents(colorSelect))],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            });
            return true;
        }

        if (customId === 'botcustom_color_select' && interaction.isStringSelectMenu()) {
            const selected = interaction.values[0];
            guildConfig.embedColor = selected;
            saveConfig(config);
            await interaction.update({
                content: `${E.success} Embed color set to **${EMBED_COLORS[selected].name}**.`,
                components: [],
            }).catch(() => {});
            await rerender('appearance');
            return true;
        }

        /* ── BANNER (per-guild data) ── */
        if (customId === 'botcustom_banner') {
            const modal = new ModalBuilder().setCustomId('botcustom_banner_modal').setTitle('Set Server Bot Banner');
            const input = new TextInputBuilder()
                .setCustomId('banner_url')
                .setLabel('Banner image URL (PNG, JPG, GIF, WebP)')
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder('https://example.com/banner.png')
                .setMaxLength(BANNER_LIMIT)
                .setRequired(true);
            if (guildConfig.bannerUrl) input.setValue(guildConfig.bannerUrl);
            modal.addComponents(new ActionRowBuilder().addComponents(input));
            await interaction.showModal(modal);
            return true;
        }

        if (customId === 'botcustom_banner_modal' && interaction.isModalSubmit()) {
            const bannerUrl = interaction.fields.getTextInputValue('banner_url').trim();
            if (!isValidImageUrl(bannerUrl)) {
                await interaction.reply({ content: `${E.cancel} Please provide a valid image URL — videos and other file types are not supported.`, flags: MessageFlags.Ephemeral });
                return true;
            }
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            // Save locally first so our own /botinfo / /botprofile renders
            // the new banner regardless of whether Discord accepts the API
            // call. Then attempt to push to Discord so the bot's actual
            // server profile updates too.
            guildConfig.bannerUrl = bannerUrl;
            saveConfig(config);

            const apiResult = await setGuildBanner(interaction.guild, bannerUrl);
            await interaction.editReply({
                content: apiResult.applied
                    ? `${E.success} Bot banner updated for this server (live on Discord profile too).`
                    : `${E.success} Bot banner saved for this server.\n-# ${E.cancel} Discord declined the live profile update: \`${apiResult.error || 'unknown'}\``,
            });
            await rerender('profile');
            return true;
        }

        if (customId === 'botcustom_reset_banner') {
            await interaction.deferUpdate();
            // Reset locally and on Discord. We always clear the local
            // value even if the API push fails so the next /botinfo run
            // doesn't show a stale URL.
            guildConfig.bannerUrl = null;
            saveConfig(config);
            const apiResult = await resetGuildBanner(interaction.guild);
            if (!apiResult.applied) {
                await interaction.followUp({
                    content: `${E.cancel} Local banner cleared but Discord rejected the live profile update: \`${apiResult.error || 'unknown'}\``,
                    flags: MessageFlags.Ephemeral,
                }).catch(() => {});
            }
            await interaction.editReply({
                components: [buildCustomizePanel(guildConfig, interaction.guild, interaction.client, 'profile')],
                flags: MessageFlags.IsComponentsV2,
            }).catch(() => {});
            return true;
        }

        /* ── ABOUT / BIO (per-guild data) ── */
        if (customId === 'botcustom_about') {
            const modal = new ModalBuilder().setCustomId('botcustom_about_modal').setTitle('Set Bot About / Bio');
            const input = new TextInputBuilder()
                .setCustomId('about_text')
                .setLabel(`About text (max ${ABOUT_LIMIT} characters)`)
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder('Write a description or bio for the bot in this server…')
                .setMaxLength(ABOUT_LIMIT)
                .setRequired(true);
            if (guildConfig.aboutText) input.setValue(guildConfig.aboutText);
            modal.addComponents(new ActionRowBuilder().addComponents(input));
            await interaction.showModal(modal);
            return true;
        }

        if (customId === 'botcustom_about_modal' && interaction.isModalSubmit()) {
            const aboutText = interaction.fields.getTextInputValue('about_text').trim();
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            // Save locally so /botinfo, -about, and the home panel render
            // it immediately for this guild.
            guildConfig.aboutText = aboutText || null;
            saveConfig(config);

            // Push the per-guild bio through Discord's guild_member
            // endpoint so it shows on the bot's server profile inside
            // this guild only — no global side-effect on other servers.
            const apiResult = await setGuildBio(interaction.guild, aboutText || '');

            const baseLine = aboutText
                ? `${E.success} Bot about/bio saved for this server.`
                : `${E.success} Bot about/bio cleared for this server.`;
            const liveNote = apiResult.applied
                ? `\n-# ${E.success} Discord server profile bio also updated${aboutText && aboutText.length > BIO_LIMIT ? ` (trimmed to ${BIO_LIMIT} chars for Discord; full text shown on \`/botinfo\` and \`/botprofile\`)` : ''}.`
                : `\n-# ${E.cancel} Discord declined the live bio update: \`${apiResult.error || 'unknown'}\` — local panels still render the new text.`;
            await interaction.editReply({ content: baseLine + liveNote });
            await rerender('profile');
            return true;
        }

        if (customId === 'botcustom_reset_about') {
            await interaction.deferUpdate();
            guildConfig.aboutText = null;
            saveConfig(config);
            // Clear the per-guild bio on Discord too. Failure is silent
            // — the local clear is what /botinfo and the home panel read.
            await resetGuildBio(interaction.guild).catch(() => {});
            await interaction.editReply({
                components: [buildCustomizePanel(guildConfig, interaction.guild, interaction.client, 'profile')],
                flags: MessageFlags.IsComponentsV2,
            }).catch(() => {});
            return true;
        }

        /* ── PREFIX ── */
        if (customId === 'botcustom_prefix') {
            const modal = new ModalBuilder().setCustomId('botcustom_prefix_modal').setTitle('Set Custom Prefix');
            const input = new TextInputBuilder()
                .setCustomId('prefix')
                .setLabel(`Custom prefix (1–${PREFIX_LIMIT} characters)`)
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('e.g. ! or >> or ?')
                .setMaxLength(PREFIX_LIMIT)
                .setMinLength(1)
                .setRequired(true);
            if (guildConfig.prefix) input.setValue(guildConfig.prefix);
            modal.addComponents(new ActionRowBuilder().addComponents(input));
            await interaction.showModal(modal);
            return true;
        }

        if (customId === 'botcustom_prefix_modal' && interaction.isModalSubmit()) {
            const newPrefix = interaction.fields.getTextInputValue('prefix').trim();
            guildConfig.prefix = newPrefix;
            saveConfig(config);
            // Mirror to the prefixes store so getGuildPrefix() in the
            // prefix command pipeline picks up the new value immediately.
            syncPrefixToFile(guildId, newPrefix);
            await interaction.reply({ content: `${E.success} Custom prefix set to \`${newPrefix}\`.`, flags: MessageFlags.Ephemeral });
            await rerender('behavior');
            return true;
        }

        if (customId === 'botcustom_reset_prefix') {
            guildConfig.prefix = null;
            saveConfig(config);
            syncPrefixToFile(guildId, null);
            await interaction.update({
                components: [buildCustomizePanel(guildConfig, interaction.guild, interaction.client, 'behavior')],
                flags: MessageFlags.IsComponentsV2,
            }).catch(() => {});
            return true;
        }

        /* ── COOLDOWN ── */
        if (customId === 'botcustom_cooldown') {
            const modal = new ModalBuilder().setCustomId('botcustom_cooldown_modal').setTitle('Set Command Cooldown');
            const input = new TextInputBuilder()
                .setCustomId('cooldown')
                .setLabel(`Cooldown in seconds (0–${COOLDOWN_MAX})`)
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('e.g. 3')
                .setMaxLength(2)
                .setRequired(true)
                .setValue(String(guildConfig.commandCooldown ?? 3));
            modal.addComponents(new ActionRowBuilder().addComponents(input));
            await interaction.showModal(modal);
            return true;
        }

        if (customId === 'botcustom_cooldown_modal' && interaction.isModalSubmit()) {
            const cd = parseInt(interaction.fields.getTextInputValue('cooldown').trim(), 10);
            if (!Number.isFinite(cd) || cd < 0 || cd > COOLDOWN_MAX) {
                await interaction.reply({ content: `${E.cancel} Please enter a number between 0 and ${COOLDOWN_MAX}.`, flags: MessageFlags.Ephemeral });
                return true;
            }
            guildConfig.commandCooldown = cd;
            saveConfig(config);
            await interaction.reply({ content: `${E.success} Command cooldown set to **${cd}s**.`, flags: MessageFlags.Ephemeral });
            await rerender('behavior');
            return true;
        }

        /* ── TOGGLES ── */
        if (customId === 'botcustom_toggle_delete') {
            guildConfig.deleteCommands = !guildConfig.deleteCommands;
            saveConfig(config);
            await interaction.update({
                components: [buildCustomizePanel(guildConfig, interaction.guild, interaction.client, 'behavior')],
                flags: MessageFlags.IsComponentsV2,
            }).catch(() => {});
            return true;
        }

        if (customId === 'botcustom_toggle_ephemeral') {
            guildConfig.ephemeralResponses = !guildConfig.ephemeralResponses;
            saveConfig(config);
            await interaction.update({
                components: [buildCustomizePanel(guildConfig, interaction.guild, interaction.client, 'behavior')],
                flags: MessageFlags.IsComponentsV2,
            }).catch(() => {});
            return true;
        }

        if (customId === 'botcustom_toggle_dm') {
            guildConfig.dmOnJoin = !guildConfig.dmOnJoin;
            saveConfig(config);
            await interaction.update({
                components: [buildCustomizePanel(guildConfig, interaction.guild, interaction.client, 'messages')],
                flags: MessageFlags.IsComponentsV2,
            }).catch(() => {});
            return true;
        }

        /* ── LANGUAGE TAG (informational) ── */
        if (customId === 'botcustom_language') {
            const langSelect = new StringSelectMenuBuilder()
                .setCustomId('botcustom_language_select')
                .setPlaceholder('Select language tag…')
                .addOptions(Object.entries(LANGUAGES).map(([key, v]) => ({
                    label: v.name, value: key, emoji: v.emoji,
                    default: guildConfig.language === key,
                })));
            await interaction.reply({
                components: [new ContainerBuilder()
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`${E.book} Select language tag (stored only — translations not yet wired up):`))
                    .addActionRowComponents(new ActionRowBuilder().addComponents(langSelect))],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            });
            return true;
        }

        if (customId === 'botcustom_language_select' && interaction.isStringSelectMenu()) {
            guildConfig.language = interaction.values[0];
            saveConfig(config);
            await interaction.update({
                content: `${E.success} Language tag set to **${LANGUAGES[guildConfig.language]?.name || guildConfig.language}**.`,
                components: [],
            }).catch(() => {});
            await rerender('messages');
            return true;
        }

        /* ── FOOTER TEXT ── */
        if (customId === 'botcustom_footer') {
            const modal = new ModalBuilder().setCustomId('botcustom_footer_modal').setTitle('Set Custom Footer');
            const input = new TextInputBuilder()
                .setCustomId('footer')
                .setLabel(`Footer text (max ${FOOTER_LIMIT} chars)`)
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('e.g. Powered by xNico — leave blank to clear')
                .setMaxLength(FOOTER_LIMIT)
                .setRequired(false);
            if (guildConfig.footerText) input.setValue(guildConfig.footerText);
            modal.addComponents(new ActionRowBuilder().addComponents(input));
            await interaction.showModal(modal);
            return true;
        }

        if (customId === 'botcustom_footer_modal' && interaction.isModalSubmit()) {
            const footerText = interaction.fields.getTextInputValue('footer').trim();
            guildConfig.footerText = footerText || null;
            saveConfig(config);
            await interaction.reply({
                content: footerText
                    ? `${E.success} Custom footer set: "${footerText}"`
                    : `${E.success} Custom footer cleared.`,
                flags: MessageFlags.Ephemeral,
            });
            await rerender('messages');
            return true;
        }

        /* ── FOOTER ICON ── */
        if (customId === 'botcustom_footer_icon') {
            const modal = new ModalBuilder().setCustomId('botcustom_footer_icon_modal').setTitle('Set Footer Icon');
            const input = new TextInputBuilder()
                .setCustomId('icon_url')
                .setLabel('Icon URL (PNG, JPG, GIF, WebP)')
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder('https://example.com/icon.png — blank to clear')
                .setRequired(false);
            if (guildConfig.footerIcon) input.setValue(guildConfig.footerIcon);
            modal.addComponents(new ActionRowBuilder().addComponents(input));
            await interaction.showModal(modal);
            return true;
        }

        if (customId === 'botcustom_footer_icon_modal' && interaction.isModalSubmit()) {
            const iconUrl = interaction.fields.getTextInputValue('icon_url').trim();
            if (iconUrl && !isValidImageUrl(iconUrl)) {
                await interaction.reply({ content: `${E.cancel} Please provide a valid image URL.`, flags: MessageFlags.Ephemeral });
                return true;
            }
            guildConfig.footerIcon = iconUrl || null;
            saveConfig(config);
            await interaction.reply({
                content: iconUrl
                    ? `${E.success} Footer icon set.`
                    : `${E.success} Footer icon cleared.`,
                flags: MessageFlags.Ephemeral,
            });
            await rerender('messages');
            return true;
        }

        /* ── DM MESSAGE ── */
        if (customId === 'botcustom_dm_message') {
            const modal = new ModalBuilder().setCustomId('botcustom_dm_message_modal').setTitle('Set DM Welcome Message');
            const input = new TextInputBuilder()
                .setCustomId('dm_message')
                .setLabel('DM message — supports {user}, {server}')
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder('Welcome {user} to {server}! We have {memberCount} members now.')
                .setMaxLength(1000)
                .setRequired(true);
            if (guildConfig.dmMessage) input.setValue(guildConfig.dmMessage);
            modal.addComponents(new ActionRowBuilder().addComponents(input));
            await interaction.showModal(modal);
            return true;
        }

        if (customId === 'botcustom_dm_message_modal' && interaction.isModalSubmit()) {
            const dmMessage = interaction.fields.getTextInputValue('dm_message').trim();
            guildConfig.dmMessage = dmMessage;
            saveConfig(config);
            await interaction.reply({ content: `${E.success} DM welcome message updated.`, flags: MessageFlags.Ephemeral });
            await rerender('messages');
            return true;
        }

        /* ── RESET MESSAGES (footer + footer icon + dm + language) ── */
        if (customId === 'botcustom_reset_messages') {
            guildConfig.footerText = null;
            guildConfig.footerIcon = null;
            guildConfig.dmOnJoin = false;
            guildConfig.dmMessage = null;
            guildConfig.language = 'en';
            saveConfig(config);
            await interaction.update({
                components: [buildCustomizePanel(guildConfig, interaction.guild, interaction.client, 'messages')],
                flags: MessageFlags.IsComponentsV2,
            }).catch(() => {});
            return true;
        }

        /* ── PREVIEW / EXPORT / RESETS ── */
        if (customId === 'botcustom_preview') {
            const botMember = interaction.guild.members.me;
            const avatarUrl = botMember.displayAvatarURL({ dynamic: true, size: 256 });
            const nickname = botMember.nickname || interaction.client.user.username;

            const lines = [];
            lines.push(`## ${E.eye} Bot Preview for ${interaction.guild.name}`);
            lines.push('');
            lines.push(`${E.copy} **Nickname:** ${nickname}`);
            lines.push(`${E.picture} **Avatar:** [link](${avatarUrl})`);
            lines.push(`${E.picture} **Banner:** ${guildConfig.bannerUrl ? `[link](${guildConfig.bannerUrl})` : '*(none)*'}`);
            lines.push(`${E.document} **About:** ${guildConfig.aboutText ? guildConfig.aboutText.slice(0, 200) : '*(none)*'}`);
            lines.push(`${E.edit} **Prefix:** ${guildConfig.prefix ? `\`${guildConfig.prefix}\`` : 'Default'}`);
            lines.push(`${E.palette} **Embed Color:** ${EMBED_COLORS[guildConfig.embedColor]?.name || 'Default'}`);
            lines.push(`${E.book} **Language Tag:** ${LANGUAGES[guildConfig.language]?.name || 'English'} *(stored only)*`);
            lines.push(`${E.document} **Footer:** ${guildConfig.footerText || '*(default)*'}`);
            lines.push(`${E.timer} **Cooldown:** ${guildConfig.commandCooldown}s`);
            lines.push(`${E.trash} **Auto-Delete:** ${guildConfig.deleteCommands ? 'Yes' : 'No'}`);
            lines.push(`${E.block} **Ephemeral:** ${guildConfig.ephemeralResponses ? 'Yes' : 'No'}`);
            lines.push(`${E.editAlt} **DM on Join:** ${guildConfig.dmOnJoin ? 'Enabled' : 'Disabled'}`);

            await interaction.reply({ content: lines.join('\n'), flags: MessageFlags.Ephemeral });
            return true;
        }

        if (customId === 'botcustom_export') {
            const cleaned = Object.fromEntries(Object.entries(guildConfig).filter(([, v]) => v !== null));
            const exportData = JSON.stringify(cleaned, null, 2);
            await interaction.reply({
                content: `${E.image} **Current Configuration:**\n\`\`\`json\n${exportData}\n\`\`\``,
                flags: MessageFlags.Ephemeral,
            });
            return true;
        }

        if (customId === 'botcustom_reset_nick') {
            try {
                await interaction.guild.members.me.setNickname(null);
                guildConfig.nickname = null;
                saveConfig(config);
                await interaction.update({
                    components: [buildCustomizePanel(guildConfig, interaction.guild, interaction.client, 'appearance')],
                    flags: MessageFlags.IsComponentsV2,
                }).catch(() => {});
            } catch (error) {
                await interaction.reply({ content: `${E.cancel} Failed to reset nickname: ${error.message}`, flags: MessageFlags.Ephemeral });
            }
            return true;
        }

        if (customId === 'botcustom_reset_avatar') {
            await interaction.deferUpdate();
            const result = await resetGuildAvatar(interaction.guild);
            guildConfig.avatarUrl = null;
            saveConfig(config);
            if (!result.success) {
                await interaction.followUp({ content: `${E.cancel} Local avatar cleared but API reset failed: ${result.error}`, flags: MessageFlags.Ephemeral });
            }
            await interaction.editReply({
                components: [buildCustomizePanel(guildConfig, interaction.guild, interaction.client, 'appearance')],
                flags: MessageFlags.IsComponentsV2,
            }).catch(() => {});
            return true;
        }

        /* ── HELP ── */
        if (customId === 'botcustom_help') {
            const help = [
                `# ${E.palette} Bot Customisation Help`,
                '',
                `## ${E.copy} Appearance`,
                `${E.edit} **Nickname** — Per-server bot nickname (live).`,
                `${E.picture} **Server Avatar** — Per-server avatar (live).`,
                `${E.palette} **Embed Color** — Applied to every CV2 container & classic embed.`,
                '',
                `## ${E.book} Profile`,
                `${E.picture} **Banner** — Per-server banner image, shown by \`/botprofile\`.`,
                `${E.document} **About / Bio** — Per-server bio, shown on the bot's home panel and \`/botprofile\`.`,
                '',
                `## ${E.settings} Behavior`,
                `${E.edit} **Custom Prefix** — 1–${PREFIX_LIMIT} chars, takes effect immediately.`,
                `${E.timer} **Cooldown** — 0–${COOLDOWN_MAX}s; premium users bypass.`,
                `${E.trash} **Auto-Delete** — Removes the user's command message after running.`,
                `${E.block} **Ephemeral** — Slash replies are visible only to the user.`,
                '',
                `## ${E.edit} Messages`,
                `${E.book} **Language Tag** — Stored only; translations not yet wired up.`,
                `${E.document} **Custom Footer** — Appears on every CV2 + classic embed.`,
                `${E.picture} **Footer Icon** — Optional icon shown beside the footer text in classic embeds.`,
                `${E.editAlt} **DM on Join** — Sends a customisable DM to new members.`,
                `> Variables: \`{user}\`, \`{server}\`, \`{memberCount}\``,
                '',
                `## Notes`,
                `• Avatar / nickname changes can take a few seconds to appear.`,
                `• Prefix changes take effect immediately for all members.`,
                `• Saved settings persist across bot restarts.`,
                ``,
                `-# ${E.bots} xNico • Configure these from the dashboard too.`,
            ].join('\n');

            await interaction.reply({ content: help, flags: MessageFlags.Ephemeral });
            return true;
        }

        return false;
    },
};
