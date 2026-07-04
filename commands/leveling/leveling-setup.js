const { 
    SlashCommandBuilder,
    PermissionFlagsBits, 
    ContainerBuilder, 
    TextDisplayBuilder, 
    MessageFlags,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');
const { getGuildConfig, updateGuildConfig } = require('../../utils/database');
const { buildPermissionDenied } = require('../../utils/responseBuilder');

const jsonStore = require('../../utils/jsonStore');
const { checkAndExpire } = require('../../utils/panelExpiration');
const { LEVELUP_STYLES, LEVELUP_STYLE_KEYS } = require('../../utils/levelUpCard');

/** Clamp a string to discord.js TextDisplay limits (1–4000 chars) */
function safeContent(str) {
    if (!str || typeof str !== 'string') return '\u200b';
    if (str.length > 4000) return str.substring(0, 3997) + '...';
    return str;
}

/** Safely update the panel message after a modal reply */
async function refreshPanel(interaction, containerBuilder) {
    try {
        if (interaction.message) {
            await interaction.message.edit({ components: [containerBuilder], flags: MessageFlags.IsComponentsV2 });
        }
    } catch (e) {
        // Panel refresh failed — user will need to re-run the command
    }
}

/** Sync leveling-setup toggle with the file-based toggle used by the XP handler */
function syncToggleFile(guildId, enabled) {
    let data = {};
    try { if (jsonStore.has('levelingtoggle')) data = jsonStore.read('levelingtoggle'); } catch {}
    if (!data[guildId]) data[guildId] = { enabled: false, disabledChannels: [] };
    data[guildId].enabled = enabled;
    jsonStore.write('levelingtoggle', data);
}

function buildMainPanel(config, guild) {
    const levelingConfig = config.leveling || {};
    const xpSettings = levelingConfig.xpSettings || { minXp: 15, maxXp: 25, cooldown: 60 };
    const enabled = levelingConfig.enabled;
    
    let content = `# <:Fire:1521227907647668374> Leveling System\n\n`;
    content += `Reward active members with XP, levels, and role rewards!\n\n`;
    
    content += `### <:Bookopen:1521227911137595605> Current Configuration\n`;
    content += `**Status:** ${enabled ? '<:Toggleon:1521227758011809964> Enabled' : '<:Toggleoff:1521227763816595559> Disabled'}\n`;
    const announceCh = levelingConfig.announcementChannel || levelingConfig.announcements?.customChannelId;
    content += `**Announcement Channel:** ${announceCh ? `<#${announceCh}>` : '*Uses message channel*'}\n\n`;
    
    content += `### <:Lightning:1521227915537285150> XP Settings\n`;
    content += `**XP per Message:** ${xpSettings.minXp} - ${xpSettings.maxXp}\n`;
    content += `**Cooldown:** ${xpSettings.cooldown}s between XP gains\n`;
    content += `**Multiplier:** ${levelingConfig.multiplier || 1}x\n`;
    const voiceOn = levelingConfig.voiceXp !== false; // default ON
    const voiceRate = Number(levelingConfig.voiceXpRate) > 0 ? Number(levelingConfig.voiceXpRate) : 10;
    content += `**Voice XP:** ${voiceOn ? `<:Toggleon:1521227758011809964> Enabled · ${voiceRate} XP/min` : '<:Toggleoff:1521227763816595559> Disabled'}\n\n`;
    
    content += `### <:Award:1521228119640375336> Role Rewards\n`;
    content += `**Stack Roles:** ${levelingConfig.stackRoles ? '<:Toggleon:1521227758011809964> Yes' : '<:Toggleoff:1521227763816595559> No'}\n`;
    content += `**Level Roles:** ${levelingConfig.roles?.length || 0} configured\n\n`;
    
    content += `### <:Bullhorn:1521227936575914016> Level-Up Announcement\n`;
    content += `**Card Style:** ${(LEVELUP_STYLES[(levelingConfig.announcements||{}).cardStyle] || LEVELUP_STYLES.default).label}\n`;
    content += `**Message Placement:** ${(levelingConfig.announcements||{}).messageMode === 'inside' ? 'On the card' : 'Above the card'}\n`;
    content += `**Custom Message:** ${(levelingConfig.announcements||{}).message && (levelingConfig.announcements||{}).message.trim() ? (((levelingConfig.announcements||{}).message.length > 60) ? (levelingConfig.announcements||{}).message.slice(0,57) + '...' : (levelingConfig.announcements||{}).message) : '*Default*'}\n\n`;

    content += `### <:Commentblock:1521227898101432331> Exclusions\n`;
    content += `**Ignored Channels:** ${levelingConfig.ignoreChannels?.length || 0}\n`;
    content += `**Ignored Roles:** ${levelingConfig.ignoreRoles?.length || 0}`;
    
    return content;
}

function buildContainer(config, guild) {
    const levelingConfig = config.leveling || {};
    const container = new ContainerBuilder()
        .setAccentColor(levelingConfig.enabled ? 0x57F287 : 0xED4245);
    
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(safeContent(buildMainPanel(config, guild)))
    );
    
    container.addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    );
    
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent('### Controls')
    );
    
    container.addActionRowComponents(createControlRow(levelingConfig));
    container.addActionRowComponents(createSettingsRow(levelingConfig));
    container.addActionRowComponents(createVoiceRow(levelingConfig));
    container.addActionRowComponents(createAdvancedRow(levelingConfig));
    container.addActionRowComponents(createAnnounceRow(levelingConfig));
    
    return container;
}

