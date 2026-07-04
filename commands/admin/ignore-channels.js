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
    RoleSelectMenuBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    SectionBuilder,
    ThumbnailBuilder
} = require('discord.js');
const path = require('path');

const jsonStore = require('../../utils/jsonStore');
const { checkAndExpire } = require('../../utils/panelExpiration');

function loadConfig() {
    try {
        if (!jsonStore.has('ignored-channels')) {
            jsonStore.write('ignored-channels', {});
            return {};
        }
        return jsonStore.read('ignored-channels');
    } catch (e) {
        return {};
    }
}

function saveConfig(config) {
    jsonStore.write('ignored-channels', config);
}

function getGuildConfig(guildId) {
    const config = loadConfig();
    if (!config[guildId]) {
        config[guildId] = {
            channels: [],
            categories: [],
            bypassRoles: [],
            enabled: true,
            allowAdmins: true,
            logChannel: null,
            notifyUser: true,
            customMessage: null
        };
        saveConfig(config);
    }
    return config[guildId];
}

function isChannelIgnored(guildId, channelId, categoryId = null) {
    const guildConfig = getGuildConfig(guildId);
    if (!guildConfig.enabled) return false;
    
    if (guildConfig.channels.includes(channelId)) return true;
    if (categoryId && guildConfig.categories.includes(categoryId)) return true;
    
    return false;
}

function canBypass(member, guildConfig) {
    if (!member) return false;
    
    if (guildConfig.allowAdmins && member.permissions.has(PermissionFlagsBits.Administrator)) {
        return true;
    }
    
    if (guildConfig.bypassRoles && guildConfig.bypassRoles.length > 0) {
        return member.roles.cache.some(role => guildConfig.bypassRoles.includes(role.id));
    }
    
    return false;
}

function buildMainPanel(guildConfig, guild) {
    const container = new ContainerBuilder();
    
    const channelCount = guildConfig.channels?.length || 0;
    const categoryCount = guildConfig.categories?.length || 0;
    const bypassCount = guildConfig.bypassRoles?.length || 0;
    
    let headerContent = `# <:Commentblock:1521227898101432331> Ignore Channels System\n`;
    headerContent += `-# Disable bot commands in specific channels or categories\n\n`;
    headerContent += `### Current Status\n`;
    headerContent += `> **System:** ${guildConfig.enabled ? '<:Toggleon:1521227758011809964> Enabled' : '<:Toggleoff:1521227763816595559> Disabled'}\n`;
    headerContent += `> **Ignored Channels:** ${channelCount}\n`;
    headerContent += `> **Ignored Categories:** ${categoryCount}\n`;
    headerContent += `> **Bypass Roles:** ${bypassCount}\n`;
    headerContent += `> **Allow Admins:** ${guildConfig.allowAdmins ? 'Yes' : 'No'}\n`;
    headerContent += `> **Notify Users:** ${guildConfig.notifyUser ? 'Yes' : 'No'}`;
    
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(headerContent));
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent('### <:Document:1521227875016114266> Management Options'));
    
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('ignorech_toggle_system')
            .setLabel(guildConfig.enabled ? 'Disable System' : 'Enable System')
            .setStyle(guildConfig.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
            .setEmoji(guildConfig.enabled ? '<:Toggleoff:1521227763816595559>' : '<:Toggleon:1521227758011809964>'),
        new ButtonBuilder()
            .setCustomId('ignorech_view_channels')
            .setLabel('View Channels')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('<:Document:1521227875016114266>'),
        new ButtonBuilder()
            .setCustomId('ignorech_view_categories')
            .setLabel('View Categories')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('<:Folderopen:1521227986966417642>')
    );
    
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('ignorech_add_channel')
            .setLabel('Add Channel')
            .setStyle(ButtonStyle.Success)
            .setEmoji('<:Add:1521227828199293152>'),
        new ButtonBuilder()
            .setCustomId('ignorech_add_category')
            .setLabel('Add Category')
            .setStyle(ButtonStyle.Success)
            .setEmoji('<:Folderopen:1521227986966417642>'),
        new ButtonBuilder()
            .setCustomId('ignorech_bypass_roles')
            .setLabel('Bypass Roles')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('<:Shield:1521227694677692467>')
    );
    
    const row3 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('ignorech_settings')
            .setLabel('Settings')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('<:Settings:1521227767780343879>'),
        new ButtonBuilder()
            .setCustomId('ignorech_clear_all')
            .setLabel('Clear All')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('<:Trash:1521227750420254820>'),
        new ButtonBuilder()
            .setCustomId('ignorech_help')
            .setLabel('Help')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('<:Lightbulbalt:1521227880703463675>')
    );
    
    container.addActionRowComponents(row1);
    container.addActionRowComponents(row2);
    container.addActionRowComponents(row3);
    
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
    
    let content = `# <:Document:1521227875016114266> Ignored Channels\n`;
    content += `-# Page ${currentPage + 1}/${totalPages} • ${channels.length} channel(s)\n\n`;
    
    if (pageChannels.length === 0) {
        content += `> *No channels are currently ignored*\n`;
        content += `> Use **Add Channel** to ignore a channel`;
    } else {
        pageChannels.forEach((chId, idx) => {
            const channel = guild.channels.cache.get(chId);
            const name = channel ? `#${channel.name}` : `Unknown (${chId})`;
            content += `\`${startIdx + idx + 1}.\` ${name}\n`;
        });
    }
    
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
    
    if (pageChannels.length > 0) {
        const removeOptions = pageChannels.map((chId, idx) => {
            const channel = guild.channels.cache.get(chId);
            return {
                label: channel ? `#${channel.name}` : `Unknown Channel`,
                description: `Remove from ignored list`,
                value: chId
            };
        });
        
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('ignorech_remove_channel')
            .setPlaceholder('Select a channel to remove...')
            .addOptions(removeOptions);
        
        container.addActionRowComponents(new ActionRowBuilder().addComponents(selectMenu));
    }
    
    const navRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`ignorech_channels_page_${currentPage - 1}`)
            .setEmoji('<:History:1521227863079256278>')
            .setLabel('Previous')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(currentPage === 0),
        new ButtonBuilder()
            .setCustomId(`ignorech_channels_page_${currentPage + 1}`)
            .setEmoji('<:Caretright:1521227704953864202>')
            .setLabel('Next')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(currentPage >= totalPages - 1),
        new ButtonBuilder()
            .setCustomId('ignorech_back')
            .setLabel('Back')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('<:Caretleft:1521227977495543838>')
    );
    
    container.addActionRowComponents(navRow);
    
    return container;
}

