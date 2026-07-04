const { SlashCommandBuilder, PermissionFlagsBits, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, ChannelSelectMenuBuilder, StringSelectMenuBuilder, RoleSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
// Import TEMPLATES from roletemplate.js
const { TEMPLATES } = require('./roletemplate');

const jsonStore = require('../../utils/jsonStore');
const DEFAULT_COLOR = 0xCAD7E6;
const ERROR_COLOR = 0xED4245;

const activeSetups = new Map();

function loadConfig() {
    if (!jsonStore.has('reactionroles')) {
        jsonStore.write('reactionroles', {});
        return {};
    }
    try {
        return jsonStore.read('reactionroles');
    } catch {
        return {};
    }
}

function saveConfig(config) {
    jsonStore.write('reactionroles', config);
}

function findEmojiInArgs(args) {
    const unicodeEmojiRegex = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/u;
    const customEmojiRegex = /<a?:\w+:\d+>/;
    for (let i = args.length - 1; i >= 0; i--) {
        if (unicodeEmojiRegex.test(args[i]) || customEmojiRegex.test(args[i])) {
            return args[i];
        }
    }
    return null;
}

function parseColor(input) {
    if (!input) return DEFAULT_COLOR;
    const hex = input.toLowerCase().trim().replace('#', '');
    const parsed = parseInt(hex, 16);
    if (!isNaN(parsed) && hex.length === 6) return parsed;
    return DEFAULT_COLOR;
}

function colorToHex(num) {
    return '#' + num.toString(16).padStart(6, '0');
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

function buildSetupMessage(setup, guild) {
    const channelText = setup.channelId ? `<#${setup.channelId}>` : '*Not set*';
    const colorHex = colorToHex(setup.color);
    const isButton = setup.mode === 'button';
    const modeLabel = isButton ? '🔘 Button Roles' : '🎯 Reaction Roles';

    let rolesText = '';
    if (setup.roles.length > 0) {
        rolesText = setup.roles.map(r => {
            const role = guild.roles.cache.get(r.roleId);
            return `${r.emoji} **${role ? role.name : `<@&${r.roleId}>`}**`;
        }).join('\n');
    } else {
        rolesText = '*No roles added yet*';
    }

    let previewText = '';
    if (setup.customMessage) {
        previewText = `\n### <:Document:1521227875016114266> Custom Message\n${setup.customMessage.length > 200 ? setup.customMessage.substring(0, 200) + '...' : setup.customMessage}\n`;
    }

    const container = new ContainerBuilder()
        .setAccentColor(setup.color)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `## <:Userplus:1521227719621218477> Role Panel Setup\n` +
            `Set up your role panel step by step.`
        ));

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

    // --- Template selection dropdown ---
    const templateOptions = Object.entries(TEMPLATES).map(([key, tmpl]) => {
        const option = new StringSelectMenuOptionBuilder()
            .setLabel(tmpl.label)
            .setValue(key)
            .setDescription(tmpl.description);
        // Only set emoji if valid
        const customMatch = typeof tmpl.emoji === 'string' && tmpl.emoji.match(/^<(a?):(\w+):(\d+)>$/);
        if (customMatch) {
            option.setEmoji({ id: customMatch[3], name: customMatch[2], animated: !!customMatch[1] });
        } else if (typeof tmpl.emoji === 'string' && /^[\p{Emoji}\u200d]+$/u.test(tmpl.emoji)) {
            option.setEmoji(tmpl.emoji);
        }
        return option;
    });
    const templateSelect = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('rrsetup_select_template')
            .setPlaceholder('Select a template to auto-create roles...')
            .addOptions(templateOptions)
    );
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent('### 🗂️ Templates (Optional)'));
    container.addActionRowComponents(templateSelect);
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `### <:Document:1521227875016114266> Panel Info\n` +
        `**Mode:** ${modeLabel}\n` +
        `**Title:** ${setup.title || '*Not set*'}\n` +
        `**Description:** ${setup.description || '*Default*'}\n` +
        `**Channel:** ${channelText}\n` +
        `**Color:** \`${colorHex}\`\n` +
        `**Image:** ${setup.image || '*None*'}` +
        previewText
    ));

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('rrsetup_mode').setLabel(isButton ? 'Switch to Reactions' : 'Switch to Buttons').setEmoji(isButton ? '🎯' : '🔘').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('rrsetup_message').setLabel('Set Message').setEmoji('📝').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('rrsetup_channel').setLabel('Set Channel').setEmoji('📌').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('rrsetup_color').setLabel('Set Color').setEmoji('🎨').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('rrsetup_image').setLabel('Set Image').setEmoji('🖼️').setStyle(ButtonStyle.Secondary)
    );

    container.addActionRowComponents(row1);

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `### <:Bookmark:1521227835526742066> Roles (${setup.roles.length}/20)\n` +
        rolesText
    ));

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('rrsetup_addrole').setLabel('Add Role').setEmoji('➕').setStyle(ButtonStyle.Success).setDisabled(setup.roles.length >= 20),
        new ButtonBuilder().setCustomId('rrsetup_removerole').setLabel('Remove Role').setEmoji('➖').setStyle(ButtonStyle.Danger).setDisabled(setup.roles.length === 0)
    );

    container.addActionRowComponents(row2);

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

    const row3 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('rrsetup_preview').setLabel('Preview').setEmoji('👁️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('rrsetup_send').setLabel('Send Panel').setEmoji('🚀').setStyle(ButtonStyle.Success).setDisabled(!setup.channelId || setup.roles.length === 0),
        new ButtonBuilder().setCustomId('rrsetup_cancel').setLabel('Cancel').setEmoji('✖️').setStyle(ButtonStyle.Danger)
    );

    container.addActionRowComponents(row3);

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

    return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

async function ensureTemplateRoles(guild, templateKey) {
    const tmpl = TEMPLATES[templateKey];
    if (!tmpl) return [];
    const created = [];
    for (const r of tmpl.roles) {
        const name = r.name.replace(/^[^\w]*\s*/, '').trim() || r.name;
        let role = guild.roles.cache.find(existing => existing.name.toLowerCase() === name.toLowerCase());
        if (!role) {
            try {
                role = await guild.roles.create({
                    name,
                    color: r.color || null,
                    reason: 'Auto-created from template',
                });
            } catch (e) { continue; }
        }
        created.push({ roleId: role.id, emoji: r.emoji });
    }
    return created;
}