function createControlRow(levelingConfig) {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('leveling_toggle')
                .setLabel(levelingConfig.enabled ? 'Disable' : 'Enable')
                .setStyle(levelingConfig.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
                .setEmoji(levelingConfig.enabled ? '<:Toggleoff:1521227763816595559>' : '<:Toggleon:1521227758011809964>'),
            new ButtonBuilder()
                .setCustomId('leveling_channel')
                .setLabel('Announcement Channel')
                .setStyle((levelingConfig.announcementChannel || levelingConfig.announcements?.customChannelId) ? ButtonStyle.Success : ButtonStyle.Primary)
                .setEmoji('<:Bullhorn:1521227936575914016>'),
            new ButtonBuilder()
                .setCustomId('leveling_xp')
                .setLabel('XP Settings')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('<:Lightning:1521227915537285150>')
        );
}

function createSettingsRow(levelingConfig) {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('leveling_multiplier')
                .setLabel('Multiplier')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('✖️'),
            new ButtonBuilder()
                .setCustomId('leveling_stack_toggle')
                .setLabel(levelingConfig.stackRoles ? 'Stack: ON' : 'Stack: OFF')
                .setStyle(levelingConfig.stackRoles ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setEmoji('<:Userplus:1521227719621218477>'),
            new ButtonBuilder()
                .setCustomId('leveling_roles')
                .setLabel('Level Roles')
                .setStyle((levelingConfig.roles?.length > 0) ? ButtonStyle.Success : ButtonStyle.Primary)
                .setEmoji('<:Award:1521228119640375336>')
        );
}

function createVoiceRow(levelingConfig) {
    const voiceOn = levelingConfig.voiceXp !== false; // default ON
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('leveling_voicexp_toggle')
                .setLabel(voiceOn ? 'Voice XP: ON' : 'Voice XP: OFF')
                .setStyle(voiceOn ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setEmoji('<:Volumeup:1521228004502536272>'),
            new ButtonBuilder()
                .setCustomId('leveling_voicexp_rate')
                .setLabel('Voice XP / Min')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('<:Lightning:1521227915537285150>')
        );
}

function createAdvancedRow(levelingConfig) {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('leveling_ignore')
                .setLabel('Ignore Settings')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('<:Commentblock:1521227898101432331>'),
            new ButtonBuilder()
                .setCustomId('leveling_reset')
                .setLabel('Reset All XP')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('<:Trash:1521227750420254820>')
        );
}

function createAnnounceRow(levelingConfig) {
    const ann = levelingConfig.announcements || {};
    const hasMsg = !!(ann.message && ann.message.trim());
    const inside = ann.messageMode === 'inside';
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('leveling_message')
                .setLabel('Level-Up Message')
                .setStyle(hasMsg ? ButtonStyle.Success : ButtonStyle.Primary)
                .setEmoji('<:Commentblock:1521227898101432331>'),
            new ButtonBuilder()
                .setCustomId('leveling_msgmode')
                .setLabel(inside ? 'Message: On Card' : 'Message: Above Card')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('<:Bookopen:1521227911137595605>'),
            new ButtonBuilder()
                .setCustomId('leveling_cardstyle')
                .setLabel(`Card Style: ${(LEVELUP_STYLES[ann.cardStyle] || LEVELUP_STYLES.default).label}`)
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('<:Sketch:1521228025365004471>')
        );
}

