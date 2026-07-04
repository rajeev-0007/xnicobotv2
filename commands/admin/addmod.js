const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } = require('discord.js');
const { COLORS, buildErrorResponse } = require('../../utils/responseBuilder');
const trust = require('../../utils/trustManager');

module.exports = {
    prefix: 'addmod',
    description: 'Add a user or role to the Moderator trust list',
    usage: 'addmod <@user|@role|userId>',
    category: 'admin',
    aliases: ['add-mod', 'trustmod'],

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
                        `# <:Shield:1521227694677692467> Add Moderator\n\n` +
                        `<:Infocircle:1521227700835057685> **Usage:** \`addmod @user\` or \`addmod @role\`\n\n` +
                        `<:Caretright:1521227704953864202> Adds a user or role to the trusted moderator list.\n` +
                        `<:Caretright:1521227704953864202> Moderators receive the **Trusted Moderator** role with permissions:\n` +
                        `<:Caretright:1521227704953864202> Kick, Manage Messages, Mute, Move, Timeout, and more.`
                    ))
;
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            const targetId = targetUser ? targetUser.id : targetRole.id;
            const targetType = targetUser ? 'user' : 'role';
            const targetName = targetUser ? targetUser.username : targetRole.name;

            // Validation checks
            if (targetUser?.bot) {
                const container = buildErrorResponse('Cannot Add Bot', 'You cannot add bots to the moderator list.');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }
            if (targetUser && targetUser.id === message.author.id) {
                const container = buildErrorResponse('Cannot Add Yourself', 'You cannot add yourself to the moderator list.');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }
            if (targetRole && targetRole.id === message.guild.id) {
                const container = buildErrorResponse('Invalid Role', 'You cannot add the @everyone role to the moderator list.');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }
            if (targetRole && targetRole.managed) {
                const container = buildErrorResponse('Managed Role', `**${targetRole.name}** is a bot/integration-managed role and cannot be added to the moderator list.`);
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }
            if (targetUser && trust.isGuildOwner(message.guild, targetUser.id)) {
                const container = buildErrorResponse('Already Owner', 'The server owner already has full access.');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }
            if (targetUser && trust.isSecondOwner(message.guild.id, targetUser.id)) {
                const container = buildErrorResponse('Already Second Owner', 'The second owner already has higher access than Moderator.');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }
            if (trust.getList(message.guild.id, 'mods').some(e => e.id === targetId)) {
                const container = buildErrorResponse('Already Moderator', `**${targetName}** is already in the moderator list.`);
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            if (trust.getList(message.guild.id, 'admins').some(e => e.id === targetId)) {
                const container = buildErrorResponse('Higher Role Exists', `**${targetName}** is already an **Admin**, which is higher than Moderator.`);
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            // Cross-list check
            const inVcMods = trust.getList(message.guild.id, 'vcmods').some(e => e.id === targetId);
            let crossNote = inVcMods ? `\n\n<:Infotriangle:1521227710381428926> **Note:** Currently in the **VC Mod** list — will be auto-promoted and removed from it.` : '';

            const confirmContainer = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# <:Infotriangle:1521227710381428926> Confirm: Add Moderator\n\n` +
                    `<:Caretright:1521227704953864202> **Target:** ${targetUser || targetRole} (\`${targetId}\`)\n` +
                    `<:Caretright:1521227704953864202> **Type:** ${targetType === 'user' ? '<:User:1521227714227343380> User' : '<:Userplus:1521227719621218477> Role'}\n` +
                    `<:Caretright:1521227704953864202> **Requested by:** ${message.author.username}\n\n` +
                    `### What will happen:\n` +
                    (targetType === 'user'
                        ? `- <:Caretright:1521227704953864202> User will be added to the **Moderator trust list**\n- <:Caretright:1521227704953864202> A **Trusted Moderator** role will be assigned with permissions:\n  Kick, Manage Messages/Nicknames, Mute, Deafen, Move, Timeout`
                        : `- <:Caretright:1521227704953864202> Role will be marked as a **Trusted Moderator** role\n- <:Caretright:1521227704953864202> All members with this role gain moderator-level bot access`) +
                    crossNote + `\n\n-# Are you sure you want to proceed?`
                ));

            await trust.withConfirmation(message, confirmContainer, async (i) => {
                const result = trust.addToList(message.guild.id, 'mods', targetId, targetType, message.author.id);
                if (!result.success) {
                    const fail = new ContainerBuilder().setAccentColor(COLORS.ERROR)
                        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Cancel:1521227723916181644> Failed\n\n${result.message}`));
                    return i.update({ components: [fail], flags: MessageFlags.IsComponentsV2 });
                }

                if (inVcMods) trust.removeFromList(message.guild.id, 'vcmods', targetId);

                let roleNote = '';
                if (targetType === 'user') {
                    const rr = await trust.assignTrustRole(message.guild, targetId, 'mods');
                    roleNote = rr.success ? `\n**Role Assigned:** ${rr.role}` : `\n<:Infotriangle:1521227710381428926> Could not assign role: ${rr.error}`;
                    if (inVcMods) await trust.removeTrustRole(message.guild, targetId, 'vcmods');
                }

                if (targetUser) {
                    await trust.notifyUser(message.client, targetUser.id,
                        `<:Notificationon:1521227730304106680> You have been added as a **Trusted Moderator** in **${message.guild.name}** by **${message.author.username}**.\n> You now have moderator-level access and permissions.`
                    );
                }

                const autoRemoved = inVcMods ? `\n**Auto-removed from:** VC Mods` : '';

                const success = new ContainerBuilder()
                    .setAccentColor(COLORS.SUCCESS)
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                        `# <:Checkedbox:1521227734943269077> Moderator Added Successfully\n\n` +
                        `<:Caretright:1521227704953864202> **${targetType === 'user' ? '<:User:1521227714227343380> User' : '<:Userplus:1521227719621218477> Role'}:** ${targetUser || targetRole} (\`${targetId}\`)${roleNote}\n` +
                        `<:Caretright:1521227704953864202> **Added by:** ${message.author.username}${autoRemoved}\n\n` +
                        `<:Caretright:1521227704953864202> They now have moderator-level trust and permissions in this server.`
                    ))
;
                await i.update({ components: [success], flags: MessageFlags.IsComponentsV2 });
            });
        } catch (error) {
            console.error('[AddMod] Error:', error);
            const container = buildErrorResponse('Error', 'An error occurred while executing this command.', error.message);
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
