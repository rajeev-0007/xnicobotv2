const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    MessageFlags,
    ChannelType,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder
} = require('discord.js');
const path = require('path');
const jsonStore = require('../../utils/jsonStore');

const DEFAULT_COLOR = 0xCAD7E6;
const ERROR_COLOR = 0xED4245;
const SUCCESS_COLOR = 0x57F287;

// ─── Template Definitions ───
const TEMPLATES = {
    colors: {
        label: 'Colors',
        emoji: '🎨',
        description: 'Let members pick their favorite color role',
        panelTitle: '🎨 Pick Your Color',
        panelDescription: 'Select a color below to get a colored name in chat!',
        accentColor: 0xCAD7E6,
        roles: [
            { name: '🔴 Red',       color: '#E74C3C', emoji: '🔴' },
            { name: '🟠 Orange',    color: '#E67E22', emoji: '🟠' },
            { name: '🟡 Yellow',    color: '#F1C40F', emoji: '🟡' },
            { name: '🟢 Green',     color: '#2ECC71', emoji: '🟢' },
            { name: '🔵 Blue',      color: '#3498DB', emoji: '🔵' },
            { name: '🟣 Purple',    color: '#9B59B6', emoji: '🟣' },
            { name: '💗 Pink',      color: '#E91E63', emoji: '💗' },
            { name: '⚪ White',     color: '#FFFFFF', emoji: '⚪' },
            { name: '⚫ Black',     color: '#23272A', emoji: '⚫' },
            { name: '🩵 Teal',      color: '#1ABC9C', emoji: '🩵' }
        ]
    },
    gender: {
        label: 'Gender',
        emoji: '⚧',
        description: 'Let members select their gender identity',
        panelTitle: '⚧️ Select Your Gender',
        panelDescription: 'Choose the role that represents you best!',
        accentColor: 0xE091D0,
        roles: [
            { name: '♂️ Male',          color: '#5D9CEC', emoji: '♂' },
            { name: '♀️ Female',        color: '#EC87C0', emoji: '♀' },
            { name: '⚧️ Non-Binary',    color: '#F5D76E', emoji: '⚧' },
            { name: '🏳️ Prefer Not to Say', color: '#95A5A6', emoji: '🏳' }
        ]
    },
    age: {
        label: 'Age',
        emoji: '🎂',
        description: 'Let members select their age range',
        panelTitle: '🎂 Select Your Age',
        panelDescription: 'Pick your age range below!',
        accentColor: 0x85C1E9,
        roles: [
            { name: '🧒 Under 13',  color: '#73C6B6', emoji: '🧒' },
            { name: '🧑 13-15',     color: '#85C1E9', emoji: '🧑' },
            { name: '🧑 16-17',     color: '#A29BFE', emoji: '🎓' },
            { name: '🧑 18-20',     color: '#FDCB6E', emoji: '<:Fire:1521227907647668374>' },
            { name: '🧑 21-25',     color: '#E17055', emoji: '☕' },
            { name: '🧑 26+',       color: '#D63031', emoji: '🎩' }
        ]
    }
};

const activeSessions = new Map();
const TIMEOUT_MS = 5 * 60 * 1000;

// ─── Helpers ───
function loadConfig() {
    if (!jsonStore.has('reactionroles')) {
        jsonStore.write('reactionroles', {});
        return {};
    }
    try { return jsonStore.read('reactionroles'); } catch { return {}; }
}

