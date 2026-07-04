const { isOwner } = require('../../utils/helpers');
const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { buildErrorResponse, COLORS } = require('../../utils/responseBuilder');
const premiumManager = require('../../utils/premiumManager');
const ITEMS_PER_PAGE = 8;

function buildPage(client, activeUsers, activeServers, page, view) {
    const now = new Date();

    if (view === 'users') {
        const totalPages = Math.max(1, Math.ceil(activeUsers.length / ITEMS_PER_PAGE));
        const safePage = Math.max(0, Math.min(page, totalPages - 1));
        const slice = activeUsers.slice(safePage * ITEMS_PER_PAGE, (safePage + 1) * ITEMS_PER_PAGE);

        let content = `# <:Sketch:1521228025365004471> Active Premium Users\n\n`;
        content += `**Total Active:** ${activeUsers.length}\n\n`;

        if (activeUsers.length === 0) {
            content += `> No active premium users found.`;
        } else {
            slice.forEach((p, i) => {
                const num = safePage * ITEMS_PER_PAGE + i + 1;
                const activatedTs = Math.floor(new Date(p.activatedAt).getTime() / 1000);
                const durText = p.expiresAt
                    ? `Expires <t:${Math.floor(new Date(p.expiresAt).getTime() / 1000)}:R>`
                    : 'Permanent ♾️';
                content += `**${num}.** <@${p.userId}> (\`${p.userId}\`)\n`;
                content += `   <:Bookopen:1521227911137595605> Activated <t:${activatedTs}:R> · ${durText}\n`;
                content += `   <:Key:1521228000467878111> Key: \`${p.keyUsed || 'Unknown'}\`\n\n`;
            });
        }

        content += `-# Page ${safePage + 1}/${totalPages}`;

        const container = new ContainerBuilder().setAccentColor(0xF5C542);
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

        if (totalPages > 1) {
            container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`premiums_users_${safePage - 1}`)
                    .setEmoji('<:History:1521227863079256278>')
                    .setLabel('Previous')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(safePage === 0),
                new ButtonBuilder()
                    .setCustomId(`premiums_pg_users_${safePage}`)
                    .setLabel(`${safePage + 1} / ${totalPages}`)
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(true),
                new ButtonBuilder()
                    .setCustomId(`premiums_users_${safePage + 1}`)
                    .setEmoji('<:Caretright:1521227704953864202>')
                    .setLabel('Next')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(safePage >= totalPages - 1)
            );
            container.addActionRowComponents(row);
        }

        // Add view switcher
        container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
        const switchRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('premiums_switch_overview')
                .setLabel('Overview')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('premiums_switch_users')
                .setLabel('Users')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(true),
            new ButtonBuilder()
                .setCustomId('premiums_switch_servers')
                .setLabel('Servers')
                .setStyle(ButtonStyle.Secondary)
        );
        container.addActionRowComponents(switchRow);

        return container;
    }

    if (view === 'servers') {
        const totalPages = Math.max(1, Math.ceil(activeServers.length / ITEMS_PER_PAGE));
        const safePage = Math.max(0, Math.min(page, totalPages - 1));
        const slice = activeServers.slice(safePage * ITEMS_PER_PAGE, (safePage + 1) * ITEMS_PER_PAGE);

        let content = `# <:Home:1521228339736482056> Active Premium Servers\n\n`;
        content += `**Total Active:** ${activeServers.length}\n\n`;

        if (activeServers.length === 0) {
            content += `> No active premium servers found.`;
        } else {
            slice.forEach((s, i) => {
                const num = safePage * ITEMS_PER_PAGE + i + 1;
                const guild = client.guilds.cache.get(s.guildId);
                const guildName = guild ? guild.name : `Unknown`;
                const activatedTs = Math.floor(new Date(s.activatedAt).getTime() / 1000);
                const durText = s.expiresAt
                    ? `Expires <t:${Math.floor(new Date(s.expiresAt).getTime() / 1000)}:R>`
                    : 'Permanent ♾️';
                content += `**${num}.** ${guildName} (\`${s.guildId}\`)\n`;
                content += `   <:Bookopen:1521227911137595605> Activated <t:${activatedTs}:R> · ${durText}\n`;
                if (s.activatedBy) content += `   <:User:1521227714227343380> By: <@${s.activatedBy}>\n`;
                content += `   <:Key:1521228000467878111> Key: \`${s.keyUsed || 'Unknown'}\`\n\n`;
            });
        }

        content += `-# Page ${safePage + 1}/${totalPages}`;

        const container = new ContainerBuilder().setAccentColor(0x9B59B6);
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

        if (totalPages > 1) {
            container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`premiums_servers_${safePage - 1}`)
                    .setEmoji('<:History:1521227863079256278>')
                    .setLabel('Previous')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(safePage === 0),
                new ButtonBuilder()
                    .setCustomId(`premiums_pg_servers_${safePage}`)
                    .setLabel(`${safePage + 1} / ${totalPages}`)
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(true),
                new ButtonBuilder()
                    .setCustomId(`premiums_servers_${safePage + 1}`)
                    .setEmoji('<:Caretright:1521227704953864202>')
                    .setLabel('Next')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(safePage >= totalPages - 1)
            );
            container.addActionRowComponents(row);
        }

        // Add view switcher
        container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
        const switchRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('premiums_switch_overview')
                .setLabel('Overview')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('premiums_switch_users')
                .setLabel('Users')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('premiums_switch_servers')
                .setLabel('Servers')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(true)
        );
        container.addActionRowComponents(switchRow);

        return container;
    }

    // Default: overview
    const stats = premiumManager.getStats();

    let content = `# <:Sketch:1521228025365004471> Premium Overview\n\n`;

    // Users summary
    content += `### <:User:1521227714227343380> Premium Users — ${stats.users.active} Active\n`;
    content += `> ♾️ Permanent: **${stats.users.permanent}** · <:Timer:1521227971590095070> Timed: **${stats.users.timed}**\n`;
    if (stats.users.expired > 0) content += `> <:Cancel:1521227723916181644> Expired: **${stats.users.expired}**\n`;
    if (stats.users.soonestExpiry) {
        const ts = Math.floor(new Date(stats.users.soonestExpiry.expiresAt).getTime() / 1000);
        content += `> <:Alarm:1521227869047750689> Next Expiry: <@${stats.users.soonestExpiry.userId}> — <t:${ts}:R>\n`;
    }
    content += `\n`;

    // Servers summary
    content += `### <:Home:1521228339736482056> Premium Servers — ${stats.servers.active} Active\n`;
    if (stats.servers.expired > 0) content += `> <:Cancel:1521227723916181644> Expired: **${stats.servers.expired}**\n`;
    if (stats.servers.soonestExpiry) {
        const ts = Math.floor(new Date(stats.servers.soonestExpiry.expiresAt).getTime() / 1000);
        const guild = client.guilds.cache.get(stats.servers.soonestExpiry.guildId);
        const name = guild ? guild.name : stats.servers.soonestExpiry.guildId;
        content += `> <:Alarm:1521227869047750689> Next Expiry: **${name}** — <t:${ts}:R>\n`;
    }
    content += `\n`;

    // Keys summary
    content += `### <:Key:1521228000467878111> Keys\n`;
    content += `> <:online:1521228065752088576> Active: **${stats.keys.active}** · <:Cloudcheck:1521228125437165678> Redeemed: **${stats.keys.redeemed}** · <:Alarm:1521227869047750689> Expired: **${stats.keys.expired}**\n\n`;

    // Top users list (first 5)
    if (activeUsers.length > 0) {
        content += `### <:Checkedbox:1521227734943269077> Recent Premium Users\n`;
        activeUsers.slice(0, 5).forEach((p, i) => {
            const dur = p.expiresAt ? `<t:${Math.floor(new Date(p.expiresAt).getTime() / 1000)}:R>` : '♾️';
            content += `> **${i + 1}.** <@${p.userId}> — ${dur}\n`;
        });
        if (activeUsers.length > 5) content += `> *...and ${activeUsers.length - 5} more*\n`;
        content += `\n`;
    }

    // Top servers list (first 5)
    if (activeServers.length > 0) {
        content += `### <:Checkedbox:1521227734943269077> Recent Premium Servers\n`;
        activeServers.slice(0, 5).forEach((s, i) => {
            const guild = client.guilds.cache.get(s.guildId);
            const name = guild ? guild.name : s.guildId;
            const dur = s.expiresAt ? `<t:${Math.floor(new Date(s.expiresAt).getTime() / 1000)}:R>` : '♾️';
            content += `> **${i + 1}.** ${name} — ${dur}\n`;
        });
        if (activeServers.length > 5) content += `> *...and ${activeServers.length - 5} more*\n`;
    }

    const container = new ContainerBuilder();
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

    // Add view switcher
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
    const switchRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('premiums_switch_overview')
            .setLabel('Overview')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(true),
        new ButtonBuilder()
            .setCustomId('premiums_switch_users')
            .setLabel(`Users (${stats.users.active})`)
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('premiums_switch_servers')
            .setLabel(`Servers (${stats.servers.active})`)
            .setStyle(ButtonStyle.Secondary)
    );
    container.addActionRowComponents(switchRow);

    return container;
}

