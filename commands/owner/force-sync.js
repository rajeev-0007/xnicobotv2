const { isOwner } = require('../../utils/helpers');
const { MessageFlags, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize } = require('discord.js');
const { COLORS, EMOJIS } = require('../../utils/responseBuilder');

async function performSync(client) {
    const results = {
        guilds: { before: client.guilds.cache.size, after: 0, fetched: 0 },
        channels: { before: client.channels.cache.size, after: 0 },
        users: { before: client.users.cache.size, after: 0 },
        members: { fetched: 0, errors: 0 },
        startTime: Date.now(),
        endTime: null
    };

    try {
        const fetchedGuilds = await client.guilds.fetch();
        results.guilds.after = client.guilds.cache.size;
        results.guilds.fetched = fetchedGuilds.size;
    } catch {
        results.guilds.after = client.guilds.cache.size;
    }

    let membersFetched = 0;
    let memberErrors = 0;
    const guildArray = Array.from(client.guilds.cache.values());

    for (const guild of guildArray) {
        try {
            if (guild.memberCount <= 1000) {
                await guild.members.fetch({ time: 10000 });
                membersFetched++;
            } else {
                await guild.members.fetch({ limit: 100, time: 10000 });
                membersFetched++;
            }
        } catch {
            memberErrors++;
        }
    }

    results.members.fetched = membersFetched;
    results.members.errors = memberErrors;
    results.channels.after = client.channels.cache.size;
    results.users.after = client.users.cache.size;
    results.endTime = Date.now();

    return results;
}

function buildSyncResult(results) {
    const duration = ((results.endTime - results.startTime) / 1000).toFixed(2);
    const guildDiff = results.guilds.after - results.guilds.before;
    const channelDiff = results.channels.after - results.channels.before;
    const userDiff = results.users.after - results.users.before;

    const formatDiff = (diff) => {
        if (diff > 0) return `(+${diff})`;
        if (diff < 0) return `(${diff})`;
        return '(no change)';
    };

    let content = `# ${EMOJIS.SUCCESS} Force Sync Complete\n`;
    content += `-# Completed in **${duration}s**\n\n`;

    content += `### <:Invoice:1521227903956811836> Sync Results\n`;
    content += `> <:Home:1521228339736482056> **Guilds:** ${results.guilds.before} → ${results.guilds.after} ${formatDiff(guildDiff)}\n`;
    content += `> <:Edit:1521227886634205298> **Channels:** ${results.channels.before} → ${results.channels.after} ${formatDiff(channelDiff)}\n`;
    content += `> <:User:1521227714227343380> **Users Cached:** ${results.users.before} → ${results.users.after} ${formatDiff(userDiff)}\n\n`;

    content += `### <:Userplus:1521227719621218477> Member Fetch\n`;
    content += `> <:Checkedbox:1521227734943269077> **Successful:** ${results.members.fetched} guilds\n`;
    if (results.members.errors > 0) {
        content += `> <:Cancel:1521227723916181644> **Failed:** ${results.members.errors} guilds\n`;
    }
    content += `> <:Document:1521227875016114266> **Total Guilds:** ${results.guilds.fetched}\n\n`;

    const hasChanges = guildDiff !== 0 || channelDiff !== 0 || userDiff !== 0;
    if (hasChanges) {
        content += `### <:Lightningalt:1521227851796447472> Changes Detected\n`;
        if (guildDiff !== 0) content += `> <:Caretright:1521227704953864202> Guild cache ${guildDiff > 0 ? 'grew' : 'shrunk'} by **${Math.abs(guildDiff)}**\n`;
        if (channelDiff !== 0) content += `> <:Caretright:1521227704953864202> Channel cache ${channelDiff > 0 ? 'grew' : 'shrunk'} by **${Math.abs(channelDiff)}**\n`;
        if (userDiff !== 0) content += `> <:Caretright:1521227704953864202> User cache ${userDiff > 0 ? 'grew' : 'shrunk'} by **${Math.abs(userDiff)}**\n`;
    } else {
        content += `### <:Checkedbox:1521227734943269077> Status\n`;
        content += `> Cache is already up to date with Discord API.\n`;
    }

    return new ContainerBuilder()
        .setAccentColor(COLORS.SUCCESS)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
;
}

module.exports = {
    name: 'force-sync',
    prefix: 'force-sync',
    aliases: ['fsync', 'forcesync', 'sync'],
    description: 'Force-sync bot cache with Discord API',
    usage: 'force-sync',
    category: 'owner',
    ownerOnly: true,

    async executePrefix(message, args) {
        if (!isOwner(message.author.id)) {
            return message.reply(`${EMOJIS.ERROR} This command is only available to the bot owner!`);
        }

        const loadingMsg = await message.reply({ components: [
            new ContainerBuilder()
                .setAccentColor(COLORS.WARNING)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# ${EMOJIS.LOADING} Syncing Cache\n\n` +
                    `Fetching guilds, channels, and members from Discord API...\n` +
                    `-# This may take a moment depending on server count.`
                ))
        ], flags: MessageFlags.IsComponentsV2 });

        const results = await performSync(message.client);
        const container = buildSyncResult(results);
        await loadingMsg.edit({ content: null, components: [container], flags: MessageFlags.IsComponentsV2 });
    }
};