async function handleTemplateSelect(interaction) {
    const key = module.exports.getSetupKey(interaction.user.id, interaction.guild.id);
    const setup = module.exports.activeSetups.get(key);
    if (!setup) {
        return interaction.reply({ components: [errorContainer('### <:Cancel:1521227723916181644> Session Expired\nRun `/reactionroles setup` again.')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    }
    const templateKey = interaction.values[0];
    await interaction.deferUpdate().catch(() => {});
    const newRoles = await ensureTemplateRoles(interaction.guild, templateKey);
    for (const r of newRoles) {
        if (!setup.roles.some(x => x.roleId === r.roleId)) {
            setup.roles.push(r);
        }
    }
    const tmpl = TEMPLATES[templateKey];
    if (tmpl && !setup.title) setup.title = tmpl.panelTitle;
    if (tmpl && !setup.description) setup.description = tmpl.panelDescription;
    const msg = buildSetupMessage(setup, interaction.guild);
    return interaction.editReply({ ...msg }).catch(() => {});
}

function buildPanelPreview(setup, guild) {
    const rolesList = setup.roles.length > 0
        ? setup.roles.map(r => {
            const role = guild.roles.cache.get(r.roleId);
            return `${r.emoji} **${role ? role.name : 'Unknown Role'}**`;
        }).join('\n')
        : '-# No roles added yet';

    const title = setup.title || 'Reaction Roles';
    const isButton = setup.mode === 'button';
    const defaultDesc = isButton ? 'Click a button below to assign yourself a role.' : 'React with the emojis below to assign yourself a role.';
    const desc = setup.customMessage || setup.description || defaultDesc;

    const panelContainer = new ContainerBuilder()
        .setAccentColor(setup.color);

    if (isButton) {
        panelContainer.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`## ${title}\n${desc}`)
        );
    } else {
        panelContainer.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`## ${title}\n${desc}\n\n${rolesList}`)
        );
    }

    if (setup.image) {
        panelContainer.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`[​](${setup.image})`)
        );
    }

    // Add button rows for button mode
    if (isButton && setup.roles.length > 0) {
        const buttonRows = [];
        let currentRow = [];
        for (const r of setup.roles) {
            const role = guild.roles.cache.get(r.roleId);
            const btn = new ButtonBuilder()
                .setCustomId(`rr_role_${r.roleId}`)
                .setLabel((role ? role.name : 'Unknown Role').substring(0, 80))
                .setStyle(ButtonStyle.Secondary);
            const customMatch = r.emoji.match(/^<(a)?:(\w+):(\d+)>$/);
            if (customMatch) {
                btn.setEmoji({ id: customMatch[3], name: customMatch[2], animated: !!customMatch[1] });
            } else {
                btn.setEmoji(r.emoji);
            }
            currentRow.push(btn);
            if (currentRow.length >= 5) {
                buttonRows.push(new ActionRowBuilder().addComponents(...currentRow));
                currentRow = [];
            }
        }
        if (currentRow.length > 0) {
            buttonRows.push(new ActionRowBuilder().addComponents(...currentRow));
        }
        for (const row of buttonRows) {
            panelContainer.addActionRowComponents(row);
        }
    }

    panelContainer.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

    return panelContainer;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reactionroles')
        .setDescription('Create and manage emoji reaction role panels')
        .addSubcommand(sub =>
            sub.setName('setup')
                .setDescription('Interactive setup wizard for reaction roles'))
        .addSubcommand(sub =>
            sub.setName('create')
                .setDescription('Quick create a reaction role panel')
                .addStringOption(opt =>
                    opt.setName('title').setDescription('Panel title').setRequired(true))
                .addStringOption(opt =>
                    opt.setName('description').setDescription('Panel description').setRequired(false))
                .addChannelOption(opt =>
                    opt.setName('channel').setDescription('Channel to send (defaults to current)')
                        .addChannelTypes(ChannelType.GuildText).setRequired(false))
                .addStringOption(opt =>
                    opt.setName('color').setDescription('Accent color hex (default #cad7e6)').setRequired(false))
                .addStringOption(opt =>
                    opt.setName('image').setDescription('Image URL for the panel').setRequired(false)))
        .addSubcommand(sub =>
            sub.setName('add')
                .setDescription('Add a role to a panel')
                .addStringOption(opt =>
                    opt.setName('message-id').setDescription('Message ID of the panel').setRequired(true))
                .addRoleOption(opt =>
                    opt.setName('role').setDescription('Role to add').setRequired(true))
                .addStringOption(opt =>
                    opt.setName('emoji').setDescription('Emoji for the reaction').setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('remove')
                .setDescription('Remove a role from a panel')
                .addStringOption(opt =>
                    opt.setName('message-id').setDescription('Message ID of the panel').setRequired(true))
                .addRoleOption(opt =>
                    opt.setName('role').setDescription('Role to remove').setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('delete')
                .setDescription('Delete an entire panel')
                .addStringOption(opt =>
                    opt.setName('message-id').setDescription('Message ID to delete').setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('edit')
                .setDescription('Edit panel appearance')
                .addStringOption(opt =>
                    opt.setName('message-id').setDescription('Message ID of the panel').setRequired(true))
                .addStringOption(opt =>
                    opt.setName('title').setDescription('New title').setRequired(false))
                .addStringOption(opt =>
                    opt.setName('description').setDescription('New description').setRequired(false))
                .addStringOption(opt =>
                    opt.setName('color').setDescription('New accent color hex').setRequired(false))
                .addStringOption(opt =>
                    opt.setName('image').setDescription('New image URL ("none" to remove)').setRequired(false)))
        .addSubcommand(sub =>
            sub.setName('attach')
                .setDescription('Attach reaction roles to any existing message')
                .addStringOption(opt =>
                    opt.setName('message-id').setDescription('Target message ID').setRequired(true))
                .addRoleOption(opt =>
                    opt.setName('role').setDescription('Role to add').setRequired(true))
                .addStringOption(opt =>
                    opt.setName('emoji').setDescription('Emoji for the reaction').setRequired(true))
                .addChannelOption(opt =>
                    opt.setName('channel').setDescription('Channel (defaults to current)')
                        .addChannelTypes(ChannelType.GuildText).setRequired(false)))
        .addSubcommand(sub =>
            sub.setName('list').setDescription('View all panels'))
        .addSubcommand(sub =>
            sub.setName('help').setDescription('Detailed setup guide'))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

    prefix: 'reactionroles',
    aliases: ['rr', 'selfroles', 'rolemenu', 'rroles'],
    description: 'Create and manage emoji reaction role panels',
    category: 'automation',
    usage: 'reactionroles <setup/create/add/remove/delete/edit/attach/list/help>',

    activeSetups,

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        try {
            if (sub === 'setup') await this.handleSetup(interaction);
            else if (sub === 'create') await this.handleCreate(interaction);
            else if (sub === 'add') await this.handleAdd(interaction);
            else if (sub === 'remove') await this.handleRemove(interaction);
            else if (sub === 'delete') await this.handleDelete(interaction);
            else if (sub === 'edit') await this.handleEdit(interaction);
            else if (sub === 'attach') await this.handleAttach(interaction);
            else if (sub === 'list') await this.handleList(interaction);
            else if (sub === 'help') await this.handleHelp(interaction);
        } catch (error) {
            console.error('Reaction role command error:', error);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ components: [errorContainer('### <:Cancel:1521227723916181644> Something Went Wrong\nAn error occurred. Please try again.')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral }).catch(() => {});
            }
        }
    },

    validateRole(interaction, role) {
        const botMember = interaction.guild.members.me;
        if (!botMember.permissions.has('ManageRoles')) {
            return errorContainer('### <:Cancel:1521227723916181644> Missing Permission\nI need **Manage Roles** permission to assign roles.');
        }
        if (role.position >= botMember.roles.highest.position) {
            return errorContainer(`### <:Cancel:1521227723916181644> Role Too High\nI cannot assign **${role.name}** — it\'s above my highest role.\nMove my role higher in Server Settings > Roles.`);
        }
        if (role.managed) {
            return errorContainer(`### <:Cancel:1521227723916181644> Managed Role\n**${role.name}** is managed by a bot/integration and cannot be assigned.`);
        }
        return null;
    },

    validateRoleById(guild, roleId) {
        const role = guild.roles.cache.get(roleId);
        if (!role) return 'Role not found. Make sure you copied the correct role ID.';
        const botMember = guild.members.me;
        if (!botMember.permissions.has('ManageRoles')) return 'I need **Manage Roles** permission.';
        if (role.position >= botMember.roles.highest.position) return `**${role.name}** is above my highest role.`;
        if (role.managed) return `**${role.name}** is managed by a bot/integration.`;
        return null;
    },

    async syncReactions(message, roles) {
        try {
            for (const roleData of roles) {
                try {
                    const customMatch = roleData.emoji.match(/<a?:\w+:(\d+)>/);
                    if (customMatch) {
                        await message.react(customMatch[1]).catch(() => {});
                    } else {
                        await message.react(roleData.emoji).catch(() => {});
                    }
                } catch {}
            }
        } catch {}
    },

    async removeReaction(message, emoji) {
        try {
            const customMatch = emoji.match(/<a?:\w+:(\d+)>/);
            const emojiId = customMatch ? customMatch[1] : emoji;
            const reaction = message.reactions.cache.find(r =>
                (r.emoji.id && r.emoji.id === emojiId) || r.emoji.name === emojiId
            );
            if (reaction) {
                await reaction.users.fetch();
                const botReaction = reaction.users.cache.has(message.client.user.id);
                if (botReaction) await reaction.users.remove(message.client.user.id).catch(() => {});
            }
        } catch {}
    },

    getSetupKey(userId, guildId) {
        return `${userId}-${guildId}`;
    },

    async handleSetup(interaction) {
        const key = this.getSetupKey(interaction.user.id, interaction.guild.id);
        const existingSetup = activeSetups.get(key);
        if (existingSetup) {
            activeSetups.delete(key);
        }

        const setup = {
            guildId: interaction.guild.id,
            channelId: interaction.channel.id,
            title: null,
            description: null,
            customMessage: null,
            color: DEFAULT_COLOR,
            image: null,
            mode: 'reaction',
            roles: [],
            userId: interaction.user.id,
            messageId: null,
            createdAt: Date.now()
        };

        activeSetups.set(key, setup);

        setTimeout(() => {
            if (activeSetups.has(key) && activeSetups.get(key).createdAt === setup.createdAt) {
                activeSetups.delete(key);
            }
        }, 10 * 60 * 1000);

        const msg = buildSetupMessage(setup, interaction.guild);
        await interaction.reply({ ...msg, flags: msg.flags | MessageFlags.Ephemeral });
        // Keep a reference to the root panel interaction so helper selectors
        // (channel / remove-role) can refresh THIS panel instead of spawning
        // duplicate orphaned panels. Token stays valid for 15m (> 10m expiry).
        setup.rootInteraction = interaction;
    },

    async handleSetupInteraction(interaction) {
        // Template select handler (StringSelectMenu)
        if (interaction.isStringSelectMenu() && interaction.customId === 'rrsetup_select_template') {
            return handleTemplateSelect(interaction);
        }
        const key = this.getSetupKey(interaction.user.id, interaction.guild.id);
        const setup = activeSetups.get(key);
        if (!setup) {
            return interaction.reply({ components: [errorContainer('### <:Cancel:1521227723916181644> Session Expired\nYour setup session has expired. Run `/reactionroles setup` again.')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        const action = interaction.customId.replace('rrsetup_', '');

        if (action === 'mode') {
            setup.mode = setup.mode === 'button' ? 'reaction' : 'button';
            const msg = buildSetupMessage(setup, interaction.guild);
            return interaction.update({ ...msg }).catch(() => {});
        }

        if (action === 'message') {
            const modal = new ModalBuilder()
                .setCustomId('rrsetup_modal_message')
                .setTitle('Set Panel Message')
                .addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('rr_title').setLabel('Panel Title').setStyle(TextInputStyle.Short).setPlaceholder('e.g. Pick Your Roles').setMaxLength(100).setRequired(true).setValue(setup.title || '')
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('rr_description').setLabel('Short Description (below title)').setStyle(TextInputStyle.Short).setPlaceholder('e.g. React to get your roles!').setMaxLength(200).setRequired(false).setValue(setup.description || '')
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('rr_custom').setLabel('Custom Message (full panel content)').setStyle(TextInputStyle.Paragraph).setPlaceholder('Write your own custom message here...\nSupports Discord markdown, mentions, etc.').setMaxLength(2000).setRequired(false).setValue(setup.customMessage || '')
                    )
                );
            return interaction.showModal(modal);
        }

        if (action === 'channel') {
            const row = new ActionRowBuilder().addComponents(
                new ChannelSelectMenuBuilder()
                    .setCustomId('rrsetup_select_channel')
                    .setPlaceholder('Select a channel...')
                    .setChannelTypes(ChannelType.GuildText)
            );
            return interaction.reply({
                components: [successContainer('### <:Hashtag:1521227771957870604> Select Channel\nChoose which channel the panel should be sent to.'), row],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
            });
        }

        if (action === 'color') {
            const modal = new ModalBuilder()
                .setCustomId('rrsetup_modal_color')
                .setTitle('Set Panel Color')
                .addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('rr_color').setLabel('Hex Color Code').setStyle(TextInputStyle.Short).setPlaceholder('#cad7e6').setMaxLength(7).setRequired(true).setValue(colorToHex(setup.color))
                    )
                );
            return interaction.showModal(modal);
        }

        if (action === 'image') {
            const modal = new ModalBuilder()
                .setCustomId('rrsetup_modal_image')
                .setTitle('Set Panel Image')
                .addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('rr_image').setLabel('Image URL (leave empty to remove)').setStyle(TextInputStyle.Short).setPlaceholder('https://example.com/image.png').setMaxLength(500).setRequired(false).setValue(setup.image || '')
                    )
                );
            return interaction.showModal(modal);
        }

        if (action === 'addrole') {
            const modal = new ModalBuilder()
                .setCustomId('rrsetup_modal_addrole')
                .setTitle('Add Reaction Role')
                .addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('rr_roleid').setLabel('Role ID (right-click role → Copy ID)').setStyle(TextInputStyle.Short).setPlaceholder('e.g. 1234567890123456789').setMaxLength(20).setRequired(true)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('rr_emoji').setLabel('Emoji (paste emoji or custom emoji)').setStyle(TextInputStyle.Short).setPlaceholder('e.g. 🎮 or <:name:id>').setMaxLength(60).setRequired(true)
                    )
                );
            return interaction.showModal(modal);
        }

        if (action === 'removerole') {
            if (setup.roles.length === 0) {
                return interaction.reply({ components: [errorContainer('### <:Cancel:1521227723916181644> No Roles\nThere are no roles to remove.')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }

            const options = setup.roles.map((r, i) => {
                const role = interaction.guild.roles.cache.get(r.roleId);
                return {
                    label: role ? role.name : `Unknown (${r.roleId})`,
                    value: String(i),
                    emoji: r.emoji.startsWith('<') ? undefined : { name: r.emoji },
                    description: `Emoji: ${r.emoji}`
                };
            });

            const row = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('rrsetup_select_removerole')
                    .setPlaceholder('Select a role to remove...')
                    .addOptions(options)
            );

            return interaction.reply({
                components: [successContainer('### <:Trash:1521227750420254820> Remove Role\nSelect which role to remove from the panel.'), row],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
            });
        }

        if (action === 'preview') {
            if (!setup.title && !setup.customMessage) {
                return interaction.reply({ components: [errorContainer('### <:Cancel:1521227723916181644> Nothing to Preview\nSet a message first using **Set Message**.')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }
            const preview = buildPanelPreview(setup, interaction.guild);
            return interaction.reply({
                components: [preview, successContainer('-# This is a preview — the actual panel will be sent when you click **Send Panel**')],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
            });
        }

        if (action === 'send') {
            if (!setup.channelId) {
                return interaction.reply({ components: [errorContainer('### <:Cancel:1521227723916181644> No Channel\nSelect a channel first using **Set Channel**.')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }
            if (setup.roles.length === 0) {
                return interaction.reply({ components: [errorContainer('### <:Cancel:1521227723916181644> No Roles\nAdd at least one role using **Add Role**.')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }

            const channel = await interaction.client.channels.fetch(setup.channelId).catch(() => null);
            if (!channel) {
                return interaction.reply({ components: [errorContainer('### <:Cancel:1521227723916181644> Channel Not Found\nThe selected channel no longer exists.')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }

            const requiredPerms = ['SendMessages', 'ViewChannel', 'ReadMessageHistory'];
            if (setup.mode !== 'button') requiredPerms.push('AddReactions');
            const botPerms = channel.permissionsFor(interaction.guild.members.me);
            if (!botPerms?.has(requiredPerms)) {
                const permNames = requiredPerms.map(p => `**${p.replace(/([A-Z])/g, ' $1').trim()}**`).join(', ');
                return interaction.reply({ components: [errorContainer(`### <:Cancel:1521227723916181644> Missing Permissions\nI need ${permNames} in <#${channel.id}>.`)], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }

            const panelContainer = buildPanelPreview(setup, interaction.guild);

            const roleMessage = await channel.send({
                components: [panelContainer],
                flags: MessageFlags.IsComponentsV2
            });

            const config = loadConfig();
            if (!config[interaction.guild.id]) config[interaction.guild.id] = {};

            const isButton = setup.mode === 'button';
            const defaultDesc = isButton ? 'Click a button below to assign yourself a role.' : 'React with the emojis below to assign yourself a role.';

            config[interaction.guild.id][roleMessage.id] = {
                title: setup.title || 'Role Panel',
                description: setup.customMessage || setup.description || defaultDesc,
                channelId: channel.id,
                messageId: roleMessage.id,
                color: setup.color,
                image: setup.image || null,
                roles: setup.roles,
                mode: setup.mode || 'reaction',
                createdBy: interaction.user.id,
                createdAt: Date.now()
            };

            saveConfig(config);

            if (!isButton) {
                await this.syncReactions(roleMessage, setup.roles);
            }

            activeSetups.delete(key);

            const modeHint = isButton
                ? `-# Members can click buttons to toggle roles\n-# Use \`/reactionroles add\` to add more roles later`
                : `-# Members can react with the emojis to get roles\n-# Use \`/reactionroles add\` to add more roles later`;

            await interaction.update({
                components: [successContainer(
                    `### <:Checkedbox:1521227734943269077> Panel Sent!\n` +
                    `Your role panel has been sent to <#${channel.id}>.\n` +
                    `**Mode:** ${isButton ? '🔘 Button Roles' : '🎯 Reaction Roles'}\n` +
                    `**Message ID:** \`${roleMessage.id}\`\n` +
                    `**Roles:** ${setup.roles.length}\n\n` +
                    modeHint
                )],
                flags: MessageFlags.IsComponentsV2
            }).catch(() => {});
            return;
        }

        if (action === 'cancel') {
            activeSetups.delete(key);
            return interaction.update({
                components: [successContainer('### <:Cancel:1521227723916181644> Setup Cancelled\nReaction role setup has been cancelled.')],
                flags: MessageFlags.IsComponentsV2
            }).catch(() => {});
        }
    },

    async handleSetupModal(interaction) {
        const key = this.getSetupKey(interaction.user.id, interaction.guild.id);
        const setup = activeSetups.get(key);
        if (!setup) {
            return interaction.reply({ components: [errorContainer('### <:Cancel:1521227723916181644> Session Expired\nRun `/reactionroles setup` again.')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        const modalId = interaction.customId;

        if (modalId === 'rrsetup_modal_message') {
            const title = interaction.fields.getTextInputValue('rr_title')?.trim();
            const desc = interaction.fields.getTextInputValue('rr_description')?.trim();
            const custom = interaction.fields.getTextInputValue('rr_custom')?.trim();

            if (title) setup.title = title;
            if (desc) setup.description = desc;
            if (custom) {
                setup.customMessage = custom;
                setup.description = null;
            } else {
                setup.customMessage = null;
            }

            const msg = buildSetupMessage(setup, interaction.guild);
            await interaction.deferUpdate().catch(() => {});
            return interaction.editReply({ ...msg }).catch(() => {});
        }

        if (modalId === 'rrsetup_modal_color') {
            const colorInput = interaction.fields.getTextInputValue('rr_color')?.trim();
            setup.color = parseColor(colorInput);

            const msg = buildSetupMessage(setup, interaction.guild);
            await interaction.deferUpdate().catch(() => {});
            return interaction.editReply({ ...msg }).catch(() => {});
        }

        if (modalId === 'rrsetup_modal_image') {
            const imageInput = interaction.fields.getTextInputValue('rr_image')?.trim();
            setup.image = imageInput || null;

            const msg = buildSetupMessage(setup, interaction.guild);
            await interaction.deferUpdate().catch(() => {});
            return interaction.editReply({ ...msg }).catch(() => {});
        }

        if (modalId === 'rrsetup_modal_addrole') {
            const roleId = interaction.fields.getTextInputValue('rr_roleid')?.trim();
            const emoji = interaction.fields.getTextInputValue('rr_emoji')?.trim();

            if (!roleId || !emoji) {
                return interaction.reply({ components: [errorContainer('### <:Cancel:1521227723916181644> Missing Fields\nBoth Role ID and Emoji are required.')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }

            const isCustomEmoji = /^<a?:\w+:\d+>$/.test(emoji);
            const isUnicodeEmoji = findEmojiInArgs([emoji]) !== null;
            if (!isCustomEmoji && !isUnicodeEmoji) {
                return interaction.reply({ components: [errorContainer('### <:Cancel:1521227723916181644> Invalid Emoji\nPaste a valid emoji (e.g. 🎮) or custom emoji (e.g. `<:name:id>`).')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }

            if (!/^\d{17,20}$/.test(roleId)) {
                return interaction.reply({ components: [errorContainer('### <:Cancel:1521227723916181644> Invalid Role ID\nRole ID should be a number (17-20 digits).\nRight-click the role → Copy Role ID.')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }

            const roleErr = this.validateRoleById(interaction.guild, roleId);
            if (roleErr) {
                return interaction.reply({ components: [errorContainer(`### <:Cancel:1521227723916181644> Invalid Role\n${roleErr}`)], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }

            if (setup.roles.some(r => r.roleId === roleId)) {
                const role = interaction.guild.roles.cache.get(roleId);
                return interaction.reply({ components: [errorContainer(`### <:Cancel:1521227723916181644> Duplicate Role\n**${role?.name || roleId}** is already added.`)], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }

            if (setup.roles.some(r => r.emoji === emoji)) {
                return interaction.reply({ components: [errorContainer(`### <:Cancel:1521227723916181644> Duplicate Emoji\n${emoji} is already used for another role.`)], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }

            if (setup.roles.length >= 20) {
                return interaction.reply({ components: [errorContainer('### <:Cancel:1521227723916181644> Limit Reached\nMaximum 20 roles per panel.')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }

            setup.roles.push({ roleId, emoji });

            const msg = buildSetupMessage(setup, interaction.guild);
            await interaction.deferUpdate().catch(() => {});
            return interaction.editReply({ ...msg }).catch(() => {});
        }
    },

    async handleSetupSelect(interaction) {
        const key = this.getSetupKey(interaction.user.id, interaction.guild.id);
        const setup = activeSetups.get(key);
        if (!setup) {
            return interaction.reply({ components: [errorContainer('### <:Cancel:1521227723916181644> Session Expired\nRun `/reactionroles setup` again.')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        if (interaction.customId === 'rrsetup_select_channel') {
            const channelId = interaction.values[0];
            setup.channelId = channelId;

            // Turn the helper message into a confirmation (not a full panel)
            await interaction.update({
                components: [successContainer(`### <:Checkedbox:1521227734943269077> Channel Set\nThe panel will be sent to <#${channelId}>.\n-# Return to the setup panel above to continue.`)],
                flags: MessageFlags.IsComponentsV2
            }).catch(() => {});

            // Refresh the original setup panel so it reflects the new channel
            const msg = buildSetupMessage(setup, interaction.guild);
            if (setup.rootInteraction) {
                await setup.rootInteraction.editReply({ components: msg.components }).catch(() => {});
            } else if (setup.rootMessage) {
                await setup.rootMessage.edit({ components: msg.components }).catch(() => {});
            }
            return;
        }

        if (interaction.customId === 'rrsetup_select_removerole') {
            const idx = parseInt(interaction.values[0]);
            if (idx >= 0 && idx < setup.roles.length) {
                const removed = setup.roles.splice(idx, 1)[0];
                const role = interaction.guild.roles.cache.get(removed.roleId);

                // Confirm in the helper message
                await interaction.update({
                    components: [successContainer(`### <:Checkedbox:1521227734943269077> Role Removed\n**${role ? role.name : 'Role'}** was removed from the panel.\n-# Return to the setup panel above to continue.`)],
                    flags: MessageFlags.IsComponentsV2
                }).catch(() => {});

                // Refresh the original setup panel
                const msg = buildSetupMessage(setup, interaction.guild);
                if (setup.rootInteraction) {
                    await setup.rootInteraction.editReply({ components: msg.components }).catch(() => {});
                } else if (setup.rootMessage) {
                    await setup.rootMessage.edit({ components: msg.components }).catch(() => {});
                }
                return;
            }
            // Index out of range — acknowledge to avoid "interaction failed"
            return interaction.deferUpdate().catch(() => {});
        }
    },

    async handleCreate(interaction) {
        const title = interaction.options.getString('title');
        const description = interaction.options.getString('description') || 'React with the emojis below to assign yourself a role.';
        const channel = interaction.options.getChannel('channel') || interaction.channel;
        const colorInput = interaction.options.getString('color');
        const image = interaction.options.getString('image');
        const color = parseColor(colorInput);

        const botMember = interaction.guild.members.me;
        if (!channel.permissionsFor(botMember).has(['SendMessages', 'ViewChannel', 'AddReactions'])) {
            return interaction.reply({ components: [errorContainer(`### <:Cancel:1521227723916181644> No Access\nI need **Send Messages**, **View Channel**, and **Add Reactions** permissions in <#${channel.id}>.`)], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        const panelContainer = new ContainerBuilder()
            .setAccentColor(color);

        panelContainer.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`## ${title}\n${description}\n\n-# No roles added yet — use \`/reactionroles add\` to add roles`)
        );
        panelContainer.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

        const roleMessage = await channel.send({
            components: [panelContainer],
            flags: MessageFlags.IsComponentsV2
        });

        const config = loadConfig();
        if (!config[interaction.guild.id]) config[interaction.guild.id] = {};

        config[interaction.guild.id][roleMessage.id] = {
            title,
            description,
            channelId: channel.id,
            messageId: roleMessage.id,
            color,
            image: image || null,
            roles: [],
            mode: 'reaction',
            createdBy: interaction.user.id,
            createdAt: Date.now()
        };

        saveConfig(config);

        const reply = successContainer(
            `### <:Checkedbox:1521227734943269077> Panel Created\n` +
            `**Channel:** <#${channel.id}>\n` +
            `**Message ID:** \`${roleMessage.id}\`\n\n` +
            `**Add roles:**\n\`/reactionroles add message-id:${roleMessage.id} role:@RoleName emoji:🎮\`\n\n` +
            `-# Up to 20 roles per panel • Bot role must be above assigned roles\n` +
            `-# Want buttons instead? Use /reactionroles setup and toggle to Button mode`
        );

        await interaction.reply({ components: [reply], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    },

    async handleAdd(interaction) {
        const messageId = interaction.options.getString('message-id');
        const role = interaction.options.getRole('role');
        const emoji = interaction.options.getString('emoji');

        const config = loadConfig();
        const panel = config[interaction.guild.id]?.[messageId];

        if (!panel) {
            return interaction.reply({ components: [errorContainer(`### <:Cancel:1521227723916181644> Panel Not Found\nNo panel with ID \`${messageId}\`.\nUse \`/reactionroles list\` to see your panels.`)], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        const channel = await interaction.client.channels.fetch(panel.channelId).catch(() => null);
        if (channel) {
            const requiredPerms = ['ReadMessageHistory'];
            if (panel.mode !== 'button') requiredPerms.push('AddReactions');
            const botPerms = channel.permissionsFor(interaction.guild.members.me);
            if (!botPerms?.has(requiredPerms)) {
                return interaction.reply({ components: [errorContainer(`### <:Cancel:1521227723916181644> Missing Permissions\nI need ${requiredPerms.map(p => `**${p}**`).join(' and ')} in <#${panel.channelId}>.`)], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }
        }

        if (panel.roles.some(r => r.roleId === role.id)) {
            return interaction.reply({ components: [errorContainer(`### <:Cancel:1521227723916181644> Duplicate Role\n**${role.name}** is already in this panel.`)], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        if (panel.roles.some(r => r.emoji === emoji)) {
            return interaction.reply({ components: [errorContainer(`### <:Cancel:1521227723916181644> Duplicate Emoji\n${emoji} is already used in this panel.`)], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        if (panel.roles.length >= 20) {
            return interaction.reply({ components: [errorContainer('### <:Cancel:1521227723916181644> Limit Reached\nMaximum 20 roles per panel. Create a new panel for more.')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        const roleErr = this.validateRole(interaction, role);
        if (roleErr) return interaction.reply({ components: [roleErr], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });

        panel.roles.push({
            roleId: role.id,
            emoji
        });

        saveConfig(config);
        await this.updatePanel(interaction.client, interaction.guild.id, messageId);

        const isBtn = panel.mode === 'button';
        await interaction.reply({ components: [successContainer(`### <:Checkedbox:1521227734943269077> Role Added\n${emoji} **${role.name}** added to the panel.\n**Roles:** ${panel.roles.length}/20\n-# ${isBtn ? 'Members click the button to toggle the role' : `Members react with ${emoji} to get the role`}`)], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    },

    async handleRemove(interaction) {
        const messageId = interaction.options.getString('message-id');
        const role = interaction.options.getRole('role');

        const config = loadConfig();
        const panel = config[interaction.guild.id]?.[messageId];

        if (!panel) {
            return interaction.reply({ components: [errorContainer('### <:Cancel:1521227723916181644> Panel Not Found')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        const idx = panel.roles.findIndex(r => r.roleId === role.id);
        if (idx === -1) {
            return interaction.reply({ components: [errorContainer(`### <:Cancel:1521227723916181644> Not Found\n**${role.name}** is not in this panel.`)], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        const removedEmoji = panel.roles[idx].emoji;
        panel.roles.splice(idx, 1);
        saveConfig(config);

        if (panel.mode !== 'button') {
            const channel = await interaction.client.channels.fetch(panel.channelId).catch(() => null);
            if (channel) {
                const msg = await channel.messages.fetch(messageId).catch(() => null);
                if (msg) await this.removeReaction(msg, removedEmoji);
            }
        }

        await this.updatePanel(interaction.client, interaction.guild.id, messageId);

        await interaction.reply({ components: [successContainer(`### <:Checkedbox:1521227734943269077> Role Removed\n**${role.name}** removed from the panel.\n**Remaining:** ${panel.roles.length}/20`)], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    },

    async handleDelete(interaction) {
        const messageId = interaction.options.getString('message-id');
        const config = loadConfig();
        const panel = config[interaction.guild.id]?.[messageId];

        if (!panel) {
            return interaction.reply({ components: [errorContainer('### <:Cancel:1521227723916181644> Panel Not Found')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        try {
            const channel = await interaction.client.channels.fetch(panel.channelId).catch(() => null);
            if (channel) {
                if (!panel.attachedTo) {
                    const msg = await channel.messages.fetch(messageId).catch(() => null);
                    if (msg) await msg.delete().catch(() => {});
                } else {
                    const msg = await channel.messages.fetch(messageId).catch(() => null);
                    if (msg) await msg.reactions.removeAll().catch(() => {});
                }
            }
        } catch {}

        const count = panel.roles.length;
        delete config[interaction.guild.id][messageId];
        if (config[interaction.guild.id] && Object.keys(config[interaction.guild.id]).length === 0) {
            delete config[interaction.guild.id];
        }
        saveConfig(config);

        await interaction.reply({ components: [successContainer(`### <:Trash:1521227750420254820> Panel Deleted\nRemoved ${count} reaction role(s).`)], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    },

    async handleEdit(interaction) {
        const messageId = interaction.options.getString('message-id');
        const newTitle = interaction.options.getString('title');
        const newDesc = interaction.options.getString('description');
        const newColor = interaction.options.getString('color');
        const newImage = interaction.options.getString('image');

        if (!newTitle && !newDesc && !newColor && !newImage) {
            return interaction.reply({ components: [errorContainer('### <:Cancel:1521227723916181644> Nothing to Edit\nProvide at least one option: title, description, color, or image.')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        const config = loadConfig();
        const panel = config[interaction.guild.id]?.[messageId];
        if (!panel) {
            return interaction.reply({ components: [errorContainer('### <:Cancel:1521227723916181644> Panel Not Found')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        if (panel.attachedTo) {
            return interaction.reply({ components: [errorContainer('### <:Cancel:1521227723916181644> Cannot Edit\nAttached panels don\'t have an editable embed. Use `/reactionroles create` or `/reactionroles setup` for a custom panel.')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        const changes = [];
        if (newTitle) { panel.title = newTitle; changes.push('Title'); }
        if (newDesc) { panel.description = newDesc; changes.push('Description'); }
        if (newColor) { panel.color = parseColor(newColor); changes.push('Color'); }
        if (newImage) { panel.image = newImage.toLowerCase() === 'none' ? null : newImage; changes.push('Image'); }

        saveConfig(config);
        await this.updatePanel(interaction.client, interaction.guild.id, messageId);

        await interaction.reply({ components: [successContainer(`### <:Checkedbox:1521227734943269077> Panel Updated\nChanged: **${changes.join(', ')}**`)], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    },

    async handleAttach(interaction) {
        const messageId = interaction.options.getString('message-id');
        const role = interaction.options.getRole('role');
        const emoji = interaction.options.getString('emoji');
        const channel = interaction.options.getChannel('channel') || interaction.channel;

        const roleErr = this.validateRole(interaction, role);
        if (roleErr) return interaction.reply({ components: [roleErr], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });

        const botPerms = channel.permissionsFor(interaction.guild.members.me);
        if (!botPerms?.has(['AddReactions', 'ReadMessageHistory'])) {
            return interaction.reply({ components: [errorContainer(`### <:Cancel:1521227723916181644> Missing Permissions\nI need **Add Reactions** and **Read Message History** in <#${channel.id}> to add emoji reactions.`)], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        const targetMsg = await channel.messages.fetch(messageId).catch(() => null);
        if (!targetMsg) {
            return interaction.reply({ components: [errorContainer(`### <:Cancel:1521227723916181644> Message Not Found\nMessage \`${messageId}\` not found in <#${channel.id}>.`)], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        const config = loadConfig();
        if (!config[interaction.guild.id]) config[interaction.guild.id] = {};

        if (!config[interaction.guild.id][messageId]) {
            config[interaction.guild.id][messageId] = {
                title: null,
                description: null,
                channelId: channel.id,
                messageId: messageId,
                color: DEFAULT_COLOR,
                image: null,
                roles: [],
                attachedTo: true,
                mode: 'reaction',
                createdBy: interaction.user.id,
                createdAt: Date.now()
            };
        }

        const panel = config[interaction.guild.id][messageId];

        if (panel.roles.some(r => r.roleId === role.id)) {
            return interaction.reply({ components: [errorContainer(`### <:Cancel:1521227723916181644> Duplicate\n**${role.name}** is already attached.`)], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        if (panel.roles.some(r => r.emoji === emoji)) {
            return interaction.reply({ components: [errorContainer(`### <:Cancel:1521227723916181644> Duplicate Emoji\n${emoji} is already used on this message.`)], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        if (panel.roles.length >= 20) {
            return interaction.reply({ components: [errorContainer('### <:Cancel:1521227723916181644> Limit Reached\nMaximum 20 roles per message.')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        panel.roles.push({
            roleId: role.id,
            emoji
        });

        saveConfig(config);

        await this.syncReactions(targetMsg, panel.roles);

        await interaction.reply({ components: [successContainer(`### <:Checkedbox:1521227734943269077> Reaction Attached\n${emoji} → **${role.name}** on [that message](${targetMsg.url})\n**Total:** ${panel.roles.length}/20\n-# Members react with ${emoji} to get the role`)], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    },

    async handleList(interaction) {
        const config = loadConfig();
        const guildPanels = config[interaction.guild.id] || {};

        if (Object.keys(guildPanels).length === 0) {
            return interaction.reply({ components: [successContainer('### <:Document:1521227875016114266> No Panels\nCreate one with `/reactionroles setup` or `/reactionroles create`')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        let desc = '## <:Userplus:1521227719621218477> Reaction Role Panels\n\n';
        const footer = `\n-# ${Object.keys(guildPanels).length} panel(s) total`;
        let truncated = false;
        for (const [msgId, panel] of Object.entries(guildPanels)) {
            const title = panel.title || (panel.attachedTo ? 'Attached Reactions' : 'Untitled');
            const rolePreview = panel.roles.slice(0, 5).map(r => r.emoji).join(' ');
            const extra = panel.roles.length > 5 ? ` +${panel.roles.length - 5} more` : '';
            let entry = `**${title}** — <#${panel.channelId}>\n`;
            entry += `\`${msgId}\` • ${panel.roles.length}/20 roles${panel.attachedTo ? ' • attached' : ''}${panel.mode === 'button' ? ' • 🔘 buttons' : ''}\n`;
            if (rolePreview) entry += `-# ${rolePreview}${extra}\n`;
            entry += '\n';
            // Keep within Discord's 4000-char text limit (leave room for footer)
            if (desc.length + entry.length + footer.length > 3900) { truncated = true; break; }
            desc += entry;
        }
        if (truncated) desc += '-# …more panels not shown (list is full)\n';
        desc += `-# ${Object.keys(guildPanels).length} panel(s) total`;

        await interaction.reply({ components: [successContainer(desc)], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    },

    async handleHelp(interaction) {
        const container = new ContainerBuilder()
            .setAccentColor(DEFAULT_COLOR)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `## Reaction Roles — Setup Guide\n` +
                `Let members assign themselves roles by reacting with emojis.\n\n` +
                `### <:Lightbulbalt:1521227880703463675> Interactive Setup (Recommended)\n` +
                `\`/reactionroles setup\`\n` +
                `-# Step-by-step wizard with buttons — easiest way to create a panel\n\n` +
                `### <:Document:1521227875016114266> Quick Create\n` +
                `\`/reactionroles create title:"Pick Your Roles"\`\n` +
                `-# Optional: \`color:#ff5733\` \`description:"..."\` \`image:URL\`\n\n` +
                `### <:Bookmark:1521227835526742066> Add Roles\n` +
                `\`/reactionroles add message-id:123 role:@Gamer emoji:🎮\`\n` +
                `-# The bot adds the emoji as a reaction on the panel\n\n` +
                `### <:Userplus:1521227719621218477> Attach to Any Message\n` +
                `\`/reactionroles attach message-id:123 role:@Role emoji:🎮\`\n` +
                `-# Add reaction roles to any existing message\n\n` +
                `### <:Palette:1521227950601539755> Customize\n` +
                `\`/reactionroles edit message-id:123 color:#ff5733\`\n` +
                `\`/reactionroles edit message-id:123 title:"New Title"\`\n\n` +
                `### Requirements\n` +
                `• Bot role must be **above** assigned roles\n` +
                `• Bot needs **Manage Roles** + **Add Reactions** (reaction mode) + **Read Message History**\n` +
                `• Up to **20 roles** per panel\n\n` +
                `### All Commands\n` +
                `\`setup\` \`create\` \`add\` \`remove\` \`edit\` \`attach\` \`delete\` \`list\` \`help\`\n\n` +
                `### <:Palette:1521227950601539755> Button Mode\n` +
                `Use \`/reactionroles setup\` and toggle to **Button Roles** mode — members click buttons instead of reacting with emojis.`
            ));

        await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    },

    async updatePanel(client, guildId, messageId) {
        const config = loadConfig();
        const panel = config[guildId]?.[messageId];
        if (!panel) return;

        const channel = await client.channels.fetch(panel.channelId).catch(() => null);
        if (!channel) return;

        const message = await channel.messages.fetch(messageId).catch(() => null);
        if (!message) return;

        if (panel.attachedTo) {
            if (panel.roles.length > 0 && panel.mode !== 'button') await this.syncReactions(message, panel.roles);
            return;
        }

        const isButton = panel.mode === 'button';
        const rolesList = panel.roles.length > 0
            ? panel.roles.map(r => {
                const role = channel.guild.roles.cache.get(r.roleId);
                return `${r.emoji} **${role ? role.name : 'Unknown Role'}**`;
            }).join('\n')
            : '-# No roles added yet';

        const panelContainer = new ContainerBuilder()
            .setAccentColor(panel.color ?? DEFAULT_COLOR);

        if (isButton) {
            panelContainer.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`## ${panel.title}\n${panel.description}`)
            );
        } else {
            panelContainer.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`## ${panel.title}\n${panel.description}\n\n${rolesList}`)
            );
        }

        if (panel.image) {
            panelContainer.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`[​](${panel.image})`)
            );
        }

        if (isButton && panel.roles.length > 0) {
            const buttonRows = [];
            let currentRow = [];
            for (const r of panel.roles) {
                const role = channel.guild.roles.cache.get(r.roleId);
                const btn = new ButtonBuilder()
                    .setCustomId(`rr_role_${r.roleId}`)
                    .setLabel((role ? role.name : 'Unknown Role').substring(0, 80))
                    .setStyle(ButtonStyle.Secondary);
                const customMatch = r.emoji.match(/^<(a)?:(\w+):(\d+)>$/);
                if (customMatch) {
                    btn.setEmoji({ id: customMatch[3], name: customMatch[2], animated: !!customMatch[1] });
                } else {
                    btn.setEmoji(r.emoji);
                }
                currentRow.push(btn);
                if (currentRow.length >= 5) {
                    buttonRows.push(new ActionRowBuilder().addComponents(...currentRow));
                    currentRow = [];
                }
            }
            if (currentRow.length > 0) {
                buttonRows.push(new ActionRowBuilder().addComponents(...currentRow));
            }
            for (const row of buttonRows) {
                panelContainer.addActionRowComponents(row);
            }
        }

        panelContainer.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

        await message.edit({ components: [panelContainer], flags: MessageFlags.IsComponentsV2 }).catch(() => {});

        if (!isButton && panel.roles.length > 0) {
            await this.syncReactions(message, panel.roles);
        }
    },

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
            return message.reply({ components: [errorContainer('### <:Cancel:1521227723916181644> Missing Permission\nYou need **Manage Roles** to use this.')], flags: MessageFlags.IsComponentsV2 });
        }

        const sub = args[0]?.toLowerCase();

        if (!sub || sub === 'help') {
            const container = new ContainerBuilder()
                .setAccentColor(DEFAULT_COLOR)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `## <:Userplus:1521227719621218477> Reaction Roles\n\n` +
                    `**Commands:**\n` +
                    `\`-rr setup\` — Interactive setup wizard\n` +
                    `\`-rr create <title>\` — Quick create panel\n` +
                    `\`-rr add <msg-id> @Role 🎮\` — Add role reaction\n` +
                    `\`-rr attach <msg-id> @Role 🎮\` — Attach to any message\n` +
                    `\`-rr edit <msg-id> <color/title/desc> <value>\` — Edit\n` +
                    `\`-rr remove <msg-id> @Role\` — Remove role\n` +
                    `\`-rr delete <msg-id>\` — Delete panel\n` +
                    `\`-rr list\` — View all panels\n\n` +
                    `-# React with emoji = get role • Unreact = remove role\n` +
                    `-# Use /reactionroles setup for button mode`
                ));
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        try {
            if (sub === 'setup') {
                const key = this.getSetupKey(message.author.id, message.guild.id);
                if (activeSetups.has(key)) activeSetups.delete(key);

                const setup = {
                    guildId: message.guild.id,
                    channelId: message.channel.id,
                    title: null,
                    description: null,
                    customMessage: null,
                    color: DEFAULT_COLOR,
                    image: null,
                    mode: 'reaction',
                    roles: [],
                    userId: message.author.id,
                    messageId: null,
                    createdAt: Date.now()
                };
                activeSetups.set(key, setup);

                setTimeout(() => {
                    if (activeSetups.has(key) && activeSetups.get(key).createdAt === setup.createdAt) {
                        activeSetups.delete(key);
                    }
                }, 10 * 60 * 1000);

                const wiz = buildSetupMessage(setup, message.guild);
                const sent = await message.reply({ ...wiz });
                // Store the panel message so helper selectors can refresh it
                // (prefix has no interaction token like the slash version).
                setup.rootMessage = sent;
                return;
            }

            if (sub === 'create') {
                const title = args.slice(1).join(' ');
                if (!title) return message.reply({ components: [errorContainer('### <:Cancel:1521227723916181644> Usage\n`-rr create <title>`')], flags: MessageFlags.IsComponentsV2 });

                const panelContainer = new ContainerBuilder()
                    .setAccentColor(DEFAULT_COLOR)
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(`## ${title}\nReact with the emojis below to assign yourself a role.\n\n-# No roles added yet`)
                    );
                panelContainer.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

                const roleMessage = await message.channel.send({ components: [panelContainer], flags: MessageFlags.IsComponentsV2 });

                const config = loadConfig();
                if (!config[message.guild.id]) config[message.guild.id] = {};
                config[message.guild.id][roleMessage.id] = {
                    title, description: 'React with the emojis below to assign yourself a role.',
                    channelId: message.channel.id, messageId: roleMessage.id,
                    color: DEFAULT_COLOR, image: null, roles: [],
                    mode: 'reaction',
                    createdBy: message.author.id, createdAt: Date.now()
                };
                saveConfig(config);

                message.reply({ components: [successContainer(`### <:Checkedbox:1521227734943269077> Panel Created\n**ID:** \`${roleMessage.id}\`\nAdd roles: \`-rr add ${roleMessage.id} @Role 🎮\``)], flags: MessageFlags.IsComponentsV2 });
            }

            else if (sub === 'add') {
                const messageId = args[1];
                const role = message.mentions.roles.first();
                const emoji = findEmojiInArgs(args.slice(2));
                if (!messageId || !role || !emoji) return message.reply({ components: [errorContainer('### <:Cancel:1521227723916181644> Usage\n`-rr add <msg-id> @Role <emoji>`')], flags: MessageFlags.IsComponentsV2 });

                const config = loadConfig();
                const panel = config[message.guild.id]?.[messageId];
                if (!panel) return message.reply({ components: [errorContainer('### <:Cancel:1521227723916181644> Panel Not Found')], flags: MessageFlags.IsComponentsV2 });

                const panelChannel = await message.client.channels.fetch(panel.channelId).catch(() => null);
                if (panelChannel && panel.mode !== 'button') {
                    const botPerms = panelChannel.permissionsFor(message.guild.members.me);
                    if (!botPerms?.has(['AddReactions', 'ReadMessageHistory'])) {
                        return message.reply({ components: [errorContainer(`### <:Cancel:1521227723916181644> Missing Permissions\nI need **Add Reactions** and **Read Message History** in <#${panel.channelId}>.`)], flags: MessageFlags.IsComponentsV2 });
                    }
                }

                if (panel.roles.some(r => r.roleId === role.id)) return message.reply({ components: [errorContainer(`### <:Cancel:1521227723916181644> Duplicate\n**${role.name}** already in panel.`)], flags: MessageFlags.IsComponentsV2 });
                if (panel.roles.some(r => r.emoji === emoji)) return message.reply({ components: [errorContainer(`### <:Cancel:1521227723916181644> Duplicate Emoji\n${emoji} already used.`)], flags: MessageFlags.IsComponentsV2 });
                if (panel.roles.length >= 20) return message.reply({ components: [errorContainer('### <:Cancel:1521227723916181644> Limit Reached')], flags: MessageFlags.IsComponentsV2 });

                const roleErr = this.validateRole({ guild: message.guild }, role);
                if (roleErr) return message.reply({ components: [roleErr], flags: MessageFlags.IsComponentsV2 });

                panel.roles.push({ roleId: role.id, emoji });
                saveConfig(config);
                await this.updatePanel(message.client, message.guild.id, messageId);
                message.reply({ components: [successContainer(`### <:Checkedbox:1521227734943269077> Added\n${emoji} → **${role.name}** (${panel.roles.length}/20)`)], flags: MessageFlags.IsComponentsV2 });
            }

            else if (sub === 'attach') {
                const messageId = args[1];
                const role = message.mentions.roles.first();
                const emoji = findEmojiInArgs(args.slice(2));
                if (!messageId || !role || !emoji) return message.reply({ components: [errorContainer('### <:Cancel:1521227723916181644> Usage\n`-rr attach <msg-id> @Role <emoji>`')], flags: MessageFlags.IsComponentsV2 });

                const roleErr = this.validateRole({ guild: message.guild }, role);
                if (roleErr) return message.reply({ components: [roleErr], flags: MessageFlags.IsComponentsV2 });

                const attachPerms = message.channel.permissionsFor(message.guild.members.me);
                if (!attachPerms?.has(['AddReactions', 'ReadMessageHistory'])) {
                    return message.reply({ components: [errorContainer(`### <:Cancel:1521227723916181644> Missing Permissions\nI need **Add Reactions** and **Read Message History** in this channel.`)], flags: MessageFlags.IsComponentsV2 });
                }

                const targetMsg = await message.channel.messages.fetch(messageId).catch(() => null);
                if (!targetMsg) return message.reply({ components: [errorContainer('### <:Cancel:1521227723916181644> Message Not Found')], flags: MessageFlags.IsComponentsV2 });

                const config = loadConfig();
                if (!config[message.guild.id]) config[message.guild.id] = {};

                if (!config[message.guild.id][messageId]) {
                    config[message.guild.id][messageId] = {
                        title: null, description: null, channelId: message.channel.id,
                        messageId, color: DEFAULT_COLOR, image: null, roles: [],
                        attachedTo: true, mode: 'reaction',
                        createdBy: message.author.id, createdAt: Date.now()
                    };
                }

                const panel = config[message.guild.id][messageId];
                if (panel.roles.some(r => r.roleId === role.id)) return message.reply({ components: [errorContainer('### <:Cancel:1521227723916181644> Already Attached')], flags: MessageFlags.IsComponentsV2 });
                if (panel.roles.some(r => r.emoji === emoji)) return message.reply({ components: [errorContainer('### <:Cancel:1521227723916181644> Emoji Already Used')], flags: MessageFlags.IsComponentsV2 });
                if (panel.roles.length >= 20) return message.reply({ components: [errorContainer('### <:Cancel:1521227723916181644> Limit Reached')], flags: MessageFlags.IsComponentsV2 });

                panel.roles.push({ roleId: role.id, emoji });
                saveConfig(config);

                await this.syncReactions(targetMsg, panel.roles);

                message.reply({ components: [successContainer(`### <:Checkedbox:1521227734943269077> Attached\n${emoji} → **${role.name}** (${panel.roles.length}/20)\n-# React with ${emoji} to get the role`)], flags: MessageFlags.IsComponentsV2 });
            }

            else if (sub === 'edit') {
                const messageId = args[1];
                const editType = args[2]?.toLowerCase();
                const editValue = args.slice(3).join(' ');
                if (!messageId || !editType || !editValue) return message.reply({ components: [errorContainer('### <:Cancel:1521227723916181644> Usage\n`-rr edit <msg-id> <color/title/description> <value>`')], flags: MessageFlags.IsComponentsV2 });

                const config = loadConfig();
                const panel = config[message.guild.id]?.[messageId];
                if (!panel) return message.reply({ components: [errorContainer('### <:Cancel:1521227723916181644> Panel Not Found')], flags: MessageFlags.IsComponentsV2 });

                if (panel.attachedTo) return message.reply({ components: [errorContainer('### <:Cancel:1521227723916181644> Cannot Edit\nAttached panels don\'t have an editable embed.')], flags: MessageFlags.IsComponentsV2 });

                if (editType === 'color') panel.color = parseColor(editValue);
                else if (editType === 'title') panel.title = editValue;
                else if (editType === 'description' || editType === 'desc') panel.description = editValue;
                else if (editType === 'image') panel.image = editValue.toLowerCase() === 'none' ? null : editValue;
                else return message.reply({ components: [errorContainer('### <:Cancel:1521227723916181644> Invalid Option\nOptions: `color`, `title`, `description`, `image`')], flags: MessageFlags.IsComponentsV2 });

                saveConfig(config);
                await this.updatePanel(message.client, message.guild.id, messageId);
                message.reply({ components: [successContainer(`### <:Checkedbox:1521227734943269077> Updated\n**${editType}** changed.`)], flags: MessageFlags.IsComponentsV2 });
            }

            else if (sub === 'remove') {
                const messageId = args[1]; const role = message.mentions.roles.first();
                if (!messageId || !role) return message.reply({ components: [errorContainer('### <:Cancel:1521227723916181644> Usage\n`-rr remove <msg-id> @Role`')], flags: MessageFlags.IsComponentsV2 });
                const config = loadConfig(); const panel = config[message.guild.id]?.[messageId];
                if (!panel) return message.reply({ components: [errorContainer('### <:Cancel:1521227723916181644> Panel Not Found')], flags: MessageFlags.IsComponentsV2 });
                const idx = panel.roles.findIndex(r => r.roleId === role.id);
                if (idx === -1) return message.reply({ components: [errorContainer(`### <:Cancel:1521227723916181644> Not Found\n**${role.name}** not in panel.`)], flags: MessageFlags.IsComponentsV2 });

                const removedEmoji = panel.roles[idx].emoji;
                panel.roles.splice(idx, 1); saveConfig(config);

                if (panel.mode !== 'button') {
                    const channel = await message.client.channels.fetch(panel.channelId).catch(() => null);
                    if (channel) {
                        const msg = await channel.messages.fetch(messageId).catch(() => null);
                        if (msg) await this.removeReaction(msg, removedEmoji);
                    }
                }

                await this.updatePanel(message.client, message.guild.id, messageId);
                message.reply({ components: [successContainer(`### <:Checkedbox:1521227734943269077> Removed\n**${role.name}** (${panel.roles.length}/20)`)], flags: MessageFlags.IsComponentsV2 });
            }

            else if (sub === 'delete') {
                const messageId = args[1];
                if (!messageId) return message.reply({ components: [errorContainer('### <:Cancel:1521227723916181644> Usage\n`-rr delete <msg-id>`')], flags: MessageFlags.IsComponentsV2 });
                const config = loadConfig(); const panel = config[message.guild.id]?.[messageId];
                if (!panel) return message.reply({ components: [errorContainer('### <:Cancel:1521227723916181644> Panel Not Found')], flags: MessageFlags.IsComponentsV2 });

                try {
                    const ch = await message.client.channels.fetch(panel.channelId).catch(() => null);
                    if (ch) {
                        const m = await ch.messages.fetch(messageId).catch(() => null);
                        if (m) {
                            if (panel.attachedTo) {
                                await m.reactions.removeAll().catch(() => {});
                            } else {
                                await m.delete().catch(() => {});
                            }
                        }
                    }
                } catch {}

                delete config[message.guild.id][messageId];
                if (config[message.guild.id] && Object.keys(config[message.guild.id]).length === 0) delete config[message.guild.id];
                saveConfig(config);
                message.reply({ components: [successContainer('### <:Trash:1521227750420254820> Panel Deleted')], flags: MessageFlags.IsComponentsV2 });
            }

            else if (sub === 'list') {
                const config = loadConfig();
                const guildPanels = config[message.guild.id] || {};
                if (Object.keys(guildPanels).length === 0) return message.reply({ components: [successContainer('### <:Document:1521227875016114266> No Panels\n`-rr setup` or `-rr create <title>` to get started')], flags: MessageFlags.IsComponentsV2 });

                let desc = '## <:Userplus:1521227719621218477> Panels\n\n';
                for (const [msgId, panel] of Object.entries(guildPanels)) {
                    const title = panel.title || (panel.attachedTo ? 'Attached' : 'Untitled');
                    const emojis = panel.roles.slice(0, 5).map(r => r.emoji).join(' ');
                    let entry = `**${title}** — <#${panel.channelId}>\n\`${msgId}\` • ${panel.roles.length} roles${panel.attachedTo ? ' • attached' : ''}\n`;
                    if (emojis) entry += `-# ${emojis}\n`;
                    entry += '\n';
                    if (desc.length + entry.length > 3900) { desc += '-# …more panels not shown\n'; break; }
                    desc += entry;
                }
                message.reply({ components: [successContainer(desc.trim())], flags: MessageFlags.IsComponentsV2 });
            }

            else {
                message.reply({ components: [errorContainer('### <:Cancel:1521227723916181644> Unknown Command\nTry: `setup`, `create`, `add`, `attach`, `edit`, `remove`, `delete`, `list`, `help`')], flags: MessageFlags.IsComponentsV2 });
            }
        } catch (error) {
            console.error('Reaction role prefix error:', error);
            message.reply({ components: [errorContainer('### <:Cancel:1521227723916181644> Error\nSomething went wrong.')], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }
    }
};