function saveConfig(config) {
    jsonStore.write('reactionroles', config);
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

function getSessionKey(userId, guildId) {
    return `rt_${userId}_${guildId}`;
}

// ─── Build main template selection panel ───
function buildTemplatePanel(session) {
    const check = '<:Checkedbox:1521227734943269077>';
    const uncheck = '<:Uncheckbox:1473038543768109076>';

    const selectedCount = session.selected.length;
    const statusText = selectedCount === 0
        ? '<:Folderblock:1521228044683968745> **No templates selected** — Pick templates below'
        : `<:Cloudcheck:1521228125437165678> **${selectedCount} template${selectedCount !== 1 ? 's' : ''} selected** — Ready to deploy`;

    let templatesText = '### <:Document:1521227875016114266> Available Templates\n';
    for (const [key, tmpl] of Object.entries(TEMPLATES)) {
        const isSelected = session.selected.includes(key);
        templatesText += `${isSelected ? check : uncheck} ${tmpl.emoji} **${tmpl.label}** — ${tmpl.description}\n`;
        templatesText += `-# ╰ ${tmpl.roles.length} roles: ${tmpl.roles.map(r => r.emoji).join(' ')}\n`;
    }

    const channelText = session.channelId ? `<#${session.channelId}>` : '*Current channel*';
    const configSection = `### <:Settings:1521227767780343879> Configuration\n**Target Channel:** ${channelText}\n-# Panels will be sent to this channel`;

    const selectOptions = Object.entries(TEMPLATES).map(([key, tmpl]) => ({
        label: tmpl.label,
        description: `${session.selected.includes(key) ? '✓ Selected' : '✗ Not selected'} • ${tmpl.roles.length} roles`,
        value: key,
        emoji: { name: tmpl.emoji.replace(/\uFE0F/g, '') },
        default: session.selected.includes(key)
    }));

    const selectMenu = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('roletemplate_toggle')
            .setPlaceholder('Select templates to deploy...')
            .setMinValues(0)
            .setMaxValues(Object.keys(TEMPLATES).length)
            .addOptions(selectOptions)
    );

    const controlButtons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('roletemplate_select_all')
            .setLabel('Select All')
            .setStyle(ButtonStyle.Success)
            .setEmoji('<:Toggleon:1521227758011809964>')
            .setDisabled(selectedCount === Object.keys(TEMPLATES).length),
        new ButtonBuilder()
            .setCustomId('roletemplate_deselect_all')
            .setLabel('Deselect All')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('<:Toggleoff:1521227763816595559>')
            .setDisabled(selectedCount === 0),
        new ButtonBuilder()
            .setCustomId('roletemplate_cancel')
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('<:Cancel:1521227723916181644>')
    );

    const applyRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('roletemplate_deploy')
            .setLabel(`Deploy Templates (${selectedCount})`)
            .setStyle(ButtonStyle.Success)
            .setEmoji('🚀')
            .setDisabled(selectedCount === 0)
    );

    const accentColor = selectedCount > 0 ? 0x57F287 : DEFAULT_COLOR;

    const container = new ContainerBuilder()
        .setAccentColor(accentColor)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            '## <:Userplus:1521227719621218477> Role Template Setup\n-# Quickly deploy pre-made role panels with auto-created roles'
        ))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(statusText))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(templatesText))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(configSection))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addActionRowComponents(selectMenu)
        .addActionRowComponents(controlButtons)
        .addActionRowComponents(applyRow)
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent('-# <:Infotriangle:1521227710381428926> Roles will be auto-created below the bot\'s highest role'));

    return container;
}

// ─── Build a role select panel for a deployed template ───
function buildRolePanel(template, roleMap) {
    const tmpl = TEMPLATES[template];
    const roleList = tmpl.roles.map(r => {
        const roleId = roleMap[r.name];
        return `${r.emoji} <@&${roleId}>`;
    }).join('\n');

    const panelContainer = new ContainerBuilder()
        .setAccentColor(tmpl.accentColor);

    panelContainer.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`## ${tmpl.panelTitle}\n${tmpl.panelDescription}`)
    );

    const selectOptions = tmpl.roles.map(r => ({
        label: r.name.replace(/^[^\w]*\s*/, '').trim() || r.name,
        value: roleMap[r.name],
        emoji: { name: r.emoji.replace(/\uFE0F/g, '') },
        description: `Get the ${r.name} role`
    }));

    const selectMenu = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`rt_select_${template}`)
            .setPlaceholder(`Choose your ${tmpl.label.toLowerCase()}...`)
            .setMinValues(0)
            .setMaxValues(1)
            .addOptions(selectOptions)
    );

    panelContainer.addActionRowComponents(selectMenu);

    panelContainer.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    panelContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Select an option to get the role • Select again to remove it`));

    return panelContainer;
}

// ─── Build result panel after deployment ───
function buildResultPanel(results) {
    const check = '<:Checkedbox:1521227734943269077>';
    const cross = '<:Cancel:1521227723916181644>';

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    let statusText = successCount === results.length
        ? `<:Cloudcheck:1521228125437165678> **All ${successCount} templates deployed successfully!**`
        : `<:Infotriangle:1521227710381428926> **${successCount} deployed, ${failCount} failed**`;

    let detailsText = '### <:Document:1521227875016114266> Deployment Results\n';
    for (const result of results) {
        const tmpl = TEMPLATES[result.template];
        if (result.success) {
            detailsText += `${check} ${tmpl.emoji} **${tmpl.label}** — ${result.rolesCreated} roles created → <#${result.channelId}>\n`;
        } else {
            detailsText += `${cross} ${tmpl.emoji} **${tmpl.label}** — ${result.error}\n`;
        }
    }

    const tipsText = '### <:Lightbulbalt:1521227880703463675> What\'s Next?\n' +
        '<:Caretright:1521227704953864202> Members can now use the drop-down menus to self-assign roles\n' +
        '<:Caretright:1521227704953864202> To remove template panels, delete the message in the channel\n' +
        '<:Caretright:1521227704953864202> Use `/reactionroles setup` to create fully custom panels\n' +
        '<:Caretright:1521227704953864202> Role colors appear on members when it\'s their highest colored role';

    const container = new ContainerBuilder()
        .setAccentColor(failCount === 0 ? SUCCESS_COLOR : ERROR_COLOR)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent('## <:Checkedbox:1521227734943269077> Template Deployment Complete'))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(statusText))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(detailsText))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(tipsText))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

    return container;
}

