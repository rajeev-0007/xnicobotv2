'use strict';

/**
 * musicResponse.js — Brand-consistent reply helpers for the /commands/music
 * suite. Centralizes the success / error / info container shape, the
 * BRANDING footer, accent colors, and the standard player-pre-flight guard
 * (player exists, has a current track, caller is in the same VC). Keeps
 * every music command terse and visually coherent.
 *
 * All helpers return a `ContainerBuilder` ready to be sent with the
 * Components V2 flag. Use `replyMusic()` to dispatch — it adapts to both
 * slash interactions and prefix messages, normalizes flags, and resolves
 * to the actual sent `Message` so callers can use the returned `.id`
 * (e.g. for caching).
 */

const {
    ContainerBuilder, TextDisplayBuilder,
    SeparatorBuilder, SeparatorSpacingSize,
    MessageFlags,
} = require('discord.js');

const { BRANDING } = require('./responseBuilder');
const { voiceErrorMessage } = require('./musicHelpers');

const CV2     = MessageFlags.IsComponentsV2;
const CV2_EPH = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;

const COLOR = {
    BRAND:   0xCAD7E6,
    SUCCESS: 0x57F287,
    INFO:    0x5865F2,
    WARNING: 0xFEE75C,
    ERROR:   0xED4245,
    SPOTIFY: 0x1DB954,
};

const ICON = {
    SUCCESS:  '<:Checkedbox:1521227734943269077>',
    ERROR:    '<:Cancel:1521227723916181644>',
    WARNING:  '<:Infotriangle:1521227710381428926>',
    INFO:     '<:Bookopen:1521227911137595605>',
    LOADING:  '<:Lightning:1521227915537285150>',
    MUSIC:    '<:Music:1521228141543165982>',
};

/* ───────────────────────────────────────────────────────────────────── */

// Shown at the bottom of EVERY music card so users always know the self-heal
// path when playback misbehaves (node offline, track stuck, nothing plays…).
const MUSIC_FIX_HINT = '<:Refresh:1521227946441052420> Music not playing right? Run `fix` to reconnect the nodes, then play again.';

function _attachFooter(container, { brand = true } = {}) {
    container.addSeparatorComponents(
        new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    );
    const lines = [`-# ${MUSIC_FIX_HINT}`];
    if (brand) lines.push(BRANDING);
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(lines.join('\n'))
    );
    return container;
}

/**
 * Build a brand-styled music container.
 *
 * @param {object}  o
 * @param {string}  o.title         Displayed as `# <emoji> Title`
 * @param {string} [o.emoji]        Inline title emoji
 * @param {string} [o.body]         Body text (markdown, multi-line ok)
 * @param {string} [o.footer]       Subtle footer (rendered with `-#`)
 * @param {number} [o.color]        Discord colour (default brand)
 * @param {boolean}[o.brand=true]   Append the BRANDING footer
 * @returns {ContainerBuilder}
 */
function buildMusicContainer({ title, emoji, body, footer, color = COLOR.BRAND, brand = true } = {}) {
    let content = `# ${emoji ? `${emoji} ` : ''}${title || ''}`.trim();
    if (body)   content += `\n\n${body}`;
    if (footer) content += `\n\n-# ${footer}`;

    const c = new ContainerBuilder().setAccentColor(color);
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
    // Always show the `fix` recovery hint; append the brand line for
    // non-error cards (errors stay compact but still get the fix hint).
    return _attachFooter(c, { brand });
}

const musicSuccess = (title, body, footer) =>
    buildMusicContainer({ title, body, footer, emoji: ICON.SUCCESS, color: COLOR.BRAND });

const musicInfo = (title, body, footer) =>
    buildMusicContainer({ title, body, footer, color: COLOR.BRAND });

const musicWarn = (title, body, footer) =>
    buildMusicContainer({ title, body, footer, emoji: ICON.WARNING, color: COLOR.WARNING });

/**
 * Errors route the optional `suggestion` argument through the dedicated
 * footer slot so it renders identically to success/info footers. Errors
 * skip the BRANDING footer to keep the response compact.
 */
const musicError = (title, body, suggestion) =>
    buildMusicContainer({
        title, body,
        footer: suggestion || null,
        emoji: ICON.ERROR,
        color: COLOR.ERROR,
        brand: false,
    });

const musicLoading = (title, body, footer) =>
    buildMusicContainer({ title, body, footer, emoji: ICON.LOADING, color: COLOR.INFO });

/* ───────────────────────────────────────────────────────────────────── */