function buildCategoryListPanel(guildConfig, guild, page = 0) {
    const container = new ContainerBuilder();
    
    const categories = guildConfig.categories || [];
    const itemsPerPage = 10;
    const totalPages = Math.max(1, Math.ceil(categories.length / itemsPerPage));
    const currentPage = Math.min(page, totalPages - 1);
    const startIdx = currentPage * itemsPerPage;
    const pageCategories = categories.slice(startIdx, startIdx + itemsPerPage);
    
    let content = `# <:Folderopen:1521227986966417642> Ignored Categories\n`;
    content += `-# Page ${currentPage + 1}/${totalPages} • ${categories.length} category(ies)\n\n`;
    
    if (pageCategories.length === 0) {
        content += `> *No categories are currently ignored*\n`;
        content += `> Use **Add Category** to ignore a category`;
    } else {
        pageCategories.forEach((catId, idx) => {
            const category = guild.channels.cache.get(catId);
            const name = category ? `<:Folderopen:1521227986966417642> ${category.name}` : `Unknown (${catId})`;
            const channelCount = category ? category.children.cache.size : 0;
            content += `\`${startIdx + idx + 1}.\` ${name} (${channelCount} channels)\n`;
        });
    }
    
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
    
    if (pageCategories.length > 0) {
        const removeOptions = pageCategories.map((catId, idx) => {
            const category = guild.channels.cache.get(catId);
            return {
                label: category ? category.name : `Unknown Category`,
                description: `Remove from ignored list`,
                value: catId
            };
        });
        
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('ignorech_remove_category')
            .setPlaceholder('Select a category to remove...')
            .addOptions(removeOptions);
        
        container.addActionRowComponents(new ActionRowBuilder().addComponents(selectMenu));
    }
    
    const navRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`ignorech_categories_page_${currentPage - 1}`)
            .setEmoji('<:History:1521227863079256278>')
            .setLabel('Previous')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(currentPage === 0),
        new ButtonBuilder()
            .setCustomId(`ignorech_categories_page_${currentPage + 1}`)
            .setEmoji('<:Caretright:1521227704953864202>')
            .setLabel('Next')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(currentPage >= totalPages - 1),
        new ButtonBuilder()
            .setCustomId('ignorech_back')
            .setLabel('Back')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('<:Caretleft:1521227977495543838>')
    );
    
    container.addActionRowComponents(navRow);
    
    return container;
}

