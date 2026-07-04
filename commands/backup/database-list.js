'use strict';

const {
    ContainerBuilder, TextDisplayBuilder,
    SeparatorBuilder, SeparatorSpacingSize,
    ActionRowBuilder, ButtonBuilder, ButtonStyle,
    StringSelectMenuBuilder,
    PermissionFlagsBits, MessageFlags
} = require('discord.js');
const { db } = require('../../utils/database');
const { buildExpiredPanel } = require('../../utils/responseBuilder');

const PER_PAGE = 8;
const TIMEOUT = 120_000;
const VALID_TYPES = ['embed', 'welcome', 'leave', 'custom', 'announcement'];
const TYPE_EMOJI = { embed: '<:Folder:1521228095225331765>', welcome: '<:Userplus:1521227719621218477>', leave: '<:Userplus:1521227719621218477>', custom: '<:Edit:1521227886634205298>', announcement: '<:Bullhorn:1521227936575914016>' };

async function fetchEntries(guildId, filterType) {
    const prefix = filterType ? `${guildId}_${filterType}_` : `${guildId}_`;
    const keys = await db.list(prefix);
    const entries = [];
    for (const key of keys) {
        const data = await db.get(key);
        if (data) entries.push({ key, ...data });
    }
    return entries;
}

function buildList(entries, page, filterType, guildId, uid) {
    const total = entries.length;
    const pages = Math.max(1, Math.ceil(total / PER_PAGE));
    page = Math.max(0, Math.min(page, pages - 1));
    const slice = entries.slice(page * PER_PAGE, (page + 1) * PER_PAGE);
    const sid = `${uid}_${Date.now().toString(36)}`;

    const ctr = new ContainerBuilder();
    const filterLabel = filterType ? ` (${filterType})` : '';
    ctr.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `# <:Checkedbox:1521227734943269077> Database Entries${filterLabel}\n-# ${total} entr${total !== 1 ? 'ies' : 'y'} · Page ${page + 1}/${pages}`
    ));
    ctr.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));

    if (slice.length === 0) {
        ctr.addTextDisplayComponents(new TextDisplayBuilder().setContent('No entries found.\n> Use `database-set <type> <name> <data>` to create one.'));
    } else {
        let lines = '';
        for (const e of slice) {
            const emoji = TYPE_EMOJI[e.type] || '<:Box:1521228152414666833>';
            const ts = e.createdAt ? ` · <t:${Math.floor(e.createdAt / 1000)}:R>` : '';
            lines += `${emoji} **${e.name}** \`${e.type}\`${ts}\n`;
        }
        ctr.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.trim()));
    }

    // Type filter dropdown
    const filterOpts = [
        { label: 'All Types', value: 'all', description: 'Show all database entries' },
        ...VALID_TYPES.map(t => ({ label: t.charAt(0).toUpperCase() + t.slice(1), value: t, description: `Filter by ${t}` }))
    ];
    ctr.addActionRowComponents(new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId(`dbl:filter:${sid}`).setPlaceholder('Filter by type…').addOptions(filterOpts)
    ));

    // Entry select if entries exist
    if (total > 0) {
        const entryOpts = entries.map((e, i) => ({
            label: `${e.name}`.slice(0, 100),
            description: `${e.type}${e.createdAt ? ' · ' + new Date(e.createdAt).toLocaleDateString() : ''}`.slice(0, 100),
            value: String(i)
        })).slice(0, 25);
        ctr.addActionRowComponents(new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder().setCustomId(`dbl:sel:${sid}`).setPlaceholder('Select an entry to view…').addOptions(entryOpts)
        ));
    }

    // Nav buttons
    ctr.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`dbl:prev:${sid}`).setEmoji('<:History:1521227863079256278>').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
        new ButtonBuilder().setCustomId(`dbl:next:${sid}`).setEmoji('<:Caretright:1521227704953864202>').setStyle(ButtonStyle.Secondary).setDisabled(page >= pages - 1),
        new ButtonBuilder().setCustomId(`dbl:refresh:${sid}`).setEmoji('<:History:1521227863079256278>').setStyle(ButtonStyle.Secondary)
    ));
    return { ctr, page, pages, sid };
}

