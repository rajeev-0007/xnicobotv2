/**
 * resolveUser — Robust user resolution for prefix commands.
 *
 * Discord.js `message.mentions.users.first()` can return null in
 * several edge cases:
 *   - The mentioned user left the guild (ID valid but not cached)
 *   - The mention was copy-pasted as raw text `<@ID>`
 *   - Intents/partials race on large guilds
 *
 * This helper tries multiple strategies in order:
 *   1. message.mentions.users.first()
 *   2. Parse <@ID> or <@!ID> from args[0] and fetch
 *   3. Treat args[0] as a raw user ID and fetch
 *
 * Usage:
 *   const { resolveUser } = require('../../utils/resolveUser');
 *   const user = await resolveUser(message, args);
 *   if (!user) return message.reply('User not found');
 */

'use strict';

/**
 * @param {Message} message - Discord.js message
 * @param {string[]} args - Command arguments (first arg should be the user mention/ID)
 * @returns {Promise<User|null>}
 */
async function resolveUser(message, args) {
    // Strategy 1: Discord.js parsed mentions
    const mentioned = message.mentions?.users?.first?.();
    if (mentioned) return mentioned;

    // Strategy 2: Parse mention format from args
    const raw = args?.[0];
    if (!raw) return null;

    const idMatch = raw.match(/^<@!?(\d{17,20})>$/) || raw.match(/^(\d{17,20})$/);
    if (!idMatch) return null;

    const userId = idMatch[1];

    // Strategy 3: Fetch from client
    try {
        return await message.client.users.fetch(userId);
    } catch {
        return null;
    }
}

module.exports = { resolveUser };
