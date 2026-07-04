const { SlashCommandBuilder, PermissionFlagsBits, ContainerBuilder, TextDisplayBuilder, MessageFlags, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ChannelType, ButtonBuilder, ButtonStyle, SeparatorBuilder, SeparatorSpacingSize } = require('discord.js');
const actionMsgBuilder = require('../../utils/actionMessageBuilder');
const { checkAndExpire } = require('../../utils/panelExpiration');

const jsonStore = require('../../utils/jsonStore');

function loadMenusConfig() {
    if (!jsonStore.has('select-menus')) {
        jsonStore.write('select-menus', {});
        return {};
    }
    try {
        return jsonStore.read('select-menus');
    } catch (e) {
        return {};
    }
}

function saveMenusConfig(config) {
    jsonStore.write('select-menus', config);
}

// Strip Discord-generated component IDs recursively (they cause edit rejections)
function stripComponentIds(component) {
    if (!component || typeof component !== 'object') return component;
    const obj = Array.isArray(component) ? [...component] : { ...component };
    if (!Array.isArray(obj)) delete obj.id;
    if (obj.components && Array.isArray(obj.components)) {
        obj.components = obj.components.map(c => stripComponentIds(c));
    }
    if (obj.accessory && typeof obj.accessory === 'object') {
        obj.accessory = stripComponentIds(obj.accessory);
    }
    return obj;
}

