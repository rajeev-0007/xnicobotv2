const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } = require('discord.js');
const { COLORS, buildErrorResponse } = require('../../utils/responseBuilder');
const trust = require('../../utils/trustManager');

module.exports = {
    prefix: 'add-owner',
    description: 'Assign a user as the second owner of the guild',
    usage: 'add-owner <@user|userId>',
    category: 'admin',
    aliases: ['setowner'],

    async executePrefix(message, args) {
        if (!trust.isGuildOwner(message.guild, message.author.id)) {
            const container = buildErrorResponse('Permission Denied', 'Only the **server owner** can use this command.');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        try {
        let targetUser = message.mentions.users.first() || null;

        if (!targetUser && args[0]) {
            const id = args[0].replace(/[<@!>]/g, '');
            try { targetUser = await message.client.users.fetch(id); } catch {
                const container = buildErrorResponse('Not Found', 'Could not find that user. Provide a valid mention or user ID.');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }
        }

        if (!targetUser) {
            const container = new ContainerBuilder()
                .setAccentColor(COLORS.INFO)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# <:Crown:1521227739988889764> Add Second Owner\n\n` +
                    `<:Infocircle:1521227700835057685> **Usage:** \`add-owner @user\`\n\n` +
                    `<:Caretright:1521227704953864202> Assigns a user as the second owner of this server.\n` +
                    `<:Caretright:1521227704953864202> The second owner receives the **Second Owner** role with Administrator permissions.\n` +
                    `<:Caretright:1521227704953864202> They can manage admins, mods, and VC mods.\n` +
                    `<:Caretright:1521227704953864202> Only **one** second owner is allowed at a time.`
                ))
;
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (targetUser.id === message.author.id) {
            const container = buildErrorResponse('Already Owner', 'You are already the server owner.');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
        if (targetUser.bot) {
            const container = buildErrorResponse('Cannot Add Bot', 'You cannot assign a bot as second owner.');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const current = trust.getSecondOwner(message.guild.id);
        if (current === targetUser.id) {
            const container = buildErrorResponse('Already Second Owner', `**${targetUser.username}** is already the second owner.`);
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        // Cross-list check — auto-promote from lower lists
        const inAdmins = trust.getList(message.guild.id, 'admins').some(e => e.id === targetUser.id);
        const inMods = trust.getList(message.guild.id, 'mods').some(e => e.id === targetUser.id);
        const inVcMods = trust.getList(message.guild.id, 'vcmods').some(e => e.id === targetUser.id);

        let replaceNote = '';
        let currentOwnerName = null;
        if (current) {
            try {
                const prevUser = await message.client.users.fetch(current);
                currentOwnerName = prevUser.username;
            } catch { currentOwnerName = current; }
            replaceNote = `\n\n<:Infotriangle:1521227710381428926> **Warning:** This will replace the current second owner **${currentOwnerName}** (\`${current}\`).\nThey will lose their Second Owner role and privileges.`;
        }

        let crossNote = '';
        if (inAdmins || inMods || inVcMods) {
            const lists = [inAdmins ? 'Admin' : '', inMods ? 'Moderator' : '', inVcMods ? 'VC Mod' : ''].filter(Boolean).join(' & ');
            crossNote = `\n\n<:Infotriangle:1521227710381428926> **Note:** Currently in the **${lists}** list — will be auto-promoted and removed from lower lists.`;
        }

        const confirmContainer = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `# <:Infotriangle:1521227710381428926> Confirm: Assign Second Owner\n\n` +
                `<:Caretright:1521227704953864202> **Target:** ${targetUser} (\`${targetUser.id}\`)\n` +
                `<:Caretright:1521227704953864202> **Server:** ${message.guild.name}\n` +
                `<:Caretright:1521227704953864202> **Requested by:** ${message.author.username}\n\n` +
                `### What will happen:\n` +
                `- <:Caretright:1521227704953864202> User will be assigned as the **Second Owner**\n` +
                `- <:Caretright:1521227704953864202> A **Second Owner** role with **Administrator** permission will be assigned\n` +
                `- <:Caretright:1521227704953864202> They can manage Admins, Moderators, and VC Mods\n` +
                `- <:Caretright:1521227704953864202> They have the same bot access as the server owner` +
                replaceNote + crossNote +
                `\n\n-# Are you sure you want to proceed?`
            ));

        await trust.withConfirmation(message, confirmContainer, async (i) => {
            // Remove previous second owner's role if exists
            if (current) {
                await trust.removeTrustRole(message.guild, current, 'secondOwner');
                await trust.notifyUser(message.client, current,
                    `<:Notificationon:1521227730304106680> You have been **removed** as Second Owner of **${message.guild.name}** by **${message.author.username}**.\n> A new second owner has been assigned.`
                );
            }

            trust.setSecondOwner(message.guild.id, targetUser.id);

            // Remove from lower trust lists
            if (inAdmins) trust.removeFromList(message.guild.id, 'admins', targetUser.id);
            if (inMods) trust.removeFromList(message.guild.id, 'mods', targetUser.id);
            if (inVcMods) trust.removeFromList(message.guild.id, 'vcmods', targetUser.id);

            // Assign Second Owner role
            let roleNote = '';
            const rr = await trust.assignTrustRole(message.guild, targetUser.id, 'secondOwner');
            roleNote = rr.success ? `\n**Role Assigned:** ${rr.role}` : `\n<:Infotriangle:1521227710381428926> Could not assign role: ${rr.error}`;

            // Remove lower trust roles
            if (inAdmins) await trust.removeTrustRole(message.guild, targetUser.id, 'admins');
            if (inMods) await trust.removeTrustRole(message.guild, targetUser.id, 'mods');
            if (inVcMods) await trust.removeTrustRole(message.guild, targetUser.id, 'vcmods');

            // DM the new second owner
            await trust.notifyUser(message.client, targetUser.id,
                `<:Crown:1521227739988889764> You have been assigned as the **Second Owner** of **${message.guild.name}** by **${message.author.username}**.\n> You now have full bot access and can manage admins, moderators, and VC mods.`
            );

            const success = new ContainerBuilder()
                .setAccentColor(COLORS.SUCCESS)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# <:Checkedbox:1521227734943269077> Second Owner Assigned Successfully\n\n` +
                    `<:Caretright:1521227704953864202> **<:Crown:1521227739988889764> User:** ${targetUser} (\`${targetUser.id}\`)${roleNote}\n` +
                    `<:Caretright:1521227704953864202> **Server:** ${message.guild.name}\n` +
                    `<:Caretright:1521227704953864202> **Assigned by:** ${message.author.username}\n` +
                    (current ? `<:Caretright:1521227704953864202> **Previous Owner Removed:** ${currentOwnerName} (\`${current}\`)\n` : '') +
                    ((inAdmins || inMods || inVcMods) ? `<:Caretright:1521227704953864202> **Auto-removed from:** ${[inAdmins ? 'Admins' : '', inMods ? 'Moderators' : '', inVcMods ? 'VC Mods' : ''].filter(Boolean).join(', ')}\n` : '') +
                    `\n> They can now manage admins, mods, and VC mods in this server.`
                ))
;
            await i.update({ components: [success], flags: MessageFlags.IsComponentsV2 });
        });
        } catch (error) {
            console.error('[AddOwner] Error:', error);
            const container = buildErrorResponse('Error', 'An error occurred while executing this command.', error.message);
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
