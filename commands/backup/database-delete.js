'use strict';

const {
    ContainerBuilder, TextDisplayBuilder,
    SeparatorBuilder, SeparatorSpacingSize,
    ActionRowBuilder, ButtonBuilder, ButtonStyle,
    PermissionFlagsBits, MessageFlags
} = require('discord.js');
const { db } = require('../../utils/database');
const { confirmAction } = require('../../utils/confirmAction');

const TIMEOUT = 30_000;
const VALID_TYPES = ['embed', 'welcome', 'leave', 'custom', 'announcement'];
const TYPE_EMOJI = { embed: '<:Folder:1521228095225331765>', welcome: '<:Userplus:1521227719621218477>', leave: '<:Userplus:1521227719621218477>', custom: '<:Edit:1521227886634205298>', announcement: '<:Bullhorn:1521227936575914016>' };

module.exports = {
    prefix: 'database-delete',
    description: 'Delete a database entry',
    usage: 'database-delete <type> <name>',
    category: 'backup',
    aliases: ['db-delete', 'dbdelete', 'db-del'],
    permissions: ['ManageGuild'],

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return message.reply({ components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent('# <:Cancel:1521227723916181644> Missing Permission\n\nYou need **Manage Guild** permission.'))], flags: MessageFlags.IsComponentsV2 });
        }

        if (args.length < 2) {
            return message.reply({ components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Cancel:1521227723916181644> Invalid Usage\n\n**Usage:** \`database-delete <type> <name>\`\n**Types:** \`${VALID_TYPES.join('`, `')}\``))], flags: MessageFlags.IsComponentsV2 });
        }

        const type = args[0].toLowerCase();
        const name = args[1];

        if (!VALID_TYPES.includes(type)) {
            return message.reply({ components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Cancel:1521227723916181644> Invalid Type\n\nValid: \`${VALID_TYPES.join('`, `')}\``))], flags: MessageFlags.IsComponentsV2 });
        }

        const key = `${message.guild.id}_${type}_${name}`;

        try {
            const existing = await db.get(key);
            if (!existing) {
                return message.reply({ components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Cancel:1521227723916181644> Not Found\n\nNo entry **${name}** (type: \`${type}\`).`))], flags: MessageFlags.IsComponentsV2 });
            }

            const emoji = TYPE_EMOJI[existing.type] || '<:Box:1521228152414666833>';
            const ts = existing.createdAt ? `\n**Created:** <t:${Math.floor(existing.createdAt / 1000)}:f>` : '';

            const { confirmed, button } = await confirmAction(message, true, {
                title: 'Confirm Delete',
                description: `${emoji} **${existing.name}** (\`${existing.type}\`)${ts}\n\n> This is permanent and cannot be undone.`,
                confirmLabel: 'Yes, Delete',
            });
            if (!confirmed) return;

            try {
                await db.delete(key);
                await button.editReply({ components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Checkedbox:1521227734943269077> Deleted\n\n${emoji} **${name}** (\`${type}\`) permanently removed.`))], flags: MessageFlags.IsComponentsV2 });
            } catch (err) {
                console.error('Database Delete Error:', err);
                await button.editReply({ components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Cancel:1521227723916181644> Error\n\n${err.message}`))], flags: MessageFlags.IsComponentsV2 });
            }
        } catch (error) {
            console.error('Database Delete Error:', error);
            return message.reply({ components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent('# <:Cancel:1521227723916181644> Error\n\nFailed to process deletion.'))], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
