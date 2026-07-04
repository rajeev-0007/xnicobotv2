const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, TextDisplayBuilder, MessageFlags, ChannelType, SeparatorBuilder, SeparatorSpacingSize, EmbedBuilder } = require('discord.js');

const jsonStore = require('../../utils/jsonStore');
const DEFAULT_COLOR = 0xCAD7E6;
const ERROR_COLOR = 0xED4245;

async function resolveChannel(guild, input) {
    if (!input || !guild) return null;
    const cleaned = input.trim();
    if (!cleaned) return null;

    const idMatch = cleaned.match(/^<?#?(\d{17,20})>?$/);
    if (idMatch) {
        const cached = guild.channels.cache.get(idMatch[1]);
        if (cached) return cached;
        try { return await guild.channels.fetch(idMatch[1]).catch(() => null); } catch { return null; }
    }

    const nameLower = cleaned.replace(/^#/, '').toLowerCase();
    const byName = guild.channels.cache.find(
        c => c.name.toLowerCase() === nameLower && c.type === ChannelType.GuildText,
    );
    if (byName) return byName;

    return guild.channels.cache.find(c => c.name.toLowerCase() === nameLower) || null;
}

function loadConfig() {
    if (!jsonStore.has('sticky')) {
        jsonStore.write('sticky', {});
        return {};
    }
    try {
        return jsonStore.read('sticky');
    } catch {
        return {};
    }
}

function saveConfig(config) {
    try {
        jsonStore.write('sticky', config);
    } catch (error) {
        console.error('Error saving sticky config:', error);
    }
}

function ensureGuildConfig(config, guildId) {
    if (!config[guildId]) config[guildId] = { enabled: false, messages: {} };
    if (!config[guildId].messages) config[guildId].messages = {};
    return config[guildId];
}

function successContainer(text) {
    return new ContainerBuilder()
        .setAccentColor(DEFAULT_COLOR)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
}

function errorContainer(text) {
    return new ContainerBuilder()
        .setAccentColor(ERROR_COLOR)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
}

function buildStickyHelpText(guildConfig) {
    const status = guildConfig.enabled ? '<:Toggleon:1521227758011809964> d**' : '<:Toggleoff:1521227763816595559> **Disabled**';
    const count = Object.keys(guildConfig.messages || {}).length;

    return `## <:Pin:1521227932625014916> Sticky Message System\n\n` +
        `**Status:** ${status} • **Active:** ${count} message(s)\n\n` +
        `Keep important messages pinned at the bottom of your channels.\n\n` +
        `### Quick Setup\n` +
        `Create a sticky message in one step — channel, content, and type all at once.\n\n` +
        `### Advanced Setup\n` +
        `1. **Set Message** — Write the content\n` +
        `2. **Set Channel** — Choose target channel\n` +
        `3. **Pick Type** — Embed, Container, or Content\n\n` +
        `### Variables\n` +
        `\`{user}\` \`{username}\` \`{server}\` \`{membercount}\` \`{channelname}\``;
}

function buildPanelButtons(guildConfig) {
    const quickRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('sticky_quick_setup')
                .setLabel('Quick Setup')
                .setStyle(ButtonStyle.Success)
                .setEmoji('<:Checkedbox:1521227734943269077>'),
            new ButtonBuilder()
                .setCustomId('sticky_remove')
                .setLabel('Remove Sticky')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('<:Trash:1521227750420254820>')
        );

    const advancedRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('sticky_set_message')
                .setLabel('Set Message')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('<:Pin:1521227932625014916>'),
            new ButtonBuilder()
                .setCustomId('sticky_set_channel')
                .setLabel('Set Channel')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('<:Pin:1521227932625014916>')
        );

    const displayTypeButtons = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('sticky_type_embed')
                .setLabel('Embed')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('<:Bookopen:1521227911137595605>'),
            new ButtonBuilder()
                .setCustomId('sticky_type_container')
                .setLabel('Container')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('<:Box:1521228152414666833>'),
            new ButtonBuilder()
                .setCustomId('sticky_type_content')
                .setLabel('Content Only')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('<:Edit:1521227886634205298>')
        );

    const controlButtons = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('sticky_toggle')
                .setLabel(guildConfig.enabled ? 'Disable' : 'Enable')
                .setStyle(guildConfig.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
                .setEmoji(guildConfig.enabled ? '<:Toggleoff:1521227763816595559>' : '<:Toggleon:1521227758011809964>'),
            new ButtonBuilder()
                .setCustomId('sticky_list')
                .setLabel('List All')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('<:Bookopen:1521227911137595605>'),
            new ButtonBuilder()
                .setCustomId('sticky_clear')
                .setLabel('Clear All')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('<:Trash:1521227750420254820>')
        );

    return { quickRow, advancedRow, displayTypeButtons, controlButtons };
}

