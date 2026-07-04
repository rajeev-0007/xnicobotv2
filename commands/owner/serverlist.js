const { isOwner } = require('../../utils/helpers');
const { MessageFlags, ContainerBuilder, TextDisplayBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, SeparatorBuilder, SeparatorSpacingSize, PermissionsBitField } = require('discord.js');

const jsonStore = require('../../utils/jsonStore');
// ─── Persistent Bot Invite Store ───

function loadBotInvites() {
    try {
        if (jsonStore.has('bot-invites')) {
            return jsonStore.read('bot-invites');
        }
    } catch {}
    return {};
}

function saveBotInvites(data) {
    jsonStore.write('bot-invites', data);
}

/**
 * Create (or fetch existing) permanent invite for a guild and persist it.
 * Returns the invite URL string or null.
 */
async function createAndStorePermanentInvite(guild) {
    const store = loadBotInvites();

    // 1. If we already have a stored invite, verify it still works
    if (store[guild.id]) {
        try {
            const existing = await guild.invites.fetch().catch(() => null);
            if (existing) {
                const found = existing.find(inv => inv.url === store[guild.id].url);
                if (found) return found.url; // still valid
            }
        } catch {}
        // Stored invite is stale — continue to create a new one
    }

    // 2. Look for an existing permanent invite the bot can use
    try {
        if (guild.members.me?.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
            const invites = await guild.invites.fetch().catch(() => null);
            if (invites && invites.size > 0) {
                const permanent = invites.find(inv => inv.maxAge === 0 && !inv.temporary);
                if (permanent) {
                    store[guild.id] = { url: permanent.url, code: permanent.code, createdAt: Date.now() };
                    saveBotInvites(store);
                    return permanent.url;
                }
            }
        }
    } catch {}

    // 3. Create a new permanent invite
    try {
        if (guild.members.me?.permissions.has(PermissionsBitField.Flags.CreateInstantInvite)) {
            const channel = guild.channels.cache.find(ch =>
                (ch.type === 0 || ch.type === 2) &&
                ch.permissionsFor(guild.members.me)?.has(PermissionsBitField.Flags.CreateInstantInvite)
            );
            if (channel) {
                const invite = await channel.createInvite({
                    maxAge: 0, maxUses: 0, unique: false,
                    reason: 'Bot permanent invite (auto-created)'
                }).catch(() => null);
                if (invite) {
                    store[guild.id] = { url: invite.url, code: invite.code, createdAt: Date.now() };
                    saveBotInvites(store);
                    return invite.url;
                }
            }
        }
    } catch {}

    // 4. Vanity URL fallback
    if (guild.vanityURLCode) {
        const url = `https://discord.gg/${guild.vanityURLCode}`;
        store[guild.id] = { url, code: guild.vanityURLCode, createdAt: Date.now() };
        saveBotInvites(store);
        return url;
    }

    return null;
}

/**
 * Get the stored invite URL for a guild (fast, no API call).
 * Falls back to createAndStorePermanentInvite if nothing stored.
 */
async function getStoredInvite(guild) {
    const store = loadBotInvites();
    if (store[guild.id]?.url) return store[guild.id].url;
    return createAndStorePermanentInvite(guild);
}

// ─── UI Builders ───

async function buildServerListContainer(guildArray, startIndex, page, totalPages, totalGuilds) {
    const lines = [];
    for (let i = 0; i < guildArray.length; i++) {
        const guild = guildArray[i];
        const invite = await getStoredInvite(guild);
        const inviteText = invite ? `[Join Server](${invite})` : '`No Invite`';
        const ownerTag = guild.ownerId ? `<@${guild.ownerId}>` : 'Unknown';
        lines.push(
            `**${startIndex + i + 1}.** ${guild.name}\n` +
            `> <:Fileuser:1521228225466859792> \`${guild.id}\`\n` +
            `> <:Userplus:1521227719621218477> **${guild.memberCount}** members\n` +
            `> <:Crown:1521227739988889764> Owner: ${ownerTag}\n` +
            `> <:Attach:1521228039135170722> ${inviteText}`
        );
    }

    return new ContainerBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `# <:Bookopen:1521227911137595605> Server List\n` +
                `-# Page ${page}/${totalPages} • Total: ${totalGuilds} servers`
            )
        )
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(lines.join('\n\n'))
        );
}

function buildPaginationButtons(page, totalPages) {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`slist_first`)
                .setEmoji('<:History:1521227863079256278>')
                .setLabel('First')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page <= 1),
            new ButtonBuilder()
                .setCustomId(`slist_prev`)
                .setLabel('Previous')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('<:back:1417485105437478943>')
                .setDisabled(page <= 1),
            new ButtonBuilder()
                .setCustomId(`slist_info`)
                .setLabel(`${page}/${totalPages}`)
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true),
            new ButtonBuilder()
                .setCustomId(`slist_next`)
                .setLabel('Next')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('<:next:1417485139595890728>')
                .setDisabled(page >= totalPages),
            new ButtonBuilder()
                .setCustomId(`slist_last`)
                .setEmoji('<:Caretright:1521227704953864202>')
                .setLabel('Last')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page >= totalPages)
        );
}

const PER_PAGE = 5;

/**
 * Shared render used by both execute/executePrefix AND the button handler.
 */
async function renderPage(client, page) {
    const guilds = client.guilds.cache.sort((a, b) => b.memberCount - a.memberCount);
    const totalPages = Math.ceil(guilds.size / PER_PAGE) || 1;
    page = Math.max(1, Math.min(page, totalPages));

    const startIndex = (page - 1) * PER_PAGE;
    const guildArray = Array.from(guilds.values()).slice(startIndex, startIndex + PER_PAGE);

    const container = await buildServerListContainer(guildArray, startIndex, page, totalPages, guilds.size);
    const row = buildPaginationButtons(page, totalPages);

    return { container, row, page, totalPages };
}

// ─── Command ───

module.exports = {
    name: 'serverlist',
    prefix: 'serverlist',
    aliases: ['servers', 'guilds', 'sl'],
    description: 'List all servers the bot is in with invite links',
    usage: 'serverlist [page]',
    category: 'owner',
    ownerOnly: true,

    // Exported helpers for button handler & other commands
    renderPage,
    createAndStorePermanentInvite,
    getStoredInvite,
    loadBotInvites,
    PER_PAGE,

    async executePrefix(message, args) {
        if (!isOwner(message.author.id)) {
            return message.reply(require('../../utils/ownerUI').ownerOnly());
        }

        const loadingMsg = await message.reply('<a:Loading:1521227993995940032> Fetching server list with invites...');

        const page = parseInt(args[0]) || 1;
        const { container, row, totalPages } = await renderPage(message.client, page);

        if (page > totalPages) {
            return loadingMsg.edit(`<:Cancel:1521227723916181644> Invalid page! Max page: ${totalPages}`);
        }

        await loadingMsg.edit({ content: null, components: [container.addActionRowComponents(row)], flags: MessageFlags.IsComponentsV2 });
    }
};
