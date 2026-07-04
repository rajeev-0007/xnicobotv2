const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ChannelType,
    ContainerBuilder,
    TextDisplayBuilder,
    MessageFlags,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    ChannelSelectMenuBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize
} = require('discord.js');

const jsonStore = require('../../utils/jsonStore');
const { checkAndExpire } = require('../../utils/panelExpiration');

function loadConfig() {
    try {
        if (!jsonStore.has('botblock')) {
            jsonStore.write('botblock', {});
            return {};
        }
        return jsonStore.read('botblock');
    } catch (e) {
        return {};
    }
}

function saveConfig(config) {
    jsonStore.write('botblock', config);
}

function getGuildConfig(guildId) {
    const config = loadConfig();
    if (!config[guildId]) {
        config[guildId] = {
            channels: [],
            enabled: true
        };
        saveConfig(config);
    }
    return config[guildId];
}

// ── Panel Builders ──

function buildMainPanel(guildConfig, guild) {
    const container = new ContainerBuilder();

    const channelCount = guildConfig.channels?.length || 0;

    let header = `# <:Commentblock:1521227898101432331> Bot Block System\n`;
    header += `-# Auto-delete all bot messages in specific channels\n\n`;
    header += `### Current Status\n`;
    header += `> **System:** ${guildConfig.enabled ? '<:Toggleon:1521227758011809964> Enabled' : '<:Toggleoff:1521227763816595559> Disabled'}\n`;
    header += `> **Blocked Channels:** ${channelCount}\n`;
    header += `> **Scope:** All bots (including xNico)`;

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(header));
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent('### <:Document:1521227875016114266> Management Options'));

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('botblock_toggle')
            .setLabel(guildConfig.enabled ? 'Disable System' : 'Enable System')
            .setStyle(guildConfig.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
            .setEmoji(guildConfig.enabled ? '<:Toggleoff:1521227763816595559>' : '<:Toggleon:1521227758011809964>'),
        new ButtonBuilder()
            .setCustomId('botblock_view')
            .setLabel('View Channels')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('<:Document:1521227875016114266>'),
        new ButtonBuilder()
            .setCustomId('botblock_add')
            .setLabel('Add Channel')
            .setStyle(ButtonStyle.Success)
            .setEmoji('<:Add:1521227828199293152>')
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('botblock_clear')
            .setLabel('Clear All')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('<:Trash:1521227750420254820>'),
        new ButtonBuilder()
            .setCustomId('botblock_help')
            .setLabel('Help')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('<:Lightbulbalt:1521227880703463675>')
    );

    container.addActionRowComponents(row1);
    container.addActionRowComponents(row2);

    return container;
}

function buildChannelListPanel(guildConfig, guild, page = 0) {
    const container = new ContainerBuilder();

    const channels = guildConfig.channels || [];
    const itemsPerPage = 10;
    const totalPages = Math.max(1, Math.ceil(channels.length / itemsPerPage));
    const currentPage = Math.min(page, totalPages - 1);
    const startIdx = currentPage * itemsPerPage;
    const pageChannels = channels.slice(startIdx, startIdx + itemsPerPage);

    let content = `# <:Document:1521227875016114266> Blocked Channels\n`;
    content += `-# Page ${currentPage + 1}/${totalPages} • ${channels.length} channel(s)\n\n`;

    if (pageChannels.length === 0) {
        content += `> *No channels are currently blocked*\n`;
        content += `> Use **Add Channel** to block bot messages in a channel`;
    } else {
        pageChannels.forEach((chId, idx) => {
            const channel = guild.channels.cache.get(chId);
            const name = channel ? `<#${chId}>` : `Unknown (${chId})`;
            content += `\`${startIdx + idx + 1}.\` ${name}\n`;
        });
    }

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    if (pageChannels.length > 0) {
        const removeOptions = pageChannels.map(chId => {
            const channel = guild.channels.cache.get(chId);
            return {
                label: channel ? `#${channel.name}` : `Unknown Channel`,
                description: `Remove from blocked list`,
                value: chId
            };
        });

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('botblock_remove_channel')
            .setPlaceholder('Select a channel to unblock...')
            .addOptions(removeOptions);

        container.addActionRowComponents(new ActionRowBuilder().addComponents(selectMenu));
    }

    const navRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`botblock_page_${currentPage - 1}`)
            .setLabel('Previous')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(currentPage === 0),
        new ButtonBuilder()
            .setCustomId(`botblock_page_${currentPage + 1}`)
            .setLabel('Next')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(currentPage >= totalPages - 1),
        new ButtonBuilder()
            .setCustomId('botblock_back')
            .setLabel('Back')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('<:Caretleft:1521227977495543838>')
    );

    container.addActionRowComponents(navRow);

    return container;
}

function buildAddChannelPanel() {
    const container = new ContainerBuilder();

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `# <:Add:1521227828199293152> Add Channel\n-# Select a channel to block all bot messages in`
    ));

    const channelSelect = new ChannelSelectMenuBuilder()
        .setCustomId('botblock_select_channel')
        .setPlaceholder('Select a channel...')
        .setChannelTypes(ChannelType.GuildText)
        .setMaxValues(1);

    container.addActionRowComponents(new ActionRowBuilder().addComponents(channelSelect));

    const backRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('botblock_back')
            .setLabel('Back')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('<:Caretleft:1521227977495543838>')
    );

    container.addActionRowComponents(backRow);

    return container;
}

