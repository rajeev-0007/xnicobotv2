const { isOwner } = require('../../utils/helpers');
const { MessageFlags, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, PermissionsBitField } = require('discord.js');

const jsonStore = require('../../utils/jsonStore');

function loadBotInvites() {
    try {
        if (jsonStore.has('bot-invites')) return jsonStore.read('bot-invites');
    } catch {}
    return {};
}

function saveBotInvites(data) {
    jsonStore.write('bot-invites', data);
}

module.exports = {
    name: 'getinvite',
    prefix: 'getinvite',
    aliases: ['fetchinvite', 'guildinvite', 'serverinvite'],
    description: 'Get an invite link for a server the bot is in',
    usage: 'getinvite <serverID>',
    category: 'owner',
    ownerOnly: true,

    async executePrefix(message, args) {
        if (!isOwner(message.author.id)) return;
        const guildId = args[0];
        if (!guildId) {
            return message.reply(require('../../utils/ownerUI').errReply('Missing Argument', 'Please provide a server ID.', { hint: 'Usage: `getinvite <serverID>`' }));
        }
        await this.fetchInvite(message, message.client, guildId);
    },

    async fetchInvite(context, client, guildId) {
        const guild = client.guilds.cache.get(guildId);
        if (!guild) {
            const msg = `<:Cancel:1521227723916181644> Could not find server with ID: \`${guildId}\``;
            return context.editReply ? context.editReply({ content: msg }) : context.reply(msg);
        }

        const store = loadBotInvites();
        let inviteUrl = null;
        let method = '';

        // 1. Check stored invite
        if (store[guild.id]?.url) {
            try {
                if (guild.members.me?.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
                    const invites = await guild.invites.fetch().catch(() => null);
                    if (invites) {
                        const found = invites.find(inv => inv.url === store[guild.id].url);
                        if (found) { inviteUrl = found.url; method = 'Stored invite'; }
                    }
                }
            } catch {}
        }

        // 2. Find existing permanent invite
        if (!inviteUrl) {
            try {
                if (guild.members.me?.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
                    const invites = await guild.invites.fetch().catch(() => null);
                    if (invites?.size > 0) {
                        const perm = invites.find(inv => inv.maxAge === 0 && !inv.temporary);
                        if (perm) { inviteUrl = perm.url; method = 'Existing permanent invite'; }
                        else {
                            const any = invites.first();
                            if (any) { inviteUrl = any.url; method = 'Existing invite (may expire)'; }
                        }
                    }
                }
            } catch {}
        }

        // 3. Create new invite
        if (!inviteUrl) {
            try {
                if (guild.members.me?.permissions.has(PermissionsBitField.Flags.CreateInstantInvite)) {
                    const channel = guild.channels.cache.find(ch =>
                        (ch.type === 0 || ch.type === 2) &&
                        ch.permissionsFor(guild.members.me)?.has(PermissionsBitField.Flags.CreateInstantInvite)
                    );
                    if (channel) {
                        const invite = await channel.createInvite({ maxAge: 0, maxUses: 0, unique: false, reason: 'Owner getinvite command' }).catch(() => null);
                        if (invite) { inviteUrl = invite.url; method = 'Newly created permanent invite'; }
                    }
                }
            } catch {}
        }

        // 4. Vanity URL
        if (!inviteUrl && guild.vanityURLCode) {
            inviteUrl = `https://discord.gg/${guild.vanityURLCode}`;
            method = 'Vanity URL';
        }

        // Save to store
        if (inviteUrl) {
            store[guild.id] = { url: inviteUrl, createdAt: Date.now() };
            saveBotInvites(store);
        }

        const owner = await client.users.fetch(guild.ownerId).catch(() => null);
        const ownerTag = owner ? `${owner.username} (\`${guild.ownerId}\`)` : `\`${guild.ownerId}\``;

        const container = new ContainerBuilder()
            .setAccentColor(inviteUrl ? 0x57F287 : 0xED4245)
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `### <:Key:1521228000467878111> Server Invite\n` +
                    `**Server:** ${guild.name}\n` +
                    `**ID:** \`${guild.id}\`\n` +
                    `**Members:** ${guild.memberCount.toLocaleString()}\n` +
                    `**Owner:** ${ownerTag}\n` +
                    `**Created:** <t:${Math.floor(guild.createdTimestamp / 1000)}:R>`
                )
            )
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    inviteUrl
                        ? `<:Checkedbox:1521227734943269077> **Invite:** ${inviteUrl}\n-# ${method}`
                        : `<:Cancel:1521227723916181644> **No invite available** — Bot lacks \`Create Instant Invite\` and \`Manage Server\` permissions.`
                )
            );

        const opts = { components: [container], flags: MessageFlags.IsComponentsV2 };
        return context.editReply ? context.editReply(opts) : context.reply(opts);
    }
};
