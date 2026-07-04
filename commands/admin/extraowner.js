const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } = require('discord.js');
const { COLORS } = require('../../utils/responseBuilder');
const trust = require('../../utils/trustManager');

function buildPanel(guild, secondOwnerId) {
    const ownerDisplay = secondOwnerId
        ? `<@${secondOwnerId}> (\`${secondOwnerId}\`)`
        : '*Not set*';

    const statusEmoji = secondOwnerId
        ? '<:Checkedbox:1521227734943269077>'
        : '<:Cancel:1521227723916181644>';

    const content =
        `# <:Shield:1521227694677692467> Extra Owner\n` +
        `-# Secondary owner configuration for **${guild.name}**\n\n` +
        `### <:Userplus:1521227719621218477> Current Extra Owner\n` +
        `${statusEmoji} ${ownerDisplay}\n\n` +
        `### <:Document:1521227875016114266> What Extra Owner Gets\n` +
        `<:Caretright:1521227704953864202> Full access to all security commands\n` +
        `<:Caretright:1521227704953864202> Can manage antinuke, whitelist, and trust settings\n` +
        `<:Caretright:1521227704953864202> Treated as server owner in the bot's permission system\n` +
        `<:Caretright:1521227704953864202> Cannot override the actual server owner\n\n` +
        `### <:Lightningalt:1521227851796447472> Commands\n` +
        `<:Caretright:1521227704953864202> \`extraowner set @user\` — Set a user as extra owner\n` +
        `<:Caretright:1521227704953864202> \`extraowner view\` — View current extra owner\n` +
        `<:Caretright:1521227704953864202> \`extraowner reset\` — Remove the extra owner\n\n` +
        `-# <:Infotriangle:1521227710381428926> Only the server owner can manage this setting`;

    const container = new ContainerBuilder()
        .setAccentColor(secondOwnerId ? 0x57F287 : null);
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
    return container;
}

module.exports = {
    name: 'extraowner',
    prefix: 'extraowner',
    description: 'Set, view, or reset the secondary (extra) owner for this server',
    usage: 'extraowner [set @user|view|reset]',
    category: 'admin',
    aliases: ['secondowner'],
    prefixOnly: true,

    async executePrefix(message, args) {
        const guild = message.guild;
        const sub = args[0]?.toLowerCase();

        if (sub === 'view' || !sub) {
            if (!trust.isServerOwner(guild, message.author.id)) {
                return message.reply(require('../../utils/adminUI').errReply('Not Allowed', 'Only the **server owner** or **extra owner** can use this command.'));
            }

            const secondOwnerId = trust.getSecondOwner(guild.id);
            const panel = buildPanel(guild, secondOwnerId);
            return message.reply({ components: [panel], flags: MessageFlags.IsComponentsV2 });
        }

        if (!trust.isGuildOwner(guild, message.author.id)) {
            return message.reply(require('../../utils/adminUI').errReply('Not Allowed', 'Only the **server owner** can set or reset the extra owner.'));
        }

        if (sub === 'set') {
            const user = message.mentions.users.first();
            if (!user) {
                return message.reply(require('../../utils/adminUI').errReply('Missing User', 'Mention a user to set as extra owner.', { hint: 'Usage: `extraowner set @user`' }));
            }

            if (user.id === message.author.id) {
                return message.reply(require('../../utils/adminUI').errReply('Already Owner', 'You are already the server owner.'));
            }

            if (user.bot) {
                return message.reply(require('../../utils/adminUI').errReply('Invalid Target', 'You cannot set a bot as extra owner.'));
            }

            const currentSecond = trust.getSecondOwner(guild.id);
            if (currentSecond === user.id) {
                return message.reply(require('../../utils/adminUI').errReply('Already Set', `**${user.username}** is already the extra owner.`));
            }

            trust.setSecondOwner(guild.id, user.id);

            const container = new ContainerBuilder()
                .setAccentColor(0x57F287)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# <:Checkedbox:1521227734943269077> Extra Owner Set\n\n` +
                    `**User:** ${user} (\`${user.id}\`)\n\n` +
                    `> This user now has owner-level access to all bot security commands.\n\n` +
                    (currentSecond ? `-# Previous extra owner <@${currentSecond}> has been replaced` : `-# Use \`extraowner reset\` to remove`)
                ));
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (sub === 'reset') {
            const currentSecond = trust.getSecondOwner(guild.id);
            if (!currentSecond) {
                return message.reply(require('../../utils/adminUI').errReply('No Extra Owner', 'There is no extra owner set for this server.'));
            }

            trust.removeSecondOwner(guild.id);

            const container = new ContainerBuilder()
                .setAccentColor(0xED4245)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# <:Cancel:1521227723916181644> Extra Owner Removed\n\n` +
                    `**Previous:** <@${currentSecond}> (\`${currentSecond}\`)\n\n` +
                    `> This user no longer has owner-level bot access.`
                ));
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const secondOwnerId = trust.getSecondOwner(guild.id);
        const panel = buildPanel(guild, secondOwnerId);
        return message.reply({ components: [panel], flags: MessageFlags.IsComponentsV2 });
    }
};
