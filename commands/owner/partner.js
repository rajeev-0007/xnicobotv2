'use strict';

const { SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { isOwner } = require('../../utils/helpers');
const { db } = require('../../utils/database');

const DB_KEY = 'partners';

async function loadPartners() { return (await db.get(DB_KEY)) || []; }
async function savePartners(list) { await db.set(DB_KEY, list); }

// ── Add partner (owner only)
async function handleAdd(reply, name, invite, description) {
    if (!name || !invite) {
        const c = new ContainerBuilder().setAccentColor(0xED4245);
        c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `# <:Cancel:1521227723916181644> Usage\n> \`partner add <name> <invite_link> [description]\``
        ));
        return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    const partners = await loadPartners();
    const id = Date.now().toString(36);
    partners.push({ id, name, invite, description: description || '', addedAt: Date.now() });
    await savePartners(partners);

    const c = new ContainerBuilder().setAccentColor(0x57F287);
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `# <:Checkedbox:1521227734943269077> Partner Added\n\n` +
        `> <:Caretright:1521227704953864202> **Name:** ${name}\n` +
        `> <:Caretright:1521227704953864202> **Invite:** ${invite}\n` +
        `> <:Caretright:1521227704953864202> **Description:** ${description || 'None'}\n` +
        `> <:Caretright:1521227704953864202> **ID:** \`${id}\`\n\n` +
        `-# Total partners: ${partners.length}`
    ));
    return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
}

// ── Remove partner (owner only)
async function handleRemove(reply, identifier) {
    if (!identifier) {
        const c = new ContainerBuilder().setAccentColor(0xED4245);
        c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `# <:Cancel:1521227723916181644> Usage\n> \`partner remove <id_or_name>\``
        ));
        return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    const partners = await loadPartners();
    const lower = identifier.toLowerCase();
    const idx = partners.findIndex(p => p.id === identifier || p.name.toLowerCase() === lower);

    if (idx === -1) {
        const c = new ContainerBuilder().setAccentColor(0xED4245);
        c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `# <:Cancel:1521227723916181644> Not Found\n> No partner with ID or name "${identifier}".`
        ));
        return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    const removed = partners.splice(idx, 1)[0];
    await savePartners(partners);

    const c = new ContainerBuilder().setAccentColor(0x57F287);
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `# <:Checkedbox:1521227734943269077> Partner Removed\n\n` +
        `> **${removed.name}** has been removed.\n\n` +
        `-# Remaining partners: ${partners.length}`
    ));
    return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
}

// ── List partners (public)
async function handleList(reply) {
    const partners = await loadPartners();

    if (partners.length === 0) {
        const c = new ContainerBuilder().setAccentColor(0xCAD7E6);
        c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `# <:PartnerServer:1521228095225331765> Partners\n\n> No partners yet.`
        ));
        return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    const lines = partners.map((p, i) => {
        const desc = p.description ? `\n>  └ ${p.description}` : '';
        return `> **${i + 1}.** [${p.name}](${p.invite})${desc}`;
    });

    const c = new ContainerBuilder().setAccentColor(0x5865F2);
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `# <:PartnerServer:1521228095225331765> Our Partners\n\n` +
        lines.join('\n\n') +
        `\n\n-# ${partners.length} partner${partners.length > 1 ? 's' : ''} • Interested? Contact the bot owner`
    ));
    return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
}

module.exports = {
    data: null,
    prefix: 'partner',
    description: 'Manage bot partners (add/remove/list)',
    usage: 'partner [add|remove|list] [args]',
    aliases: ['partners'],
    category: 'owner',

    async executePrefix(message, args) {
        const action = (args[0] || 'list').toLowerCase();

        if (action === 'list') {
            return handleList(message.reply.bind(message));
        }

        if (!isOwner(message.author.id)) {
            const c = new ContainerBuilder().setAccentColor(0xED4245);
            c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `# <:Cancel:1521227723916181644> Owner Only\n> Only the bot owner can add/remove partners.`
            ));
            return message.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
        }

        if (action === 'add') {
            // partner add <name> <invite> [description...]
            const name = args[1];
            const invite = args[2];
            const description = args.slice(3).join(' ') || '';
            return handleAdd(message.reply.bind(message), name, invite, description);
        }

        if (action === 'remove' || action === 'delete' || action === 'del') {
            const identifier = args.slice(1).join(' ');
            return handleRemove(message.reply.bind(message), identifier);
        }

        // Default: show list
        return handleList(message.reply.bind(message));
    },
};
