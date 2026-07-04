'use strict';

/**
 * -vcmod
 * ───────────────────────────────────────────────────────────────────
 * List trusted VC moderators in the guild. The previous version
 * built one big container with all entries inlined, which can hit
 * the 4 000-char Components V2 cap on guilds with a lot of trusted
 * staff. Now uses the shared pagination helper, matching `-mods`
 * and `-admins` style for consistency.
 */

const { MessageFlags } = require('discord.js');
const { COLORS, buildErrorResponse } = require('../../utils/responseBuilder');
const { paginate, setupPaginationCollector } = require('../../utils/pagination');
const { createContainer, addTextDisplay, addSeparator } = require('../../utils/componentHelpers');
const trust = require('../../utils/trustManager');

const E = {
    mic:       '<:Microphone:1521227746376683590>',
    user:      '<:User:1521227714227343380>',
    role:      '<:Userplus:1521227719621218477>',
    caret:     '<:Caretright:1521227704953864202>',
    shield:    '<:Shield:1521227694677692467>',
    cancel:    '<:Cancel:1521227723916181644>' };

function formatEntryLine(entry) {
    const mention  = entry.type === 'user' ? `<@${entry.id}>` : `<@&${entry.id}>`;
    const typeIcon = entry.type === 'user' ? E.user : E.role;
    const addedBy  = entry.addedBy ? `by <@${entry.addedBy}>` : 'by *unknown*';
    const addedAt  = entry.addedAt
        ? `<t:${Math.floor(new Date(entry.addedAt).getTime() / 1000)}:R>`
        : '*unknown time*';
    return `${typeIcon} ${mention} — added ${addedAt} ${addedBy}`;
}

module.exports = {
    prefix:      'vcmod',
    description: 'Display all trusted VC moderators in this guild',
    usage:       'vcmod',
    category:    'admin',
    aliases:     ['vcmods', 'listvcmods', 'vcmodlist'],

    async executePrefix(message) {
        try {
            const entries = trust.getList(message.guild.id, 'vcmods');

            if (entries.length === 0) {
                const container = createContainer(COLORS.INFO);
                addTextDisplay(
                    container,
                    `# ${E.mic} Trusted VC Moderators\n\n` +
                    `*No VC moderators in the trust list*\n\n` +
                    `-# Use \`add-vcmod @user\` to grant trust.`,
                );
                addSeparator(container);
                return message.reply({
                    components: [container],
                    flags: MessageFlags.IsComponentsV2 });
            }

            const lines = entries.map(formatEntryLine);

            const result = paginate({
                header:
                    `# ${E.mic} Trusted VC Moderators\n` +
                    `${E.caret} **Server:** ${message.guild.name}\n` +
                    `${E.caret} **Total:** ${entries.length}\n` +
                    `${E.caret} **Trust Role:** Trusted VC Mod\n` +
                    `${E.caret} **Permissions:** Mute · Deafen · Move Members\n` +
                    `-# Use \`add-vcmod @user\` or \`remove-vcmod @user\` to manage.`,
                lines,
                perPage:     15,
                accentColor: COLORS.INFO });

            const reply = await message.reply(result);
            setupPaginationCollector(reply, result._pageData, message.author.id);
        } catch (error) {
            console.error('[VCMod] Error:', error);
            const container = buildErrorResponse(
                'Error',
                'An error occurred while executing this command.',
                error.message,
            );
            return message.reply({
                components: [container],
                flags: MessageFlags.IsComponentsV2 });
        }
    } };
