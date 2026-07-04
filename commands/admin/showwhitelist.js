const { ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const { COLORS } = require('../../utils/responseBuilder');
const trust = require('../../utils/trustManager');
const { paginate, setupPaginationCollector } = require('../../utils/pagination');

const jsonStore = require('../../utils/jsonStore');

function loadJSON(storeName) {
    return jsonStore.read(storeName);
}

module.exports = {
    name: 'showwhitelist',
    prefix: 'showwhitelist',
    description: 'Display whitelisted users and roles in each antinuke category',
    usage: 'showwhitelist',
    category: 'admin',
    aliases: ['whitelistshow', 'wllist', 'listwhitelist', 'whitelisted'],

    async executePrefix(message) {
        if (!trust.isServerOwner(message.guild, message.author.id)) {
            return message.reply('<:Cancel:1521227723916181644> Only the **server owner** or **second owner** can use this command.');
        }

        const guildId = message.guild.id;

        // Antinuke whitelist
        const antinuke = loadJSON('antinuke');
        const anConfig = antinuke[guildId];
        const whitelistedUsers = anConfig?.whitelistedUsers || [];

        // Automod ignored roles
        const automod = loadJSON('automod');
        const amConfig = automod[guildId];
        const ignoredRoles = amConfig?.ignoredRoles || [];
        const ignoredChannels = amConfig?.ignoredChannels || [];

        // Build all lines
        const lines = [];

        lines.push(`### Antinuke Whitelisted Users (${whitelistedUsers.length})`);
        if (whitelistedUsers.length === 0) {
            lines.push('*No whitelisted users*');
        } else {
            for (const id of whitelistedUsers) {
                lines.push(`• <@${id}> (\`${id}\`)`);
            }
        }

        lines.push('');
        lines.push(`### Automod Whitelisted (${ignoredRoles.length} roles, ${ignoredChannels.length} channels)`);
        if (ignoredRoles.length === 0 && ignoredChannels.length === 0) {
            lines.push('*No whitelisted roles or channels*');
        } else {
            if (ignoredRoles.length > 0) {
                lines.push('**Ignored Roles:**');
                for (const id of ignoredRoles) lines.push(`• <@&${id}>`);
            }
            if (ignoredChannels.length > 0) {
                lines.push('**Ignored Channels:**');
                for (const id of ignoredChannels) lines.push(`• <#${id}>`);
            }
        }

        const totalItems = whitelistedUsers.length + ignoredRoles.length + ignoredChannels.length;

        // If small enough, show in a single message (no pagination needed)
        if (totalItems <= 15) {
            const container = new ContainerBuilder()
                .setAccentColor(COLORS.INFO)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# <:Shield:1521227694677692467> Whitelist Overview — ${message.guild.name}\n\n` +
                    lines.join('\n') + '\n\n' +
                    `-# Use \`whitelist <category> @user\` to add, \`unwhitelist <category> @user\` to remove`
                ));
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        // Paginated view
        const result = paginate({
            header: `# <:Shield:1521227694677692467> Whitelist Overview — ${message.guild.name}`,
            lines,
            perPage: 15,
            accentColor: COLORS.INFO,
            footer: `-# Use \`whitelist <category> @user\` to add, \`unwhitelist <category> @user\` to remove`
        });

        const reply = await message.reply(result);
        setupPaginationCollector(reply, result._pageData, message.author.id);
    }
};