// ─── Deploy a single template: create roles + send panel ───
async function deployTemplate(guild, channelId, templateKey) {
    const tmpl = TEMPLATES[templateKey];
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel) return { success: false, template: templateKey, error: 'Channel not found' };

    const botMember = guild.members.me;
    if (!botMember.permissions.has('ManageRoles')) {
        return { success: false, template: templateKey, error: 'Bot missing **Manage Roles** permission' };
    }

    const botPerms = channel.permissionsFor(botMember);
    if (!botPerms?.has(['SendMessages', 'ViewChannel'])) {
        return { success: false, template: templateKey, error: `Bot missing permissions in <#${channelId}>` };
    }

    const roleMap = {};
    let rolesCreated = 0;

    // Find existing roles that match template names (to avoid duplicates)
    const existingRoles = guild.roles.cache;

    for (const roleDef of tmpl.roles) {
        const existing = existingRoles.find(r => r.name === roleDef.name);
        if (existing) {
            roleMap[roleDef.name] = existing.id;
            continue;
        }

        try {
            const created = await guild.roles.create({
                name: roleDef.name,
                color: roleDef.color,
                mentionable: false,
                reason: `Role Template: ${tmpl.label} — auto-created by roletemplate command`
            });
            roleMap[roleDef.name] = created.id;
            rolesCreated++;
        } catch (err) {
            return { success: false, template: templateKey, error: `Failed to create role "${roleDef.name}": ${err.message}` };
        }
    }

    // Send the select menu panel
    try {
        const panelContainer = buildRolePanel(templateKey, roleMap);
        const sentMsg = await channel.send({
            components: [panelContainer],
            flags: MessageFlags.IsComponentsV2
        });

        // Save to reactionroles config for persistence
        const config = loadConfig();
        if (!config[guild.id]) config[guild.id] = {};
        config[guild.id][sentMsg.id] = {
            title: tmpl.panelTitle,
            description: tmpl.panelDescription,
            channelId: channel.id,
            messageId: sentMsg.id,
            color: tmpl.accentColor,
            image: null,
            template: templateKey,
            roles: tmpl.roles.map(r => ({
                roleId: roleMap[r.name],
                emoji: r.emoji,
                name: r.name
            })),
            mode: 'select',
            createdBy: 'roletemplate',
            createdAt: Date.now()
        };
        saveConfig(config);

        return {
            success: true,
            template: templateKey,
            rolesCreated,
            channelId: channel.id,
            messageId: sentMsg.id
        };
    } catch (err) {
        return { success: false, template: templateKey, error: `Failed to send panel: ${err.message}` };
    }
}

