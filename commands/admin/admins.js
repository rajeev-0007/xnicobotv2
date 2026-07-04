const { MessageFlags } = require('discord.js');
const { COLORS, buildErrorResponse } = require('../../utils/responseBuilder');
const { paginate, setupPaginationCollector } = require('../../utils/pagination');
const { createContainer, addTextDisplay, addSeparator } = require('../../utils/componentHelpers');
const trust = require('../../utils/trustManager');

module.exports = {
    prefix: 'admins',
    description: 'Display all trusted admins in this guild',
    usage: 'admins',
    category: 'admin',
    aliases: ['listadmins', 'adminlist'],

    async executePrefix(message) {
        try {
            const entries = trust.getList(message.guild.id, 'admins');

            if (entries.length === 0) {
                const container = createContainer(COLORS.INFO);
                addTextDisplay(container, `# <:Shield:1521227694677692467> Trusted Admins\n\n*No admins in the trust list*\n\n-# Use \`add-admin @user\` to add admins`);
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
                header: `# <:Shield:1521227694677692467> Trusted Admins\n\n` +
                    `<:Caretright:1521227704953864202> **Server:** ${message.guild.name}\n` +
                    `<:Caretright:1521227704953864202> **Total:** ${entries.length}\n` +
                    `<:Caretright:1521227704953864202> **Trust Role:** Trusted Admin\n` +
                    `<:Caretright:1521227704953864202> **Permissions:** Manage Channels, Roles, Messages, Ban, Kick, Mute, Move, Timeout`,
                lines: allLines,
                perPage: 15,
                accentColor: COLORS.INFO });

            const reply = await message.reply(result);
            setupPaginationCollector(reply, result._pageData, message.author.id);
        } catch (error) {
            console.error('[Admins] Error:', error);
            const container = buildErrorResponse('Error', 'An error occurred while executing this command.', error.message);
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