function createSelectMenuComponent(menuId, config, guildId) {
    const menuData = config[guildId]?.[menuId];
    if (!menuData || !menuData.options || menuData.options.length === 0) return null;

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`select_cmd_${guildId}_${menuId}`)
        .setPlaceholder(menuData.placeholder || 'Select an option...')
        .setMinValues(menuData.minValues || 1)
        .setMaxValues(menuData.maxValues || 1);

    for (const opt of menuData.options) {
        // Guard against Discord's limits: label/value 1–100 chars, description
        // 1–100 (or omitted). Empty or over-length strings throw "Invalid
        // string length", so clamp and only set a description when non-empty.
        const label = String(opt.label ?? '').slice(0, 100) || 'Option';
        const value = String(opt.value ?? '').slice(0, 100) || label;
        const option = new StringSelectMenuOptionBuilder()
            .setLabel(label)
            .setValue(value);

        const desc = String(opt.description ?? '').trim().slice(0, 100);
        if (desc) option.setDescription(desc);

        if (opt.emoji) option.setEmoji(opt.emoji);
        if (opt.default) option.setDefault(true);

        selectMenu.addOptions(option);
    }

    return new ActionRowBuilder().addComponents(selectMenu);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('select-menu-maker')
        .setDescription('Create and manage custom select menus with actions')
        .addSubcommand(sub => sub
            .setName('create')
            .setDescription('Create a new select menu')
            .addStringOption(opt => opt
                .setName('id')
                .setDescription('Unique menu ID (e.g., roles, colors, games)')
                .setRequired(true))
            .addStringOption(opt => opt
                .setName('placeholder')
                .setDescription('Placeholder text shown when nothing is selected')
                .setRequired(false))
            .addIntegerOption(opt => opt
                .setName('min-values')
                .setDescription('Minimum selections required (default: 1)')
                .setMinValue(0)
                .setMaxValue(25)
                .setRequired(false))
            .addIntegerOption(opt => opt
                .setName('max-values')
                .setDescription('Maximum selections allowed (default: 1)')
                .setMinValue(1)
                .setMaxValue(25)
                .setRequired(false))
            .addBooleanOption(opt => opt
                .setName('ephemeral')
                .setDescription('Make responses visible only to the user (default: true)')
                .setRequired(false)))
        .addSubcommand(sub => sub
            .setName('add-option')
            .setDescription('Add an option to a select menu')
            .addStringOption(opt => opt
                .setName('menu-id')
                .setDescription('The menu to add option to')
                .setRequired(true)
                .setAutocomplete(true))
            .addStringOption(opt => opt
                .setName('label')
                .setDescription('Option label (displayed to users)')
                .setRequired(true))
            .addStringOption(opt => opt
                .setName('value')
                .setDescription('Option value (unique identifier)')
                .setRequired(true))
            .addStringOption(opt => opt
                .setName('description')
                .setDescription('Option description')
                .setRequired(false))
            .addStringOption(opt => opt
                .setName('emoji')
                .setDescription('Option emoji')
                .setRequired(false)))
        .addSubcommand(sub => sub
            .setName('remove-option')
            .setDescription('Remove an option from a select menu')
            .addStringOption(opt => opt
                .setName('menu-id')
                .setDescription('The menu to remove option from')
                .setRequired(true)
                .setAutocomplete(true))
            .addStringOption(opt => opt
                .setName('value')
                .setDescription('Option value to remove')
                .setRequired(true)
                .setAutocomplete(true)))
        .addSubcommand(sub => sub
            .setName('edit-actions')
            .setDescription('Add or modify actions for a menu option')
            .addStringOption(opt => opt
                .setName('menu-id')
                .setDescription('The menu containing the option')
                .setRequired(true)
                .setAutocomplete(true))
            .addStringOption(opt => opt
                .setName('option-value')
                .setDescription('The option value to edit actions for')
                .setRequired(true)
                .setAutocomplete(true)))
        .addSubcommand(sub => sub
            .setName('send')
            .setDescription('Send a select menu to a channel')
            .addStringOption(opt => opt
                .setName('menu-id')
                .setDescription('Menu ID to send')
                .setRequired(true)
                .setAutocomplete(true))
            .addStringOption(opt => opt
                .setName('message')
                .setDescription('Message to display above the menu')
                .setRequired(false))
            .addChannelOption(opt => opt
                .setName('channel')
                .setDescription('Target channel (defaults to current)')
                .setRequired(false))
            .addBooleanOption(opt => opt
                .setName('container')
                .setDescription('Wrap menu inside a styled container (Components V2)')
                .setRequired(false))
            .addStringOption(opt => opt
                .setName('title')
                .setDescription('Container title (only works with container:true)')
                .setRequired(false))
            .addStringOption(opt => opt
                .setName('color')
                .setDescription('Container accent color hex (e.g. #5865F2, only with container:true)')
                .setRequired(false)))
        .addSubcommand(sub => sub
            .setName('attach')
            .setDescription('Attach a select menu to an existing bot message')
            .addStringOption(opt => opt
                .setName('message-id')
                .setDescription('Message ID to attach menu to')
                .setRequired(true))
            .addStringOption(opt => opt
                .setName('menu-id')
                .setDescription('Menu ID to attach')
                .setRequired(true)
                .setAutocomplete(true))
            .addChannelOption(opt => opt
                .setName('channel')
                .setDescription('Channel containing the message')
                .setRequired(false)))
        .addSubcommand(sub => sub
            .setName('list')
            .setDescription('View all created select menus'))
        .addSubcommand(sub => sub
            .setName('view')
            .setDescription('View detailed information for a single select menu')
            .addStringOption(opt => opt
                .setName('menu-id')
                .setDescription('Menu ID to view')
                .setRequired(true)
                .setAutocomplete(true)))
        .addSubcommand(sub => sub
            .setName('delete')
            .setDescription('Delete a select menu')
            .addStringOption(opt => opt
                .setName('menu-id')
                .setDescription('Menu ID to delete')
                .setRequired(true)
                .setAutocomplete(true)))
        .addSubcommand(sub => sub
            .setName('edit')
            .setDescription('Edit select menu settings')
            .addStringOption(opt => opt
                .setName('menu-id')
                .setDescription('Menu ID to edit')
                .setRequired(true)
                .setAutocomplete(true))
            .addStringOption(opt => opt
                .setName('placeholder')
                .setDescription('New placeholder text')
                .setRequired(false))
            .addIntegerOption(opt => opt
                .setName('min-values')
                .setDescription('New minimum selections')
                .setMinValue(0)
                .setMaxValue(25)
                .setRequired(false))
            .addIntegerOption(opt => opt
                .setName('max-values')
                .setDescription('New maximum selections')
                .setMinValue(1)
                .setMaxValue(25)
                .setRequired(false))
            .addBooleanOption(opt => opt
                .setName('ephemeral')
                .setDescription('Make responses ephemeral')
                .setRequired(false)))
        .addSubcommand(sub => sub
            .setName('help')
            .setDescription('View detailed guide on using select menu maker'))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    prefix: 'select-menu-maker',
    description: 'Create and manage custom select menus with actions',
    category: 'utility',
    aliases: ['selectmenu', 'menumaker', 'dropdown', 'select-maker'],
    usage: 'select-menu-maker <create/add-option/send/attach/list/delete/help>',

    async autocomplete(interaction) {
        const focusedOption = interaction.options.getFocused(true);
        const config = loadMenusConfig();
        const guildMenus = config[interaction.guild.id] || {};

        if (focusedOption.name === 'menu-id') {
            const choices = Object.keys(guildMenus).map(id => ({
                name: `${id} - ${guildMenus[id].placeholder || 'Select menu'}`,
                value: id
            }));
            const filtered = choices.filter(c => c.name.toLowerCase().includes(focusedOption.value.toLowerCase()));
            await interaction.respond(filtered.slice(0, 25));
        } else if (focusedOption.name === 'option-value' || focusedOption.name === 'value') {
            const menuId = interaction.options.getString('menu-id');
            const menuData = guildMenus[menuId];
            if (!menuData || !menuData.options) {
                return interaction.respond([]);
            }
            const choices = menuData.options.map(opt => ({
                name: `${opt.label} (${opt.value})`,
                value: opt.value
            }));
            const filtered = choices.filter(c => c.name.toLowerCase().includes(focusedOption.value.toLowerCase()));
            await interaction.respond(filtered.slice(0, 25));
        }
    },

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        switch (subcommand) {
            case 'create': return this.handleCreate(interaction);
            case 'add-option': return this.handleAddOption(interaction);
            case 'remove-option': return this.handleRemoveOption(interaction);
            case 'edit-actions': return this.handleEditActions(interaction);
            case 'send': return this.handleSend(interaction);
            case 'attach': return this.handleAttach(interaction);
            case 'list': return this.handleList(interaction);
            case 'view': return this.handleView(interaction);
            case 'delete': return this.handleDelete(interaction);
            case 'edit': return this.handleEdit(interaction);
            case 'help': return this.handleHelp(interaction);
        }
    },

    async handleCreate(interaction) {
        const menuId = interaction.options.getString('id').toLowerCase().replace(/\s+/g, '-');
        const placeholder = interaction.options.getString('placeholder') || 'Select an option...';
        const minValues = interaction.options.getInteger('min-values') ?? 1;
        const maxValues = interaction.options.getInteger('max-values') ?? 1;
        const ephemeral = interaction.options.getBoolean('ephemeral') ?? true;

        if (!/^[a-z0-9_-]{1,64}$/i.test(menuId)) {
            return interaction.reply({
                content: '<:Cancel:1521227723916181644> Menu ID must be 1–64 chars, only letters, numbers, underscore and dash.',
                flags: MessageFlags.Ephemeral,
            });
        }
        if (placeholder.length > 150) {
            return interaction.reply({
                content: '<:Cancel:1521227723916181644> Placeholder must be 150 characters or less (Discord limit).',
                flags: MessageFlags.Ephemeral,
            });
        }
        if (maxValues < minValues) {
            return interaction.reply({
                content: '<:Cancel:1521227723916181644> `max-values` must be greater than or equal to `min-values`.',
                flags: MessageFlags.Ephemeral,
            });
        }

        const config = loadMenusConfig();
        const guildId = interaction.guild.id;

        if (!config[guildId]) config[guildId] = {};

        if (config[guildId][menuId]) {
            return interaction.reply({
                content: '<:Cancel:1521227723916181644> A select menu with this ID already exists! Use `/select-menu-maker delete` first or choose a different ID.',
                flags: MessageFlags.Ephemeral
            });
        }

        config[guildId][menuId] = {
            placeholder,
            minValues,
            maxValues,
            ephemeral,
            options: [],
            uses: 0,
            createdAt: Date.now(),
            createdBy: interaction.user.id
        };

        saveMenusConfig(config);

        const container = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `# <:Checkedbox:1521227734943269077> Select Menu Created\n\n` +
                    `Your custom select menu has been created!\n\n` +
                    `### <:Document:1521227875016114266> Menu Details\n` +
                    `**ID:** \`${menuId}\`\n` +
                    `**Placeholder:** ${placeholder}\n` +
                    `**Min Selections:** ${minValues}\n` +
                    `**Max Selections:** ${maxValues}\n` +
                    `**Response:** ${ephemeral ? '<:Eye:1521227940480815156> Ephemeral' : '<:Bullhorn:1521227936575914016> Public'}\n\n` +
                    `### <:Settings:1521227767780343879> Next Steps\n` +
                    `**1.** Add options: \`/select-menu-maker add-option menu-id:${menuId}\`\n` +
                    `**2.** Add actions: \`/select-menu-maker edit-actions menu-id:${menuId}\`\n` +
                    `**3.** Send to channel: \`/select-menu-maker send menu-id:${menuId}\`\n\n` +
                    `### <:Bookmark:1521227835526742066> Available Actions\n` +
                    `• **Role Actions** - Add/Remove/Toggle roles\n` +
                    `• **Messages** - Send message or DM\n` +
                    `• **Tickets** - Create support tickets\n` +
                    `• **Channels** - Create new channels`
                )
            );

        return interaction.reply({
            components: [container],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
        });
    },

    async handleAddOption(interaction) {
        const menuId = interaction.options.getString('menu-id');
        const label = interaction.options.getString('label');
        const value = interaction.options.getString('value').toLowerCase().replace(/\s+/g, '-');
        const description = interaction.options.getString('description') || '';
        const emoji = interaction.options.getString('emoji');

        const config = loadMenusConfig();
        const guildId = interaction.guild.id;

        if (!config[guildId]?.[menuId]) {
            return interaction.reply({
                content: `<:Cancel:1521227723916181644> Menu \`${menuId}\` not found! Create it first with \`/select-menu-maker create\``,
                flags: MessageFlags.Ephemeral
            });
        }

        const menuData = config[guildId][menuId];

        if (menuData.options.length >= 25) {
            return interaction.reply({
                content: '<:Cancel:1521227723916181644> Select menus can only have up to 25 options!',
                flags: MessageFlags.Ephemeral
            });
        }

        if (menuData.options.some(o => o.value === value)) {
            return interaction.reply({
                content: `<:Cancel:1521227723916181644> An option with value \`${value}\` already exists!`,
                flags: MessageFlags.Ephemeral
            });
        }

        menuData.options.push({
            label,
            value,
            description,
            emoji: emoji || null,
            actions: []
        });

        saveMenusConfig(config);

        const container = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `# <:Checkedbox:1521227734943269077> Option Added\n\n` +
                    `**Menu:** \`${menuId}\`\n` +
                    `**Label:** ${label}\n` +
                    `**Value:** \`${value}\`\n` +
                    `${description ? `**Description:** ${description}\n` : ''}` +
                    `${emoji ? `**Emoji:** ${emoji}\n` : ''}\n` +
                    `**Total Options:** ${menuData.options.length}/25\n\n` +
                    `-# Use \`/select-menu-maker edit-actions\` to add actions to this option`
                )
            );

        return interaction.reply({
            components: [container],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
        });
    },

    async handleRemoveOption(interaction) {
        const menuId = interaction.options.getString('menu-id');
        const value = interaction.options.getString('value');

        const config = loadMenusConfig();
        const guildId = interaction.guild.id;

        if (!config[guildId]?.[menuId]) {
            return interaction.reply({
                content: `<:Cancel:1521227723916181644> Menu \`${menuId}\` not found!`,
                flags: MessageFlags.Ephemeral
            });
        }

        const menuData = config[guildId][menuId];
        const optionIndex = menuData.options.findIndex(o => o.value === value);

        if (optionIndex === -1) {
            return interaction.reply({
                content: `<:Cancel:1521227723916181644> Option with value \`${value}\` not found!`,
                flags: MessageFlags.Ephemeral
            });
        }

        const removed = menuData.options.splice(optionIndex, 1)[0];
        saveMenusConfig(config);

        return interaction.reply({
            content: `<:Checkedbox:1521227734943269077> Removed option **${removed.label}** (\`${removed.value}\`) from menu \`${menuId}\``,
            flags: MessageFlags.Ephemeral
        });
    },

    buildActionPanel(menuId, option, guildId) {
        const actionTypes = [
            { emoji: '<:Userplus:1521227719621218477>', label: 'Add Role', value: 'add_role', desc: 'Give a role when selected' },
            { emoji: '<:Trash:1521227750420254820>', label: 'Remove Role', value: 'remove_role', desc: 'Remove a role when selected' },
            { emoji: '<:History:1521227863079256278>', label: 'Toggle Role', value: 'toggle_role', desc: 'Toggle a role on/off' },
            { emoji: '<:Hashtag:1521227771957870604>', label: 'Send Message', value: 'send_message', desc: 'Send a message in a channel' },
            { emoji: '<:Editalt:1521227921673556019>', label: 'Send DM', value: 'send_dm', desc: 'Send a direct message' },
            { emoji: '🎫', label: 'Create Ticket', value: 'create_ticket', desc: 'Create a support ticket' },
            { emoji: '<:Folderopen:1521227986966417642>', label: 'Create Channel', value: 'create_channel', desc: 'Create a new channel' },
            { emoji: '<:Document:1521227875016114266>', label: 'Send Embed', value: 'send_embed', desc: 'Send a custom embed' }
        ];

        // Mirror button-maker's helpers so each action gets a friendly summary
        const actionEmojiOf = t => actionTypes.find(a => a.value === t)?.emoji || '<:Settings:1521227767780343879>';
        const describe = (a) => {
            switch (a.type) {
                case 'add_role':       return `Add role <@&${a.roleId}>`;
                case 'remove_role':    return `Remove role <@&${a.roleId}>`;
                case 'toggle_role':    return `Toggle role <@&${a.roleId}>`;
                case 'send_message':
                    if (a.mode === 'embed')      return `Send embed: "${(a.embed?.title || 'Custom Embed').slice(0, 30)}"`;
                    if (a.mode === 'components') return `Send V2 message`;
                    return `Send: "${(a.message || '').slice(0, 40)}${(a.message || '').length > 40 ? '…' : ''}"`;
                case 'send_dm':        return `DM: "${(a.message || '').slice(0, 40)}${(a.message || '').length > 40 ? '…' : ''}"`;
                case 'create_ticket':  return `Create ticket${a.categoryId ? ` in category` : ''}`;
                case 'create_channel': return `Create channel: ${a.channelName || 'new-channel'}`;
                case 'send_embed':     return `Send embed: ${a.title || 'Custom Embed'}`;
                default:               return a.type;
            }
        };

        let content = `# <:Bookmark:1521227835526742066> Edit Actions for Option\n\n`;
        content += `**Menu:** \`${menuId}\`\n`;
        content += `**Option:** ${option.label} (\`${option.value}\`)\n\n`;
        content += `### Current Actions (${option.actions?.length || 0})\n`;

        const actions = option.actions || [];
        if (actions.length > 0) {
            actions.forEach((action, i) => {
                content += `**${i + 1}.** ${actionEmojiOf(action.type)} ${describe(action)}\n`;
            });
        } else {
            content += `*No actions configured.*\n`;
        }

        content += `\n### <:Pin:1521227932625014916> Add Action\nSelect an action type to add:`;

        const actionMenu = new StringSelectMenuBuilder()
            .setCustomId(`select_action_add:${guildId}:${menuId}:${option.value}`)
            .setPlaceholder('Choose action type to add...')
            .addOptions(actionTypes.map(a =>
                new StringSelectMenuOptionBuilder()
                    .setLabel(a.label)
                    .setValue(a.value)
                    .setDescription(a.desc)
                    .setEmoji(a.emoji)
            ));

        const actionRow = new ActionRowBuilder().addComponents(actionMenu);

        const container = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
            .addActionRowComponents(actionRow);

        // Edit/delete rows for existing actions (max 5 buttons per row, max
        // 5 visible at once; users with >5 actions can still re-create them).
        if (actions.length > 0) {
            const editableTypes = new Set(['send_message']);
            const editable = actions
                .map((a, i) => ({ a, i }))
                .filter(({ a }) => editableTypes.has(a.type))
                .slice(0, 5);
            if (editable.length > 0) {
                const editRow = new ActionRowBuilder();
                for (const { i } of editable) {
                    editRow.addComponents(
                        new ButtonBuilder()
                            .setCustomId(`sel_edit_action:${guildId}:${menuId}:${option.value}:${i}`)
                            .setLabel(`Edit #${i + 1}`)
                            .setStyle(ButtonStyle.Secondary)
                            .setEmoji('<:Editalt:1521227921673556019>')
                    );
                }
                container.addActionRowComponents(editRow);
            }

            const delRow = new ActionRowBuilder();
            actions.slice(0, 5).forEach((a, i) => {
                delRow.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`sel_del_action:${guildId}:${menuId}:${option.value}:${i}`)
                        .setLabel(`Del #${i + 1}`)
                        .setStyle(ButtonStyle.Danger)
                        .setEmoji('<:Trash:1521227750420254820>')
                );
            });
            container.addActionRowComponents(delRow);
        }

        // Clear-all + done row, mirroring button-maker
        container.addActionRowComponents(new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`sel_clear_actions:${guildId}:${menuId}:${option.value}`)
                .setLabel('Clear All')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('<:Trash:1521227750420254820>'),
            new ButtonBuilder()
                .setCustomId(`sel_action_done:${guildId}:${menuId}:${option.value}`)
                .setLabel('Save & Exit')
                .setStyle(ButtonStyle.Success)
                .setEmoji('<:Checkedbox:1521227734943269077>'),
        ));

        return container;
    },

    async handleEditActions(interaction) {
        const menuId = interaction.options.getString('menu-id');
        const optionValue = interaction.options.getString('option-value');

        const config = loadMenusConfig();
        const guildId = interaction.guild.id;

        if (!config[guildId]?.[menuId]) {
            return interaction.reply({
                content: `<:Cancel:1521227723916181644> Menu \`${menuId}\` not found!`,
                flags: MessageFlags.Ephemeral
            });
        }

        const menuData = config[guildId][menuId];
        const option = menuData.options.find(o => o.value === optionValue);

        if (!option) {
            return interaction.reply({
                content: `<:Cancel:1521227723916181644> Option \`${optionValue}\` not found in menu \`${menuId}\`!`,
                flags: MessageFlags.Ephemeral
            });
        }

        const container = this.buildActionPanel(menuId, option, guildId);

        return interaction.reply({
            components: [container],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
        });
    },

    async handleSend(interaction) {
        const menuId = interaction.options.getString('menu-id');
        const message = interaction.options.getString('message');
        const channel = interaction.options.getChannel('channel') || interaction.channel;
        const useContainer = interaction.options.getBoolean('container') || false;
        const title = interaction.options.getString('title');
        const colorHex = interaction.options.getString('color');

        const config = loadMenusConfig();
        const guildId = interaction.guild.id;

        if (!config[guildId]?.[menuId]) {
            return interaction.reply({
                content: `<:Cancel:1521227723916181644> Menu \`${menuId}\` not found!`,
                flags: MessageFlags.Ephemeral
            });
        }

        const menuData = config[guildId][menuId];

        if (!menuData.options || menuData.options.length === 0) {
            return interaction.reply({
                content: `<:Cancel:1521227723916181644> Menu \`${menuId}\` has no options! Add some with \`/select-menu-maker add-option\``,
                flags: MessageFlags.Ephemeral
            });
        }

        // Preflight permissions on target channel
        const me = interaction.guild.members.me;
        const required = ['ViewChannel', 'SendMessages'];
        if (useContainer) required.push('EmbedLinks');
        const perms = channel.permissionsFor(me);
        const missing = required.filter(p => !perms?.has(p));
        if (missing.length) {
            return interaction.reply({
                content: `<:Cancel:1521227723916181644> I'm missing **${missing.join(', ')}** in ${channel}. Grant those and try again.`,
                flags: MessageFlags.Ephemeral
            });
        }

        const row = createSelectMenuComponent(menuId, config, guildId);
        if (!row) {
            return interaction.reply({
                content: '<:Cancel:1521227723916181644> Failed to create select menu component!',
                flags: MessageFlags.Ephemeral
            });
        }

        try {
            if (useContainer) {
                const accentColor = colorHex ? parseInt(colorHex.replace('#', ''), 16) || 0xCAD7E6 : 0xCAD7E6;
                const container = new ContainerBuilder().setAccentColor(accentColor);

                if (title || message) {
                    let textContent = '';
                    if (title) textContent += `# ${title}\n\n`;
                    if (message) textContent += message;
                    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(textContent.trim()));
                    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
                }

                container.addActionRowComponents(row);

                await channel.send({ components: [container], flags: MessageFlags.IsComponentsV2 });
            } else {
                await channel.send({
                    content: message || null,
                    components: [row]
                });
            }

            return interaction.reply({
                content: `<:Checkedbox:1521227734943269077> Select menu sent to ${channel}!${useContainer ? ' (inside container)' : ''}`,
                flags: MessageFlags.Ephemeral
            });
        } catch (error) {
            return interaction.reply({
                content: `<:Cancel:1521227723916181644> Failed to send menu: ${error.message}`,
                flags: MessageFlags.Ephemeral
            });
        }
    },

    async handleAttach(interaction) {
        const messageId = interaction.options.getString('message-id');
        const menuId = interaction.options.getString('menu-id');
        const channel = interaction.options.getChannel('channel') || interaction.channel;

        const config = loadMenusConfig();
        const guildId = interaction.guild.id;

        if (!config[guildId]?.[menuId]) {
            return interaction.reply({
                content: `<:Cancel:1521227723916181644> Menu \`${menuId}\` not found!`,
                flags: MessageFlags.Ephemeral
            });
        }

        const menuData = config[guildId][menuId];

        if (!menuData.options || menuData.options.length === 0) {
            return interaction.reply({
                content: `<:Cancel:1521227723916181644> Menu \`${menuId}\` has no options!`,
                flags: MessageFlags.Ephemeral
            });
        }

        let targetMessage;
        try {
            targetMessage = await channel.messages.fetch(messageId);
        } catch (error) {
            return interaction.reply({
                content: '<:Cancel:1521227723916181644> Message not found! Make sure the message ID is correct.',
                flags: MessageFlags.Ephemeral
            });
        }

        if (targetMessage.author.id !== interaction.client.user.id) {
            return interaction.reply({
                content: '<:Cancel:1521227723916181644> I can only attach menus to my own messages!',
                flags: MessageFlags.Ephemeral
            });
        }

        try {
            const newRow = createSelectMenuComponent(menuId, config, guildId);
            if (!newRow) {
                return interaction.reply({
                    content: '<:Cancel:1521227723916181644> Failed to create select menu component!',
                    flags: MessageFlags.Ephemeral
                });
            }
            const newRowData = stripComponentIds(newRow.toJSON());

            const isComponentsV2 = targetMessage.flags?.has(MessageFlags.IsComponentsV2) ||
                (targetMessage.components && targetMessage.components.some(c => {
                    const type = c.data?.type || c.type;
                    return type === 17 || type === 10 || type === 9 || type === 12 || type === 14;
                }));

            if (isComponentsV2) {
                // Get existing components and strip auto-generated IDs
                const existingComponents = targetMessage.components.map(c => {
                    const json = c.toJSON ? c.toJSON() : (c.data || c);
                    return stripComponentIds(json);
                });

                // Count total ActionRows (top-level AND inside containers)
                let totalRows = 0;
                for (const comp of existingComponents) {
                    if (comp.type === 1) totalRows++;
                    if (comp.type === 17 && comp.components) {
                        totalRows += comp.components.filter(ch => ch.type === 1).length;
                    }
                }

                if (totalRows >= 5) {
                    return interaction.reply({
                        content: '<:Cancel:1521227723916181644> Message already has maximum 5 action rows!',
                        flags: MessageFlags.Ephemeral
                    });
                }

                // Try to inject into the last Container for cleaner V2 display
                const lastContainerIndex = existingComponents.map((c, i) => c.type === 17 ? i : -1).filter(i => i !== -1).pop();
                if (lastContainerIndex !== undefined && lastContainerIndex >= 0) {
                    const container = existingComponents[lastContainerIndex];
                    if (!container.components) container.components = [];
                    container.components.push(newRowData);
                } else {
                    existingComponents.push(newRowData);
                }

                await targetMessage.edit({
                    components: existingComponents
                });
            } else {
                const existingRows = targetMessage.components.map(c => {
                    const json = c.toJSON ? c.toJSON() : (c.data || c);
                    return stripComponentIds(json);
                });
                
                if (existingRows.length >= 5) {
                    return interaction.reply({
                        content: '<:Cancel:1521227723916181644> Message already has maximum 5 action rows!',
                        flags: MessageFlags.Ephemeral
                    });
                }

                const editOptions = {
                    components: [...existingRows, newRowData]
                };

                // Preserve message content
                if (targetMessage.content) editOptions.content = targetMessage.content;

                // Preserve embeds (only rich embeds, skip auto-generated URL previews)
                if (targetMessage.embeds?.length > 0) {
                    editOptions.embeds = targetMessage.embeds
                        .filter(e => !e.data?.type || e.data?.type === 'rich')
                        .map(e => e.data || e.toJSON?.() || e);
                }

                await targetMessage.edit(editOptions);
            }

            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# <:Checkedbox:1521227734943269077> Select Menu Attached\n\n` +
                        `**Menu:** \`${menuId}\`\n` +
                        `**Message:** [View](${targetMessage.url})\n\n` +
                        `Original message content preserved.`
                    )
                );

            return interaction.reply({
                components: [container],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
            });
        } catch (error) {
            console.error('Select menu attach error:', error);
            return interaction.reply({
                content: `<:Cancel:1521227723916181644> Failed to attach menu: ${error.message}`,
                flags: MessageFlags.Ephemeral
            });
        }
    },

    async handleList(interaction) {
        const config = loadMenusConfig();
        const guildMenus = config[interaction.guild.id] || {};

        if (Object.keys(guildMenus).length === 0) {
            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# <:Document:1521227875016114266> No Select Menus Created\n\n` +
                        `You haven't created any select menus yet.\n\n` +
                        `### 🚀 Get Started\n` +
                        `\`/select-menu-maker create id:roles placeholder:Choose your roles\`\n\n` +
                        `### <:Lightbulbalt:1521227880703463675> Need Help?\n` +
                        `Use \`/select-menu-maker help\` for a complete guide.`
                    )
                );

            return interaction.reply({
                components: [container],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
            });
        }

        let content = `# <:Palette:1521227950601539755> Select Menu Manager\n\n`;
        content += `**Total Menus:** ${Object.keys(guildMenus).length}\n\n`;
        content += `### <:Document:1521227875016114266> Your Menus\n`;

        for (const [id, data] of Object.entries(guildMenus)) {
            const optionCount = data.options?.length || 0;
            content += `\n<:Folderopen:1521227986966417642> **\`${id}\`**\n`;
            content += `   • Placeholder: ${data.placeholder}\n`;
            content += `   • Options: ${optionCount}/25 | Min: ${data.minValues || 1} | Max: ${data.maxValues || 1}\n`;
        }

        content += `\n### <:Settings:1521227767780343879> Quick Actions\n`;
        content += `• \`/select-menu-maker add-option\` - Add options\n`;
        content += `• \`/select-menu-maker edit-actions\` - Configure actions\n`;
        content += `• \`/select-menu-maker send\` - Send to channel`;

        const container = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

        return interaction.reply({
            components: [container],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
        });
    },

    async handleDelete(interaction) {
        const menuId = interaction.options.getString('menu-id');

        const config = loadMenusConfig();
        const guildId = interaction.guild.id;

        if (!config[guildId]?.[menuId]) {
            return interaction.reply({
                content: `<:Cancel:1521227723916181644> Menu \`${menuId}\` not found!`,
                flags: MessageFlags.Ephemeral
            });
        }

        delete config[guildId][menuId];
        saveMenusConfig(config);

        return interaction.reply({
            content: `<:Checkedbox:1521227734943269077> Select menu \`${menuId}\` has been deleted!`,
            flags: MessageFlags.Ephemeral
        });
    },

    async handleView(interaction) {
        const menuId = interaction.options.getString('menu-id');
        const config = loadMenusConfig();
        const menuData = config[interaction.guild.id]?.[menuId];

        if (!menuData) {
            return interaction.reply({
                content: `<:Cancel:1521227723916181644> Menu \`${menuId}\` not found.`,
                flags: MessageFlags.Ephemeral,
            });
        }

        const created = menuData.createdAt ? `<t:${Math.floor(menuData.createdAt / 1000)}:R>` : 'unknown';
        const creator = menuData.createdBy ? `<@${menuData.createdBy}>` : 'unknown';

        let content = `# <:Document:1521227875016114266> Select Menu: \`${menuId}\`\n\n`;
        content += `### <:Settings:1521227767780343879> Configuration\n`;
        content += `<:Pin:1521227932625014916> **Placeholder:** ${menuData.placeholder}\n`;
        content += `<:Pin:1521227932625014916> **Min / Max:** ${menuData.minValues || 1} / ${menuData.maxValues || 1}\n`;
        content += `<:Pin:1521227932625014916> **Response:** ${menuData.ephemeral !== false ? 'Ephemeral (private)' : 'Public'}\n`;
        content += `<:Pin:1521227932625014916> **Created:** ${created} by ${creator}\n`;
        content += `<:Pin:1521227932625014916> **Total Uses:** \`${menuData.uses || 0}\`\n\n`;

        const options = menuData.options || [];
        content += `### <:Bookopen:1521227911137595605> Options (${options.length}/25)\n`;
        if (!options.length) {
            content += `*No options yet. Add some with* \`/select-menu-maker add-option\`.`;
        } else {
            options.forEach((opt, i) => {
                const actionCount = opt.actions?.length || 0;
                content += `**${i + 1}.** ${opt.emoji ? opt.emoji + ' ' : ''}**${opt.label}** \`${opt.value}\` — *${actionCount} action${actionCount === 1 ? '' : 's'}*\n`;
                if (opt.description) content += `> ${opt.description}\n`;
            });
        }

        const container = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

        return interaction.reply({
            components: [container],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        });
    },

    async handleEdit(interaction) {
        const menuId = interaction.options.getString('menu-id');
        const newPlaceholder = interaction.options.getString('placeholder');
        const newMinValues = interaction.options.getInteger('min-values');
        const newMaxValues = interaction.options.getInteger('max-values');
        const newEphemeral = interaction.options.getBoolean('ephemeral');

        const config = loadMenusConfig();
        const guildId = interaction.guild.id;

        if (!config[guildId]?.[menuId]) {
            return interaction.reply({
                content: `<:Cancel:1521227723916181644> Menu \`${menuId}\` not found!`,
                flags: MessageFlags.Ephemeral
            });
        }

        const menuData = config[guildId][menuId];
        const changes = [];

        if (newPlaceholder !== null) {
            menuData.placeholder = newPlaceholder;
            changes.push(`Placeholder → ${newPlaceholder}`);
        }
        if (newMinValues !== null) {
            menuData.minValues = newMinValues;
            changes.push(`Min Values → ${newMinValues}`);
        }
        if (newMaxValues !== null) {
            menuData.maxValues = newMaxValues;
            changes.push(`Max Values → ${newMaxValues}`);
        }
        if (newEphemeral !== null) {
            menuData.ephemeral = newEphemeral;
            changes.push(`Ephemeral → ${newEphemeral ? 'Yes' : 'No'}`);
        }

        if (changes.length === 0) {
            return interaction.reply({
                content: '<:Cancel:1521227723916181644> No changes specified! Provide at least one option to edit.',
                flags: MessageFlags.Ephemeral
            });
        }

        saveMenusConfig(config);

        return interaction.reply({
            content: `<:Checkedbox:1521227734943269077> Updated menu \`${menuId}\`:\n${changes.map(c => `• ${c}`).join('\n')}`,
            flags: MessageFlags.Ephemeral
        });
    },

    async handleHelp(interaction) {
        const container = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `# 📖 Select Menu Maker Guide\n\n` +
                    `Create interactive dropdown menus with custom actions!\n\n` +
                    `### <:Document:1521227875016114266> Workflow\n` +
                    `**1. Create Menu** → **2. Add Options** → **3. Add Actions** → **4. Send**\n\n` +
                    `### <:Settings:1521227767780343879> Commands\n` +
                    `\`/select-menu-maker create\` - Create a new menu\n` +
                    `\`/select-menu-maker add-option\` - Add an option to menu\n` +
                    `\`/select-menu-maker remove-option\` - Remove an option\n` +
                    `\`/select-menu-maker edit-actions\` - Configure option actions\n` +
                    `\`/select-menu-maker send\` - Send menu to channel\n` +
                    `\`/select-menu-maker attach\` - Attach to existing message\n` +
                    `\`/select-menu-maker edit\` - Edit menu settings\n` +
                    `\`/select-menu-maker list\` - View all menus\n` +
                    `\`/select-menu-maker delete\` - Delete a menu\n\n` +
                    `### <:Bookmark:1521227835526742066> Available Actions\n` +
                    `• **Add Role** - Give user a role\n` +
                    `• **Remove Role** - Remove a role from user\n` +
                    `• **Toggle Role** - Add if missing, remove if has\n` +
                    `• **Send Message** - Send a message in channel\n` +
                    `• **Send DM** - Direct message the user\n` +
                    `• **Create Ticket** - Create support ticket\n` +
                    `• **Create Channel** - Create a new channel\n` +
                    `• **Send Embed** - Send a custom embed\n\n` +
                    `### <:Lightbulbalt:1521227880703463675> Example: Role Selector\n` +
                    `\`\`\`\n` +
                    `/select-menu-maker create id:colors placeholder:Pick your color role\n` +
                    `/select-menu-maker add-option menu-id:colors label:Red value:red emoji:<:dnd:1521228070701502486>\n` +
                    `/select-menu-maker add-option menu-id:colors label:Blue value:blue emoji:🔵\n` +
                    `/select-menu-maker edit-actions menu-id:colors option-value:red\n` +
                    `/select-menu-maker send menu-id:colors\n` +
                    `\`\`\`\n\n` +
                    `### <:Edit:1521227886634205298> Variables in Messages\n` +
                    `• \`{user}\` - User's display name\n` +
                    `• \`{userId}\` - User's ID\n` +
                    `• \`{userMention}\` - Mentions the user\n` +
                    `• \`{server}\` - Server name\n` +
                    `• \`{membercount}\` - Total members`
                )
            );

        return interaction.reply({
            components: [container],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
        });
    },

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return message.reply('<:Cancel:1521227723916181644> You need **Manage Server** permission!');
        }

        const subcommand = args[0]?.toLowerCase();

        if (!subcommand || subcommand === 'help') {
            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# <:Palette:1521227950601539755> Select Menu Maker\n\n` +
                        `Create dropdown menus with custom actions.\n\n` +
                        `### <:Document:1521227875016114266> Slash Commands (Recommended)\n` +
                        `\`/select-menu-maker create\` - Create menu\n` +
                        `\`/select-menu-maker add-option\` - Add options\n` +
                        `\`/select-menu-maker edit-actions\` - Add actions\n` +
                        `\`/select-menu-maker send\` - Send to channel\n` +
                        `\`/select-menu-maker list\` - View all menus\n` +
                        `\`/select-menu-maker help\` - Full guide\n\n` +
                        `*Use slash commands for full functionality!*`
                    )
                );

            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (subcommand === 'list') {
            const config = loadMenusConfig();
            const guildMenus = config[message.guild.id] || {};

            if (Object.keys(guildMenus).length === 0) {
                return message.reply('<:Cancel:1521227723916181644> No select menus created yet!');
            }

            let content = `# <:Document:1521227875016114266> Your Select Menus\n\n`;
            for (const [id, data] of Object.entries(guildMenus)) {
                content += `<:Folderopen:1521227986966417642> **\`${id}\`** - ${data.options?.length || 0} options\n`;
            }

            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        return message.reply('<:Cancel:1521227723916181644> Use slash commands for full functionality: `/select-menu-maker`');
    },

    async handleInteraction(interaction) {
        const self = this;
        if (await checkAndExpire(interaction, 'builder')) return true;

        // Edit / delete / clear / done buttons spawned by buildActionPanel
        if (interaction.customId.startsWith('sel_edit_action:') ||
            interaction.customId.startsWith('sel_del_action:') ||
            interaction.customId.startsWith('sel_clear_actions:') ||
            interaction.customId.startsWith('sel_action_done:'))
        {
            const [head, ...rest] = interaction.customId.split(':');
            const guildId = rest[0];
            const menuId  = rest[1];
            const optionValue = rest[2];
            const idx = head === 'sel_edit_action' || head === 'sel_del_action' ? parseInt(rest[3], 10) : null;

            const config = loadMenusConfig();
            const menuData = config[guildId]?.[menuId];
            const option   = menuData?.options?.find(o => o.value === optionValue);
            if (!menuData || !option) {
                await interaction.reply({
                    content: '<:Cancel:1521227723916181644> Menu or option no longer exists.',
                    flags: MessageFlags.Ephemeral,
                });
                return true;
            }
            option.actions = option.actions || [];

            if (head === 'sel_clear_actions') {
                option.actions = [];
                saveMenusConfig(config);
                const container = self.buildActionPanel(menuId, option, guildId);
                await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
                return true;
            }

            if (head === 'sel_action_done') {
                const container = new ContainerBuilder()
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                        `# <:Checkedbox:1521227734943269077> Option Saved\n\n` +
                        `**Menu:** \`${menuId}\`\n` +
                        `**Option:** ${option.label}\n` +
                        `**Actions:** ${option.actions.length} configured`
                    ));
                await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
                return true;
            }

            if (head === 'sel_del_action') {
                if (Number.isInteger(idx) && option.actions[idx]) {
                    option.actions.splice(idx, 1);
                    saveMenusConfig(config);
                }
                const container = self.buildActionPanel(menuId, option, guildId);
                await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
                return true;
            }

            // sel_edit_action — open the message-builder pre-populated with
            // the saved data so the admin can tweak it.
            if (head === 'sel_edit_action') {
                const action = option.actions[idx];
                if (!action || action.type !== 'send_message') {
                    await interaction.reply({
                        content: '<:Cancel:1521227723916181644> Only send-message actions are editable inline.',
                        flags: MessageFlags.Ephemeral,
                    });
                    return true;
                }
                const context = `Menu: \`${menuId}\` Option: \`${optionValue}\` (edit action #${idx + 1})`;
                const sessionId = `${menuId}:${optionValue}`;
                const existing = {
                    mode: action.mode || 'simple',
                    content: action.message || action.content || '',
                    channelId: action.channelId || '',
                    title: action.embed?.title || '',
                    description: action.embed?.description || '',
                    color: action.embed?.color || action.color || '#bcf1e4',
                    image: action.embed?.image || action.image || '',
                    thumbnail: action.embed?.thumbnail || action.thumbnail || '',
                    author: action.embed?.author || '',
                    authorIcon: action.embed?.authorIcon || '',
                    footer: action.embed?.footer || action.footer || '',
                    footerIcon: action.embed?.footerIcon || '',
                    fields: action.embed?.fields || [],
                };
                const sessionKey = `${interaction.user.id}:select:${guildId}:${sessionId}`;
                actionMsgBuilder.messageBuilderSessions.set(sessionKey, existing);

                if (!global.selectEditActionIndex) global.selectEditActionIndex = new Map();
                global.selectEditActionIndex.set(`${interaction.user.id}:${guildId}:${menuId}:${optionValue}`, idx);

                const prefix = `selmsg:${guildId}:${menuId}:${optionValue}`;
                const container = actionMsgBuilder.buildMessageBuilderPanel(existing, prefix, context);
                await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
                return true;
            }
            return true;
        }

        if (interaction.customId.startsWith('selmsg:')) {
            const baseId = actionMsgBuilder.extractPrefixFromCustomId(interaction.customId);
            const parts = baseId.split(':');
            const guildId = parts[1];
            const menuId = parts[2];
            const optionValue = parts.slice(3).join(':');
            const prefix = `selmsg:${guildId}:${menuId}:${optionValue}`;
            const sessionId = `${menuId}:${optionValue}`;
            
            const handled = await actionMsgBuilder.handleButtonInteraction(
                interaction, prefix, 'select', guildId, sessionId,
                async (inter, data) => {
                    const config = loadMenusConfig();
                    if (!config[guildId]?.[menuId]) {
                        await inter.reply({ content: '<:Cancel:1521227723916181644> Menu not found!', flags: MessageFlags.Ephemeral });
                        return;
                    }
                    
                    const option = config[guildId][menuId].options?.find(o => o.value === optionValue);
                    if (!option) {
                        await inter.reply({ content: '<:Cancel:1521227723916181644> Option not found!', flags: MessageFlags.Ephemeral });
                        return;
                    }
                    
                    if (!option.actions) option.actions = [];
                    
                    const actionData = {
                        type: 'send_message',
                        mode: data.mode,
                        channelId: data.channelId || ''
                    };
                    
                    if (data.mode === 'embed') {
                        actionData.embed = {
                            title: data.title,
                            description: data.description,
                            color: data.color,
                            image: data.image,
                            thumbnail: data.thumbnail,
                            author: data.author,
                            authorIcon: data.authorIcon,
                            footer: data.footer,
                            footerIcon: data.footerIcon,
                            fields: data.fields || []
                        };
                    } else if (data.mode === 'components') {
                        actionData.content = data.content;
                        actionData.color = data.color;
                        actionData.image = data.image;
                        actionData.thumbnail = data.thumbnail;
                        actionData.footer = data.footer;
                    } else {
                        actionData.message = data.content;
                    }

                    // If we were editing an existing action (sel_edit_action),
                    // replace it in-place; otherwise append a fresh action.
                    const editKey = `${inter.user.id}:${guildId}:${menuId}:${optionValue}`;
                    const editIdx = global.selectEditActionIndex?.get(editKey);
                    if (Number.isInteger(editIdx) && option.actions[editIdx]) {
                        option.actions[editIdx] = actionData;
                        global.selectEditActionIndex.delete(editKey);
                    } else {
                        option.actions.push(actionData);
                    }
                    saveMenusConfig(config);
                    
                    const updatedOption = config[guildId][menuId].options.find(o => o.value === optionValue);
                    const container = self.buildActionPanel(menuId, updatedOption, guildId);
                    await inter.update({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
                },
                async (inter) => {
                    const config = loadMenusConfig();
                    const option = config[guildId]?.[menuId]?.options?.find(o => o.value === optionValue);
                    if (option) {
                        const container = self.buildActionPanel(menuId, option, guildId);
                        await inter.update({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
                    } else {
                        const cancelContainer = new ContainerBuilder()
                            .setAccentColor(0xED4245)
                            .addTextDisplayComponents(new TextDisplayBuilder().setContent('<:Cancel:1521227723916181644> Cancelled message builder.'));
                        await inter.update({ components: [cancelContainer], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
                    }
                }
            );
            return handled;
        }
        
        if (!interaction.customId.startsWith('select_action_add:')) return false;

        // Format: select_action_add:guildId:menuId:optionValue
        const parts = interaction.customId.replace('select_action_add:', '').split(':');
        const guildId = parts[0];
        const menuId = parts[1];
        const optionValue = parts.slice(2).join(':');

        if (interaction.isStringSelectMenu()) {
            const actionType = interaction.values[0];

            if (['add_role', 'remove_role', 'toggle_role'].includes(actionType)) {
                const modal = new ModalBuilder()
                    .setCustomId(`select_modal_role:${guildId}:${menuId}:${optionValue}:${actionType}`)
                    .setTitle('Configure Role Action');

                modal.addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('role_id')
                            .setLabel('Role ID')
                            .setStyle(TextInputStyle.Short)
                            .setPlaceholder('Right-click role → Copy ID')
                            .setRequired(true)
                    )
                );

                await interaction.showModal(modal);
                return true;
            }

            if (actionType === 'send_message') {
                const context = `Menu: \`${menuId}\` Option: \`${optionValue}\``;
                const sessionId = `${menuId}:${optionValue}`;
                const data = actionMsgBuilder.startMessageBuilderSession(interaction.user.id, 'select', guildId, sessionId, context);
                const prefix = `selmsg:${guildId}:${menuId}:${optionValue}`;
                const container = actionMsgBuilder.buildMessageBuilderPanel(data, prefix, context);
                await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
                return true;
            }

            if (actionType === 'send_dm') {
                const modal = new ModalBuilder()
                    .setCustomId(`select_modal_dm:${guildId}:${menuId}:${optionValue}`)
                    .setTitle('Configure DM Action');

                modal.addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('message')
                            .setLabel('DM Message')
                            .setStyle(TextInputStyle.Paragraph)
                            .setPlaceholder('Use {user}, {server}...')
                            .setRequired(true)
                    )
                );

                await interaction.showModal(modal);
                return true;
            }

            if (actionType === 'create_ticket') {
                const modal = new ModalBuilder()
                    .setCustomId(`select_modal_ticket:${guildId}:${menuId}:${optionValue}`)
                    .setTitle('Configure Ticket Action');

                modal.addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('ticket_name')
                            .setLabel('Ticket Channel Name')
                            .setStyle(TextInputStyle.Short)
                            .setPlaceholder('ticket-{user}')
                            .setValue('ticket-{user}')
                            .setRequired(true)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('category_id')
                            .setLabel('Category ID (optional)')
                            .setStyle(TextInputStyle.Short)
                            .setRequired(false)
                    )
                );

                await interaction.showModal(modal);
                return true;
            }

            if (actionType === 'send_embed') {
                const modal = new ModalBuilder()
                    .setCustomId(`select_modal_embed:${guildId}:${menuId}:${optionValue}`)
                    .setTitle('Configure Embed Action');

                modal.addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('title')
                            .setLabel('Embed Title')
                            .setStyle(TextInputStyle.Short)
                            .setRequired(true)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('description')
                            .setLabel('Embed Description')
                            .setStyle(TextInputStyle.Paragraph)
                            .setRequired(true)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('color')
                            .setLabel('Embed Color (hex)')
                            .setStyle(TextInputStyle.Short)
                            .setValue('#bcf1e4')
                            .setRequired(false)
                    )
                );

                await interaction.showModal(modal);
                return true;
            }

            if (actionType === 'create_channel') {
                const modal = new ModalBuilder()
                    .setCustomId(`select_modal_channel:${guildId}:${menuId}:${optionValue}`)
                    .setTitle('Configure Channel Action');

                modal.addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('channel_name')
                            .setLabel('Channel Name')
                            .setStyle(TextInputStyle.Short)
                            .setPlaceholder('e.g., {user}-channel')
                            .setRequired(true)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('category_id')
                            .setLabel('Category ID (optional)')
                            .setStyle(TextInputStyle.Short)
                            .setRequired(false)
                    )
                );

                await interaction.showModal(modal);
                return true;
            }
        }

        return false;
    },

    async handleModalSubmit(interaction) {
        if (interaction.customId.startsWith('selmsg:')) {
            const mainPart = interaction.customId.split('_modal_')[0];
            const parts = mainPart.split(':');
            const guildId = parts[1];
            const menuId = parts[2];
            const optionValue = parts.slice(3).join(':');
            const prefix = `selmsg:${guildId}:${menuId}:${optionValue}`;
            const sessionId = `${menuId}:${optionValue}`;
            
            const handled = await actionMsgBuilder.handleModalSubmit(interaction, prefix, 'select', guildId, sessionId);
            return handled;
        }
        
        if (!interaction.customId.startsWith('select_modal_')) return false;

        const fullId = interaction.customId.replace('select_modal_', '');
        const config = loadMenusConfig();

        // Format: role:guildId:menuId:optionValue:actionType
        if (fullId.startsWith('role:')) {
            const parts = fullId.replace('role:', '').split(':');
            const guildId = parts[0];
            const menuId = parts[1];
            const actionType = parts[parts.length - 1];
            const optionValue = parts.slice(2, -1).join(':');

            const roleId = interaction.fields.getTextInputValue('role_id');

            if (!config[guildId]?.[menuId]) {
                return interaction.reply({ content: '<:Cancel:1521227723916181644> Menu not found!', flags: MessageFlags.Ephemeral });
            }

            const option = config[guildId][menuId].options.find(o => o.value === optionValue);
            if (!option) {
                return interaction.reply({ content: '<:Cancel:1521227723916181644> Option not found!', flags: MessageFlags.Ephemeral });
            }

            if (!option.actions) option.actions = [];
            option.actions.push({ type: actionType, roleId });
            saveMenusConfig(config);

            const container = this.buildActionPanel(menuId, option, guildId);
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            return true;
        }

        // Format: dm:guildId:menuId:optionValue
        if (fullId.startsWith('dm:')) {
            const parts = fullId.replace('dm:', '').split(':');
            const guildId = parts[0];
            const menuId = parts[1];
            const optionValue = parts.slice(2).join(':');

            const message = interaction.fields.getTextInputValue('message');

            if (!config[guildId]?.[menuId]) {
                return interaction.reply({ content: '<:Cancel:1521227723916181644> Menu not found!', flags: MessageFlags.Ephemeral });
            }

            const option = config[guildId][menuId].options.find(o => o.value === optionValue);
            if (!option) {
                return interaction.reply({ content: '<:Cancel:1521227723916181644> Option not found!', flags: MessageFlags.Ephemeral });
            }

            if (!option.actions) option.actions = [];
            option.actions.push({ type: 'send_dm', message });
            saveMenusConfig(config);

            const container = this.buildActionPanel(menuId, option, guildId);
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            return true;
        }

        // Format: ticket:guildId:menuId:optionValue
        if (fullId.startsWith('ticket:')) {
            const parts = fullId.replace('ticket:', '').split(':');
            const guildId = parts[0];
            const menuId = parts[1];
            const optionValue = parts.slice(2).join(':');

            const ticketName = interaction.fields.getTextInputValue('ticket_name');
            const categoryId = interaction.fields.getTextInputValue('category_id') || null;

            if (!config[guildId]?.[menuId]) {
                return interaction.reply({ content: '<:Cancel:1521227723916181644> Menu not found!', flags: MessageFlags.Ephemeral });
            }

            const option = config[guildId][menuId].options.find(o => o.value === optionValue);
            if (!option) {
                return interaction.reply({ content: '<:Cancel:1521227723916181644> Option not found!', flags: MessageFlags.Ephemeral });
            }

            if (!option.actions) option.actions = [];
            option.actions.push({ type: 'create_ticket', ticketName, categoryId });
            saveMenusConfig(config);

            const container = this.buildActionPanel(menuId, option, guildId);
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            return true;
        }

        // Format: embed:guildId:menuId:optionValue
        if (fullId.startsWith('embed:')) {
            const parts = fullId.replace('embed:', '').split(':');
            const guildId = parts[0];
            const menuId = parts[1];
            const optionValue = parts.slice(2).join(':');

            const title = interaction.fields.getTextInputValue('title');
            const description = interaction.fields.getTextInputValue('description');
            const color = interaction.fields.getTextInputValue('color') || '#bcf1e4';

            if (!config[guildId]?.[menuId]) {
                return interaction.reply({ content: '<:Cancel:1521227723916181644> Menu not found!', flags: MessageFlags.Ephemeral });
            }

            const option = config[guildId][menuId].options.find(o => o.value === optionValue);
            if (!option) {
                return interaction.reply({ content: '<:Cancel:1521227723916181644> Option not found!', flags: MessageFlags.Ephemeral });
            }

            if (!option.actions) option.actions = [];
            option.actions.push({ type: 'send_embed', title, description, color, channelId: null });
            saveMenusConfig(config);

            const container = this.buildActionPanel(menuId, option, guildId);
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            return true;
        }

        // Format: channel:guildId:menuId:optionValue
        if (fullId.startsWith('channel:')) {
            const parts = fullId.replace('channel:', '').split(':');
            const guildId = parts[0];
            const menuId = parts[1];
            const optionValue = parts.slice(2).join(':');

            const channelName = interaction.fields.getTextInputValue('channel_name');
            const categoryId = interaction.fields.getTextInputValue('category_id') || null;

            if (!config[guildId]?.[menuId]) {
                return interaction.reply({ content: '<:Cancel:1521227723916181644> Menu not found!', flags: MessageFlags.Ephemeral });
            }

            const option = config[guildId][menuId].options.find(o => o.value === optionValue);
            if (!option) {
                return interaction.reply({ content: '<:Cancel:1521227723916181644> Option not found!', flags: MessageFlags.Ephemeral });
            }

            if (!option.actions) option.actions = [];
            option.actions.push({ type: 'create_channel', channelName, categoryId });
            saveMenusConfig(config);

            const container = this.buildActionPanel(menuId, option, guildId);
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            return true;
        }

        return false;
    }
};