// ─── Module Export ───
module.exports = {
    TEMPLATES,
    data: new SlashCommandBuilder()
        .setName('roletemplate')
        .setDescription('Deploy pre-made role panels (Colors, Gender, Age) with auto-created roles')
        .addChannelOption(opt =>
            opt.setName('channel')
                .setDescription('Channel to send panels to (defaults to current)')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

    prefix: 'roletemplate',
    aliases: ['rt', 'roletemplates', 'rolepreset'],
    description: 'Deploy pre-made role panels (Colors, Gender, Age) with auto-created roles',
    category: 'automation',
    usage: 'roletemplate [#channel]',

    activeSessions,

    async execute(interaction) {
        const channel = interaction.options.getChannel('channel');
        const channelId = channel?.id || interaction.channel.id;
        const key = getSessionKey(interaction.user.id, interaction.guild.id);

        // Clean old session
        if (activeSessions.has(key)) activeSessions.delete(key);

        const session = {
            guildId: interaction.guild.id,
            channelId,
            selected: [],
            userId: interaction.user.id,
            createdAt: Date.now()
        };

        activeSessions.set(key, session);
        setTimeout(() => {
            if (activeSessions.has(key) && activeSessions.get(key).createdAt === session.createdAt) {
                activeSessions.delete(key);
            }
        }, TIMEOUT_MS);

        const panel = buildTemplatePanel(session);
        await interaction.reply({ components: [panel], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    },

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
            return message.reply({ components: [errorContainer('### <:Cancel:1521227723916181644> Missing Permission\nYou need **Manage Roles** to use this.')], flags: MessageFlags.IsComponentsV2 });
        }

        let channelId = message.channel.id;
        if (args[0]) {
            const id = args[0].replace(/[<#>]/g, '');
            const ch = message.guild.channels.cache.get(id);
            if (ch && ch.type === ChannelType.GuildText) channelId = ch.id;
        }

        const key = getSessionKey(message.author.id, message.guild.id);
        if (activeSessions.has(key)) activeSessions.delete(key);

        const session = {
            guildId: message.guild.id,
            channelId,
            selected: [],
            userId: message.author.id,
            createdAt: Date.now()
        };

        activeSessions.set(key, session);
        setTimeout(() => {
            if (activeSessions.has(key) && activeSessions.get(key).createdAt === session.createdAt) {
                activeSessions.delete(key);
            }
        }, TIMEOUT_MS);

        const panel = buildTemplatePanel(session);
        await message.reply({ components: [panel], flags: MessageFlags.IsComponentsV2 });
    },

    async handleInteraction(interaction) {
        const customId = interaction.customId;
        if (!customId.startsWith('roletemplate_') && !customId.startsWith('rt_select_')) return false;

        const key = getSessionKey(interaction.user.id, interaction.guild?.id);

        // ─── Role select menu (members using the deployed panel) ───
        if (customId.startsWith('rt_select_')) {
            return this.handleRoleSelect(interaction);
        }

        // ─── Setup interactions (admin configuring) ───
        const session = activeSessions.get(key);
        if (!session) {
            await interaction.reply({
                components: [errorContainer('### <:Cancel:1521227723916181644> Session Expired\nYour setup session has expired. Run `/roletemplate` again.')],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
            });
            return true;
        }

        // Toggle template selection
        if (customId === 'roletemplate_toggle' && interaction.isStringSelectMenu()) {
            session.selected = interaction.values;
            activeSessions.set(key, session);
            const panel = buildTemplatePanel(session);
            await interaction.update({ components: [panel], flags: MessageFlags.IsComponentsV2 });
            return true;
        }

        // Select All
        if (customId === 'roletemplate_select_all') {
            session.selected = Object.keys(TEMPLATES);
            activeSessions.set(key, session);
            const panel = buildTemplatePanel(session);
            await interaction.update({ components: [panel], flags: MessageFlags.IsComponentsV2 });
            return true;
        }

        // Deselect All
        if (customId === 'roletemplate_deselect_all') {
            session.selected = [];
            activeSessions.set(key, session);
            const panel = buildTemplatePanel(session);
            await interaction.update({ components: [panel], flags: MessageFlags.IsComponentsV2 });
            return true;
        }

        // Cancel
        if (customId === 'roletemplate_cancel') {
            activeSessions.delete(key);
            await interaction.update({
                components: [successContainer('### <:Cancel:1521227723916181644> Setup Cancelled\n-# No roles or panels were created.')],
                flags: MessageFlags.IsComponentsV2
            });
            return true;
        }

        // Deploy
        if (customId === 'roletemplate_deploy') {
            if (session.selected.length === 0) {
                await interaction.reply({
                    components: [errorContainer('### <:Cancel:1521227723916181644> Nothing Selected\nSelect at least one template to deploy.')],
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
                });
                return true;
            }

            await interaction.deferUpdate();

            const results = [];
            for (const templateKey of session.selected) {
                const result = await deployTemplate(interaction.guild, session.channelId, templateKey);
                results.push(result);
            }

            activeSessions.delete(key);

            const resultPanel = buildResultPanel(results);
            await interaction.editReply({ components: [resultPanel], flags: MessageFlags.IsComponentsV2 });
            return true;
        }

        return false;
    },

    // ─── Handle members clicking the role select menu ───
    async handleRoleSelect(interaction) {
        const templateKey = interaction.customId.replace('rt_select_', '');
        const tmpl = TEMPLATES[templateKey];
        if (!tmpl) {
            await interaction.reply({ content: '<:Cancel:1521227723916181644> Unknown template.', flags: MessageFlags.Ephemeral });
            return true;
        }

        const guild = interaction.guild;
        if (!guild) return true;

        const member = await guild.members.fetch(interaction.user.id).catch(() => null);
        if (!member) {
            await interaction.reply({ content: '<:Cancel:1521227723916181644> Could not fetch your member data.', flags: MessageFlags.Ephemeral });
            return true;
        }

        // Load the panel config to get correct role IDs
        const config = loadConfig();
        const guildConfig = config[guild.id];
        if (!guildConfig) {
            await interaction.reply({ content: '<:Cancel:1521227723916181644> Panel configuration not found.', flags: MessageFlags.Ephemeral });
            return true;
        }

        const panel = guildConfig[interaction.message.id];
        if (!panel || !panel.roles) {
            await interaction.reply({ content: '<:Cancel:1521227723916181644> This panel is no longer configured.', flags: MessageFlags.Ephemeral });
            return true;
        }

        // Get all role IDs from this template panel
        const templateRoleIds = panel.roles.map(r => r.roleId);

        // If nothing was selected (min 0), remove all template roles
        if (!interaction.values || interaction.values.length === 0) {
            const rolesToRemove = templateRoleIds.filter(id => member.roles.cache.has(id));
            for (const roleId of rolesToRemove) {
                const role = guild.roles.cache.get(roleId);
                if (role && !role.managed && role.position < guild.members.me.roles.highest.position) {
                    await member.roles.remove(role).catch(() => {});
                }
            }

            await interaction.reply({
                components: [successContainer(`### <:Checkedbox:1521227734943269077> Roles Cleared\nAll **${tmpl.label}** roles have been removed.`)],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
            });
            return true;
        }

        const selectedRoleId = interaction.values[0];
        const selectedRoleDef = panel.roles.find(r => r.roleId === selectedRoleId);
        if (!selectedRoleDef) {
            await interaction.reply({ content: '<:Cancel:1521227723916181644> That role option is no longer valid.', flags: MessageFlags.Ephemeral });
            return true;
        }

        const selectedRole = guild.roles.cache.get(selectedRoleId);
        if (!selectedRole) {
            await interaction.reply({ content: '<:Cancel:1521227723916181644> Role not found. It may have been deleted.', flags: MessageFlags.Ephemeral });
            return true;
        }

        if (selectedRole.position >= guild.members.me.roles.highest.position) {
            await interaction.reply({ content: '<:Cancel:1521227723916181644> I cannot assign this role — it\'s above my highest role.', flags: MessageFlags.Ephemeral });
            return true;
        }

        // Toggle: if they already have the selected role, remove it
        if (member.roles.cache.has(selectedRoleId)) {
            await member.roles.remove(selectedRole).catch(() => {});
            await interaction.reply({
                components: [successContainer(`### <:Cancel:1521227723916181644> Role Removed\n${selectedRoleDef.emoji} **${selectedRole.name}** has been removed.`)],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
            });
            return true;
        }

        // Remove any other template roles first (exclusive selection)
        const otherTemplateRoles = templateRoleIds.filter(id => id !== selectedRoleId && member.roles.cache.has(id));
        for (const roleId of otherTemplateRoles) {
            const role = guild.roles.cache.get(roleId);
            if (role && !role.managed && role.position < guild.members.me.roles.highest.position) {
                await member.roles.remove(role).catch(() => {});
            }
        }

        // Add the selected role
        await member.roles.add(selectedRole).catch(() => {});

        await interaction.reply({
            components: [successContainer(`### <:Checkedbox:1521227734943269077> Role Assigned\n${selectedRoleDef.emoji} **${selectedRole.name}** has been given to you!`)],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
        });
        return true;
    }
};
