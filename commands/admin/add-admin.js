const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } = require('discord.js');
const { COLORS, buildErrorResponse } = require('../../utils/responseBuilder');
const trust = require('../../utils/trustManager');

module.exports = {
    prefix: 'add-admin',
    description: 'Add a user or role to the Admin trust list',
    usage: 'add-admin <@user|@role|userId>',
    category: 'admin',
    aliases: ['addadmin', 'trustadd-admin'],

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
                        `# <:Shield:1521227694677692467> Add Admin\n\n` +
                        `<:Infocircle:1521227700835057685> **Usage:** \`add-admin @user\` or \`add-admin @role\`\n\n` +
                        `<:Caretright:1521227704953864202> Adds a user or role to the trusted admin list.\n` +
                        `<:Caretright:1521227704953864202> Admins receive the **Trusted Admin** role with full moderation permissions.\n` +
                        `<:Caretright:1521227704953864202> Permissions include: Manage Channels, Roles, Messages, Ban, Kick, and more.`
                    ))
;
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            const targetId = targetUser ? targetUser.id : targetRole.id;
            const targetType = targetUser ? 'user' : 'role';
            const targetName = targetUser ? targetUser.username : targetRole.name;

            // Validation checks
            if (targetUser?.bot) {
                const container = buildErrorResponse('Cannot Add Bot', 'You cannot add bots to the admin list.');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }
            if (targetUser && targetUser.id === message.author.id) {
                const container = buildErrorResponse('Cannot Add Yourself', 'You cannot add yourself to the admin list.');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }
            if (targetRole && targetRole.id === message.guild.id) {
                const container = buildErrorResponse('Invalid Role', 'You cannot add the @everyone role to the admin list.');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }
            if (targetRole && targetRole.managed) {
                const container = buildErrorResponse('Managed Role', `**${targetRole.name}** is a bot/integration-managed role and cannot be added to the admin list.`);
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }
            if (targetUser && trust.isGuildOwner(message.guild, targetUser.id)) {
                const container = buildErrorResponse('Already Owner', 'The server owner already has full access.');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }
            if (targetUser && trust.isSecondOwner(message.guild.id, targetUser.id)) {
                const container = buildErrorResponse('Already Second Owner', 'The second owner already has higher access than admin.');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }
            if (trust.getList(message.guild.id, 'admins').some(e => e.id === targetId)) {
                const container = buildErrorResponse('Already Admin', `**${targetName}** is already in the admin list.`);
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            // Cross-list check
            const inMods = trust.getList(message.guild.id, 'mods').some(e => e.id === targetId);
            const inVcMods = trust.getList(message.guild.id, 'vcmods').some(e => e.id === targetId);
            let crossNote = '';
            if (inMods || inVcMods) {
                const lists = [inMods ? 'Moderator' : '', inVcMods ? 'VC Mod' : ''].filter(Boolean).join(' & ');
                crossNote = `\n\n<:Infotriangle:1521227710381428926> **Note:** Currently in the **${lists}** list — will be auto-promoted and removed from lower lists.`;
            }

            const confirmContainer = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# <:Infotriangle:1521227710381428926> Confirm: Add Admin\n\n` +
                    `<:Caretright:1521227704953864202> **Target:** ${targetUser || targetRole} (\`${targetId}\`)\n` +
                    `<:Caretright:1521227704953864202> **Type:** ${targetType === 'user' ? '<:User:1521227714227343380> User' : '<:Userplus:1521227719621218477> Role'}\n` +
                    `<:Caretright:1521227704953864202> **Requested by:** ${message.author.username}\n\n` +
                    `### What will happen:\n` +
                    (targetType === 'user'
                        ? `- <:Caretright:1521227704953864202> User will be added to the **Admin trust list**\n- <:Caretright:1521227704953864202> A **Trusted Admin** role will be assigned with permissions:\n  Manage Channels/Roles/Messages, Ban, Kick, Mute, Move, etc.`
                        : `- <:Caretright:1521227704953864202> Role will be marked as a **Trusted Admin** role\n- <:Caretright:1521227704953864202> All members with this role gain admin-level bot access`) +
                    crossNote + `\n\n-# Are you sure you want to proceed?`
                ));

            await trust.withConfirmation(message, confirmContainer, async (i) => {
                const result = trust.addToList(message.guild.id, 'admins', targetId, targetType, message.author.id);
                if (!result.success) {
                    const fail = new ContainerBuilder().setAccentColor(COLORS.ERROR)
                        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Cancel:1521227723916181644> Failed\n\n${result.message}`));
                    return i.update({ components: [fail], flags: MessageFlags.IsComponentsV2 });
                }

                // Remove from lower lists
                if (inMods) trust.removeFromList(message.guild.id, 'mods', targetId);
                if (inVcMods) trust.removeFromList(message.guild.id, 'vcmods', targetId);

                // Assign role if user
                let roleNote = '';
                if (targetType === 'user') {
                    const rr = await trust.assignTrustRole(message.guild, targetId, 'admins');
                    roleNote = rr.success ? `\n**Role Assigned:** ${rr.role}` : `\n<:Infotriangle:1521227710381428926> Could not assign role: ${rr.error}`;

                    // Remove lower trust roles
                    if (inMods) await trust.removeTrustRole(message.guild, targetId, 'mods');
                    if (inVcMods) await trust.removeTrustRole(message.guild, targetId, 'vcmods');
                }

                // DM notification
                if (targetUser) {
                    await trust.notifyUser(message.client, targetUser.id,
                        `<:Notificationon:1521227730304106680> You have been added as a **Trusted Admin** in **${message.guild.name}** by **${message.author.username}**.\n> You now have admin-level access and permissions.`
                    );
                }

                const autoRemoved = (inMods || inVcMods)
                    ? `\n**Auto-removed from:** ${[inMods ? 'Moderators' : '', inVcMods ? 'VC Mods' : ''].filter(Boolean).join(', ')}` : '';

                const success = new ContainerBuilder()
                    .setAccentColor(COLORS.SUCCESS)
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                        `# <:Checkedbox:1521227734943269077> Admin Added Successfully\n\n` +
                        `<:Caretright:1521227704953864202> **${targetType === 'user' ? '<:User:1521227714227343380> User' : '<:Userplus:1521227719621218477> Role'}:** ${targetUser || targetRole} (\`${targetId}\`)${roleNote}\n` +
                        `<:Caretright:1521227704953864202> **Added by:** ${message.author.username}${autoRemoved}\n\n` +
                        `<:Caretright:1521227704953864202> They now have admin-level trust and permissions in this server.`
                    ))
;
                await i.update({ components: [success], flags: MessageFlags.IsComponentsV2 });
            });
        } catch (error) {
            console.error('[AddAdmin] Error:', error);
            const container = buildErrorResponse('Error', 'An error occurred while executing this command.', error.message);
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
