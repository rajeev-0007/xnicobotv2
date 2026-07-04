'use strict';

const {
    ContainerBuilder, TextDisplayBuilder,
    SeparatorBuilder, SeparatorSpacingSize,
    ActionRowBuilder, ButtonBuilder, ButtonStyle,
    PermissionFlagsBits, MessageFlags
} = require('discord.js');
const { db } = require('../../utils/database');
const { buildExpiredPanel } = require('../../utils/responseBuilder');

const TIMEOUT = 30_000;
const VALID_TYPES = ['embed', 'welcome', 'leave', 'custom', 'announcement'];
const TYPE_EMOJI = { embed: '<:Folder:1521228095225331765>', welcome: '<:Userplus:1521227719621218477>', leave: '<:Userplus:1521227719621218477>', custom: '<:Edit:1521227886634205298>', announcement: '<:Bullhorn:1521227936575914016>' };

module.exports = {
    prefix: 'database-get',
    description: 'Retrieve a database entry by type and name',
    usage: 'database-get <type> <name>',
    category: 'backup',
    aliases: ['db-get', 'dbget'],
    permissions: ['ManageGuild'],

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return message.reply({ components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent('# <:Cancel:1521227723916181644> Missing Permission\n\nYou need **Manage Guild** permission.'))], flags: MessageFlags.IsComponentsV2 });
        }

        if (args.length < 2) {
            return message.reply({ components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Cancel:1521227723916181644> Invalid Usage\n\n**Usage:** \`database-get <type> <name>\`\n**Types:** \`${VALID_TYPES.join('`, `')}\``))], flags: MessageFlags.IsComponentsV2 });
        }

        const type = args[0].toLowerCase();
        const name = args[1];

        if (!VALID_TYPES.includes(type)) {
            return message.reply({ components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Cancel:1521227723916181644> Invalid Type\n\nValid: \`${VALID_TYPES.join('`, `')}\``))], flags: MessageFlags.IsComponentsV2 });
        }

        const key = `${message.guild.id}_${type}_${name}`;

        try {
            const result = await db.get(key);
            if (!result) {
                return message.reply({ components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Cancel:1521227723916181644> Not Found\n\nNo entry **${name}** (type: \`${type}\`).`))], flags: MessageFlags.IsComponentsV2 });
            }

            const emoji = TYPE_EMOJI[result.type] || '<:Box:1521228152414666833>';
            let dataPreview;

            if (type === 'embed' && typeof result.data === 'object') {
                const d = result.data;
                const parts = [];
                if (d.title) parts.push(`> **Title:** ${d.title}`);
                if (d.description) parts.push(`> **Desc:** ${d.description.substring(0, 120)}${d.description.length > 120 ? '…' : ''}`);
                if (d.color) parts.push(`> **Color:** ${d.color}`);
                if (d.footer) parts.push(`> **Footer:** ${d.footer}`);
                if (d.author) parts.push(`> **Author:** ${d.author}`);
                if (d.image) parts.push(`> **Image:** Set`);
                if (d.thumbnail) parts.push(`> **Thumbnail:** Set`);
                dataPreview = parts.join('\n') || '> (empty embed)';
            } else {
                const raw = typeof result.data === 'object' ? JSON.stringify(result.data, null, 2) : String(result.data);
                dataPreview = `\`\`\`\n${raw.substring(0, 800)}${raw.length > 800 ? '…' : ''}\n\`\`\``;
            }

            const uid = message.author.id;
            const sid = `${uid}_${Date.now().toString(36)}`;

            const ctr = new ContainerBuilder();
            ctr.addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `# ${emoji} ${result.name}\n\n` +
                `**Type:** \`${result.type}\`\n` +
                (result.createdAt ? `**Created:** <t:${Math.floor(result.createdAt / 1000)}:f>\n` : '') +
                (result.updatedAt ? `**Updated:** <t:${Math.floor(result.updatedAt / 1000)}:R>\n` : '') +
                (result.createdBy ? `**By:** <@${result.createdBy}>\n` : '')
            ));
            ctr.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
            ctr.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Data:**\n${dataPreview}`));
            ctr.addActionRowComponents(new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`dbg:del:${sid}`).setEmoji('<:Trash:1521227750420254820>').setLabel('Delete Entry').setStyle(ButtonStyle.Danger)
            ));

            const sent = await message.reply({ components: [ctr], flags: MessageFlags.IsComponentsV2 });
            const collector = sent.createMessageComponentCollector({ time: TIMEOUT });

            collector.on('collect', async (i) => {
                if (i.user.id !== uid) return i.reply({ content: '<:Cancel:1521227723916181644> Only the command invoker can use this.', flags: MessageFlags.Ephemeral });
                const action = i.customId.split(':')[1];

                if (action === 'del') {
                    const cfm = new ContainerBuilder().setAccentColor(0xED4245)
                        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Infotriangle:1521227710381428926> Confirm Delete\n\nDelete **${name}** (\`${type}\`) permanently?`))
                        .addActionRowComponents(new ActionRowBuilder().addComponents(
                            new ButtonBuilder().setCustomId(`dbg:cfDel:${uid}_${Date.now().toString(36)}`).setEmoji('<:Trash:1521227750420254820>').setLabel('Yes, Delete').setStyle(ButtonStyle.Danger),
                            new ButtonBuilder().setCustomId(`dbg:cancel:${uid}_${Date.now().toString(36)}`).setEmoji('<:Cancel:1521227723916181644>').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
                        ));
                    return i.update({ components: [cfm], flags: MessageFlags.IsComponentsV2 });
                }
                if (action === 'cfDel') {
                    collector.stop('handled');
                    await db.delete(key);
                    return i.update({ components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Checkedbox:1521227734943269077> Deleted\n\n**${name}** (\`${type}\`) removed.`))], flags: MessageFlags.IsComponentsV2 });
                }
                if (action === 'cancel') {
                    return i.update({ components: [ctr], flags: MessageFlags.IsComponentsV2 });
                }
            });

            collector.on('end', (_, reason) => {
                if (reason === 'handled' || reason === 'time') {
                    if (reason === 'time') sent.edit({ components: [buildExpiredPanel('database-get')], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
                }
            });
        } catch (error) {
            console.error('Database Get Error:', error);
            return message.reply({ components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent('# <:Cancel:1521227723916181644> Error\n\nFailed to retrieve data.'))], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
