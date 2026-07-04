/**
 * securityUI.js — Shared helpers for the security command family
 * (anti, antinuke, antialt, antiraid, antispam, threatmode,
 * superthreatmode, automod). Centralizes the bot-branded emoji set,
 * accent colors, and a few common builders so each panel stays
 * visually consistent without each file copy-pasting the same
 * `<:Toggleon:...>` / accent-color logic.
 *
 * Why a separate module from `theme.js`/`responseBuilder.js`?
 *   • theme.js is for *globally applicable* colors and generic
 *     emojis used everywhere.
 *   • responseBuilder.js is for one-off success/error/info replies.
 *   • This module is for the **security panel UX** specifically:
 *     the action validators, the toggle/protection rendering, and
 *     the threat-mode / super-threat-mode badge logic that several
 *     of these commands share.
 *
 * Kept intentionally small. Each command still owns its own
 * persistence and business logic.
 */

const {
    ContainerBuilder, TextDisplayBuilder, SeparatorBuilder,
    SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    MessageFlags,
} = require('discord.js');
const { THEME, formatCheck } = require('./theme');
const { BRANDING, EMOJIS, COLORS } = require('./responseBuilder');

/* ─────────────────────────── colors ──────────────────────────── */

const SEC_COLORS = {
    /** System armed / protections active */
    SAFE:    0x57F287,
    /** System unarmed / inactive */
    OFF:     0xED4245,
    /** Threat mode active (yellow/amber) */
    WARN:    0xFEE75C,
    /** Super-threat / dangerous override */
    DANGER:  0xED4245,
    /** Brand neutral */
    BRAND:   0xCAD7E6,
};

/* ───────────────────────── action validators ─────────────────── */

/**
 * Allowed punishment actions per protection module.
 * The previous implementation accepted `kick_bot` for `banProtection`,
 * `kickProtection`, etc. — but the security engine ignores it for
 * those modules, so the user got a silent "saved but does nothing"
 * outcome. Validate up-front instead.
 */
const ACTIONS_FOR = {
    banProtection:  ['remove_roles', 'kick', 'ban', 'timeout'],
    kickProtection: ['remove_roles', 'kick', 'ban', 'timeout'],
    channelDelete:  ['remove_roles', 'kick', 'ban', 'timeout'],
    channelCreate:  ['remove_roles', 'kick', 'ban', 'timeout'],
    roleDelete:     ['remove_roles', 'kick', 'ban', 'timeout'],
    roleCreate:     ['remove_roles', 'kick', 'ban', 'timeout'],
    webhookCreate:  ['remove_roles', 'kick', 'ban', 'timeout'],
    botAdd:         ['kick_bot', 'kick_both', 'ban_bot'],
};

function isValidActionFor(moduleKey, action) {
    const allowed = ACTIONS_FOR[moduleKey];
    return Array.isArray(allowed) && allowed.includes(action);
}

/** Returns the actions allowed by every key in `moduleKeys`. */
function commonActions(moduleKeys) {
    if (!moduleKeys.length) return [];
    let intersection = ACTIONS_FOR[moduleKeys[0]] || [];
    for (let i = 1; i < moduleKeys.length; i++) {
        const next = new Set(ACTIONS_FOR[moduleKeys[i]] || []);
        intersection = intersection.filter(a => next.has(a));
    }
    return intersection;
}

/* ─────────────────────────── builders ────────────────────────── */

/** Common badge for "system armed/inactive/threat-mode" lines. */
function statusBadge({ enabled = false, threat = false, superThreat = false, enabledCount = 0, total = 0 }) {
    if (superThreat) return `${EMOJIS.WARN} **SUPER THREAT MODE** — Maximum lockdown active`;
    if (threat)      return `${EMOJIS.WARN} **THREAT MODE** — Stricter limits in effect`;
    if (enabled)     return `${EMOJIS.SUCCESS} **System Armed** — \`${enabledCount}/${total}\` protection${total === 1 ? '' : 's'} active`;
    return `${EMOJIS.ERROR} **System Offline** — Your server is unprotected`;
}

/**
 * Footer line with branding. Use the same line on every security panel
 * so the bot identity is consistent.
 */
function brandFooter() {
    return BRANDING; // already starts with `-#` for subscript style
}

/**
 * Wrap a panel body in the standard layout:
 *   header → divider → status → divider → body → buttons → branding
 */
function wrapPanel({ accent, header, status, body, components = [] } = {}) {
    const c = new ContainerBuilder().setAccentColor(accent ?? SEC_COLORS.BRAND);
    if (header) c.addTextDisplayComponents(new TextDisplayBuilder().setContent(header));
    if (status) {
        c.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
        c.addTextDisplayComponents(new TextDisplayBuilder().setContent(status));
    }
    if (body) {
        c.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
        c.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
    }
    for (const comp of components) c.addActionRowComponents(comp);
    // Footer will be injected by the runtime patcher
    return c;
}

/* ───────────────────── toggle button row ─────────────────────── */

/** Standard arm/disarm toggle row used by antinuke + threat panels. */
function buildToggleRow(customId, isOn, { onLabel = 'Disable', offLabel = 'Enable', disabled = false } = {}) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(customId)
            .setLabel(isOn ? onLabel : offLabel)
            .setStyle(isOn ? ButtonStyle.Danger : ButtonStyle.Success)
            .setEmoji(isOn ? THEME.EMOJIS.TOGGLE_OFF : THEME.EMOJIS.TOGGLE_ON)
            .setDisabled(!!disabled),
    );
}

/* ────────────────── ephemeral validation reply helper ────────── */

/** Build a Components-V2 ephemeral error reply for invalid input. */
function v2InvalidReply(text) {
    return {
        components: [new ContainerBuilder()
            .setAccentColor(SEC_COLORS.OFF)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${EMOJIS.ERROR} ${text}`))],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    };
}

module.exports = {
    SEC_COLORS,
    ACTIONS_FOR,
    isValidActionFor,
    commonActions,
    statusBadge,
    brandFooter,
    wrapPanel,
    buildToggleRow,
    v2InvalidReply,
};