function buildBypassRolesPanel(guildConfig, guild) {
    const container = new ContainerBuilder();
    
    const roles = guildConfig.bypassRoles || [];
    
    let content = `# <:Shield:1521227694677692467> Bypass Roles\n`;
    content += `-# Users with these roles can use commands in ignored channels\n\n`;
    
    if (roles.length === 0) {
        content += `> *No bypass roles configured*\n`;
        content += `> ${guildConfig.allowAdmins ? '<:Checkedbox:1521227734943269077> Administrators can still use commands' : '<:Infotriangle:1521227710381428926> No one can bypass'}`;
    } else {
        roles.forEach((roleId, idx) => {
            const role = guild.roles.cache.get(roleId);
            const name = role ? `@${role.name}` : `Unknown (${roleId})`;
            content += `\`${idx + 1}.\` ${name}\n`;
        });
    }
    
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
    
    const roleSelect = new RoleSelectMenuBuilder()
        .setCustomId('ignorech_add_bypass_role')
        .setPlaceholder('Select a role to add as bypass...')
        .setMaxValues(1);
    
    container.addActionRowComponents(new ActionRowBuilder().addComponents(roleSelect));
    
    if (roles.length > 0) {
        const removeOptions = roles.map(roleId => {
            const role = guild.roles.cache.get(roleId);
            return {
                label: role ? `@${role.name}` : `Unknown Role`,
                description: `Remove from bypass list`,
                value: roleId
            };
        }).slice(0, 25);
        
        const removeSelect = new StringSelectMenuBuilder()
            .setCustomId('ignorech_remove_bypass_role')
            .setPlaceholder('Select a role to remove...')
            .addOptions(removeOptions);
        
        container.addActionRowComponents(new ActionRowBuilder().addComponents(removeSelect));
    }
    
    const backRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('ignorech_toggle_admins')
            .setLabel(guildConfig.allowAdmins ? 'Disable Admin Bypass' : 'Enable Admin Bypass')
            .setStyle(guildConfig.allowAdmins ? ButtonStyle.Danger : ButtonStyle.Success)
            .setEmoji('<:Crown:1521227739988889764>'),
        new ButtonBuilder()
            .setCustomId('ignorech_back')
            .setLabel('Back')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('<:Caretleft:1521227977495543838>')
    );
    
    container.addActionRowComponents(backRow);
    
    return container;
}

function buildSettingsPanel(guildConfig, guild) {
    const container = new ContainerBuilder();
    
    let content = `# <:Settings:1521227767780343879> Ignore System Settings\n\n`;
    content += `**Notify Users:** ${guildConfig.notifyUser ? '<:Toggleon:1521227758011809964> Enabled' : '<:Toggleoff:1521227763816595559> Disabled'}\n`;
    content += `-# When enabled, users will see a message when their command is blocked\n\n`;
    content += `**Allow Admins:** ${guildConfig.allowAdmins ? '<:Toggleon:1521227758011809964> Yes' : '<:Toggleoff:1521227763816595559> No'}\n`;
    content += `-# Administrators can bypass ignored channels\n\n`;
    content += `**Custom Message:** ${guildConfig.customMessage ? '<:Checkedbox:1521227734943269077> Set' : '<:Cancel:1521227723916181644> Default'}\n`;
    content += `-# Custom message shown when commands are blocked`;
    
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
    
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('ignorech_toggle_notify')
            .setLabel(guildConfig.notifyUser ? 'Disable Notifications' : 'Enable Notifications')
            .setStyle(guildConfig.notifyUser ? ButtonStyle.Danger : ButtonStyle.Success)
            .setEmoji('<:Notificationon:1521227730304106680>'),
        new ButtonBuilder()
            .setCustomId('ignorech_toggle_admins')
            .setLabel(guildConfig.allowAdmins ? 'Disable Admin Bypass' : 'Enable Admin Bypass')
            .setStyle(guildConfig.allowAdmins ? ButtonStyle.Danger : ButtonStyle.Success)
            .setEmoji('<:Crown:1521227739988889764>')
    );
    
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('ignorech_back')
            .setLabel('Back')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('<:Caretleft:1521227977495543838>')
    );
    
    container.addActionRowComponents(row1);
    container.addActionRowComponents(row2);
    
    return container;
}

