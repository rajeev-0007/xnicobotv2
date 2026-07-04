const { ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const { COLORS } = require('../../utils/responseBuilder');
const trust = require('../../utils/trustManager');
const jsonStore = require('../../utils/jsonStore');


function loadJSON(storeName) {
  return jsonStore.read(storeName);
}

function saveJSON(storeName, d) { jsonStore.write(storeName, d); }

const ANTINUKE_CATEGORIES = ['all', 'ban', 'kick', 'channel', 'role', 'webhook', 'botadd'];
const AUTOMOD_CATEGORIES = ['automod'];

module.exports = {
    name: 'whitelist',
    prefix: 'whitelist',
    description: 'Whitelist a user or role for specific automoderation or antinuke settings',
    usage: 'whitelist <category> <@user|@role>',
    category: 'admin',
    aliases: ['wl'],

    async executePrefix(message, args) {
        if (!trust.isServerOwner(message.guild, message.author.id)) {
            return message.reply(require('../../utils/adminUI').errReply('Not Allowed', 'Only the **server owner** or **second owner** can use this command.'));
        }

        const category = args[0]?.toLowerCase();

        if (category === 'reset') {
            const antinuke = loadJSON('antinuke');
            const guildConfig = antinuke[message.guild.id];
            if (!guildConfig || !guildConfig.whitelistedUsers?.length) {
                return message.reply(require('../../utils/adminUI').errReply('Nothing To Reset', 'There are no whitelisted users to reset.'));
            }

            const count = guildConfig.whitelistedUsers.length;
            guildConfig.whitelistedUsers = [];
            saveJSON('antinuke', antinuke);

            const container = new ContainerBuilder()
                .setAccentColor(COLORS.ERROR)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# <:Cancel:1521227723916181644> Whitelist Reset\n\n` +
                    `Removed **${count}** user${count !== 1 ? 's' : ''} from the antinuke whitelist.\n\n` +
                    `> All previously whitelisted users will now trigger antinuke protections.`
                ));
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (!category || ![...ANTINUKE_CATEGORIES, ...AUTOMOD_CATEGORIES].includes(category)) {
            const container = new ContainerBuilder()
                .setAccentColor(COLORS.INFO)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# <:Shield:1521227694677692467> Whitelist\n\n` +
                    `**Usage:** \`whitelist <category> @user\`\n\n` +
                    `### Antinuke Categories\n` +
                    `> \`all\` — Whitelist from all antinuke protections\n` +
                    `> \`ban\` — Ban protection\n` +
                    `> \`kick\` — Kick protection\n` +
                    `> \`channel\` — Channel create/delete protection\n` +
                    `> \`role\` — Role create/delete protection\n` +
                    `> \`webhook\` — Webhook protection\n` +
                    `> \`botadd\` — Bot add protection\n\n` +
                    `### Automod Categories\n` +
                    `> \`automod\` — Bypass automod (adds to ignored roles)\n\n` +
                    `### Other\n` +
                    `> \`reset\` — Clear all antinuke whitelisted users\n\n` +
                    `**Example:** \`whitelist all @TrustedAdmin\``
                ));
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const user = message.mentions.users.first();
        const role = message.mentions.roles.first();

        if (!user && !role) {
            return message.reply(require('../../utils/adminUI').errReply('Missing Target', 'Mention a user or role to whitelist.'));
        }

        const targetId = user ? user.id : role.id;
        const targetName = user ? user.username : role.name;
        const targetMention = user || role;

        // Handle automod category
        if (category === 'automod') {
            if (!role) {
                return message.reply(require('../../utils/adminUI').errReply('Roles Only', 'Automod whitelist only supports roles.', { hint: 'Use `whitelist automod @role`.' }));
            }

            const automod = loadJSON('automod');
            const guildConfig = automod[message.guild.id];
            if (!guildConfig) {
                return message.reply(require('../../utils/adminUI').errReply('Not Configured', 'Automod is not configured for this server.'));
            }

            if (!guildConfig.ignoredRoles) guildConfig.ignoredRoles = [];
            if (guildConfig.ignoredRoles.includes(role.id)) {
                return message.reply(require('../../utils/adminUI').errReply('Already Whitelisted', `**${role.name}** is already whitelisted in automod.`));
            }

            guildConfig.ignoredRoles.push(role.id);
            saveJSON('automod', automod);

            const container = new ContainerBuilder()
                .setAccentColor(COLORS.SUCCESS)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# <:Checkedbox:1521227734943269077> Automod Whitelist Added\n\n` +
                    `**Role:** ${role} (\`${role.id}\`)\n\n` +
                    `> This role will now bypass automod filters.`
                ));
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        // Handle antinuke categories
        if (!user) {
            return message.reply(require('../../utils/adminUI').errReply('Users Only', 'Antinuke whitelist only supports users.', { hint: 'Use `whitelist <category> @user`.' }));
        }

        const antinuke = loadJSON('antinuke');
        const guildConfig = antinuke[message.guild.id];
        if (!guildConfig) {
            return message.reply(require('../../utils/adminUI').errReply('Not Configured', 'Antinuke is not configured for this server. Enable it first.'));
        }

        if (!guildConfig.whitelistedUsers) guildConfig.whitelistedUsers = [];
        if (guildConfig.whitelistedUsers.includes(user.id)) {
            return message.reply(require('../../utils/adminUI').errReply('Already Whitelisted', `**${user.username}** is already whitelisted in antinuke.`));
        }

        guildConfig.whitelistedUsers.push(user.id);
        saveJSON('antinuke', antinuke);

        const container = new ContainerBuilder()
            .setAccentColor(COLORS.SUCCESS)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `# <:Checkedbox:1521227734943269077> Antinuke Whitelist Added\n\n` +
                `**User:** ${user.username} (\`${user.id}\`)\n` +
                `**Category:** ${category}\n\n` +
                `> This user is now whitelisted and won't trigger antinuke protections.`
            ));

        return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
};