function buildRolesPanel(levelingConfig, guild) {
    const roles = levelingConfig.roles || [];
    
    let content = `# <:Award:1521228119640375336> Level Role Rewards\n\n`;
    content += `Automatically assign roles when members reach specific levels.\n\n`;
    
    if (roles.length === 0) {
        content += `### No Roles Configured\n`;
        content += `*Click **Add Role** to create your first level reward!*\n\n`;
        content += `### <:Lightbulbalt:1521227880703463675> Suggested Milestones\n`;
        content += `Level 5 → @Newcomer\n`;
        content += `Level 10 → @Active\n`;
        content += `Level 25 → @Regular\n`;
        content += `Level 50 → @Veteran`;
    } else {
        content += `### Current Rewards\n`;
        const sortedRoles = [...roles].sort((a, b) => a.level - b.level);
        for (const roleConfig of sortedRoles) {
            const role = guild.roles.cache.get(roleConfig.roleId);
            content += `<:Caretright:1521227704953864202> **Level ${roleConfig.level}** → ${role ? role.toString() : '*Role not found*'}\n`;
        }
        content += `\n*${roles.length} role reward${roles.length !== 1 ? 's' : ''} configured*`;
    }
    
    return content;
}

function buildRolesContainer(levelingConfig, guild) {
    const container = new ContainerBuilder()
        ;
    
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(safeContent(buildRolesPanel(levelingConfig, guild)))
    );
    
    container.addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    );
    
    container.addActionRowComponents(
        new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('leveling_add_role')
                    .setLabel('Add Role')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('<:Add:1521227828199293152>'),
                new ButtonBuilder()
                    .setCustomId('leveling_remove_role')
                    .setLabel('Remove Role')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('<:Trash:1521227750420254820>'),
                new ButtonBuilder()
                    .setCustomId('leveling_back')
                    .setLabel('Back')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('⬅️')
            )
    );
    
    return container;
}

function buildIgnorePanel(levelingConfig) {
    const ignoreChannels = levelingConfig.ignoreChannels || [];
    const ignoreRoles = levelingConfig.ignoreRoles || [];
    
    let content = `# <:Commentblock:1521227898101432331> Ignore Settings\n\n`;
    
    content += `### Ignored Channels (${ignoreChannels.length})\n`;
    if (ignoreChannels.length === 0) {
        content += `None configured\n`;
    } else {
        for (const channelId of ignoreChannels.slice(0, 5)) {
            content += `• <#${channelId}>\n`;
        }
        if (ignoreChannels.length > 5) {
            content += `*...and ${ignoreChannels.length - 5} more*\n`;
        }
    }
    
    content += `\n### Ignored Roles (${ignoreRoles.length})\n`;
    if (ignoreRoles.length === 0) {
        content += `None configured\n`;
    } else {
        for (const roleId of ignoreRoles.slice(0, 5)) {
            content += `• <@&${roleId}>\n`;
        }
        if (ignoreRoles.length > 5) {
            content += `*...and ${ignoreRoles.length - 5} more*\n`;
        }
    }
    
    return content;
}

