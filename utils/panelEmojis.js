/**
 * Central state glyphs for every config panel.
 *
 * ── THIS IS THE ONE PLACE TO EDIT ──────────────────────────────────────────
 * Panels ship EMOJI-FREE. To turn emojis back on, put the emoji strings in
 * PANEL_EMOJIS below and every panel picks them up — welcomer, message-builder,
 * antispam, emergency and nightmode all read from here.
 *
 *   const PANEL_EMOJIS = {
 *       ON:  '<:Toggleon:1521227758011809964>',
 *       OFF: '<:Toggleoff:1521227763816595559>',
 *   };
 *
 * Nothing else needs changing.
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Why this is not just a pair of constants:
 *
 * An empty emoji cannot simply be dropped in. Discord rejects setEmoji('') with
 * "Invalid Form Body", so an unset glyph has to become `undefined` and the
 * setEmoji call has to be skipped entirely.
 *
 * More importantly, several panels encoded state ONLY in the glyph — a layout
 * menu showed which mode was active purely by which option carried the "on"
 * emoji. Removing the emoji without a replacement would have made those rows
 * unreadable: five options, no indication which one is live. So when emojis are
 * off, state falls back to a short text marker instead, and it stays visible.
 */

/** Set these to emoji strings to enable emojis everywhere. Empty = emoji-free. */
const PANEL_EMOJIS = {
    ON: '',
    OFF: '',
};

/** Text used in place of the emojis while they are empty. Also editable. */
const PANEL_TEXT_MARKS = {
    ON: '`on`',
    OFF: '`off`',
};

/** True when emojis are configured, i.e. both glyphs are non-empty. */
function emojisEnabled() {
    return Boolean(PANEL_EMOJIS.ON && PANEL_EMOJIS.OFF);
}

/**
 * For a select option's `emoji` field, or a builder's setEmoji().
 * Returns undefined when emojis are off, so callers must skip setEmoji —
 * passing '' throws Invalid Form Body.
 */
function stateEmoji(isOn) {
    if (!emojisEnabled()) return undefined;
    return isOn ? PANEL_EMOJIS.ON : PANEL_EMOJIS.OFF;
}

/**
 * For inline panel text: `statePrefix(on) + 'Image'`.
 * Yields the emoji plus a space when enabled, otherwise the text marker plus a
 * space, so a status line never renders as a bare orphaned label.
 */
function statePrefix(isOn) {
    const glyph = stateEmoji(isOn);
    if (glyph) return glyph + ' ';
    return (isOn ? PANEL_TEXT_MARKS.ON : PANEL_TEXT_MARKS.OFF) + ' ';
}

/**
 * Same as statePrefix but WITHOUT the trailing space, for text that already
 * supplies its own separator: `stateText(on) + ' Image'`.
 */
function stateText(isOn) {
    const glyph = stateEmoji(isOn);
    if (glyph) return glyph;
    return isOn ? PANEL_TEXT_MARKS.ON : PANEL_TEXT_MARKS.OFF;
}

/**
 * For a select option's description, when the emoji cannot carry the state.
 * Appends nothing while emojis are on (the glyph already says it), and a short
 * marker when they are off.
 */
function annotateState(description, isOn) {
    const base = description == null ? '' : String(description);
    if (emojisEnabled()) return base || undefined;
    const mark = isOn ? 'on' : 'off';
    const out = base ? `${base} \u00b7 ${mark}` : mark;
    return out.slice(0, 100);
}

/**
 * Applies state to a plain option descriptor `{ label, value, description }`.
 * Sets `emoji` when available; otherwise folds the state into the description,
 * so which option is active is always visible either way.
 */
function withState(option, isOn) {
    const out = { ...option };
    const glyph = stateEmoji(isOn);
    if (glyph) {
        out.emoji = glyph;
    } else {
        delete out.emoji;
        out.description = annotateState(out.description, isOn);
    }
    return out;
}

module.exports = {
    PANEL_EMOJIS,
    PANEL_TEXT_MARKS,
    emojisEnabled,
    stateEmoji,
    statePrefix,
    stateText,
    annotateState,
    withState,
};
