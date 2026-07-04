const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } = require('discord.js');
const { COLORS, buildErrorResponse } = require('../../utils/responseBuilder');
const trust = require('../../utils/trustManager');

module.exports = {
    prefix: 'modreset',
    description: 'Remove all moderators from the trust list and revoke their roles (Owner Only)',
    usage: 'modreset',
    category: 'admin',
    aliases: ['resetmods', 'clearmods'],

    async executePrefix(message) {
        if (!trust.isGuildOwner(message.guild, message.author.id)) {
            const container = buildErrorResponse('Permission Denied', 'Only the **server owner** can reset the moderator list.');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        try {
        const entries = trust.getList(message.guild.id, 'mods');
        if (entries.length === 0) {
            const container = buildErrorResponse('Already Empty', 'The moderator trust list is already empty.');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const userEntries = entries.filter(e => e.type === 'user');
        const roleEntries = entries.filter(e => e.type === 'role');

        const confirmContainer = new ContainerBuilder()
            .setAccentColor(0xED4245)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `# <:Infotriangle:1521227710381428926> Confirm: Reset Moderator List\n\n` +
                `<:Infotriangle:1521227710381428926> **This is a destructive action!**\n\n` +
                `<:Trash:1521227750420254820> **Entries to be removed:** ${entries.length}\n` +
                `- <:User:1521227714227343380> Users: ${userEntries.length}\n` +
                `- <:Caretright:1521227704953864202> Roles: ${roleEntries.length}\n\n` +
                `### What will happen:\n` +
                `- <:Caretright:1521227704953864202> **All** entries will be removed from the moderator trust list\n` +
                `- <:Caretright:1521227704953864202> The **Trusted Moderator** role will be revoked from all members\n` +
                `- <:Caretright:1521227704953864202> All moderator-level bot access will be removed\n` +
                `- <:Caretright:1521227704953864202> All affected users will be notified via DM\n\n` +
                `**Requested by:** ${message.author.username}\n\n` +
                `-# <:Infotriangle:1521227710381428926> This action cannot be undone. Are you sure?`
            ));

        await trust.withConfirmation(message, confirmContainer, async (i) => {
            const rolesRemoved = await trust.removeAllTrustRoles(message.guild, 'mods');

            for (const entry of userEntries) {
                await trust.notifyUser(message.client, entry.id,
                    `<:Notificationon:1521227730304106680> The **Moderator trust list** in **${message.guild.name}** has been **reset** by **${message.author.username}**.\n> Your moderator-level access and Trusted Moderator role have been revoked.`
                );
            }

            const count = trust.resetList(message.guild.id, 'mods');

            const success = new ContainerBuilder()
                .setAccentColor(COLORS.SUCCESS)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# <:Checkedbox:1521227734943269077> Moderator List Reset Successfully\n\n` +
                    `<:Trash:1521227750420254820> **Entries Removed:** ${count}\n` +
                    `<:Caretright:1521227704953864202> **Roles Revoked:** ${rolesRemoved} member${rolesRemoved === 1 ? '' : 's'}\n` +
                    `<:Caretright:1521227704953864202> **Reset by:** ${message.author.username}\n\n` +
                    `<:Caretright:1521227704953864202> All moderator privileges have been revoked.`
                ))
;
            await i.update({ components: [success], flags: MessageFlags.IsComponentsV2 });
        });
        } catch (error) {
            console.error('[ModReset] Error:', error);
            const container = buildErrorResponse('Error', 'An error occurred while executing this command.', error.message);
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
