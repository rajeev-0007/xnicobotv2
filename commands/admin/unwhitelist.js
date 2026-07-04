const { ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const { COLORS } = require('../../utils/responseBuilder');
const trust = require('../../utils/trustManager');
const jsonStore = require('../../utils/jsonStore');


function loadJSON(storeName) {
  return jsonStore.read(storeName);
}

function saveJSON(storeName, d) { jsonStore.write(storeName, d); }

module.exports = {
    name: 'unwhitelist',
    prefix: 'unwhitelist',
    description: 'Remove whitelist permissions for a specific user or role in automoderation or antinuke settings',
    usage: 'unwhitelist <category> <@user|@role>',
    category: 'admin',
    aliases: ['unwl', 'removewhitelist'],

    async executePrefix(message, args) {
        if (!trust.isServerOwner(message.guild, message.author.id)) {
            return message.reply(require('../../utils/adminUI').errReply('Not Allowed', 'Only the **server owner** or **second owner** can use this command.'));
        }

        const category = args[0]?.toLowerCase();
        const validCategories = ['all', 'ban', 'kick', 'channel', 'role', 'webhook', 'botadd', 'automod'];

        if (!category || !validCategories.includes(category)) {
            const container = new ContainerBuilder()
                .setAccentColor(COLORS.INFO)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# <:Shield:1521227694677692467> Unwhitelist\n\n` +
                    `**Usage:** \`unwhitelist <category> @user\`\n\n` +
                    `### Categories\n` +
                    `> \`all\` / \`ban\` / \`kick\` / \`channel\` / \`role\` / \`webhook\` / \`botadd\` — Antinuke\n` +
                    `> \`automod\` — Automod (roles only)\n\n` +
                    `**Example:** \`unwhitelist all @User\``
                ));
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const user = message.mentions.users.first();
        const role = message.mentions.roles.first();

        if (!user && !role) {
            return message.reply(require('../../utils/adminUI').errReply('Missing Target', 'Mention a user or role to remove from the whitelist.'));
        }

        // Handle automod
        if (category === 'automod') {
            if (!role) {
                return message.reply(require('../../utils/adminUI').errReply('Roles Only', 'Automod whitelist only supports roles.'));
            }

            const automod = loadJSON('automod');
            const guildConfig = automod[message.guild.id];
            if (!guildConfig || !guildConfig.ignoredRoles?.includes(role.id)) {
                return message.reply(require('../../utils/adminUI').errReply('Not Whitelisted', `**${role.name}** is not in the automod whitelist.`));
            }

            guildConfig.ignoredRoles = guildConfig.ignoredRoles.filter(id => id !== role.id);
            saveJSON('automod', automod);

            const container = new ContainerBuilder()
                .setAccentColor(COLORS.SUCCESS)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# <:Checkedbox:1521227734943269077> Automod Whitelist Removed\n\n` +
                    `**Role:** ${role} (\`${role.id}\`)\n\n` +
                    `> This role will now be subject to automod filters.`
                ));
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        // Handle antinuke
        if (!user) {
            return message.reply(require('../../utils/adminUI').errReply('Users Only', 'Antinuke whitelist only supports users.'));
        }

        const antinuke = loadJSON('antinuke');
        const guildConfig = antinuke[message.guild.id];
        if (!guildConfig || !guildConfig.whitelistedUsers?.includes(user.id)) {
            return message.reply(require('../../utils/adminUI').errReply('Not Whitelisted', `**${user.username}** is not in the antinuke whitelist.`));
        }

        guildConfig.whitelistedUsers = guildConfig.whitelistedUsers.filter(id => id !== user.id);
        saveJSON('antinuke', antinuke);

        const container = new ContainerBuilder()
            .setAccentColor(COLORS.SUCCESS)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `# <:Checkedbox:1521227734943269077> Antinuke Whitelist Removed\n\n` +
                `**User:** ${user.username} (\`${user.id}\`)\n\n` +
                `> This user will now be subject to antinuke protections.`
            ));

        return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
};