const isSlashLike = (target) =>
    typeof target?.isRepliable === 'function' || typeof target?.deferReply === 'function';

/**
 * Resolve the sent reply to a real `Message` so callers can read `.id`,
 * `.channel`, etc. consistently. For prefix messages this is already the
 * case; for slash interactions we promote the `InteractionResponse` to a
 * `Message` via `fetchReply()`.
 */
async function _resolveSent(target, sent) {
    if (!sent) return null;
    // Slash: returned value is InteractionResponse — fetch the underlying Message.
    if (isSlashLike(target) && typeof target.fetchReply === 'function') {
        try {
            const msg = await target.fetchReply();
            if (msg) return msg;
        } catch { /* fall through to the raw return value */ }
    }
    return sent;
}

/**
 * Universal reply helper — works with both slash interactions and prefix
 * messages. Picks the right method based on the call-site state.
 *
 * For prefix messages the `ephemeral` flag is silently ignored (regular
 * messages can't be ephemeral). For slash interactions the recovery path
 * (when `editReply` fails) preserves the original ephemerality.
 *
 * @param {Interaction|Message} target
 * @param {ContainerBuilder}    container
 * @param {object}             [opts]
 * @param {boolean}            [opts.ephemeral=false]   Slash-only (ignored for prefix)
 * @param {Array}              [opts.extra]             Extra top-level CV2 components
 * @returns {Promise<Message|null>} The sent Message (or null on failure)
 */
async function replyMusic(target, container, opts = {}) {
    const slash = isSlashLike(target);
    const wantEphemeral = !!opts.ephemeral && slash;
    const flags = wantEphemeral ? CV2_EPH : CV2;
    const components = opts.extra ? [container, ...opts.extra] : [container];
    const payload = { components, flags };
    const recoveryFlags = wantEphemeral ? CV2_EPH : CV2;

    if (slash) {
        try {
            // Once an interaction is deferred or replied, its ephemerality is
            // locked in by the original ack — `editReply` cannot switch it.
            // Drop the ephemeral bit on the recovery `followUp` only.
            if (target.deferred || target.replied) {
                const r = await target.editReply(payload);
                return _resolveSent(target, r);
            }
            const r = await target.reply(payload);
            return _resolveSent(target, r);
        } catch {
            try {
                const r = await target.followUp({ ...payload, flags: recoveryFlags });
                return r || null;
            } catch {
                return null;
            }
        }
    }

    // Plain Message — `Ephemeral` flag is invalid here, never set.
    try {
        return await target.reply(payload);
    } catch {
        return null;
    }
}

/* ───────────────────────────────────────────────────────────────────── */

/**
 * Standard pre-flight guard for any track-affecting command.
 *
 * Checks (in order):
 *   1. Player exists
 *   2. (optional) A track is currently playing
 *   3. Caller is in the same voice channel as the bot
 *
 * @param {object}  o
 * @param {Player}  o.player
 * @param {GuildMember} o.member
 * @param {boolean}[o.requireCurrent=true]   Enforce a current track
 * @returns {{ok: true} | {ok: false, container: ContainerBuilder, ephemeral: true}}
 */
function preflightPlayer({ player, member, requireCurrent = true }) {
    if (!player) {
        return {
            ok: false, ephemeral: true,
            container: musicError('No Music Playing', 'Nothing is currently playing.', 'Start playback with `/play <song>`.'),
        };
    }
    if (requireCurrent && !player.queue?.current) {
        return {
            ok: false, ephemeral: true,
            container: musicError('No Track Playing', 'There is no active track.'),
        };
    }
    const voiceErr = voiceErrorMessage(member, player);
    if (voiceErr) {
        return {
            ok: false, ephemeral: true,
            container: musicError('Voice Required', voiceErr),
        };
    }
    return { ok: true };
}

/**
 * Voice-only guard for spawn paths that may have no player yet (play,
 * search, playtop, playskip…).
 *
 * @returns {null | {container: ContainerBuilder, ephemeral: true}}
 */
function preflightVoiceOnly(member) {
    if (!member?.voice?.channel) {
        return {
            container: musicError('Voice Required', 'Join a voice channel before using this command.'),
            ephemeral: true,
        };
    }
    return null;
}

/* ───────────────────────────────────────────────────────────────────── */

module.exports = {
    CV2, CV2_EPH, COLOR, ICON,
    buildMusicContainer,
    musicSuccess, musicInfo, musicWarn, musicError, musicLoading,
    replyMusic,
    preflightPlayer, preflightVoiceOnly,
};
