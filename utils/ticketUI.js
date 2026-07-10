/**
 * Ticket UI helpers
 *
 * Centralizes the tiny things that used to be duplicated across the
 * ticket commands and `index.js`: emoji set, button rows, success /
 * error containers and the in-memory creation lock that prevents
 * users from spam-clicking the panel dropdown and opening multiple
 * tickets concurrently.
 *
 * Keeping these in one place makes the whole ticket UX feel
 * consistent — every command uses the same labels, colors, and
 * accent colors.
 */

const {
    ActionRowBuilder, ButtonBuilder, ButtonStyle,
    ContainerBuilder, TextDisplayBuilder, SeparatorBuilder,
    SeparatorSpacingSize, MessageFlags,
} = require('discord.js');

/* ───────────────────────────── colors ───────────────────────────── */
const COLOR = {
    BRAND: 0xCAD7E6,
    SUCCESS: 0x57F287,
    WARNING: 0xF1C40F,
    DANGER: 0xED4245,
    INFO: 0x5865F2,
};

/* ───────────────────────────── emojis ───────────────────────────── */
// Single source of truth so we don't end up with mixed unicode + custom
// emojis bleeding into the same panel/welcome.
const E = {
    ok: '<:Checkedbox:1521227734943269077>',
    cancel: '<:Cancel:1521227723916181644>',
    info: '<:Inforect:1521228008285929532>',
    warn: '<:Infotriangle:1521227710381428926>',
    right: '<:Caretright:1521227704953864202>',
    document: '<:Document:1521227875016114266>',
    clipboard: '<:Clipboard:1521228175298920448>',
    transcript: '<:Clipboardalt:1521228169753923755>',
    bookopen: '<:Bookopen:1521227911137595605>',
    star: '<:Star:1521227981685526568>',
    settings: '<:Settings:1521227767780343879>',
    edit: '<:Edit:1521227886634205298>',
    chat: '<:Hashtag:1521227771957870604>',
    bulb: '<:Lightbulbalt:1521227880703463675>',
    lock: '<:Lock:1521227892770734120>',
    ticket: '<:Document:1521227875016114266>',  // alias for visual variety
};

/* ───────────────────────────── buttons ──────────────────────────── */
/**
 * Build the canonical 3-button row that lives at the bottom of every
 * ticket welcome message. Pass `claimedBy` so a claimed ticket greys
 * out the claim button instead of pretending it's still claimable.
 */
function buildTicketButtons({ claimedBy = null, locked = false } = {}) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('ticket_claim')
            .setLabel(claimedBy ? 'Claimed' : 'Claim Ticket')
            .setStyle(claimedBy ? ButtonStyle.Success : ButtonStyle.Primary)
            .setEmoji(E.ok)
            .setDisabled(!!claimedBy || locked),
        new ButtonBuilder()
            .setCustomId('ticket_close_btn')
            .setLabel('Close Ticket')
            .setStyle(ButtonStyle.Danger)
            .setEmoji(E.lock)
            .setDisabled(locked),
        new ButtonBuilder()
            .setCustomId('ticket_transcript')
            .setLabel('Save Transcript')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji(E.transcript)
            .setDisabled(locked),
    );
}

/* ───────────────────── container helpers ────────────────────────── */
/** Build a single-text-block container with an accent color. */
function buildContainer(text, color = COLOR.BRAND) {
    return new ContainerBuilder()
        .setAccentColor(color)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
}

function successContainer(text) { return buildContainer(`${E.ok} ${text}`, COLOR.SUCCESS); }
function errorContainer(text) { return buildContainer(`${E.cancel} ${text}`, COLOR.DANGER); }
function infoContainer(text) { return buildContainer(`${E.info} ${text}`, COLOR.BRAND); }
function warnContainer(text) { return buildContainer(`${E.warn} ${text}`, COLOR.WARNING); }

function v2Reply(container, ephemeral = false) {
    return {
        components: [container],
        flags: ephemeral
            ? MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
            : MessageFlags.IsComponentsV2,
    };
}

/* ─────────────────────── creation lock ──────────────────────────── */
// Prevents one user from spam-clicking the dropdown and creating
// duplicate channels before the tickets.json write lands.
const _creationLocks = new Set();
function lockCreation(guildId, userId) {
    const key = `${guildId}:${userId}`;
    if (_creationLocks.has(key)) return false;
    _creationLocks.add(key);
    setTimeout(() => _creationLocks.delete(key), 30_000); // safety unlock
    return true;
}
function unlockCreation(guildId, userId) {
    _creationLocks.delete(`${guildId}:${userId}`);
}

/* ───────────────────────── duration ─────────────────────────────── */
/** Pretty "5m", "2h 13m", "3d 4h" duration formatter. */
function formatDuration(ms) {
    if (!ms || ms < 0) return 'just now';
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    const d = Math.floor(h / 24);
    if (d > 0) return `${d}d ${h % 24}h`;
    if (h > 0) return `${h}h ${m % 60}m`;
    if (m > 0) return `${m}m ${s % 60}s`;
    return `${s}s`;
}

/* ─────────────────────── permission check ───────────────────────── */
/**
 * Returns true if the member is allowed to manage *this* ticket.
 * `level` controls strictness:
 *   - 'view'  → owner / claimer / support / admin   (default)
 *   - 'staff' → support / admin only
 */
function canManageTicket(member, guildConfig, ticket, { level = 'view' } = {}) {
    if (!member || !ticket) return false;
    const isAdmin = member.permissions?.has?.('ManageGuild') || member.permissions?.has?.('Administrator');
    if (isAdmin) return true;

    const supportRoleId = ticket.supportRoleId || guildConfig?.supportRoleId;
    const isSupport = supportRoleId ? member.roles.cache.has(supportRoleId) : false;
    if (isSupport) return true;

    if (level === 'staff') return false;

    const isOwner = ticket.userId === member.id;
    const isClaimer = ticket.claimedBy === member.id;
    return isOwner || isClaimer;
}

module.exports = {
    COLOR,
    E,
    buildTicketButtons,
    buildContainer,
    successContainer,
    errorContainer,
    infoContainer,
    warnContainer,
    v2Reply,
    lockCreation,
    unlockCreation,
    formatDuration,
    canManageTicket,
    SeparatorBuilder,
    SeparatorSpacingSize,
};
