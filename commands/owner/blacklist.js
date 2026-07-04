const { isOwner } = require('../../utils/helpers');
const { MessageFlags, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize } = require('discord.js');
const { paginate, setupPaginationCollector } = require('../../utils/pagination');
const { COLORS } = require('../../utils/responseBuilder');

const jsonStore = require('../../utils/jsonStore');

function loadBlacklist() {
    if (!jsonStore.has('blacklist')) {
        jsonStore.write('blacklist', { users: [], guilds: [] });
    }
    return jsonStore.read('blacklist');
}

function saveBlacklist(data) {
    jsonStore.write('blacklist', data);
}

function buildBlacklistPaginated(blacklist) {
    const allLines = [];

    if (blacklist.users.length > 0) {
        allLines.push(`### <:User:1521227714227343380> Blacklisted Users`);
        blacklist.users.forEach(u => {
            allLines.push(`> <:Commentblock:1521227898101432331> **${u.username || u.id}** (\`${u.id}\`)\n> └ ${u.reason}`);
        });
    }

    if (blacklist.guilds.length > 0) {
        if (allLines.length > 0) allLines.push('');
        allLines.push(`### <:Home:1521228339736482056> Blacklisted Servers`);
        blacklist.guilds.forEach(g => {
            allLines.push(`> <:Commentblock:1521227898101432331> **${g.name}** (\`${g.id}\`)\n> └ ${g.reason}`);
        });
    }

    if (allLines.length === 0) {
        const container = new ContainerBuilder()
            .setAccentColor(COLORS.INFO)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Commentblock:1521227898101432331> Blacklist\n\n*No blacklisted users or servers.*`))
            .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        return { components: [container], flags: MessageFlags.IsComponentsV2 };
    }

    return paginate({
        header: `# <:Commentblock:1521227898101432331> Blacklist\n-# **${blacklist.users.length}** users, **${blacklist.guilds.length}** servers`,
        lines: allLines,
        perPage: 10,
        accentColor: COLORS.INFO,
    });
}

module.exports = {
    name: 'blacklist',
    prefix: 'blacklist',
    aliases: ['bl'],
    description: 'Manage blacklisted users/servers',
    usage: 'blacklist [add-user|remove-user|add-server|remove-server|list]',
    category: 'owner',
    ownerOnly: true,

    async executePrefix(message, args) {
        if (!isOwner(message.author.id)) {
            return message.reply(require('../../utils/ownerUI').ownerOnly());
        }

        const action = args[0]?.toLowerCase();
        const blacklist = loadBlacklist();

        if (!action || action === 'list') {
            const result = buildBlacklistPaginated(blacklist);
            const reply = await message.reply(result);
            if (result._pageData) setupPaginationCollector(reply, result._pageData, message.author.id);
            return;
        }

        if (action === 'add-user' || action === 'adduser') {
            const userId = args[1]?.replace(/[<@!>]/g, '');
            const reason = args.slice(2).join(' ') || 'No reason provided';

            if (!userId) {
                return message.reply(require('../../utils/ownerUI').errReply('Missing Argument', 'Please provide a user ID or mention.'));
            }

            try {
                const user = await message.client.users.fetch(userId);
                if (blacklist.users.find(u => u.id === user.id)) {
                    return message.reply(require('../../utils/ownerUI').errReply('Already Blacklisted', `**${user.username}** is already blacklisted.`));
                }

                blacklist.users.push({ id: user.id, tag: user.username, username: user.username, reason, addedAt: Date.now() });
                saveBlacklist(blacklist);

                const container = new ContainerBuilder()
                    .setAccentColor(COLORS.INFO)
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                        `# <:Checkedbox:1521227734943269077> User Blacklisted\n\n` +
                        `<:User:1521227714227343380> **User:** ${user.username}\n` +
                        `<:Caretright:1521227704953864202> **Reason:** ${reason}`
                    ))
                    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            } catch {
                return message.reply(require('../../utils/ownerUI').errReply('User Not Found', 'Could not find that user.'));
            }
        }

        if (action === 'remove-user' || action === 'removeuser') {
            const userId = args[1]?.replace(/[<@!>]/g, '');
            if (!userId) return message.reply(require('../../utils/ownerUI').errReply('Missing Argument', 'Please provide a user ID or mention.'));

            const index = blacklist.users.findIndex(u => u.id === userId);
            if (index === -1) return message.reply(require('../../utils/ownerUI').errReply('Not Blacklisted', 'That user is not blacklisted.'));

            const removed = blacklist.users.splice(index, 1)[0];
            saveBlacklist(blacklist);
            return message.reply(`<:Checkedbox:1521227734943269077> Successfully removed **${removed.username || removed.id}** from blacklist!`);
        }

        if (action === 'add-guild' || action === 'addguild' || action === 'add-server' || action === 'addserver') {
            const guildId = args[1];
            const reason = args.slice(2).join(' ') || 'No reason provided';
            if (!guildId) return message.reply(require('../../utils/ownerUI').errReply('Missing Argument', 'Please provide a server ID.'));

            if (blacklist.guilds.find(g => g.id === guildId)) {
                return message.reply(require('../../utils/ownerUI').errReply('Already Blacklisted', 'That server is already blacklisted.'));
            }

            const guild = message.client.guilds.cache.get(guildId);
            blacklist.guilds.push({ id: guildId, name: guild ? guild.name : 'Unknown Server', reason, addedAt: Date.now() });
            saveBlacklist(blacklist);

            if (guild) { try { await guild.leave(); } catch {} }

            const container = new ContainerBuilder()
                .setAccentColor(COLORS.INFO)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# <:Checkedbox:1521227734943269077> Server Blacklisted\n\n` +
                    `<:Home:1521228339736482056> **Server:** ${guild?.name || guildId}\n` +
                    `<:Caretright:1521227704953864202> **Reason:** ${reason}` +
                    (guild ? `\n<:Caretright:1521227704953864202> **Left server:** Yes` : '')
                ))
                .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (action === 'remove-guild' || action === 'removeguild' || action === 'remove-server' || action === 'removeserver') {
            const guildId = args[1];
            if (!guildId) return message.reply(require('../../utils/ownerUI').errReply('Missing Argument', 'Please provide a server ID.'));

            const index = blacklist.guilds.findIndex(g => g.id === guildId);
            if (index === -1) return message.reply(require('../../utils/ownerUI').errReply('Not Blacklisted', 'That server is not blacklisted.'));

            const removed = blacklist.guilds.splice(index, 1)[0];
            saveBlacklist(blacklist);
            return message.reply(`<:Checkedbox:1521227734943269077> Successfully removed **${removed.name}** from blacklist!`);
        }

        const helpContainer = new ContainerBuilder()
            .setAccentColor(COLORS.INFO)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `# <:Lock:1521227892770734120> Blacklist Commands\n\n` +
                `<:Caretright:1521227704953864202> \`blacklist\` - View all blacklisted users/servers\n` +
                `<:Caretright:1521227704953864202> \`blacklist add-user <@user/id> [reason]\` - Blacklist a user\n` +
                `<:Caretright:1521227704953864202> \`blacklist remove-user <@user/id>\` - Remove user\n` +
                `<:Caretright:1521227704953864202> \`blacklist add-server <id> [reason]\` - Blacklist a server\n` +
                `<:Caretright:1521227704953864202> \`blacklist remove-server <id>\` - Remove server`
            ))
            .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        
        return message.reply({ components: [helpContainer], flags: MessageFlags.IsComponentsV2 });
    }
};