function buildDetail(entry, idx, uid) {
    const sid = `${uid}_${Date.now().toString(36)}`;
    const emoji = TYPE_EMOJI[entry.type] || '<:Box:1521228152414666833>';
    let dataPreview;

    if (entry.type === 'embed' && typeof entry.data === 'object') {
        const d = entry.data;
        const parts = [];
        if (d.title) parts.push(`> **Title:** ${d.title}`);
        if (d.description) parts.push(`> **Desc:** ${d.description.substring(0, 80)}${d.description.length > 80 ? '…' : ''}`);
        if (d.color) parts.push(`> **Color:** ${d.color}`);
        if (d.footer) parts.push(`> **Footer:** ${d.footer}`);
        if (d.image) parts.push(`> **Image:** Set`);
        if (d.thumbnail) parts.push(`> **Thumbnail:** Set`);
        dataPreview = parts.join('\n') || '> (empty embed)';
    } else {
        const raw = typeof entry.data === 'object' ? JSON.stringify(entry.data, null, 2) : String(entry.data);
        dataPreview = `\`\`\`\n${raw.substring(0, 500)}${raw.length > 500 ? '…' : ''}\n\`\`\``;
    }

    const ctr = new ContainerBuilder();
    ctr.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `# ${emoji} ${entry.name}\n\n` +
        `**Type:** \`${entry.type}\`\n` +
        (entry.createdAt ? `**Created:** <t:${Math.floor(entry.createdAt / 1000)}:f>\n` : '') +
        (entry.updatedAt ? `**Updated:** <t:${Math.floor(entry.updatedAt / 1000)}:R>\n` : '') +
        (entry.createdBy ? `**By:** <@${entry.createdBy}>\n` : '')
    ));
    ctr.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
    ctr.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Data:**\n${dataPreview}`));

    ctr.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`dbl:back:${sid}`).setEmoji('<:History:1521227863079256278>').setLabel('Back').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`dbl:del:${sid}:${idx}`).setEmoji('<:Trash:1521227750420254820>').setLabel('Delete').setStyle(ButtonStyle.Danger)
    ));
    return { ctr, sid };
}

module.exports = {
    prefix: 'database-list',
    description: 'List database entries with optional type filter',
    usage: 'database-list [type]',
    category: 'backup',
    aliases: ['db-list', 'dblist'],
    permissions: ['ManageGuild'],

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return message.reply({ components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent('# <:Cancel:1521227723916181644> Missing Permission\n\nYou need **Manage Guild** permission.'))], flags: MessageFlags.IsComponentsV2 });
        }

        let filterType = args[0]?.toLowerCase() || null;
        if (filterType && !VALID_TYPES.includes(filterType)) {
            return message.reply({ components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Cancel:1521227723916181644> Invalid Type\n\nValid: \`${VALID_TYPES.join('`, `')}\``))], flags: MessageFlags.IsComponentsV2 });
        }

        const uid = message.author.id;
        const guildId = message.guild.id;
        let entries, page = 0;

        try { entries = await fetchEntries(guildId, filterType); } catch (err) {
            console.error('Database List Error:', err);
            return message.reply({ components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent('# <:Cancel:1521227723916181644> Error\n\nFailed to list entries.'))], flags: MessageFlags.IsComponentsV2 });
        }

        const { ctr } = buildList(entries, page, filterType, guildId, uid);
        const sent = await message.reply({ components: [ctr], flags: MessageFlags.IsComponentsV2 });
        const collector = sent.createMessageComponentCollector({ time: TIMEOUT });

        collector.on('collect', async (i) => {
            if (i.user.id !== uid) return i.reply({ content: '<:Cancel:1521227723916181644> Only the command invoker can use this.', flags: MessageFlags.Ephemeral });
            const parts = i.customId.split(':');
            const action = parts[1];

            try {
                if (action === 'filter') {
                    const val = i.values[0];
                    filterType = val === 'all' ? null : val;
                    page = 0;
                    entries = await fetchEntries(guildId, filterType);
                    const { ctr } = buildList(entries, page, filterType, guildId, uid);
                    return i.update({ components: [ctr], flags: MessageFlags.IsComponentsV2 });
                }
                if (action === 'sel') {
                    const idx = parseInt(i.values[0], 10);
                    if (!entries[idx]) { const { ctr } = buildList(entries, page, filterType, guildId, uid); return i.update({ components: [ctr], flags: MessageFlags.IsComponentsV2 }); }
                    const { ctr } = buildDetail(entries[idx], idx, uid);
                    return i.update({ components: [ctr], flags: MessageFlags.IsComponentsV2 });
                }
                if (action === 'back') {
                    const { ctr } = buildList(entries, page, filterType, guildId, uid);
                    return i.update({ components: [ctr], flags: MessageFlags.IsComponentsV2 });
                }
                if (action === 'prev') page = Math.max(0, page - 1);
                if (action === 'next') page++;
                if (action === 'refresh') {
                    try { entries = await fetchEntries(guildId, filterType); } catch {}
                }
                if (action === 'del') {
                    const idx = parseInt(parts[3], 10);
                    const e = entries[idx];
                    if (!e) { const { ctr } = buildList(entries, page, filterType, guildId, uid); return i.update({ components: [ctr], flags: MessageFlags.IsComponentsV2 }); }
                    const cfm = new ContainerBuilder().setAccentColor(0xED4245)
                        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Infotriangle:1521227710381428926> Confirm Delete\n\nDelete **${e.name}** (\`${e.type}\`) permanently?`))
                        .addActionRowComponents(new ActionRowBuilder().addComponents(
                            new ButtonBuilder().setCustomId(`dbl:cfDel:${uid}_${Date.now().toString(36)}:${idx}`).setEmoji('<:Trash:1521227750420254820>').setLabel('Yes, Delete').setStyle(ButtonStyle.Danger),
                            new ButtonBuilder().setCustomId(`dbl:back:${uid}_${Date.now().toString(36)}`).setEmoji('<:Cancel:1521227723916181644>').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
                        ));
                    return i.update({ components: [cfm], flags: MessageFlags.IsComponentsV2 });
                }
                if (action === 'cfDel') {
                    const idx = parseInt(parts[3], 10);
                    const e = entries[idx];
                    if (!e) { const { ctr } = buildList(entries, page, filterType, guildId, uid); return i.update({ components: [ctr], flags: MessageFlags.IsComponentsV2 }); }
                    await db.delete(e.key);
                    entries.splice(idx, 1);
                    const ok = new ContainerBuilder()
                        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Checkedbox:1521227734943269077> Deleted\n\n**${e.name}** (\`${e.type}\`) removed.`))
                        .addActionRowComponents(new ActionRowBuilder().addComponents(
                            new ButtonBuilder().setCustomId(`dbl:back:${uid}_${Date.now().toString(36)}`).setEmoji('<:History:1521227863079256278>').setLabel('Back to List').setStyle(ButtonStyle.Secondary)
                        ));
                    return i.update({ components: [ok], flags: MessageFlags.IsComponentsV2 });
                }

                // Default re-render
                const { ctr } = buildList(entries, page, filterType, guildId, uid);
                return i.update({ components: [ctr], flags: MessageFlags.IsComponentsV2 });
            } catch (err) {
                console.error('database-list collector error:', err);
                if (!i.replied && !i.deferred) i.reply({ content: 'An error occurred.', flags: MessageFlags.Ephemeral }).catch(() => {});
            }
        });

        collector.on('end', (_, reason) => {
            if (reason === 'time') sent.edit({ components: [buildExpiredPanel('database-list')], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        });
    }
};