module.exports = {
    prefix: 'premiums',
    name: 'premiums',
    description: 'View all activated premium users and servers',
    usage: 'premiums [users|servers]',
    category: 'owner',
    aliases: ['allpremiums', 'premiummembers', 'premiumlist'],
    ownerOnly: true,

    async executePrefix(message, args) {
        if (!isOwner(message.author.id)) {
            const container = buildErrorResponse('Owner Only', 'This command is restricted to the bot owner.');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        try {
            const activeUsers = premiumManager.getActivePremiumUsers();
            const activeServers = premiumManager.getActivePremiumServers();

            let view = 'overview';
            if (args[0]?.toLowerCase() === 'users') view = 'users';
            else if (args[0]?.toLowerCase() === 'servers') view = 'servers';

            const container = buildPage(message.client, activeUsers, activeServers, 0, view);
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('[Premiums] Error:', error);
            const container = buildErrorResponse('Error', 'Failed to load premium data.');
            message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }
    },

    async handleButton(interaction) {
        const customId = interaction.customId;
        if (!customId.startsWith('premiums_')) return false;
        if (customId.startsWith('premiums_pg_')) return true; // Ignore page label clicks

        if (!isOwner(interaction.user.id)) {
            await interaction.reply(require('../../utils/ownerUI').ownerOnly({ ephemeral: true })).catch(() => {});
            return true;
        }

        try {
            const activeUsers = premiumManager.getActivePremiumUsers();
            const activeServers = premiumManager.getActivePremiumServers();

            let view = 'overview';
            let page = 0;

            if (customId.startsWith('premiums_switch_')) {
                view = customId.replace('premiums_switch_', '');
            } else if (customId.startsWith('premiums_users_')) {
                view = 'users';
                page = parseInt(customId.split('_')[2]) || 0;
            } else if (customId.startsWith('premiums_servers_')) {
                view = 'servers';
                page = parseInt(customId.split('_')[2]) || 0;
            }

            const container = buildPage(interaction.client, activeUsers, activeServers, page, view);
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('[Premiums] Button error:', error);
            await interaction.reply(require('../../utils/ownerUI').errReply('Error', 'An error occurred.', { ephemeral: true })).catch(() => {});
        }

        return true;
    }
};