async function sendStickyToChannel(content, displayType, channel, user, guild) {
    const { replacePlaceholders } = require('../../utils/interactionHandlers');
    const processed = replacePlaceholders(content, user, guild, channel);

    if (displayType === 'embed') {
                const embed = new EmbedBuilder()
            .setDescription(processed)
            .setColor(DEFAULT_COLOR);
        return channel.send({ embeds: [embed] });
    } else if (displayType === 'container') {
        const container = new ContainerBuilder()
            .setAccentColor(DEFAULT_COLOR)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(processed));
        return channel.send({ components: [container], flags: MessageFlags.IsComponentsV2 });
    } else {
        return channel.send({ content: processed });
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('sticky-message')
        .setDescription('Keep important messages pinned at the bottom of channels')
        .addSubcommand(sub =>
            sub.setName('setup').setDescription('Open the sticky message setup panel'))
        .addSubcommand(sub =>
            sub.setName('set')
                .setDescription('Set a sticky message in a channel')
                .addChannelOption(opt =>
                    opt.setName('channel').setDescription('Channel for the sticky')
                        .addChannelTypes(ChannelType.GuildText).setRequired(true))
                .addStringOption(opt =>
                    opt.setName('message').setDescription('Message content').setRequired(true))
                .addStringOption(opt =>
                    opt.setName('type').setDescription('Display type').setRequired(false)
                        .addChoices(
                            { name: 'Embed', value: 'embed' },
                            { name: 'Container', value: 'container' },
                            { name: 'Content Only', value: 'content' })))
        .addSubcommand(sub =>
            sub.setName('remove')
                .setDescription('Remove a sticky message')
                .addChannelOption(opt =>
                    opt.setName('channel').setDescription('Channel to remove from')
                        .addChannelTypes(ChannelType.GuildText).setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('list').setDescription('View all sticky messages'))
        .addSubcommand(sub =>
            sub.setName('toggle').setDescription('Enable or disable the system'))
        .addSubcommand(sub =>
            sub.setName('clear').setDescription('Remove all sticky messages'))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    prefix: 'sticky-message',
    aliases: ['simple-sticky', 'stickymsg', 'sticky'],
    description: 'Keep important messages pinned at the bottom of channels',
    category: 'automation',
    usage: 'sticky-message [setup/set/remove/list/toggle/clear]',

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const config = loadConfig();
        const guildId = interaction.guild.id;
        const guildConfig = ensureGuildConfig(config, guildId);

        try {
            if (sub === 'setup') await this.showPanel(interaction, guildConfig);
            else if (sub === 'set') await this.handleSet(interaction, config, guildId, guildConfig);
            else if (sub === 'remove') await this.handleRemove(interaction, config, guildId, guildConfig);
            else if (sub === 'list') await this.handleList(interaction, guildConfig);
            else if (sub === 'toggle') await this.handleToggle(interaction, config, guildId, guildConfig);
            else if (sub === 'clear') await this.handleClear(interaction, config, guildId, guildConfig);
        } catch (error) {
            console.error('Sticky message error:', error);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ components: [errorContainer('### <:Cancel:1521227723916181644> Error\nSomething went wrong. Please try again.')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral }).catch(() => {});
            }
        }
    },

    async showPanel(interaction, guildConfig) {
        const { quickRow, advancedRow, displayTypeButtons, controlButtons } = buildPanelButtons(guildConfig);

        const container = new ContainerBuilder()
            .setAccentColor(DEFAULT_COLOR)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(buildStickyHelpText(guildConfig)))
            .addActionRowComponents(quickRow)
            .addActionRowComponents(advancedRow)
            .addActionRowComponents(displayTypeButtons)
            .addActionRowComponents(controlButtons);

        await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    },

    async handleSet(interaction, config, guildId, guildConfig) {
        const channel = interaction.options.getChannel('channel');
        const content = interaction.options.getString('message');
        const displayType = interaction.options.getString('type') || 'container';

        const botMember = interaction.guild.members.me;
        if (!channel.permissionsFor(botMember)?.has(['SendMessages', 'ViewChannel'])) {
            return interaction.reply({ components: [errorContainer(`### <:Cancel:1521227723916181644> No Access\nI don't have permission to send messages in <#${channel.id}>.`)], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        if (guildConfig.messages[channel.id]?.messageId) {
            try {
                const oldMsg = await channel.messages.fetch(guildConfig.messages[channel.id].messageId).catch(() => null);
                if (oldMsg) await oldMsg.delete().catch(() => {});
            } catch {}
        }

        guildConfig.messages[channel.id] = {
            content, displayType, messageId: null, channelId: channel.id
        };
        if (!guildConfig.enabled) guildConfig.enabled = true;

        try {
            const stickyMsg = await sendStickyToChannel(content, displayType, channel, interaction.user, interaction.guild);
            if (stickyMsg) guildConfig.messages[channel.id].messageId = stickyMsg.id;
        } catch (error) {
            console.error('Sticky send error:', error);
            delete guildConfig.messages[channel.id];
            saveConfig(config);
            return interaction.reply({ components: [errorContainer(`### <:Cancel:1521227723916181644> Failed\nCouldn't send sticky to <#${channel.id}>. Check my permissions.`)], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        saveConfig(config);

        await interaction.reply({
            components: [successContainer(
                `### <:Checkedbox:1521227734943269077> Sticky Message Created\n` +
                `**Channel:** <#${channel.id}>\n` +
                `**Type:** ${displayType.charAt(0).toUpperCase() + displayType.slice(1)}\n` +
                `**Content:** ${content.substring(0, 80)}${content.length > 80 ? '...' : ''}\n\n` +
                `-# Automatically re-appears when pushed up by new messages`
            )],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
        });
    },

    async handleRemove(interaction, config, guildId, guildConfig) {
        const channel = interaction.options.getChannel('channel');

        if (!guildConfig.messages[channel.id]) {
            return interaction.reply({ components: [errorContainer(`### <:Cancel:1521227723916181644> Not Found\nNo sticky message in <#${channel.id}>.`)], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        try {
            if (guildConfig.messages[channel.id].messageId) {
                const msg = await channel.messages.fetch(guildConfig.messages[channel.id].messageId).catch(() => null);
                if (msg) await msg.delete().catch(() => {});
            }
        } catch {}

        delete guildConfig.messages[channel.id];
        saveConfig(config);

        await interaction.reply({ components: [successContainer(`### <:Checkedbox:1521227734943269077> Removed\nSticky message removed from <#${channel.id}>.`)], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    },

    async handleList(interaction, guildConfig) {
        const messages = guildConfig.messages || {};
        const list = Object.entries(messages);

        if (list.length === 0) {
            return interaction.reply({ components: [successContainer('### <:Pin:1521227932625014916> No Sticky Messages\nUse `/sticky-message set` or the setup panel to create one.')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        let text = `## <:Pin:1521227932625014916> Active Sticky Messages\n\n`;
        text += `**Status:** ${guildConfig.enabled ? '<:Toggleon:1521227758011809964> Enabled' : '<:Toggleoff:1521227763816595559> Disabled'}\n\n`;

        for (const [channelId, data] of list) {
            const ch = interaction.guild.channels.cache.get(channelId);
            const name = ch ? `<#${channelId}>` : `Unknown (\`${channelId}\`)`;
            const typeIcon = data.displayType === 'embed' ? '<:Bookopen:1521227911137595605>' : data.displayType === 'container' ? '<:Box:1521228152414666833>' : '<:Edit:1521227886634205298>';
            const preview = data.content?.substring(0, 60) || 'No content';
            text += `${typeIcon} **${name}**\n-# ${preview}${data.content?.length > 60 ? '...' : ''}\n\n`;
        }
        text += `-# ${list.length} message(s) total`;

        await interaction.reply({ components: [successContainer(text)], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    },

    async handleToggle(interaction, config, guildId, guildConfig) {
        guildConfig.enabled = !guildConfig.enabled;
        saveConfig(config);

        const color = guildConfig.enabled ? DEFAULT_COLOR : ERROR_COLOR;
        const container = new ContainerBuilder()
            .setAccentColor(color)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `### ${guildConfig.enabled ? '<:Toggleon:1521227758011809964>' : '<:Toggleoff:1521227763816595559>'} Sticky Messages ${guildConfig.enabled ? 'Enabled' : 'Disabled'}\nThe system is now **${guildConfig.enabled ? 'active' : 'inactive'}**.`
            ));

        await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    },

    async handleClear(interaction, config, guildId, guildConfig) {
        const count = Object.keys(guildConfig.messages || {}).length;

        for (const [channelId, data] of Object.entries(guildConfig.messages || {})) {
            try {
                if (data.messageId) {
                    const ch = interaction.guild.channels.cache.get(channelId);
                    if (ch) { const msg = await ch.messages.fetch(data.messageId).catch(() => null); if (msg) await msg.delete().catch(() => {}); }
                }
            } catch {}
        }

        guildConfig.messages = {};
        saveConfig(config);

        await interaction.reply({ components: [successContainer(`### <:Trash:1521227750420254820> All Cleared\nRemoved **${count}** sticky message(s).`)], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    },

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
            return message.reply({ components: [errorContainer('### <:Cancel:1521227723916181644> Missing Permission\nYou need **Manage Messages** to use this.')], flags: MessageFlags.IsComponentsV2 });
        }

        const config = loadConfig();
        const guildId = message.guild.id;
        const guildConfig = ensureGuildConfig(config, guildId);
        const sub = args[0]?.toLowerCase();

        if (!sub || sub === 'setup' || sub === 'help') {
            const { quickRow, advancedRow, displayTypeButtons, controlButtons } = buildPanelButtons(guildConfig);
            const container = new ContainerBuilder()
                .setAccentColor(DEFAULT_COLOR)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(buildStickyHelpText(guildConfig)))
                .addActionRowComponents(quickRow)
                .addActionRowComponents(advancedRow)
                .addActionRowComponents(displayTypeButtons)
                .addActionRowComponents(controlButtons);
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (sub === 'toggle') {
            guildConfig.enabled = !guildConfig.enabled;
            saveConfig(config);
            return message.reply({ components: [successContainer(`### ${guildConfig.enabled ? '<:Toggleon:1521227758011809964>' : '<:Toggleoff:1521227763816595559>'} Sticky Messages ${guildConfig.enabled ? 'Enabled' : 'Disabled'}`)], flags: MessageFlags.IsComponentsV2 });
        }

        if (sub === 'list') {
            const list = Object.entries(guildConfig.messages || {});
            if (list.length === 0) return message.reply({ components: [successContainer('### <:Pin:1521227932625014916> No Sticky Messages')], flags: MessageFlags.IsComponentsV2 });
            let text = '## <:Pin:1521227932625014916> Sticky Messages\n\n';
            for (const [channelId, data] of list) {
                const ch = message.guild.channels.cache.get(channelId);
                text += `**${ch ? `<#${channelId}>` : 'Unknown'}** — ${(data.content || '').substring(0, 50)}...\n`;
            }
            return message.reply({ components: [successContainer(text)], flags: MessageFlags.IsComponentsV2 });
        }

        if (sub === 'clear') {
            const count = Object.keys(guildConfig.messages || {}).length;
            guildConfig.messages = {};
            saveConfig(config);
            return message.reply({ components: [successContainer(`### <:Trash:1521227750420254820> Cleared\n**${count}** sticky message(s) removed.`)], flags: MessageFlags.IsComponentsV2 });
        }

        if (sub === 'remove') {
            const channelInput = args[1];
            if (!channelInput) return message.reply({ components: [errorContainer('### <:Cancel:1521227723916181644> Usage\n`-sticky remove <#channel>`')], flags: MessageFlags.IsComponentsV2 });
            const channel = await resolveChannel(message.guild, channelInput);
            if (!channel) return message.reply({ components: [errorContainer('### <:Cancel:1521227723916181644> Channel Not Found')], flags: MessageFlags.IsComponentsV2 });
            if (!guildConfig.messages[channel.id]) return message.reply({ components: [errorContainer(`### <:Cancel:1521227723916181644> Not Found\nNo sticky in <#${channel.id}>.`)], flags: MessageFlags.IsComponentsV2 });

            try {
                if (guildConfig.messages[channel.id].messageId) {
                    const msg = await channel.messages.fetch(guildConfig.messages[channel.id].messageId).catch(() => null);
                    if (msg) await msg.delete().catch(() => {});
                }
            } catch {}

            delete guildConfig.messages[channel.id];
            saveConfig(config);
            return message.reply({ components: [successContainer(`### <:Checkedbox:1521227734943269077> Removed\nSticky removed from <#${channel.id}>.`)], flags: MessageFlags.IsComponentsV2 });
        }

        if (sub === 'set') {
            const channelInput = args[1];
            const content = args.slice(2).join(' ');
            if (!channelInput || !content) return message.reply({ components: [errorContainer('### <:Cancel:1521227723916181644> Usage\n`-sticky set <#channel> <message>`')], flags: MessageFlags.IsComponentsV2 });
            const channel = await resolveChannel(message.guild, channelInput);
            if (!channel) return message.reply({ components: [errorContainer('### <:Cancel:1521227723916181644> Channel Not Found')], flags: MessageFlags.IsComponentsV2 });

            if (guildConfig.messages[channel.id]?.messageId) {
                try { const old = await channel.messages.fetch(guildConfig.messages[channel.id].messageId).catch(() => null); if (old) await old.delete().catch(() => {}); } catch {}
            }

            guildConfig.messages[channel.id] = { content, displayType: 'container', messageId: null, channelId: channel.id };
            if (!guildConfig.enabled) guildConfig.enabled = true;

            try {
                const stickyMsg = await sendStickyToChannel(content, 'container', channel, message.author, message.guild);
                if (stickyMsg) guildConfig.messages[channel.id].messageId = stickyMsg.id;
            } catch (error) {
                console.error('Sticky send error:', error);
                delete guildConfig.messages[channel.id];
                saveConfig(config);
                return message.reply({ components: [errorContainer(`### <:Cancel:1521227723916181644> Failed\nCouldn't send to <#${channel.id}>.`)], flags: MessageFlags.IsComponentsV2 });
            }

            saveConfig(config);
            return message.reply({ components: [successContainer(`### <:Checkedbox:1521227734943269077> Sticky Set\nMessage created in <#${channel.id}>.`)], flags: MessageFlags.IsComponentsV2 });
        }

        return message.reply({ components: [errorContainer('### <:Cancel:1521227723916181644> Unknown Command\nTry: `setup`, `set`, `remove`, `list`, `toggle`, `clear`')], flags: MessageFlags.IsComponentsV2 });
    },

    async handleStickyMessage(message, config, guildId, channelId) {
        const guildConfig = config[guildId];
        if (!guildConfig || !guildConfig.enabled || !guildConfig.messages || !guildConfig.messages[channelId]) return;

        const sticky = guildConfig.messages[channelId];
        const channel = message.guild.channels.cache.get(channelId);
        if (!channel) { delete guildConfig.messages[channelId]; saveConfig(config); return; }

        try {
            const oldMessage = await channel.messages.fetch(sticky.messageId).catch(() => null);
            if (oldMessage) await oldMessage.delete().catch(() => {});
        } catch {}

        try {
            const { replacePlaceholders } = require('../../utils/interactionHandlers');
            const processed = replacePlaceholders(sticky.content, message.author, message.guild, channel);
            let stickyMessage;

            switch (sticky.displayType) {
                case 'embed': {
                                        const embed = new EmbedBuilder()
                        .setDescription(processed)
                        .setColor(parseInt(sticky.embedColor, 16) || DEFAULT_COLOR);
                    if (sticky.embedTitle) embed.setTitle(replacePlaceholders(sticky.embedTitle, message.author, message.guild, channel));
                    if (sticky.embedFooter) embed.setFooter({ text: replacePlaceholders(sticky.embedFooter, message.author, message.guild, channel) });
                    if (sticky.embedThumbnail) embed.setThumbnail(sticky.embedThumbnail);
                    if (sticky.embedImage) embed.setImage(sticky.embedImage);
                    stickyMessage = await channel.send({ embeds: [embed] });
                    break;
                }
                case 'container': {
                    const container = new ContainerBuilder()
                        .setAccentColor(DEFAULT_COLOR)
                        .addTextDisplayComponents(new TextDisplayBuilder().setContent(processed));
                    stickyMessage = await channel.send({ components: [container], flags: MessageFlags.IsComponentsV2 });
                    break;
                }
                case 'content':
                default: {
                    stickyMessage = await channel.send(processed);
                    break;
                }
            }

            if (stickyMessage) {
                guildConfig.messages[channelId].messageId = stickyMessage.id;
                saveConfig(config);
            }
        } catch (error) {
            console.error(`Sticky send error in ${channelId}:`, error);
        }
    }
};