function buildIgnoreContainer(levelingConfig) {
    const container = new ContainerBuilder()
        ;
    
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(safeContent(buildIgnorePanel(levelingConfig)))
    );
    
    container.addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    );
    
    container.addActionRowComponents(
        new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('leveling_ignore_channel')
                    .setLabel('Add/Remove Channel')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('<:Bullhorn:1521227936575914016>'),
                new ButtonBuilder()
                    .setCustomId('leveling_ignore_role')
                    .setLabel('Add/Remove Role')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('<:Userplus:1521227719621218477>'),
                new ButtonBuilder()
                    .setCustomId('leveling_back')
                    .setLabel('Back')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('⬅️')
            )
    );
    
    return container;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leveling-setup')
        .setDescription('Configure the leveling system')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    name: 'leveling-setup',
    prefix: 'leveling-setup',
    description: 'Configure the leveling system',
    usage: 'leveling-setup',
    category: 'leveling',
    aliases: ['lvlsetup', 'levelsetup'],

    async execute(interaction) {
        const guildConfig = await getGuildConfig(interaction.guild.id);
        const container = buildContainer(guildConfig, interaction.guild);
        
        await interaction.reply({ 
            components: [container], 
            flags: MessageFlags.IsComponentsV2 
        });
    },

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            const container = buildPermissionDenied('Administrator');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const guildConfig = await getGuildConfig(message.guild.id);
        const container = buildContainer(guildConfig, message.guild);
        
        message.reply({ 
            components: [container], 
            flags: MessageFlags.IsComponentsV2 
        });
    },

    async handleInteraction(interaction) {
        if (!interaction.isButton() && !interaction.isModalSubmit()) return false;
        
        const customId = interaction.customId;
        if (!customId.startsWith('leveling_')) return false;
        
        // Check if config session has expired
        if (await checkAndExpire(interaction, 'config')) return true;
        
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            await interaction.reply({ 
                content: '<:Cancel:1521227723916181644> You need Administrator permission to use these controls!', 
                flags: MessageFlags.Ephemeral 
            });
            return true;
        }
        
        const guildId = interaction.guild.id;
        let guildConfig = await getGuildConfig(guildId);
        let levelingConfig = guildConfig.leveling || {};
        
        if (interaction.isButton()) {
            if (customId === 'leveling_toggle') {
                levelingConfig.enabled = !levelingConfig.enabled;
                await updateGuildConfig(guildId, { leveling: levelingConfig });
                syncToggleFile(guildId, levelingConfig.enabled);
                
                guildConfig = await getGuildConfig(guildId);
                const container = buildContainer(guildConfig, interaction.guild);
                await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
                return true;
            }
            
            if (customId === 'leveling_voicexp_toggle') {
                // Voice XP is enabled by default; this flips the explicit flag.
                const enabled = levelingConfig.voiceXp !== false;
                levelingConfig.voiceXp = !enabled;
                await updateGuildConfig(guildId, { leveling: levelingConfig });

                guildConfig = await getGuildConfig(guildId);
                const container = buildContainer(guildConfig, interaction.guild);
                await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
                return true;
            }

            if (customId === 'leveling_voicexp_rate') {
                const rate = Number(levelingConfig.voiceXpRate) > 0 ? Number(levelingConfig.voiceXpRate) : 10;
                const modal = new ModalBuilder()
                    .setCustomId('leveling_modal_voicexp')
                    .setTitle('Voice XP Rate');

                const rateInput = new TextInputBuilder()
                    .setCustomId('voice_rate')
                    .setLabel('XP earned per minute in voice')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('10')
                    .setValue(String(rate))
                    .setRequired(true);

                modal.addComponents(new ActionRowBuilder().addComponents(rateInput));
                await interaction.showModal(modal);
                return true;
            }
            
            if (customId === 'leveling_channel') {
                const modal = new ModalBuilder()
                    .setCustomId('leveling_modal_channel')
                    .setTitle('Set Announcement Channel');
                
                const channelInput = new TextInputBuilder()
                    .setCustomId('channel_id')
                    .setLabel('Channel ID (empty = message channel)')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('123456789012345678')
                    .setValue(levelingConfig.announcementChannel || levelingConfig.announcements?.customChannelId || '')
                    .setRequired(false);
                
                modal.addComponents(new ActionRowBuilder().addComponents(channelInput));
                await interaction.showModal(modal);
                return true;
            }
            
            if (customId === 'leveling_xp') {
                const xpSettings = levelingConfig.xpSettings || { minXp: 15, maxXp: 25, cooldown: 60 };
                const modal = new ModalBuilder()
                    .setCustomId('leveling_modal_xp')
                    .setTitle('XP Settings');
                
                const minInput = new TextInputBuilder()
                    .setCustomId('min_xp')
                    .setLabel('Minimum XP per message')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('15')
                    .setValue(String(xpSettings.minXp))
                    .setRequired(true);
                
                const maxInput = new TextInputBuilder()
                    .setCustomId('max_xp')
                    .setLabel('Maximum XP per message')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('25')
                    .setValue(String(xpSettings.maxXp))
                    .setRequired(true);
                
                const cooldownInput = new TextInputBuilder()
                    .setCustomId('cooldown')
                    .setLabel('Cooldown (seconds)')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('60')
                    .setValue(String(xpSettings.cooldown))
                    .setRequired(true);
                
                modal.addComponents(
                    new ActionRowBuilder().addComponents(minInput),
                    new ActionRowBuilder().addComponents(maxInput),
                    new ActionRowBuilder().addComponents(cooldownInput)
                );
                await interaction.showModal(modal);
                return true;
            }
            
            if (customId === 'leveling_multiplier') {
                const modal = new ModalBuilder()
                    .setCustomId('leveling_modal_multiplier')
                    .setTitle('Set XP Multiplier');
                
                const multiplierInput = new TextInputBuilder()
                    .setCustomId('multiplier')
                    .setLabel('XP Multiplier (e.g., 1.5, 2)')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('1')
                    .setValue(String(levelingConfig.multiplier || 1))
                    .setRequired(true);
                
                modal.addComponents(new ActionRowBuilder().addComponents(multiplierInput));
                await interaction.showModal(modal);
                return true;
            }
            
            if (customId === 'leveling_stack_toggle') {
                levelingConfig.stackRoles = !levelingConfig.stackRoles;
                await updateGuildConfig(guildId, { leveling: levelingConfig });
                
                guildConfig = await getGuildConfig(guildId);
                const container = buildContainer(guildConfig, interaction.guild);
                await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
                await interaction.followUp({ 
                    content: `<:Checkedbox:1521227734943269077> Role stacking is now **${levelingConfig.stackRoles ? 'enabled' : 'disabled'}**!`, 
                    flags: MessageFlags.Ephemeral 
                }).catch(() => {});
                return true;
            }
            
            if (customId === 'leveling_roles') {
                const container = buildRolesContainer(levelingConfig, interaction.guild);
                await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
                return true;
            }
            
            if (customId === 'leveling_add_role') {
                const modal = new ModalBuilder()
                    .setCustomId('leveling_modal_add_role')
                    .setTitle('Add Level Role');
                
                const levelInput = new TextInputBuilder()
                    .setCustomId('level')
                    .setLabel('Level Required')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('5')
                    .setRequired(true);
                
                const roleInput = new TextInputBuilder()
                    .setCustomId('role_id')
                    .setLabel('Role ID')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('123456789012345678')
                    .setRequired(true);
                
                modal.addComponents(
                    new ActionRowBuilder().addComponents(levelInput),
                    new ActionRowBuilder().addComponents(roleInput)
                );
                await interaction.showModal(modal);
                return true;
            }
            
            if (customId === 'leveling_remove_role') {
                const modal = new ModalBuilder()
                    .setCustomId('leveling_modal_remove_role')
                    .setTitle('Remove Level Role');
                
                const levelInput = new TextInputBuilder()
                    .setCustomId('level')
                    .setLabel('Level to Remove')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('5')
                    .setRequired(true);
                
                modal.addComponents(new ActionRowBuilder().addComponents(levelInput));
                await interaction.showModal(modal);
                return true;
            }
            
            if (customId === 'leveling_ignore') {
                const container = buildIgnoreContainer(levelingConfig);
                await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
                return true;
            }
            
            if (customId === 'leveling_ignore_channel') {
                const modal = new ModalBuilder()
                    .setCustomId('leveling_modal_ignore_channel')
                    .setTitle('Toggle Ignore Channel');
                
                const channelInput = new TextInputBuilder()
                    .setCustomId('channel_id')
                    .setLabel('Channel ID (toggle add/remove)')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('123456789012345678')
                    .setRequired(true);
                
                modal.addComponents(new ActionRowBuilder().addComponents(channelInput));
                await interaction.showModal(modal);
                return true;
            }
            
            if (customId === 'leveling_ignore_role') {
                const modal = new ModalBuilder()
                    .setCustomId('leveling_modal_ignore_role')
                    .setTitle('Toggle Ignore Role');
                
                const roleInput = new TextInputBuilder()
                    .setCustomId('role_id')
                    .setLabel('Role ID (toggle add/remove)')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('123456789012345678')
                    .setRequired(true);
                
                modal.addComponents(new ActionRowBuilder().addComponents(roleInput));
                await interaction.showModal(modal);
                return true;
            }
            
            if (customId === 'leveling_reset') {
                if (jsonStore.has('leveling')) {
                    const data = jsonStore.read('leveling');
                    if (data[guildId]) {
                        data[guildId] = {};
                        jsonStore.write('leveling', data);
                    }
                }
                
                await interaction.reply({ 
                    content: '<:Checkedbox:1521227734943269077> All XP and levels have been reset for this server!', 
                    flags: MessageFlags.Ephemeral 
                });
                return true;
            }
            
            if (customId === 'leveling_message') {
                const ann = levelingConfig.announcements || {};
                const modal = new ModalBuilder()
                    .setCustomId('leveling_modal_message')
                    .setTitle('Custom Level-Up Message');

                const msgInput = new TextInputBuilder()
                    .setCustomId('message')
                    .setLabel('Message (blank = default)')
                    .setStyle(TextInputStyle.Paragraph)
                    .setPlaceholder('GG {user}, you reached Level {level}! Total XP: {xp}')
                    .setValue(ann.message || '')
                    .setMaxLength(1000)
                    .setRequired(false);

                modal.addComponents(new ActionRowBuilder().addComponents(msgInput));
                await interaction.showModal(modal);
                return true;
            }

            if (customId === 'leveling_msgmode') {
                if (!levelingConfig.announcements) levelingConfig.announcements = {};
                levelingConfig.announcements.messageMode =
                    levelingConfig.announcements.messageMode === 'inside' ? 'outside' : 'inside';
                await updateGuildConfig(guildId, { leveling: levelingConfig });

                guildConfig = await getGuildConfig(guildId);
                await interaction.update({ components: [buildContainer(guildConfig, interaction.guild)], flags: MessageFlags.IsComponentsV2 });
                return true;
            }

            if (customId === 'leveling_cardstyle') {
                if (!levelingConfig.announcements) levelingConfig.announcements = {};
                const cur = levelingConfig.announcements.cardStyle || 'default';
                const idx = LEVELUP_STYLE_KEYS.indexOf(cur);
                const next = LEVELUP_STYLE_KEYS[(idx + 1) % LEVELUP_STYLE_KEYS.length];
                levelingConfig.announcements.cardStyle = next;
                await updateGuildConfig(guildId, { leveling: levelingConfig });

                guildConfig = await getGuildConfig(guildId);
                await interaction.update({ components: [buildContainer(guildConfig, interaction.guild)], flags: MessageFlags.IsComponentsV2 });
                await interaction.followUp({
                    content: `<:Checkedbox:1521227734943269077> Level-up card style set to **${(LEVELUP_STYLES[next] || LEVELUP_STYLES.default).label}**.`,
                    flags: MessageFlags.Ephemeral
                }).catch(() => {});
                return true;
            }

            if (customId === 'leveling_back') {
                guildConfig = await getGuildConfig(guildId);
                const container = buildContainer(guildConfig, interaction.guild);
                await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
                return true;
            }
        }
        
        if (interaction.isModalSubmit()) {
            if (customId === 'leveling_modal_message') {
                const msg = interaction.fields.getTextInputValue('message').trim();
                if (!levelingConfig.announcements) levelingConfig.announcements = {};
                levelingConfig.announcements.message = msg || null;
                await updateGuildConfig(guildId, { leveling: levelingConfig });

                await interaction.reply({
                    content: msg
                        ? '<:Checkedbox:1521227734943269077> Custom level-up message saved! Use {user}, {level}, {xp}, {rank}, {server} as placeholders.'
                        : '<:Checkedbox:1521227734943269077> Reverted to the default level-up message.',
                    flags: MessageFlags.Ephemeral
                });

                guildConfig = await getGuildConfig(guildId);
                await refreshPanel(interaction, buildContainer(guildConfig, interaction.guild));
                return true;
            }

            if (customId === 'leveling_modal_channel') {
                const channelId = interaction.fields.getTextInputValue('channel_id').trim();
                
                if (channelId) {
                    let channel;
                    try {
                        channel = await interaction.guild.channels.fetch(channelId);
                    } catch (e) {
                        channel = null;
                    }
                    if (!channel) {
                        await interaction.reply({ 
                            content: '<:Cancel:1521227723916181644> Invalid channel ID!', 
                            flags: MessageFlags.Ephemeral 
                        });
                        return true;
                    }
                    levelingConfig.announcementChannel = channelId;
                    // Also update announcements sub-object for XP handler compatibility
                    if (!levelingConfig.announcements) levelingConfig.announcements = {};
                    levelingConfig.announcements.channel = 'custom';
                    levelingConfig.announcements.customChannelId = channelId;
                } else {
                    levelingConfig.announcementChannel = null;
                    if (!levelingConfig.announcements) levelingConfig.announcements = {};
                    levelingConfig.announcements.channel = 'same';
                    levelingConfig.announcements.customChannelId = null;
                }
                await updateGuildConfig(guildId, { leveling: levelingConfig });
                
                await interaction.reply({ 
                    content: channelId ? '<:Checkedbox:1521227734943269077> Announcement channel updated!' : '<:Checkedbox:1521227734943269077> Will use message channel for announcements!', 
                    flags: MessageFlags.Ephemeral 
                });
                
                guildConfig = await getGuildConfig(guildId);
                await refreshPanel(interaction, buildContainer(guildConfig, interaction.guild));
                return true;
            }
            
            if (customId === 'leveling_modal_xp') {
                const minXp = parseInt(interaction.fields.getTextInputValue('min_xp'));
                const maxXp = parseInt(interaction.fields.getTextInputValue('max_xp'));
                const cooldown = parseInt(interaction.fields.getTextInputValue('cooldown'));
                
                if (isNaN(minXp) || isNaN(maxXp) || isNaN(cooldown)) {
                    await interaction.reply({ 
                        content: '<:Cancel:1521227723916181644> Please enter valid numbers!', 
                        flags: MessageFlags.Ephemeral 
                    });
                    return true;
                }
                
                if (minXp > maxXp) {
                    await interaction.reply({ 
                        content: '<:Cancel:1521227723916181644> Minimum XP cannot be greater than maximum!', 
                        flags: MessageFlags.Ephemeral 
                    });
                    return true;
                }
                
                if (!levelingConfig.xpSettings) levelingConfig.xpSettings = {};
                levelingConfig.xpSettings.minXp = minXp;
                levelingConfig.xpSettings.maxXp = maxXp;
                levelingConfig.xpSettings.cooldown = cooldown;
                await updateGuildConfig(guildId, { leveling: levelingConfig });
                
                await interaction.reply({ 
                    content: `<:Checkedbox:1521227734943269077> XP settings updated! Range: ${minXp}-${maxXp}, Cooldown: ${cooldown}s`, 
                    flags: MessageFlags.Ephemeral 
                });
                
                guildConfig = await getGuildConfig(guildId);
                await refreshPanel(interaction, buildContainer(guildConfig, interaction.guild));
                return true;
            }

            if (customId === 'leveling_modal_voicexp') {
                const rate = parseInt(interaction.fields.getTextInputValue('voice_rate'));
                if (isNaN(rate) || rate < 0 || rate > 1000) {
                    await interaction.reply({
                        content: '<:Cancel:1521227723916181644> Enter a whole number between 0 and 1000.',
                        flags: MessageFlags.Ephemeral
                    });
                    return true;
                }

                levelingConfig.voiceXpRate = rate;
                // Editing the rate keeps voice XP on unless it was explicitly off.
                if (levelingConfig.voiceXp === undefined) levelingConfig.voiceXp = true;
                await updateGuildConfig(guildId, { leveling: levelingConfig });

                await interaction.reply({
                    content: `<:Checkedbox:1521227734943269077> Voice XP set to **${rate} XP/min**.`,
                    flags: MessageFlags.Ephemeral
                });

                guildConfig = await getGuildConfig(guildId);
                await refreshPanel(interaction, buildContainer(guildConfig, interaction.guild));
                return true;
            }
            
            if (customId === 'leveling_modal_multiplier') {
                const multiplier = parseFloat(interaction.fields.getTextInputValue('multiplier'));
                
                if (isNaN(multiplier) || multiplier <= 0) {
                    await interaction.reply({ 
                        content: '<:Cancel:1521227723916181644> Please enter a valid positive number!', 
                        flags: MessageFlags.Ephemeral 
                    });
                    return true;
                }
                
                levelingConfig.multiplier = multiplier;
                await updateGuildConfig(guildId, { leveling: levelingConfig });
                
                await interaction.reply({ 
                    content: `<:Checkedbox:1521227734943269077> XP multiplier set to **${multiplier}x**!`, 
                    flags: MessageFlags.Ephemeral 
                });
                
                guildConfig = await getGuildConfig(guildId);
                await refreshPanel(interaction, buildContainer(guildConfig, interaction.guild));
                return true;
            }
            
            if (customId === 'leveling_modal_add_role') {
                const level = parseInt(interaction.fields.getTextInputValue('level'));
                const roleId = interaction.fields.getTextInputValue('role_id').trim();
                
                if (isNaN(level) || level < 1) {
                    await interaction.reply({ 
                        content: '<:Cancel:1521227723916181644> Please enter a valid level (1 or higher)!', 
                        flags: MessageFlags.Ephemeral 
                    });
                    return true;
                }
                
                const role = interaction.guild.roles.cache.get(roleId);
                if (!role) {
                    await interaction.reply({ 
                        content: '<:Cancel:1521227723916181644> Invalid role ID!', 
                        flags: MessageFlags.Ephemeral 
                    });
                    return true;
                }
                
                guildConfig = await getGuildConfig(guildId);
                levelingConfig = guildConfig.leveling || {};
                const roles = levelingConfig.roles || [];
                
                const existingIndex = roles.findIndex(r => r.level === level);
                if (existingIndex >= 0) {
                    roles[existingIndex].roleId = roleId;
                } else {
                    roles.push({ level, roleId });
                }
                
                levelingConfig.roles = roles;
                await updateGuildConfig(guildId, { leveling: levelingConfig });
                
                await interaction.reply({ 
                    content: `<:Checkedbox:1521227734943269077> Level ${level} will now reward ${role}!`, 
                    flags: MessageFlags.Ephemeral 
                });
                
                guildConfig = await getGuildConfig(guildId);
                await refreshPanel(interaction, buildRolesContainer(guildConfig.leveling || {}, interaction.guild));
                return true;
            }
            
            if (customId === 'leveling_modal_remove_role') {
                const level = parseInt(interaction.fields.getTextInputValue('level'));
                
                if (isNaN(level)) {
                    await interaction.reply({ 
                        content: '<:Cancel:1521227723916181644> Please enter a valid level!', 
                        flags: MessageFlags.Ephemeral 
                    });
                    return true;
                }
                
                guildConfig = await getGuildConfig(guildId);
                levelingConfig = guildConfig.leveling || {};
                levelingConfig.roles = (levelingConfig.roles || []).filter(r => r.level !== level);
                
                await updateGuildConfig(guildId, { leveling: levelingConfig });
                
                await interaction.reply({ 
                    content: `<:Checkedbox:1521227734943269077> Level ${level} role reward removed!`, 
                    flags: MessageFlags.Ephemeral 
                });
                
                guildConfig = await getGuildConfig(guildId);
                await refreshPanel(interaction, buildRolesContainer(guildConfig.leveling || {}, interaction.guild));
                return true;
            }
            
            if (customId === 'leveling_modal_ignore_channel') {
                const channelId = interaction.fields.getTextInputValue('channel_id').trim();
                
                const channel = interaction.guild.channels.cache.get(channelId);
                if (!channel) {
                    await interaction.reply({ 
                        content: '<:Cancel:1521227723916181644> Invalid channel ID!', 
                        flags: MessageFlags.Ephemeral 
                    });
                    return true;
                }
                
                guildConfig = await getGuildConfig(guildId);
                levelingConfig = guildConfig.leveling || {};
                let ignoreChannels = levelingConfig.ignoreChannels || [];
                
                if (ignoreChannels.includes(channelId)) {
                    ignoreChannels = ignoreChannels.filter(id => id !== channelId);
                    await interaction.reply({ 
                        content: `<:Checkedbox:1521227734943269077> ${channel} is no longer ignored!`, 
                        flags: MessageFlags.Ephemeral 
                    });
                } else {
                    ignoreChannels.push(channelId);
                    await interaction.reply({ 
                        content: `<:Checkedbox:1521227734943269077> ${channel} will now be ignored for XP!`, 
                        flags: MessageFlags.Ephemeral 
                    });
                }
                
                levelingConfig.ignoreChannels = ignoreChannels;
                await updateGuildConfig(guildId, { leveling: levelingConfig });
                
                guildConfig = await getGuildConfig(guildId);
                await refreshPanel(interaction, buildIgnoreContainer(guildConfig.leveling || {}));
                return true;
            }
            
            if (customId === 'leveling_modal_ignore_role') {
                const roleId = interaction.fields.getTextInputValue('role_id').trim();
                
                const role = interaction.guild.roles.cache.get(roleId);
                if (!role) {
                    await interaction.reply({ 
                        content: '<:Cancel:1521227723916181644> Invalid role ID!', 
                        flags: MessageFlags.Ephemeral 
                    });
                    return true;
                }
                
                guildConfig = await getGuildConfig(guildId);
                levelingConfig = guildConfig.leveling || {};
                let ignoreRoles = levelingConfig.ignoreRoles || [];
                
                if (ignoreRoles.includes(roleId)) {
                    ignoreRoles = ignoreRoles.filter(id => id !== roleId);
                    await interaction.reply({ 
                        content: `<:Checkedbox:1521227734943269077> ${role} is no longer ignored!`, 
                        flags: MessageFlags.Ephemeral 
                    });
                } else {
                    ignoreRoles.push(roleId);
                    await interaction.reply({ 
                        content: `<:Checkedbox:1521227734943269077> Users with ${role} will now be ignored for XP!`, 
                        flags: MessageFlags.Ephemeral 
                    });
                }
                
                levelingConfig.ignoreRoles = ignoreRoles;
                await updateGuildConfig(guildId, { leveling: levelingConfig });
                
                guildConfig = await getGuildConfig(guildId);
                await refreshPanel(interaction, buildIgnoreContainer(guildConfig.leveling || {}));
                return true;
            }
        }
        
        return false;
    }
};
