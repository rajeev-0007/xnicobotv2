const { MessageFlags } = require('discord.js');
const { COLORS, buildErrorResponse } = require('../../utils/responseBuilder');
const { paginate, setupPaginationCollector } = require('../../utils/pagination');
const { createContainer, addTextDisplay, addSeparator } = require('../../utils/componentHelpers');
const trust = require('../../utils/trustManager');

module.exports = {
    prefix: 'mods',
    description: 'Display all trusted moderators in this guild',
    usage: 'mods',
    category: 'admin',
    aliases: ['listmods', 'modlist'],

    async executePrefix(message) {
        try {
            const entries = trust.getList(message.guild.id, 'mods');

            if (entries.length === 0) {
                const container = createContainer(COLORS.INFO);
                addTextDisplay(container, `# <:Shield:1521227694677692467> Trusted Moderators\n\n*No moderators in the trust list*\n\n-# Use \`addmod @user\` to add moderators`);
                addSeparator(container);
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            const allLines = entries.map(entry => {
                const mention = entry.type === 'user' ? `<@${entry.id}>` : `<@&${entry.id}>`;
                const typeIcon = entry.type === 'user' ? '<:User:1521227714227343380>' : '<:Userplus:1521227719621218477>';
                const addedBy = entry.addedBy ? `by <@${entry.addedBy}>` : '';
                const addedAt = entry.addedAt ? `<t:${Math.floor(new Date(entry.addedAt).getTime() / 1000)}:R>` : 'Unknown';
                return `${typeIcon} ${mention} — added ${addedAt} ${addedBy}`;
            });

            const result = paginate({
                header: `# <:Shield:1521227694677692467> Trusted Moderators\n\n` +
                    `**Server:** ${message.guild.name}\n` +
                    `**Total:** ${entries.length}\n` +
                    `**Trust Role:** Trusted Moderator\n` +
                    `**Permissions:** Kick, Manage Messages/Nicknames, Mute, Deafen, Move, Timeout`,
                lines: allLines,
                perPage: 15,
                accentColor: COLORS.INFO });

            const reply = await message.reply(result);
            setupPaginationCollector(reply, result._pageData, message.author.id);
        } catch (error) {
            console.error('[Mods] Error:', error);
            const container = buildErrorResponse('Error', 'An error occurred while executing this command.', error.message);
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
