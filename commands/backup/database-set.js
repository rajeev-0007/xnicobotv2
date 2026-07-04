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
    prefix: 'database-set',
    description: 'Store data in the database',
    usage: 'database-set <type> <name> <data>',
    category: 'backup',
    aliases: ['db-set', 'dbset'],
    permissions: ['ManageGuild'],

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return message.reply({ components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent('# <:Cancel:1521227723916181644> Missing Permission\n\nYou need **Manage Guild** permission.'))], flags: MessageFlags.IsComponentsV2 });
        }

        if (args.length < 3) {
            return message.reply({ components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Cancel:1521227723916181644> Invalid Usage\n\n**Usage:** \`database-set <type> <name> <data>\`\n**Types:** \`${VALID_TYPES.join('`, `')}\`\n\n> For embed type, provide valid JSON data.`))], flags: MessageFlags.IsComponentsV2 });
        }

        const type = args[0].toLowerCase();
        const name = args[1];
        const data = args.slice(2).join(' ');

        if (!VALID_TYPES.includes(type)) {
            return message.reply({ components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Cancel:1521227723916181644> Invalid Type\n\nValid: \`${VALID_TYPES.join('`, `')}\``))], flags: MessageFlags.IsComponentsV2 });
        }

        // Parse data
        let parsedData = data;
        if (type === 'embed') {
            try { parsedData = JSON.parse(data); } catch {
                return message.reply({ components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent('# <:Cancel:1521227723916181644> Invalid JSON\n\nEmbed type requires valid JSON.\n\n> Example: `{"title":"Hello","description":"World"}`'))], flags: MessageFlags.IsComponentsV2 });
            }
        }

        const key = `${message.guild.id}_${type}_${name}`;
        const uid = message.author.id;
        const emoji = TYPE_EMOJI[type] || '<:Box:1521228152414666833>';

        // Check if exists (overwrite warning)
        let existing;
        try { existing = await db.get(key); } catch {}

        const preview = typeof parsedData === 'object' ? JSON.stringify(parsedData, null, 2).substring(0, 200) : String(parsedData).substring(0, 200);
        const overwriteNote = existing ? '\n> <:Infotriangle:1521227710381428926> An entry with this name already exists and will be **overwritten**.' : '';

        const { confirmed, button } = await confirmAction(message, true, {
            title: `${existing ? 'Overwrite' : 'Save'} Database Entry`,
            description:
                `${emoji} **Type:** \`${type}\`\n**Name:** \`${name}\`\n\n` +
                `**Data Preview:**\n\`\`\`\n${preview}${preview.length >= 200 ? '…' : ''}\n\`\`\`${overwriteNote}`,
            confirmLabel: existing ? 'Overwrite' : 'Save',
            danger: !!existing,
        });
        if (!confirmed) return;

        try {
            const now = Date.now();
            await db.set(key, {
                type, name, data: parsedData,
                guildId: message.guild.id,
                createdBy: uid,
                createdAt: existing?.createdAt || now,
                updatedAt: now
            });
            await button.editReply({ components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Checkedbox:1521227734943269077> Data Stored\n\n${emoji} **${name}** (\`${type}\`) saved successfully.\n\n> Use \`database-get ${type} ${name}\` to retrieve it.`))], flags: MessageFlags.IsComponentsV2 });
        } catch (err) {
            console.error('Database Set Error:', err);
            await button.editReply({ components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Cancel:1521227723916181644> Error\n\n${err.message}`))], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