function buildHelpPanel() {
    const container = new ContainerBuilder();
    
    let content = `# <:Lightbulbalt:1521227880703463675> Ignore Channels Help\n\n`;
    content += `### What does this system do?\n`;
    content += `This system allows you to disable **all bot commands** in specific channels or entire categories. Perfect for keeping certain channels clean or restricting bot usage.\n\n`;
    content += `### Features\n`;
    content += `> <:Commentblock:1521227898101432331> **Ignore Channels** - Block commands in specific channels\n`;
    content += `> <:Folderopen:1521227986966417642> **Ignore Categories** - Block commands in entire categories\n`;
    content += `> <:Shield:1521227694677692467> **Bypass Roles** - Allow specific roles to bypass\n`;
    content += `> <:Crown:1521227739988889764> **Admin Bypass** - Admins can always use commands\n`;
    content += `> <:Notificationon:1521227730304106680> **Notifications** - Notify users when blocked\n\n`;
    content += `### Available Commands\n`;
    content += `\`/ignore-channels\` - Open this management panel\n`;
    content += `\`-ignore-channels\` - Prefix command version\n`;
    content += `\`-ignorechannels\` - Alias`;
    
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
    
    const backRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('ignorech_back')
            .setLabel('Back')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('<:Caretleft:1521227977495543838>')
    );
    
    container.addActionRowComponents(backRow);
    
    return container;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ignore-channels')
        .setDescription('Manage channels where bot commands are disabled')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    
    prefix: 'ignore-channels',
    aliases: ['ignorechannels', 'blacklist-channels', 'disable-channels'],
    description: 'Manage channels where bot commands are disabled',
    usage: 'ignore-channels',
    category: 'admin',
    
    async execute(interaction) {
        const guildConfig = getGuildConfig(interaction.guild.id);
        const panel = buildMainPanel(guildConfig, interaction.guild);
        await interaction.reply({ components: [panel], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    },
    
    async executePrefix(message) {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return message.reply('<:Cancel:1521227723916181644> You need **Manage Server** permission.');
        }
        
        const guildConfig = getGuildConfig(message.guild.id);
        const panel = buildMainPanel(guildConfig, message.guild);
        await message.reply({ components: [panel], flags: MessageFlags.IsComponentsV2 });
    },
    
    // Export utility functions for use in command handler
    isChannelIgnored,
    canBypass,
    getGuildConfig,
    loadConfig,
    saveConfig,
    
    async handleInteraction(interaction) {
        if (!interaction.isButton() && !interaction.isStringSelectMenu() && !interaction.isChannelSelectMenu() && !interaction.isRoleSelectMenu()) {
            return false;
        }
        
        const customId = interaction.customId;
        if (!customId.startsWith('ignorech_')) return false;
        
        // Check if config session has expired
        if (await checkAndExpire(interaction, 'config')) return true;
        
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            await interaction.reply({ content: '<:Cancel:1521227723916181644> You need **Manage Server** permission.', flags: MessageFlags.Ephemeral });
            return true;
        }
        
        const config = loadConfig();
        const guildId = interaction.guild.id;
        if (!config[guildId]) config[guildId] = getGuildConfig(guildId);
        const guildConfig = config[guildId];
        
        // Toggle system
        if (customId === 'ignorech_toggle_system') {
            guildConfig.enabled = !guildConfig.enabled;
            config[guildId] = guildConfig;
            saveConfig(config);
            
            const panel = buildMainPanel(guildConfig, interaction.guild);
            await interaction.update({ components: [panel], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
            return true;
        }
        
        // View channels
        if (customId === 'ignorech_view_channels') {
            const panel = buildChannelListPanel(guildConfig, interaction.guild, 0);
            await interaction.update({ components: [panel], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
            return true;
        }
        
        // View categories
        if (customId === 'ignorech_view_categories') {
            const panel = buildCategoryListPanel(guildConfig, interaction.guild, 0);
            await interaction.update({ components: [panel], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
            return true;
        }
        
        // Channel pagination
        if (customId.startsWith('ignorech_channels_page_')) {
            const page = parseInt(customId.replace('ignorech_channels_page_', ''));
            const panel = buildChannelListPanel(guildConfig, interaction.guild, page);
            await interaction.update({ components: [panel], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
            return true;
        }
        
        // Category pagination
        if (customId.startsWith('ignorech_categories_page_')) {
            const page = parseInt(customId.replace('ignorech_categories_page_', ''));
            const panel = buildCategoryListPanel(guildConfig, interaction.guild, page);
            await interaction.update({ components: [panel], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
            return true;
        }
        
        // Add channel - show channel select
        if (customId === 'ignorech_add_channel') {
            const channelSelect = new ChannelSelectMenuBuilder()
                .setCustomId('ignorech_select_channel')
                .setPlaceholder('Select a channel to ignore...')
                .setChannelTypes(ChannelType.GuildText, ChannelType.GuildVoice, ChannelType.GuildAnnouncement, ChannelType.GuildForum)
                .setMaxValues(5);
            
            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent('# <:Add:1521227828199293152> Add Ignored Channel\n\nSelect up to 5 channels to ignore:'))
                .addActionRowComponents(new ActionRowBuilder().addComponents(channelSelect))
                .addActionRowComponents(new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('ignorech_back')
                        .setLabel('Cancel')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('<:Caretleft:1521227977495543838>')
                ));
            
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
            return true;
        }
        
        // Add category - show category select
        if (customId === 'ignorech_add_category') {
            const categories = interaction.guild.channels.cache
                .filter(ch => ch.type === ChannelType.GuildCategory)
                .first(25);
            
            if (categories.length === 0) {
                await interaction.reply({ content: '<:Cancel:1521227723916181644> No categories found in this server.', flags: MessageFlags.Ephemeral });
                return true;
            }
            
            const categoryOptions = categories.map(cat => ({
                label: cat.name.substring(0, 100),
                description: `${cat.children.cache.size} channels`,
                value: cat.id
            }));
            
            const categorySelect = new StringSelectMenuBuilder()
                .setCustomId('ignorech_select_category')
                .setPlaceholder('Select a category to ignore...')
                .addOptions(categoryOptions)
                .setMaxValues(Math.min(5, categoryOptions.length));
            
            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent('# <:Folderopen:1521227986966417642> Add Ignored Category\n\nSelect categories to ignore (all channels inside will be affected):'))
                .addActionRowComponents(new ActionRowBuilder().addComponents(categorySelect))
                .addActionRowComponents(new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('ignorech_back')
                        .setLabel('Cancel')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('<:Caretleft:1521227977495543838>')
                ));
            
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
            return true;
        }
        
        // Handle channel selection
        if (customId === 'ignorech_select_channel' && interaction.isChannelSelectMenu()) {
            const selectedChannels = interaction.values;
            let added = 0;
            
            for (const channelId of selectedChannels) {
                if (!guildConfig.channels.includes(channelId)) {
                    guildConfig.channels.push(channelId);
                    added++;
                }
            }
            
            config[guildId] = guildConfig;
            saveConfig(config);
            
            await interaction.reply({ 
                content: `<:Checkedbox:1521227734943269077> Added **${added}** channel(s) to ignore list.`, 
                flags: MessageFlags.Ephemeral 
            });
            
            const panel = buildMainPanel(guildConfig, interaction.guild);
            await interaction.message.edit({ components: [panel], flags: MessageFlags.IsComponentsV2 });
            return true;
        }
        
        // Handle category selection
        if (customId === 'ignorech_select_category' && interaction.isStringSelectMenu()) {
            const selectedCategories = interaction.values;
            let added = 0;
            
            for (const catId of selectedCategories) {
                if (!guildConfig.categories.includes(catId)) {
                    guildConfig.categories.push(catId);
                    added++;
                }
            }
            
            config[guildId] = guildConfig;
            saveConfig(config);
            
            await interaction.reply({ 
                content: `<:Checkedbox:1521227734943269077> Added **${added}** category(ies) to ignore list.`, 
                flags: MessageFlags.Ephemeral 
            });
            
            const panel = buildMainPanel(guildConfig, interaction.guild);
            await interaction.message.edit({ components: [panel], flags: MessageFlags.IsComponentsV2 });
            return true;
        }
        
        // Remove channel
        if (customId === 'ignorech_remove_channel' && interaction.isStringSelectMenu()) {
            const channelId = interaction.values[0];
            guildConfig.channels = guildConfig.channels.filter(id => id !== channelId);
            config[guildId] = guildConfig;
            saveConfig(config);
            
            const panel = buildChannelListPanel(guildConfig, interaction.guild, 0);
            await interaction.update({ components: [panel], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
            return true;
        }
        
        // Remove category
        if (customId === 'ignorech_remove_category' && interaction.isStringSelectMenu()) {
            const catId = interaction.values[0];
            guildConfig.categories = guildConfig.categories.filter(id => id !== catId);
            config[guildId] = guildConfig;
            saveConfig(config);
            
            const panel = buildCategoryListPanel(guildConfig, interaction.guild, 0);
            await interaction.update({ components: [panel], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
            return true;
        }
        
        // Bypass roles panel
        if (customId === 'ignorech_bypass_roles') {
            const panel = buildBypassRolesPanel(guildConfig, interaction.guild);
            await interaction.update({ components: [panel], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
            return true;
        }
        
        // Add bypass role
        if (customId === 'ignorech_add_bypass_role' && interaction.isRoleSelectMenu()) {
            const roleId = interaction.values[0];
            
            if (!guildConfig.bypassRoles) guildConfig.bypassRoles = [];
            if (!guildConfig.bypassRoles.includes(roleId)) {
                guildConfig.bypassRoles.push(roleId);
                config[guildId] = guildConfig;
                saveConfig(config);
            }
            
            const panel = buildBypassRolesPanel(guildConfig, interaction.guild);
            await interaction.update({ components: [panel], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
            return true;
        }
        
        // Remove bypass role
        if (customId === 'ignorech_remove_bypass_role' && interaction.isStringSelectMenu()) {
            const roleId = interaction.values[0];
            guildConfig.bypassRoles = (guildConfig.bypassRoles || []).filter(id => id !== roleId);
            config[guildId] = guildConfig;
            saveConfig(config);
            
            const panel = buildBypassRolesPanel(guildConfig, interaction.guild);
            await interaction.update({ components: [panel], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
            return true;
        }
        
        // Toggle admin bypass
        if (customId === 'ignorech_toggle_admins') {
            guildConfig.allowAdmins = !guildConfig.allowAdmins;
            config[guildId] = guildConfig;
            saveConfig(config);
            
            const panel = buildSettingsPanel(guildConfig, interaction.guild);
            await interaction.update({ components: [panel], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
            return true;
        }
        
        // Toggle notifications
        if (customId === 'ignorech_toggle_notify') {
            guildConfig.notifyUser = !guildConfig.notifyUser;
            config[guildId] = guildConfig;
            saveConfig(config);
            
            const panel = buildSettingsPanel(guildConfig, interaction.guild);
            await interaction.update({ components: [panel], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
            return true;
        }
        
        // Settings panel
        if (customId === 'ignorech_settings') {
            const panel = buildSettingsPanel(guildConfig, interaction.guild);
            await interaction.update({ components: [panel], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
            return true;
        }
        
        // Clear all
        if (customId === 'ignorech_clear_all') {
            guildConfig.channels = [];
            guildConfig.categories = [];
            config[guildId] = guildConfig;
            saveConfig(config);
            
            await interaction.reply({ content: '<:Checkedbox:1521227734943269077> Cleared all ignored channels and categories.', flags: MessageFlags.Ephemeral });
            
            const panel = buildMainPanel(guildConfig, interaction.guild);
            await interaction.message.edit({ components: [panel], flags: MessageFlags.IsComponentsV2 });
            return true;
        }
        
        // Help panel
        if (customId === 'ignorech_help') {
            const panel = buildHelpPanel();
            await interaction.update({ components: [panel], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
            return true;
        }
        
        // Back to main
        if (customId === 'ignorech_back') {
            const panel = buildMainPanel(guildConfig, interaction.guild);
            await interaction.update({ components: [panel], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
            return true;
        }
        
        return false;
    }
};
