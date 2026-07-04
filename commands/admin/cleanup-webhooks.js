const { SlashCommandBuilder, PermissionFlagsBits, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } = require('discord.js');
const jsonStore = require('../../utils/jsonStore');
const { invalidateCache } = require('../../utils/logger');
const { } = require('../../utils/responseBuilder');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('cleanup-webhooks')
        .setDescription('[Owner] Remove webhook configurations for servers the bot is no longer in')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    prefix: 'cleanup-webhooks',
    description: '[Owner] Remove webhook configurations for servers the bot is no longer in',
    usage: 'cleanup-webhooks',
    category: 'admin',
    ownerOnly: true,

    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await this.performCleanup(interaction, interaction.client);
    },

    async executePrefix(message) {
        const msg = await message.reply({
            components: [
                new ContainerBuilder()
                    .addTextDisplayComponents(new TextDisplayBuilder()
                        .setContent('# <:Lightning:1521227915537285150> Cleaning Webhooks\n\nScanning all stores for deleted servers...')
                    )
            ],
            flags: MessageFlags.IsComponentsV2
        });

        await this.performCleanup(message, message.client, msg);
    },

    async performCleanup(context, client, editableMessage = null) {
        try {
            // Get all guild IDs the bot is currently in
            const activeGuildIds = new Set(client.guilds.cache.keys());

            // Stores that might contain per-guild webhook/logging config
            const GUILD_STORES = [
                'logs', 'logging', 'automod', 'antinuke', 'welcomer',
                'antispam', 'antiraid', 'antialt', 'vanityguard', 'tickets',
                'autoresponder', 'autoreact', 'autorole', 'autonick', 'voiceautorole',
                'reactionroles', 'starboard', 'suggestions', 'giveaways', 'giveaway-settings',
                'media-only', 'sticky', 'simple-sticky', 'booster-notify', 'social-notify',
                'button-commands', 'select-menus', 'customcmds', 'welcomer-templates',
                'verification', 'invites', 'join2create', 'serverstats',
                'levelchannel', 'levelingtoggle', 'levelmultiplier', 'levelroles',
                'applications', 'application-responses', 'aichat',
                'panel-registry', 'musicpanel', 'musicpanel-247', 'guildtags', 'servertag',
                'servertag-users', 'vote-config', 'birthdays', 'confessions', 'reminders',
                'spotify-links', 'marriages', 'reputation', 'user-templates', 'voicebans',
                'guilds', 'prefixes', 'emergency', 'nightmode', 'botblock', 'statusrole',
                'ignored-channels', 'lockdown', 'trust', 'warnings', 'modlogs'
            ];

            let totalRemoved = 0;
            let storesModified = 0;
            const removedGuildIds = new Set();

            for (const storeName of GUILD_STORES) {
                if (!jsonStore.has(storeName)) continue;

                const storeData = jsonStore.read(storeName);
                let modified = false;

                // Find guild IDs in this store that are no longer active
                for (const guildId of Object.keys(storeData)) {
                    if (!activeGuildIds.has(guildId)) {
                        delete storeData[guildId];
                        modified = true;
                        totalRemoved++;
                        removedGuildIds.add(guildId);
                    }
                }

                if (modified) {
                    await jsonStore.writeImmediate(storeName, storeData);
                    storesModified++;
                }
            }

            // Invalidate logger cache to pick up changes
            if (totalRemoved > 0) {
                invalidateCache();
            }

            const resultContainer = new ContainerBuilder()
                .setAccentColor(totalRemoved > 0 ? 0x57F287 : 0xCAD7E6)
                .addTextDisplayComponents(new TextDisplayBuilder()
                    .setContent(
                        totalRemoved > 0
                            ? `# <:Checkedbox:1521227734943269077> Webhook Cleanup Complete\n\n` +
                              `Removed \`${totalRemoved}\` entries from \`${storesModified}\` stores.\n\n` +
                              `**Deleted Servers Cleaned:**\n${[...removedGuildIds].slice(0, 10).map(id => `\`${id}\``).join(', ')}${removedGuildIds.size > 10 ? ` and ${removedGuildIds.size - 10} more...` : ''}\n\n` +
                              `Webhook errors for deleted servers should now stop.`
                            : `# <:Inforect:1521228008285929532> Database Already Clean\n\n` +
                              `No entries found for deleted servers.\n\n` +
                              `All configured servers are currently active.`
                    )
                )
;

            if (editableMessage) {
                await editableMessage.edit({
                    components: [resultContainer],
                    flags: MessageFlags.IsComponentsV2
                });
            } else {
                await context.editReply({
                    components: [resultContainer],
                    flags: MessageFlags.IsComponentsV2
                });
            }
        } catch (error) {
            const errorContainer = new ContainerBuilder()
                .setAccentColor(0xED4245)
                .addTextDisplayComponents(new TextDisplayBuilder()
                    .setContent(
                        `# <:Cancel:1521227723916181644> Cleanup Failed\n\n` +
                        `An error occurred during cleanup:\n\`\`\`${error.message}\`\`\``
                    )
                )
;

            if (editableMessage) {
                await editableMessage.edit({
                    components: [errorContainer],
                    flags: MessageFlags.IsComponentsV2
                });
            } else {
                await context.editReply({
                    components: [errorContainer],
                    flags: MessageFlags.IsComponentsV2
                });
            }
        }
    }
};
