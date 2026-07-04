const { isOwner } = require('../../utils/helpers');
const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { buildErrorResponse, COLORS } = require('../../utils/responseBuilder');
const premiumManager = require('../../utils/premiumManager');

const KEYS_PER_PAGE = 8;

function buildKeysPage(keys, filter, page) {
    const totalPages = Math.max(1, Math.ceil(keys.length / KEYS_PER_PAGE));
    page = Math.max(0, Math.min(page, totalPages - 1));
    const start = page * KEYS_PER_PAGE;
    const slice = keys.slice(start, start + KEYS_PER_PAGE);

    let content = `# <:Key:1521228000467878111> Premium Keys (${filter})\n\n`;
    content += `**Total:** ${keys.length} key${keys.length === 1 ? '' : 's'}\n\n`;

    slice.forEach((keyData, i) => {
        const num = start + i + 1;
        const isExpired = premiumManager.isKeyExpired(keyData);
        const statusIcon = keyData.redeemed
            ? '<:dnd:1521228070701502486> Redeemed'
            : isExpired
                ? '<:Alarm:1521227869047750689> Expired'
                : '<:online:1521228065752088576> Active';
        const typeLabel = keyData.type === 'server' ? ' \`[Server]\`' : ' \`[User]\`';

        content += `**${num}.** \`${keyData.key}\`${typeLabel}\n`;
        content += `   Status: ${statusIcon} — Duration: ${keyData.duration ? `${keyData.duration}d` : 'Permanent'}\n`;

        if (keyData.redeemed) {
            content += `   Redeemed by: <@${keyData.redeemedBy}> <t:${Math.floor(new Date(keyData.redeemedAt).getTime() / 1000)}:R>`;
            if (keyData.guildId) content += ` (Server: \`${keyData.guildId}\`)`;
            content += `\n`;
        } else if (isExpired) {
            content += `   Created: <t:${Math.floor(new Date(keyData.createdAt).getTime() / 1000)}:R> — Expired: <t:${Math.floor(new Date(keyData.expiresAt).getTime() / 1000)}:R>\n`;
        } else {
            content += `   Created: <t:${Math.floor(new Date(keyData.createdAt).getTime() / 1000)}:R> — Expires: <t:${Math.floor(new Date(keyData.expiresAt).getTime() / 1000)}:R>\n`;
        }
        content += `\n`;
    });

    content += `-# Page ${page + 1}/${totalPages}`;

    const container = new ContainerBuilder().setAccentColor(COLORS.INFO);
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

    if (totalPages > 1) {
        container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`listkeys_${filter}_${page - 1}`)
                .setEmoji('<:History:1521227863079256278>')
                .setLabel('Previous')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page === 0),
            new ButtonBuilder()
                .setCustomId(`listkeys_pg_${filter}_${page}`)
                .setLabel(`${page + 1} / ${totalPages}`)
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true),
            new ButtonBuilder()
                .setCustomId(`listkeys_${filter}_${page + 1}`)
                .setEmoji('<:Caretright:1521227704953864202>')
                .setLabel('Next')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page >= totalPages - 1)
        );
        container.addActionRowComponents(row);
    }

    return container;
}

module.exports = {
    prefix: 'listkeys',
    name: 'listkeys',
    description: 'List all premium keys',
    usage: 'listkeys [filter]',
    category: 'owner',
    aliases: ['viewkeys'],
    ownerOnly: true,
    
    async executePrefix(message, args) {
        if (!isOwner(message.author.id)) {
            const container = buildErrorResponse('Owner Only', 'This command is restricted to the bot owner.');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

      try {
        const filter = args[0]?.toLowerCase() || 'all';
        
        if (!['all', 'active', 'redeemed', 'expired'].includes(filter)) {
            let content = `# <:Key:1521228000467878111> List Premium Keys\n\n`;
            content += `**Usage:** \`listkeys [filter]\`\n\n`;
            content += `### Filters\n`;
            content += `> **all** - Show all keys (default)\n`;
            content += `> **active** - Show only unredeemed & valid keys\n`;
            content += `> **redeemed** - Show only redeemed keys\n`;
            content += `> **expired** - Show unredeemed keys past 24h\n\n`;
            content += `**Examples:**\n`;
            content += `\`listkeys\` - Show all keys\n`;
            content += `\`listkeys active\` - Show unused valid keys\n`;
            content += `\`listkeys redeemed\` - Show used keys\n`;
            content += `\`listkeys expired\` - Show expired keys`;

            const container = new ContainerBuilder()
                .setAccentColor(COLORS.INFO)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const keys = premiumManager.listKeys(filter);

        if (keys.length === 0) {
            const container = buildErrorResponse('No Keys Found', `No ${filter === 'all' ? '' : filter} keys found.`);
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const container = buildKeysPage(keys, filter, 0);
        message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
      } catch (error) {
        console.error('[ListKeys] Error:', error);
        const container = buildErrorResponse('Error', 'An error occurred while listing keys.');
        message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
      }
    },

    async handleButton(interaction) {
        const customId = interaction.customId;
        if (!customId.startsWith('listkeys_')) return false;
        if (customId.startsWith('listkeys_pg_')) return true;

        if (!isOwner(interaction.user.id)) {
            await interaction.reply(require('../../utils/ownerUI').ownerOnly({ ephemeral: true })).catch(() => {});
            return true;
        }

        // listkeys_{filter}_{page}
        const parts = customId.split('_');
        const filter = parts[1];
        const page = parseInt(parts[2]) || 0;

        const keys = premiumManager.listKeys(filter);
        if (keys.length === 0) {
            const container = buildErrorResponse('No Keys Found', `No ${filter === 'all' ? '' : filter} keys found.`);
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
            return true;
        }

        const container = buildKeysPage(keys, filter, page);
        await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
        return true;
    }
};