function buildHelpPanel() {
    const container = new ContainerBuilder();

    let content = `# <:Lightbulbalt:1521227880703463675> Bot Block Help\n\n`;
    content += `### What does this system do?\n`;
    content += `Automatically **deletes all bot messages** in specified channels — including xNico itself. Perfect for keeping channels human-only.\n\n`;
    content += `### Features\n`;
    content += `> <:Commentblock:1521227898101432331> **Block Channels** - Add channels where bot messages are deleted\n`;
    content += `> <:Document:1521227875016114266> **View & Remove** - Manage blocked channels with a select menu\n`;
    content += `> <:Settings:1521227767780343879> **Toggle System** - Enable or disable globally\n`;
    content += `> <:Trash:1521227750420254820> **Clear All** - Remove all blocked channels at once\n\n`;
    content += `### Available Commands\n`;
    content += `\`/botblock\` - Open this management panel\n`;
    content += `\`-botblock\` - Prefix command version\n`;
    content += `\`-blockbots\` \`-nobot\` \`-antibotmsg\` - Aliases\n\n`;
    content += `-# All bot messages are deleted including xNico's own responses`;

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

    const backRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('botblock_back')
            .setLabel('Back')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('<:Caretleft:1521227977495543838>')
    );

    container.addActionRowComponents(backRow);

    return container;
}

// ── Module Export ──

module.exports = {
    data: new SlashCommandBuilder()
        .setName('botblock')
        .setDescription('Manage channels where all bot messages are auto-deleted')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    prefix: 'botblock',
    aliases: ['blockbots', 'nobot', 'antibotmsg'],
    description: 'Manage channels where all bot messages are auto-deleted',
    usage: 'botblock',
    category: 'admin',

    async execute(interaction) {
        const guildConfig = getGuildConfig(interaction.guild.id);
        const panel = buildMainPanel(guildConfig, interaction.guild);
        await interaction.reply({ components: [panel], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    },

    async executePrefix(message) {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return message.reply('<:Cancel:1521227723916181644> You need **Manage Channels** permission.');
        }

        const guildConfig = getGuildConfig(message.guild.id);
        const panel = buildMainPanel(guildConfig, message.guild);
        await message.reply({ components: [panel], flags: MessageFlags.IsComponentsV2 });
    },

    // Export for handler
    loadConfig,
    getGuildConfig,

    async handleInteraction(interaction) {
        if (!interaction.isButton() && !interaction.isStringSelectMenu() && !interaction.isChannelSelectMenu()) {
            return false;
        }

        const customId = interaction.customId;
        if (!customId.startsWith('botblock_')) return false;

        // Check if config session has expired
        if (await checkAndExpire(interaction, 'config')) return true;

        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
            await interaction.reply({ content: '<:Cancel:1521227723916181644> You need **Manage Channels** permission.', flags: MessageFlags.Ephemeral });
            return true;
        }

        const config = loadConfig();
        const guildId = interaction.guild.id;
        if (!config[guildId]) config[guildId] = { channels: [], enabled: true };
        const guildConfig = config[guildId];

        // Toggle system
        if (customId === 'botblock_toggle') {
            guildConfig.enabled = !guildConfig.enabled;
            config[guildId] = guildConfig;
            saveConfig(config);

            const panel = buildMainPanel(guildConfig, interaction.guild);
            await interaction.update({ components: [panel], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
            return true;
        }

        // View channels
        if (customId === 'botblock_view') {
            const panel = buildChannelListPanel(guildConfig, interaction.guild);
            await interaction.update({ components: [panel], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
            return true;
        }

        // Page navigation
        if (customId.startsWith('botblock_page_')) {
            const page = parseInt(customId.split('_').pop());
            const panel = buildChannelListPanel(guildConfig, interaction.guild, page);
            await interaction.update({ components: [panel], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
            return true;
        }

        // Add channel (show select)
        if (customId === 'botblock_add') {
            const panel = buildAddChannelPanel();
            await interaction.update({ components: [panel], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
            return true;
        }

        // Channel selected from ChannelSelectMenu
        if (customId === 'botblock_select_channel') {
            const channelId = interaction.values[0];

            if (guildConfig.channels.includes(channelId)) {
                await interaction.reply({ content: `<:Cancel:1521227723916181644> <#${channelId}> is already blocked.`, flags: MessageFlags.Ephemeral });
                return true;
            }

            guildConfig.channels.push(channelId);
            config[guildId] = guildConfig;
            saveConfig(config);

            const panel = buildMainPanel(guildConfig, interaction.guild);
            await interaction.update({ components: [panel], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
            return true;
        }

        // Remove channel from StringSelectMenu
        if (customId === 'botblock_remove_channel') {
            const channelId = interaction.values[0];
            guildConfig.channels = guildConfig.channels.filter(id => id !== channelId);
            config[guildId] = guildConfig;
            saveConfig(config);

            const panel = buildChannelListPanel(guildConfig, interaction.guild);
            await interaction.update({ components: [panel], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
            return true;
        }

        // Clear all
        if (customId === 'botblock_clear') {
            if (!guildConfig.channels || guildConfig.channels.length === 0) {
                await interaction.reply({ content: '<:Cancel:1521227723916181644> No blocked channels to clear.', flags: MessageFlags.Ephemeral });
                return true;
            }

            const count = guildConfig.channels.length;
            guildConfig.channels = [];
            config[guildId] = guildConfig;
            saveConfig(config);

            const panel = buildMainPanel(guildConfig, interaction.guild);
            await interaction.update({ components: [panel], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
            return true;
        }

        // Help panel
        if (customId === 'botblock_help') {
            const panel = buildHelpPanel();
            await interaction.update({ components: [panel], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
            return true;
        }

        // Back to main panel
        if (customId === 'botblock_back') {
            const panel = buildMainPanel(guildConfig, interaction.guild);
            await interaction.update({ components: [panel], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
            return true;
        }

        return false;
    }
};
