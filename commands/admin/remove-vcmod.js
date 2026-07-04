const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } = require('discord.js');
const { COLORS, buildErrorResponse } = require('../../utils/responseBuilder');
const trust = require('../../utils/trustManager');

module.exports = {
    prefix: 'remove-vcmod',
    description: 'Remove a user or role from the VC Moderator trust list',
    usage: 'remove-vcmod <@user|@role|userId>',
    category: 'admin',
    aliases: ['removevcmod', 'delvcmod'],

    async executePrefix(message, args) {
        if (!trust.isServerOwner(message.guild, message.author.id)) {
            const container = buildErrorResponse('Permission Denied', 'Only the **server owner** or **second owner** can use this command.');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        try {
            let targetUser = message.mentions.users.first() || null;
            let targetRole = message.mentions.roles.first() || null;

            if (!targetUser && !targetRole && args[0]) {
                const id = args[0].replace(/[<@!&>]/g, '');
                try { targetUser = await message.client.users.fetch(id); } catch {
                    try { targetRole = await message.guild.roles.fetch(id); } catch {
                        const container = buildErrorResponse('Not Found', 'Could not find that user or role. Provide a valid mention or ID.');
                        return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
                    }
                }
            }

            if (!targetUser && !targetRole) {
                const container = new ContainerBuilder()
                    .setAccentColor(COLORS.INFO)
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                        `# <:Microphone:1521227746376683590> Remove VC Moderator\n\n` +
                        `<:Infocircle:1521227700835057685> **Usage:** \`remove-vcmod @user\` or \`remove-vcmod @role\`\n\n` +
                        `<:Caretright:1521227704953864202> Removes a user or role from the trusted VC moderator list.\n` +
                        `<:Caretright:1521227704953864202> The **Trusted VC Mod** role will be revoked.\n` +
                        `<:Caretright:1521227704953864202> All VC mod-level bot access will be removed.`
                    ))
;
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            const targetId = targetUser ? targetUser.id : targetRole.id;
            const targetType = targetUser ? 'user' : 'role';
            const targetName = targetUser ? targetUser.username : targetRole.name;

            if (!trust.getList(message.guild.id, 'vcmods').some(e => e.id === targetId)) {
                const container = buildErrorResponse('Not a VC Mod', `**${targetName}** is not in the VC moderator list.`);
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            const confirmContainer = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# <:Infotriangle:1521227710381428926> Confirm: Remove VC Moderator\n\n` +
                    `<:Caretright:1521227704953864202> **Target:** ${targetUser || targetRole} (\`${targetId}\`)\n` +
                    `<:Caretright:1521227704953864202> **Type:** ${targetType === 'user' ? '<:User:1521227714227343380> User' : '<:Userplus:1521227719621218477> Role'}\n` +
                    `<:Caretright:1521227704953864202> **Requested by:** ${message.author.username}\n\n` +
                    `### What will happen:\n` +
                    (targetType === 'user'
                        ? `- <:Caretright:1521227704953864202> User will be removed from the **VC Mod trust list**\n- <:Caretright:1521227704953864202> The **Trusted VC Mod** role will be revoked\n- <:Caretright:1521227704953864202> All VC mod-level bot access will be removed`
                        : `- <:Caretright:1521227704953864202> Role will be unmarked as a **Trusted VC Mod** role\n- <:Caretright:1521227704953864202> Members with only this role lose VC mod-level bot access`) +
                    `\n\n-# Are you sure you want to proceed?`
                ));

            await trust.withConfirmation(message, confirmContainer, async (i) => {
                const result = trust.removeFromList(message.guild.id, 'vcmods', targetId);
                if (!result.success) {
                    const fail = new ContainerBuilder().setAccentColor(COLORS.ERROR)
                        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Cancel:1521227723916181644> Failed\n\n${result.message}`));
                    return i.update({ components: [fail], flags: MessageFlags.IsComponentsV2 });
                }

                let roleNote = '';
                if (targetType === 'user') {
                    const rr = await trust.removeTrustRole(message.guild, targetId, 'vcmods');
                    roleNote = rr.success ? `\n<:Caretright:1521227704953864202> **Role Revoked:** Trusted VC Mod` : `\n<:Infotriangle:1521227710381428926> Could not revoke role: ${rr.error}`;
                }

                if (targetUser) {
                    await trust.notifyUser(message.client, targetUser.id,
                        `<:Notificationon:1521227730304106680> You have been **removed** from the **VC Mod trust list** in **${message.guild.name}** by **${message.author.username}**.\n> Your VC mod-level access has been revoked.`
                    );
                }

                const success = new ContainerBuilder()
                    .setAccentColor(COLORS.SUCCESS)
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                        `# <:Checkedbox:1521227734943269077> VC Moderator Removed Successfully\n\n` +
                        `<:Caretright:1521227704953864202> **${targetType === 'user' ? '<:User:1521227714227343380> User' : '<:Userplus:1521227719621218477> Role'}:** ${targetUser || targetRole} (\`${targetId}\`)${roleNote}\n` +
                        `<:Caretright:1521227704953864202> **Removed by:** ${message.author.username}\n\n` +
                        `<:Caretright:1521227704953864202> They no longer have VC moderator-level trust in this server.`
                    ))
;
                await i.update({ components: [success], flags: MessageFlags.IsComponentsV2 });
            });
        } catch (error) {
            console.error('[RemoveVCMod] Error:', error);
            const container = buildErrorResponse('Error', 'An error occurred while executing this command.', error.message);
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
