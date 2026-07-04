/**
 * Owner-level temporary command disabling.
 *
 * The bot owner can disable any command (with a reason) when it's misbehaving.
 * While disabled, non-owner users who invoke it (slash or prefix) get a clean
 * "temporarily disabled" notice instead of an error, and the command never
 * runs. Owners bypass the gate so they can keep testing.
 *
 * Persisted in the `disabled-commands` store (a CRITICAL_STORE, so it survives
 * restarts). Keyed by canonical (lowercased) command name.
 */
const { ContainerBuilder, TextDisplayBuilder } = require('discord.js');
const jsonStore = require('./jsonStore');

const STORE = 'disabled-commands';

// Commands that must never be disabled — otherwise the owner could lock
// themselves out of the management + help surface.
const PROTECTED = new Set(['disablecommand', 'help']);

function load() {
    try {
        if (!jsonStore.has(STORE)) return {};
        return jsonStore.read(STORE) || {};
    } catch { return {}; }
}

function save(data) {
    jsonStore.write(STORE, data);
}

/** Returns the disable record `{ reason, by, at }` or null. */
function isDisabled(name) {
    if (!name) return null;
    return load()[String(name).toLowerCase()] || null;
}

function isProtected(name) {
    return PROTECTED.has(String(name || '').toLowerCase());
}

function disable(name, reason, by) {
    const key = String(name).toLowerCase();
    const data = load();
    data[key] = { reason: (reason || 'No reason provided').slice(0, 400), by: by || null, at: Date.now() };
    save(data);
    return data[key];
}

function enable(name) {
    const key = String(name).toLowerCase();
    const data = load();
    if (!data[key]) return false;
    delete data[key];
    save(data);
    return true;
}

function list() {
    return load();
}

/** Professional "this command is temporarily disabled" notice. */
function buildNotice(name, rec) {
    const ts = rec?.at ? ` <t:${Math.floor(rec.at / 1000)}:R>` : '';
    return new ContainerBuilder()
        .setAccentColor(0xED4245)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `## <:Lock:1521227892770734120> Command Temporarily Disabled\n` +
            `The **${name}** command is currently disabled by the bot owner.\n\n` +
            `**Reason:** ${rec?.reason || 'No reason provided'}\n` +
            (rec?.by ? `-# Disabled by <@${rec.by}>${ts}` : '')
        ));
}

module.exports = { STORE, isDisabled, isProtected, disable, enable, list, buildNotice };
