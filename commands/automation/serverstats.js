'use strict';

const {
    SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder,
    SeparatorBuilder, SeparatorSpacingSize, SectionBuilder, ThumbnailBuilder,
    ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle,
    PermissionFlagsBits, MessageFlags, ChannelType
} = require('discord.js');
const {
    STAT_TYPES, getGuildConfig, setupStatsChannels,
    updateStatsChannels, removeStatsChannels, computeStats, formatChannelName
} = require('../../utils/serverStatsManager');
const { buildExpiredPanel } = require('../../utils/responseBuilder');

const TIMEOUT = 120_000;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('serverstats')
        .setDescription('Set up auto-updating server statistics voice channels')
        .addSubcommand(sub => sub.setName('setup').setDescription('Configure and create server stats channels'))
        .addSubcommand(sub => sub.setName('remove').setDescription('Remove all server stats channels'))
        .addSubcommand(sub => sub.setName('refresh').setDescription('Force refresh all stat channels'))
        .addSubcommand(sub => sub.setName('status').setDescription('View current server stats configuration'))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    prefix: 'serverstats',
    description: 'Set up auto-updating server statistics voice channels',
    usage: 'serverstats <setup|remove|refresh|status>',
    category: 'automation',
    aliases: ['sstats', 'server-stats', 'statssetup', 'statschannel'],
    permissions: ['ManageGuild'],

    /* ─── Slash Command ─── */
    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        if (sub === 'setup') return this._handleSetup(interaction, interaction.user, interaction.guild, true);
        if (sub === 'remove') return this._handleRemove(interaction, interaction.user, interaction.guild, true);
        if (sub === 'refresh') return this._handleRefresh(interaction, interaction.user, interaction.guild, true);
        if (sub === 'status') return this._handleStatus(interaction, interaction.user, interaction.guild, true);
    },

    /* ─── Prefix Command ─── */
    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return message.reply({ components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent('# <:Cancel:1521227723916181644> Missing Permission\n\nYou need **Manage Server** permission.'))], flags: MessageFlags.IsComponentsV2 });
        }

        const sub = (args[0] || 'setup').toLowerCase();
        if (sub === 'setup') return this._handleSetup(message, message.author, message.guild, false);
        if (sub === 'remove' || sub === 'delete' || sub === 'disable') return this._handleRemove(message, message.author, message.guild, false);
        if (sub === 'refresh' || sub === 'update' || sub === 'force') return this._handleRefresh(message, message.author, message.guild, false);
        if (sub === 'status' || sub === 'info' || sub === 'view') return this._handleStatus(message, message.author, message.guild, false);

        return this._handleSetup(message, message.author, message.guild, false);
    },

    /* ─── Setup Flow ─── */
    async _handleSetup(ctx, user, guild, isSlash) {
        const existing = getGuildConfig(guild.id);
        if (existing && existing.enabled) {
            const c = new ContainerBuilder();
            c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `# <:Settings:1521227767780343879> Server Stats Already Active\n\n` +
                `Stats channels are already set up with **${existing.stats.length}** stat counters.\n\n` +
                `> Use \`serverstats remove\` first, then \`serverstats setup\` to reconfigure.\n> Use \`serverstats refresh\` to force-update channel names.`
            ));
            return isSlash ? ctx.reply({ components: [c], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral }) : ctx.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
        }

        // Build selection menu
        const uid = user.id;
        const sid = `${uid}_${Date.now().toString(36)}`;

        const statOptions = Object.entries(STAT_TYPES).map(([key, val]) => ({
            label: val.label,
            value: key,
            description: val.template.replace('{value}', '...'),
            emoji: val.emoji,
            default: ['members', 'humans', 'bots', 'channels', 'roles', 'online'].includes(key)
        }));

        const container = new ContainerBuilder();
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `# <:Settings:1521227767780343879> Server Stats Setup\n\n` +
            `Select which statistics to display as voice channels.\n` +
            `The bot will create a **<:Invoice:1521227903956811836> Server Stats** category with locked voice channels that auto-update.\n\n` +
            `-# Select stats below, then click **Create Channels** to finish.`
        ));

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`sstats:select:${sid}`)
            .setPlaceholder('Select statistics to display...')
            .setMinValues(1)
            .setMaxValues(Object.keys(STAT_TYPES).length)
            .addOptions(statOptions);

        container.addActionRowComponents(new ActionRowBuilder().addComponents(selectMenu));
        container.addActionRowComponents(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`sstats:create:${sid}`).setEmoji('<:Add:1521227828199293152>').setLabel('Create Channels').setStyle(ButtonStyle.Primary).setDisabled(false),
            new ButtonBuilder().setCustomId(`sstats:all:${sid}`).setEmoji('<:Checkedbox:1521227734943269077>').setLabel('Select All').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`sstats:cancel:${sid}`).setEmoji('<:Cancel:1521227723916181644>').setLabel('Cancel').setStyle(ButtonStyle.Danger)
        ));

        const reply = isSlash
            ? await ctx.reply({ components: [container], flags: MessageFlags.IsComponentsV2, withResponse: true }).then(r => r.resource?.message || ctx.fetchReply())
            : await ctx.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });

        // Track selections (defaults)
        let selectedStats = ['members', 'humans', 'bots', 'channels', 'roles', 'online'];

        const collector = reply.createMessageComponentCollector({ time: TIMEOUT });

        collector.on('collect', async (i) => {
            if (i.user.id !== uid) {
                return i.reply({ content: '<:Cancel:1521227723916181644> Only the command user can interact with this.', flags: MessageFlags.Ephemeral });
            }

            const action = i.customId.split(':')[1];

            if (action === 'select') {
                selectedStats = i.values;
                await i.deferUpdate();
                return;
            }

            if (action === 'all') {
                selectedStats = Object.keys(STAT_TYPES);
                // Update the select menu to show all selected
                const allOptions = Object.entries(STAT_TYPES).map(([key, val]) => ({
                    label: val.label,
                    value: key,
                    description: val.template.replace('{value}', '...'),
                    emoji: val.emoji,
                    default: true
                }));
                const updatedMenu = new StringSelectMenuBuilder()
                    .setCustomId(`sstats:select:${sid}`)
                    .setPlaceholder('All statistics selected!')
                    .setMinValues(1)
                    .setMaxValues(Object.keys(STAT_TYPES).length)
                    .addOptions(allOptions);

                const updatedContainer = new ContainerBuilder();
                updatedContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# <:Settings:1521227767780343879> Server Stats Setup\n\n` +
                    `**All ${Object.keys(STAT_TYPES).length} stats selected!** Click **Create Channels** to proceed.\n\n` +
                    `-# You can deselect stats from the dropdown if you want fewer channels.`
                ));
                updatedContainer.addActionRowComponents(new ActionRowBuilder().addComponents(updatedMenu));
                updatedContainer.addActionRowComponents(new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`sstats:create:${sid}`).setEmoji('<:Add:1521227828199293152>').setLabel('Create Channels').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId(`sstats:all:${sid}`).setEmoji('<:Checkedbox:1521227734943269077>').setLabel('Select All').setStyle(ButtonStyle.Secondary).setDisabled(true),
                    new ButtonBuilder().setCustomId(`sstats:cancel:${sid}`).setEmoji('<:Cancel:1521227723916181644>').setLabel('Cancel').setStyle(ButtonStyle.Danger)
                ));
                return i.update({ components: [updatedContainer], flags: MessageFlags.IsComponentsV2 });
            }

            if (action === 'cancel') {
                collector.stop('cancelled');
                return i.update({ components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent('-# Cancelled. No channels were created.'))], flags: MessageFlags.IsComponentsV2 });
            }

            if (action === 'create') {
                collector.stop('handled');

                // Show loading state
                await i.update({ components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Lightning:1521227915537285150> Creating Stats Channels\n\nSetting up **${selectedStats.length}** stat channels\u2026`))], flags: MessageFlags.IsComponentsV2 });

                try {
                    const result = await setupStatsChannels(guild, selectedStats);
                    const stats = result.stats;

                    // Build success message with preview
                    const previewLines = selectedStats.map(key => {
                        const val = stats[key] ?? 0;
                        return `> <:Volumedown:1521228131825090792> \`${formatChannelName(key, val)}\``;
                    }).join('\n');

                    const ok = new ContainerBuilder();
                    ok.addTextDisplayComponents(new TextDisplayBuilder().setContent(
                        `# <:Checkedbox:1521227734943269077> Server Stats Created\n\n` +
                        `Successfully created **${selectedStats.length}** stat channels in the **<:Invoice:1521227903956811836> Server Stats** category.\n`
                    ));
                    ok.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
                    ok.addTextDisplayComponents(new TextDisplayBuilder().setContent(
                        `### Channels Created\n${previewLines}\n\n` +
                        `-# Stats auto-update every 5 minutes when changes are detected.\n` +
                        `-# Use \`serverstats refresh\` to force an immediate update.`
                    ));

                    return reply.edit({ components: [ok], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
                } catch (err) {
                    console.error('ServerStats setup error:', err);
                    return reply.edit({ components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Cancel:1521227723916181644> Setup Failed\n\n${err.message}`))], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
                }
            }
        });

        collector.on('end', (_, reason) => {
            if (reason === 'handled' || reason === 'cancelled') return;
            reply.edit({ components: [buildExpiredPanel('serverstats setup', 'No channels were created.')], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        });
    },

    /* ─── Remove Flow ─── */
    async _handleRemove(ctx, user, guild, isSlash) {
        const config = getGuildConfig(guild.id);
        if (!config) {
            const c = new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent('# <:Cancel:1521227723916181644> Not Set Up\n\nServer stats are not configured. Use `serverstats setup` first.'));
            return isSlash ? ctx.reply({ components: [c], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral }) : ctx.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
        }

        const uid = user.id;
        const sid = `${uid}_${Date.now().toString(36)}`;

        const warn = new ContainerBuilder().setAccentColor(0xED4245);
        warn.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `# <:Infotriangle:1521227710381428926> Remove Server Stats\n\n` +
            `This will delete the **<:Invoice:1521227903956811836> Server Stats** category and all **${config.stats.length}** stat channels.\n\n` +
            `> This action cannot be undone.`
        ));
        warn.addActionRowComponents(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`sstats:rmconfirm:${sid}`).setEmoji('<:Trash:1521227750420254820>').setLabel('Remove All').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`sstats:rmcancel:${sid}`).setEmoji('<:Cancel:1521227723916181644>').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
        ));

        const reply = isSlash
            ? await ctx.reply({ components: [warn], flags: MessageFlags.IsComponentsV2, withResponse: true }).then(r => r.resource?.message || ctx.fetchReply())
            : await ctx.reply({ components: [warn], flags: MessageFlags.IsComponentsV2 });

        const collector = reply.createMessageComponentCollector({ time: 30_000 });

        collector.on('collect', async (i) => {
            if (i.user.id !== uid) return i.reply({ content: '<:Cancel:1521227723916181644> Only the command user can interact with this.', flags: MessageFlags.Ephemeral });
            collector.stop('handled');

            if (i.customId.includes('rmcancel')) {
                return i.update({ components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent('-# Cancelled. Stats channels remain active.'))], flags: MessageFlags.IsComponentsV2 });
            }

            const result = await removeStatsChannels(guild);
            if (result.success) {
                return i.update({ components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Checkedbox:1521227734943269077> Stats Removed\n\nDeleted **${result.deleted}** channels. Server stats are now disabled.`))], flags: MessageFlags.IsComponentsV2 });
            }
            return i.update({ components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Cancel:1521227723916181644> Error\n\n${result.error}`))], flags: MessageFlags.IsComponentsV2 });
        });

        collector.on('end', (_, reason) => {
            if (reason === 'handled') return;
            reply.edit({ components: [buildExpiredPanel('serverstats remove', 'Stats channels remain active.')], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        });
    },

    /* ─── Refresh ─── */
    async _handleRefresh(ctx, user, guild, isSlash) {
        const config = getGuildConfig(guild.id);
        if (!config || !config.enabled) {
            const c = new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent('# <:Cancel:1521227723916181644> Not Set Up\n\nServer stats are not configured. Use `serverstats setup` first.'));
            return isSlash ? ctx.reply({ components: [c], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral }) : ctx.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
        }

        if (isSlash) await ctx.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            await updateStatsChannels(guild, true);
            const stats = await computeStats(guild);
            const lines = config.stats.map(key => {
                const val = stats[key] ?? 0;
                return `> <:Volumedown:1521228131825090792> \`${formatChannelName(key, val)}\``;
            }).join('\n');

            const ok = new ContainerBuilder();
            ok.addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `# <:Checkedbox:1521227734943269077> Stats Refreshed\n\n${lines}\n\n-# All channels updated to current values.`
            ));

            return isSlash ? ctx.editReply({ components: [ok], flags: MessageFlags.IsComponentsV2 }) : ctx.reply({ components: [ok], flags: MessageFlags.IsComponentsV2 });
        } catch (err) {
            const errC = new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Cancel:1521227723916181644> Refresh Failed\n\n${err.message}`));
            return isSlash ? ctx.editReply({ components: [errC], flags: MessageFlags.IsComponentsV2 }) : ctx.reply({ components: [errC], flags: MessageFlags.IsComponentsV2 });
        }
    },

    /* ─── Status/Info ─── */
    async _handleStatus(ctx, user, guild, isSlash) {
        const config = getGuildConfig(guild.id);
        if (!config || !config.enabled) {
            const c = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent('# <:Settings:1521227767780343879> Server Stats\n\n**Status:** Not configured\n\n> Use `serverstats setup` to get started.'));
            return isSlash ? ctx.reply({ components: [c], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral }) : ctx.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
        }

        const stats = await computeStats(guild);
        const channelLines = config.stats.map(key => {
            const chId = config.channelMap?.[key];
            const ch = chId ? guild.channels.cache.get(chId) : null;
            const val = stats[key] ?? 0;
            const status = ch ? '<:Toggleon:1521227758011809964>' : '<:Toggleoff:1521227763816595559>';
            return `${status} **${STAT_TYPES[key]?.label || key}** — ${val.toLocaleString()} ${ch ? '' : '*(channel missing)*'}`;
        }).join('\n');

        const lastUpdate = config.lastUpdate ? `<t:${Math.floor(config.lastUpdate / 1000)}:R>` : 'Never';

        const c = new ContainerBuilder();
        c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `# <:Settings:1521227767780343879> Server Stats Status\n\n` +
            `**Status:** <:Checkedbox:1521227734943269077> Active\n` +
            `**Category:** <#${config.categoryId}>\n` +
            `**Tracking:** ${config.stats.length} stats\n` +
            `**Last Updated:** ${lastUpdate}\n`
        ));
        c.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
        c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `### Live Counters\n${channelLines}\n\n` +
            `-# Updates happen automatically every 5 minutes when server changes are detected.`
        ));

        return isSlash ? ctx.reply({ components: [c], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral }) : ctx.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }
};
