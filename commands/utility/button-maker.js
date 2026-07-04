const { SlashCommandBuilder, PermissionFlagsBits, ContainerBuilder, TextDisplayBuilder, MessageFlags, ButtonBuilder, ButtonStyle, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder, SeparatorBuilder, SeparatorSpacingSize } = require('discord.js');
const actionMsgBuilder = require('../../utils/actionMessageBuilder');
const { checkAndExpire } = require('../../utils/panelExpiration');

const jsonStore = require('../../utils/jsonStore');

function loadButtonsConfig() {
    if (!jsonStore.has('button-commands')) {
        jsonStore.write('button-commands', {});
        return {};
    }
    return jsonStore.read('button-commands');
}

function saveButtonsConfig(config) {
    jsonStore.write('button-commands', config);
}

function getButtonStyle(style) {
    const styles = {
        'primary': ButtonStyle.Primary,
        'secondary': ButtonStyle.Secondary,
        'success': ButtonStyle.Success,
        'danger': ButtonStyle.Danger,
        'link': ButtonStyle.Link
    };
    return styles[style] || ButtonStyle.Primary;
}

function createButtonComponents(buttonIds, config, guildId) {
    const rows = [];
    let currentRow = new ActionRowBuilder();
    let buttonCount = 0;

    for (const buttonId of buttonIds) {
        const btnData = config[guildId][buttonId];
        if (!btnData) continue;

        const button = new ButtonBuilder()
            .setLabel(btnData.label)
            .setStyle(getButtonStyle(btnData.style));

        if (btnData.style === 'link') {
            button.setURL(btnData.url);
        } else {
            button.setCustomId(`btn_cmd_${guildId}_${buttonId}`);
        }

        if (btnData.emoji) button.setEmoji(btnData.emoji);

        currentRow.addComponents(button);
        buttonCount++;

        if (buttonCount === 5) {
            rows.push(currentRow);
            currentRow = new ActionRowBuilder();
            buttonCount = 0;
        }
    }

    if (buttonCount > 0) rows.push(currentRow);
    return rows;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('button-maker')
        .setDescription('Create and manage custom interactive buttons with actions')
        .addSubcommand(subcommand =>
            subcommand
                .setName('create')
                .setDescription('Create a new custom button')
                .addStringOption(option =>
                    option.setName('id')
                        .setDescription('Unique button ID (e.g., verify, support, rules)')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('label')
                        .setDescription('Button text displayed to users')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('style')
                        .setDescription('Button color/style')
                        .setRequired(true)
                        .addChoices(
                            { name: '🔵 Primary (Blue)', value: 'primary' },
                            { name: '⚪ Secondary (Gray)', value: 'secondary' },
                            { name: '🟢 Success (Green)', value: 'success' },
                            { name: '🔴 Danger (Red)', value: 'danger' },
                            { name: '🔗 Link (URL Redirect)', value: 'link' }
                        ))
                .addStringOption(option =>
                    option.setName('emoji')
                        .setDescription('Button emoji (optional, e.g., <:Checkedbox:1521227734943269077> or :emoji:)')
                        .setRequired(false))
                .addStringOption(option =>
                    option.setName('url')
                        .setDescription('URL for link buttons (required if style is Link)')
                        .setRequired(false))
                .addBooleanOption(option =>
                    option.setName('ephemeral')
                        .setDescription('Private response only clicker can see? True=private, False=public (default: true)')
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('send')
                .setDescription('Send buttons to a channel')
                .addStringOption(option =>
                    option.setName('button-ids')
                        .setDescription('Button IDs to send (comma separated, e.g., verify,support)')
                        .setRequired(true)
                        .setAutocomplete(true))
                .addStringOption(option =>
                    option.setName('message')
                        .setDescription('Message to display above the buttons')
                        .setRequired(false))
                .addChannelOption(option =>
                    option.setName('channel')
                        .setDescription('Target channel (defaults to current)')
                        .setRequired(false))
                .addBooleanOption(option =>
                    option.setName('container')
                        .setDescription('Wrap buttons inside a styled container (Components V2)')
                        .setRequired(false))
                .addStringOption(option =>
                    option.setName('title')
                        .setDescription('Container title (only works with container:true)')
                        .setRequired(false))
                .addStringOption(option =>
                    option.setName('color')
                        .setDescription('Container accent color hex (e.g. #5865F2, only with container:true)')
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('attach')
                .setDescription('Attach buttons to an existing bot message')
                .addStringOption(option =>
                    option.setName('message-id')
                        .setDescription('Message ID to attach buttons to')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('button-ids')
                        .setDescription('Button IDs to attach (comma separated)')
                        .setRequired(true)
                        .setAutocomplete(true))
                .addChannelOption(option =>
                    option.setName('channel')
                        .setDescription('Channel containing the message')
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('View all created buttons and their configurations'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('view')
                .setDescription('View detailed information for a single button')
                .addStringOption(option =>
                    option.setName('id')
                        .setDescription('Button ID to view')
                        .setRequired(true)
                        .setAutocomplete(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('clone')
                .setDescription('Duplicate an existing button under a new ID')
                .addStringOption(option =>
                    option.setName('source')
                        .setDescription('Source button ID')
                        .setRequired(true)
                        .setAutocomplete(true))
                .addStringOption(option =>
                    option.setName('new-id')
                        .setDescription('New button ID')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('delete')
                .setDescription('Delete a button permanently')
                .addStringOption(option =>
                    option.setName('id')
                        .setDescription('Button ID to delete')
                        .setRequired(true)
                        .setAutocomplete(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('edit-actions')
                .setDescription('Add or modify actions for a button')
                .addStringOption(option =>
                    option.setName('id')
                        .setDescription('Button ID to edit')
                        .setRequired(true)
                        .setAutocomplete(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('edit')
                .setDescription('Edit an existing button')
                .addStringOption(option =>
                    option.setName('id')
                        .setDescription('Button ID to edit')
                        .setRequired(true)
                        .setAutocomplete(true))
                .addStringOption(option =>
                    option.setName('label')
                        .setDescription('New button label')
                        .setRequired(false))
                .addStringOption(option =>
                    option.setName('style')
                        .setDescription('New button style')
                        .setRequired(false)
                        .addChoices(
                            { name: '🔵 Primary (Blue)', value: 'primary' },
                            { name: '⚪ Secondary (Gray)', value: 'secondary' },
                            { name: '🟢 Success (Green)', value: 'success' },
                            { name: '🔴 Danger (Red)', value: 'danger' },
                            { name: '🔗 Link (URL Redirect)', value: 'link' }
                        ))
                .addStringOption(option =>
                    option.setName('emoji')
                        .setDescription('New button emoji (use "none" to remove)')
                        .setRequired(false))
                .addStringOption(option =>
                    option.setName('url')
                        .setDescription('New URL for link buttons')
                        .setRequired(false))
                .addBooleanOption(option =>
                    option.setName('ephemeral')
                        .setDescription('Private response only clicker can see? True=private, False=public')
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('help')
                .setDescription('View detailed guide on how to use the button maker'))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    prefix: 'button-maker',
    description: 'Create and manage custom interactive buttons with actions',
    category: 'utility',
    aliases: ['buttonmaker', 'btn-maker', 'buttons'],
    usage: 'button-maker <create/send/attach/list/delete/edit-actions/help>',

    async autocomplete(interaction) {
        const focusedOption = interaction.options.getFocused(true);
        const config = loadButtonsConfig();
        const guildButtons = config[interaction.guild.id] || {};
        const allIds = Object.keys(guildButtons);

        // For comma-separated `button-ids`, autocomplete the LAST token so the
        // admin can build "verify,support,rules" without retyping each piece.
        if (focusedOption.name === 'button-ids') {
            const raw = focusedOption.value || '';
            const tokens = raw.split(',');
            const lastToken = (tokens.pop() || '').trim().toLowerCase();
            const prefix = tokens.map(t => t.trim()).filter(Boolean).join(',');
            const prefixWithComma = prefix ? `${prefix},` : '';

            const filtered = allIds
                .filter(id => id.toLowerCase().includes(lastToken))
                .map(id => {
                    const candidate = `${prefixWithComma}${id}`;
                    return {
                        name: candidate.length > 100 ? candidate.slice(0, 97) + '…' : candidate,
                        value: candidate.length > 100 ? candidate.slice(0, 100) : candidate,
                    };
                });
            return interaction.respond(filtered.slice(0, 25));
        }

        // The `new-id` field on /clone is a fresh name — don't suggest existing IDs.
        if (focusedOption.name === 'new-id') {
            return interaction.respond([]);
        }

        // Default: single-id autocomplete (for delete / edit / edit-actions / view / clone source)
        const choices = allIds.map(id => ({
            name: `${id} - ${guildButtons[id].label}`.slice(0, 100),
            value: id,
        }));

        const filtered = choices.filter(choice =>
            choice.name.toLowerCase().includes(focusedOption.value.toLowerCase())
        );

        await interaction.respond(filtered.slice(0, 25));
    },

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'create') {
            await this.handleCreate(interaction);
        } else if (subcommand === 'send') {
            await this.handleSend(interaction);
        } else if (subcommand === 'attach') {
            await this.handleAttach(interaction);
        } else if (subcommand === 'list') {
            await this.handleList(interaction);
        } else if (subcommand === 'view') {
            await this.handleView(interaction);
        } else if (subcommand === 'clone') {
            await this.handleClone(interaction);
        } else if (subcommand === 'delete') {
            await this.handleDelete(interaction);
        } else if (subcommand === 'edit-actions') {
            await this.handleEditActions(interaction);
        } else if (subcommand === 'edit') {
            await this.handleEdit(interaction);
        } else if (subcommand === 'help') {
            await this.handleHelp(interaction);
        }
    },

    async handleCreate(interaction) {
        const buttonId = interaction.options.getString('id');
        const label = interaction.options.getString('label');
        const style = interaction.options.getString('style');
        const emoji = interaction.options.getString('emoji');
        const url = interaction.options.getString('url');
        const ephemeral = interaction.options.getBoolean('ephemeral') ?? true;

        // Validate button id — Discord custom_id has a 100-char limit and we
        // already prepend "btn_cmd_<guildId>_" (~30 chars) so cap user-supplied
        // IDs at 64 chars. Also lock characters to safe set.
        if (!/^[a-z0-9_-]{1,64}$/i.test(buttonId)) {
            return interaction.reply({
                content: '<:Cancel:1521227723916181644> Button ID must be 1–64 chars, only letters, numbers, underscore and dash.',
                flags: MessageFlags.Ephemeral
            });
        }
        if (label.length > 80) {
            return interaction.reply({
                content: '<:Cancel:1521227723916181644> Button label must be 80 characters or less (Discord limit).',
                flags: MessageFlags.Ephemeral
            });
        }

        const config = loadButtonsConfig();
        const guildId = interaction.guild.id;

        if (!config[guildId]) config[guildId] = {};

        if (config[guildId][buttonId]) {
            return interaction.reply({
                content: '<:Cancel:1521227723916181644> A button with this ID already exists! Use `/button-maker delete` first or choose a different ID.',
                flags: MessageFlags.Ephemeral
            });
        }

        if (style === 'link' && !url) {
            return interaction.reply({
                content: '<:Cancel:1521227723916181644> Link-style buttons require a URL! Add the `url` option.',
                flags: MessageFlags.Ephemeral
            });
        }

        if (style === 'link' && url && !url.startsWith('http://') && !url.startsWith('https://')) {
            return interaction.reply({
                content: '<:Cancel:1521227723916181644> URL must start with `http://` or `https://`',
                flags: MessageFlags.Ephemeral
            });
        }

        config[guildId][buttonId] = {
            label: label,
            style: style,
            emoji: emoji || null,
            url: url || null,
            ephemeral: ephemeral,
            actions: [],
            createdAt: Date.now(),
            createdBy: interaction.user.id,
            uses: 0,
        };

        saveButtonsConfig(config);

        const styleEmoji = { primary: '🔵', secondary: '⚪', success: '🟢', danger: '🔴', link: '🔗' }[style];

        const container = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder()
                    .setContent(
                        `# <:Checkedbox:1521227734943269077> Button Created Successfully\n\n` +
                        `Your custom button has been created and is ready to use!\n\n` +
                        `### <:Document:1521227875016114266> Button Details\n` +
                        `**ID:** \`${buttonId}\`\n` +
                        `**Label:** ${label}\n` +
                        `**Style:** ${styleEmoji} ${style.charAt(0).toUpperCase() + style.slice(1)}\n` +
                        `${emoji ? `**Emoji:** ${emoji}\n` : ''}` +
                        `${url ? `**URL:** ${url}\n` : ''}` +
                        `**Response:** ${ephemeral ? '<:Eye:1521227940480815156> Ephemeral (only visible to clicker)' : '<:Bullhorn:1521227936575914016> Public (visible to everyone)'}\n\n` +
                        `### <:Settings:1521227767780343879> Next Steps\n` +
                        `${style === 'link' ? 
                            `*Link buttons redirect users to the URL when clicked.*\n\nUse \`/button-maker send\` to add the button to a channel.` : 
                            `**1.** Add actions: \`/button-maker edit-actions id:${buttonId}\`\n` +
                            `**2.** Send to channel: \`/button-maker send button-ids:${buttonId}\`\n\n` +
                            `### <:Bookmark:1521227835526742066> Available Actions\n` +
                            `• **Role Actions** - Add/Remove/Toggle roles\n` +
                            `• **Messages** - Send message or DM\n` +
                            `• **Tickets** - Create support tickets\n` +
                            `• **Moderation** - Kick/Ban/Timeout users\n` +
                            `• **Channels** - Create new channels`
                        }`
                    )
            );

        return interaction.reply({
            components: [container],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
        });
    },

    async handleSend(interaction) {
        const buttonIdsInput = interaction.options.getString('button-ids');
        const message = interaction.options.getString('message');
        const channel = interaction.options.getChannel('channel') || interaction.channel;
        const useContainer = interaction.options.getBoolean('container') || false;
        const title = interaction.options.getString('title');
        const colorHex = interaction.options.getString('color');

        const buttonIds = buttonIdsInput.split(',').map(id => id.trim()).filter(Boolean);
        const config = loadButtonsConfig();
        const guildId = interaction.guild.id;

        if (!config[guildId]) {
            return interaction.reply({
                content: '<:Cancel:1521227723916181644> No buttons configured for this server! Create one with `/button-maker create`',
                flags: MessageFlags.Ephemeral
            });
        }

        if (!buttonIds.length) {
            return interaction.reply({
                content: '<:Cancel:1521227723916181644> Please provide at least one button ID.',
                flags: MessageFlags.Ephemeral
            });
        }

        const missingButtons = buttonIds.filter(id => !config[guildId][id]);
        if (missingButtons.length > 0) {
            return interaction.reply({
                content: `<:Cancel:1521227723916181644> Button(s) not found: \`${missingButtons.join(', ')}\`\n\nUse \`/button-maker list\` to see available buttons.`,
                flags: MessageFlags.Ephemeral
            });
        }

        // Preflight permission check so we don't show a generic Discord error
        const me = interaction.guild.members.me;
        const required = ['ViewChannel', 'SendMessages'];
        if (useContainer) required.push('EmbedLinks');
        const perms = channel.permissionsFor(me);
        const missingPerms = required.filter(p => !perms?.has(p));
        if (missingPerms.length) {
            return interaction.reply({
                content: `<:Cancel:1521227723916181644> I'm missing **${missingPerms.join(', ')}** in ${channel}. Grant those and try again.`,
                flags: MessageFlags.Ephemeral
            });
        }

        const rows = createButtonComponents(buttonIds, config, guildId);
        if (!rows.length) {
            return interaction.reply({
                content: '<:Cancel:1521227723916181644> No valid buttons to send.',
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

                for (const row of rows) {
                    container.addActionRowComponents(row);
                }

                await channel.send({ components: [container], flags: MessageFlags.IsComponentsV2 });
            } else {
                await channel.send({
                    content: message || null,
                    components: rows
                });
            }

            return interaction.reply({
                content: `<:Checkedbox:1521227734943269077> Buttons sent to ${channel}!${useContainer ? ' (inside container)' : ''}`,
                flags: MessageFlags.Ephemeral
            });
        } catch (error) {
            return interaction.reply({
                content: `<:Cancel:1521227723916181644> Failed to send buttons to ${channel}. ${error.message}`,
                flags: MessageFlags.Ephemeral
            });
        }
    },

    async handleAttach(interaction) {
        const messageId = interaction.options.getString('message-id');
        const buttonIdsInput = interaction.options.getString('button-ids');
        const channel = interaction.options.getChannel('channel') || interaction.channel;

        const buttonIds = buttonIdsInput.split(',').map(id => id.trim());
        const config = loadButtonsConfig();
        const guildId = interaction.guild.id;

        if (!config[guildId]) {
            return interaction.reply({
                content: '<:Cancel:1521227723916181644> No buttons configured for this server!',
                flags: MessageFlags.Ephemeral
            });
        }

        const missingButtons = buttonIds.filter(id => !config[guildId][id]);
        if (missingButtons.length > 0) {
            return interaction.reply({
                content: `<:Cancel:1521227723916181644> Button(s) not found: \`${missingButtons.join(', ')}\`\n\nUse \`/button-maker list\` to see available buttons.`,
                flags: MessageFlags.Ephemeral
            });
        }

        let targetMessage;
        try {
            targetMessage = await channel.messages.fetch(messageId);
        } catch (error) {
            return interaction.reply({
                content: '<:Cancel:1521227723916181644> Message not found in that channel! Make sure the message ID is correct.',
                flags: MessageFlags.Ephemeral
            });
        }

        const rows = createButtonComponents(buttonIds, config, guildId);

        if (targetMessage.author.id === interaction.client.user.id) {
            try {
                // Check if this is a Components V2 message (has containers, text displays, etc.)
                const isComponentsV2 = targetMessage.flags?.has(MessageFlags.IsComponentsV2) || 
                    (targetMessage.components && targetMessage.components.some(c => 
                        c.type === 17 || // Container
                        c.type === 10 || // TextDisplay
                        c.type === 9 ||  // Section
                        c.type === 12 || // MediaGallery
                        c.type === 14    // Separator
                    ));
                
                if (isComponentsV2) {
                    // For Components V2 messages, preserve existing components and add/merge button rows
                    const existingComponents = targetMessage.components.map(c => {
                        // Return the raw component data
                        if (c.toJSON) return c.toJSON();
                        return c;
                    });
                    
                    // Separate V2 components and existing action rows (buttons)
                    const v2Components = existingComponents.filter(c => c.type !== 1); // type 1 = ActionRow
                    const existingActionRows = existingComponents.filter(c => c.type === 1);
                    
                    // Merge existing action rows with new button rows
                    const newButtonRows = rows.map(r => r.toJSON ? r.toJSON() : r);
                    
                    // Add new buttons to existing rows or create new rows (max 5 buttons per row, max 5 rows)
                    let mergedActionRows = [...existingActionRows];
                    for (const newRow of newButtonRows) {
                        // Find a row with space for more buttons
                        let added = false;
                        for (let i = 0; i < mergedActionRows.length; i++) {
                            if (mergedActionRows[i].components.length < 5) {
                                // Add buttons from new row to existing row
                                const spaceLeft = 5 - mergedActionRows[i].components.length;
                                const buttonsToAdd = newRow.components.slice(0, spaceLeft);
                                mergedActionRows[i].components.push(...buttonsToAdd);
                                
                                // If there are remaining buttons, they'll be handled in next iteration
                                if (newRow.components.length > spaceLeft) {
                                    newRow.components = newRow.components.slice(spaceLeft);
                                } else {
                                    added = true;
                                    break;
                                }
                            }
                        }
                        
                        // If no space in existing rows and we still have buttons, add new row
                        if (!added && newRow.components.length > 0 && mergedActionRows.length < 5) {
                            mergedActionRows.push(newRow);
                        }
                    }
                    
                    // Combine V2 components with merged action rows
                    const combinedComponents = [...v2Components, ...mergedActionRows];
                    
                    await targetMessage.edit({
                        components: combinedComponents,
                        flags: MessageFlags.IsComponentsV2
                    });
                } else {
                    // Regular message - preserve content, embeds, attachments, and merge buttons
                    
                    // Get existing action rows and merge with new buttons
                    const existingActionRows = targetMessage.components
                        .filter(c => c.type === 1)
                        .map(c => c.toJSON ? c.toJSON() : c);
                    
                    const newButtonRows = rows.map(r => r.toJSON ? r.toJSON() : r);
                    
                    // Merge existing buttons with new buttons
                    let mergedActionRows = [...existingActionRows];
                    for (const newRow of newButtonRows) {
                        let added = false;
                        for (let i = 0; i < mergedActionRows.length; i++) {
                            if (mergedActionRows[i].components.length < 5) {
                                const spaceLeft = 5 - mergedActionRows[i].components.length;
                                const buttonsToAdd = newRow.components.slice(0, spaceLeft);
                                mergedActionRows[i].components.push(...buttonsToAdd);
                                
                                if (newRow.components.length > spaceLeft) {
                                    newRow.components = newRow.components.slice(spaceLeft);
                                } else {
                                    added = true;
                                    break;
                                }
                            }
                        }
                        
                        if (!added && newRow.components.length > 0 && mergedActionRows.length < 5) {
                            mergedActionRows.push(newRow);
                        }
                    }
                    
                    const editOptions = { components: mergedActionRows };
                    
                    // Always set content (even if empty string) to prevent Discord from clearing it
                    editOptions.content = targetMessage.content || '';
                    
                    // Preserve original embeds
                    if (targetMessage.embeds && targetMessage.embeds.length > 0) {
                        editOptions.embeds = targetMessage.embeds.map(e => {
                            // Convert embed to plain object, handling both API and builder embeds
                            if (e.data) return e.data;
                            if (e.toJSON) return e.toJSON();
                            return e;
                        });
                    }
                    
                    // Preserve attachments - re-upload from URLs
                    if (targetMessage.attachments && targetMessage.attachments.size > 0) {
                        editOptions.files = Array.from(targetMessage.attachments.values()).map(att => ({
                            attachment: att.url,
                            name: att.name,
                            description: att.description || undefined
                        }));
                    }
                    
                    // Preserve stickers if any
                    if (targetMessage.stickers && targetMessage.stickers.size > 0) {
                        editOptions.stickers = Array.from(targetMessage.stickers.values()).map(s => s.id);
                    }
                    
                    await targetMessage.edit(editOptions);
                }
                
                const container = new ContainerBuilder()
                    .addTextDisplayComponents(
                        new TextDisplayBuilder()
                            .setContent(
                                `# <:Checkedbox:1521227734943269077> Buttons Attached\n\n` +
                                `**Buttons:** ${buttonIds.join(', ')}\n` +
                                `**Message:** [View](${targetMessage.url})\n\n` +
                                `Original message content preserved.`
                            )
                    );
                
                return interaction.reply({
                    components: [container],
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
                });
            } catch (error) {
                console.error('Button attach error:', error);
                return interaction.reply({
                    content: `<:Cancel:1521227723916181644> Failed to edit the message: ${error.message}`,
                    flags: MessageFlags.Ephemeral
                });
            }
        } else {
            try {
                const reply = await targetMessage.reply({ components: rows });
                
                const container = new ContainerBuilder()
                    .addTextDisplayComponents(
                        new TextDisplayBuilder()
                            .setContent(
                                `# <:Checkedbox:1521227734943269077> Buttons Attached as Reply\n\n` +
                                `**Buttons:** ${buttonIds.join(', ')}\n` +
                                `**Reply:** [View](${reply.url})\n\n` +
                                `*Cannot edit others' messages directly.*`
                            )
                    );
                
                return interaction.reply({
                    components: [container],
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
                });
            } catch (error) {
                return interaction.reply({
                    content: '<:Cancel:1521227723916181644> Failed to attach buttons. I can only edit my own messages directly.',
                    flags: MessageFlags.Ephemeral
                });
            }
        }
    },

    async handleList(interaction) {
        const config = loadButtonsConfig();
        const guildButtons = config[interaction.guild.id] || {};

        if (Object.keys(guildButtons).length === 0) {
            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(
                            `# <:Document:1521227875016114266> No Buttons Created Yet\n\n` +
                            `You haven't created any custom buttons for this server.\n\n` +
                            `### 🚀 Get Started\n` +
                            `Create your first button:\n` +
                            `\`/button-maker create id:verify label:Verify style:success\`\n\n` +
                            `### <:Lightbulbalt:1521227880703463675> Need Help?\n` +
                            `Use \`/button-maker help\` for a complete guide.`
                        )
                );

            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        let content = `# <:Palette:1521227950601539755> Button Manager\n\n`;
        content += `**Total Buttons:** ${Object.keys(guildButtons).length}\n\n`;
        content += `### <:Document:1521227875016114266> Your Buttons\n`;

        for (const [id, data] of Object.entries(guildButtons)) {
            const styleEmoji = { primary: '🔵', secondary: '⚪', success: '🟢', danger: '🔴', link: '🔗' }[data.style] || '🔵';
            const actionCount = data.actions?.length || 0;

            content += `\n${styleEmoji} **\`${id}\`** - ${data.label}\n`;
            content += `   • Actions: ${actionCount} | Style: ${data.style}`;
            if (data.emoji) content += ` | Emoji: ${data.emoji}`;
            if (data.url) content += `\n   • URL: ${data.url}`;
            content += '\n';
        }

        content += `\n### <:Settings:1521227767780343879> Quick Actions\n`;
        content += `• \`/button-maker edit-actions\` - Add button actions\n`;
        content += `• \`/button-maker send\` - Send to channel\n`;
        content += `• \`/button-maker delete\` - Remove button`;

        const container = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(content)
            );

        await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    },

    async handleDelete(interaction) {
        const buttonId = interaction.options.getString('id');
        const config = loadButtonsConfig();

        if (!config[interaction.guild.id] || !config[interaction.guild.id][buttonId]) {
            const container = new ContainerBuilder()
                .setAccentColor(0xED4245)
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(
                            `# <:Cancel:1521227723916181644> Button Not Found\n\n` +
                            `No button with ID \`${buttonId}\` exists.\n\n` +
                            `Use \`/button-maker list\` to see all available buttons.`
                        )
                );

            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        const btnData = config[interaction.guild.id][buttonId];
        delete config[interaction.guild.id][buttonId];
        saveButtonsConfig(config);

        const container = new ContainerBuilder()
            .setAccentColor(0xED4245)
            .addTextDisplayComponents(
                new TextDisplayBuilder()
                    .setContent(
                        `# <:Trash:1521227750420254820> Button Deleted\n\n` +
                        `**Button ID:** \`${buttonId}\`\n` +
                        `**Label:** ${btnData.label}\n` +
                        `**Actions Removed:** ${btnData.actions?.length || 0}\n\n` +
                        `*The button and all its actions have been permanently removed.*\n\n` +
                        `<:Infotriangle:1521227710381428926> **Note:** Existing messages with this button will show an error when clicked.`
                    )
            );

        await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    },

    async handleEdit(interaction) {
        const buttonId = interaction.options.getString('id');
        const newLabel = interaction.options.getString('label');
        const newStyle = interaction.options.getString('style');
        const newEmoji = interaction.options.getString('emoji');
        const newUrl = interaction.options.getString('url');
        const newEphemeral = interaction.options.getBoolean('ephemeral');

        const config = loadButtonsConfig();
        const guildId = interaction.guild.id;

        if (!config[guildId] || !config[guildId][buttonId]) {
            const container = new ContainerBuilder()
                .setAccentColor(0xED4245)
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(
                            `# <:Cancel:1521227723916181644> Button Not Found\n\n` +
                            `No button with ID \`${buttonId}\` exists.\n\n` +
                            `Use \`/button-maker list\` to see all available buttons.`
                        )
                );
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        const btnData = config[guildId][buttonId];
        const changes = [];

        if (newLabel !== null) {
            btnData.label = newLabel;
            changes.push(`**Label:** ${newLabel}`);
        }

        if (newStyle !== null) {
            if (newStyle === 'link' && !btnData.url && !newUrl) {
                return interaction.reply({
                    content: '<:Cancel:1521227723916181644> Link-style buttons require a URL! Add the `url` option.',
                    flags: MessageFlags.Ephemeral
                });
            }
            btnData.style = newStyle;
         const styleEmoji = { primary: '🔵', secondary: '⚪', success: '🟢', danger: '🔴', link: '🔗' }[newStyle];
            changes.push(`**Style:** ${styleEmoji} ${newStyle}`);
        }

        if (newEmoji !== null) {
            if (newEmoji.toLowerCase() === 'none') {
                btnData.emoji = null;
                changes.push(`**Emoji:** Removed`);
            } else {
                btnData.emoji = newEmoji;
                changes.push(`**Emoji:** ${newEmoji}`);
            }
        }

        if (newUrl !== null) {
            if (newUrl && !newUrl.startsWith('http://') && !newUrl.startsWith('https://')) {
                return interaction.reply({
                    content: '<:Cancel:1521227723916181644> URL must start with `http://` or `https://`',
                    flags: MessageFlags.Ephemeral
                });
            }
            btnData.url = newUrl || null;
            changes.push(`**URL:** ${newUrl || 'Removed'}`);
        }

        if (newEphemeral !== null) {
            btnData.ephemeral = newEphemeral;
            changes.push(`**Ephemeral:** ${newEphemeral ? 'Yes (private)' : 'No (public)'}`);
        }

        if (changes.length === 0) {
            return interaction.reply({
                content: '<:Cancel:1521227723916181644> No changes specified! Provide at least one option to edit.',
                flags: MessageFlags.Ephemeral
            });
        }

        saveButtonsConfig(config);

        const container = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder()
                    .setContent(
                        `# <:Checkedbox:1521227734943269077> Button Updated\n\n` +
                        `**Button ID:** \`${buttonId}\`\n\n` +
                        `### Changes Made\n` +
                        changes.join('\n') + '\n\n' +
                        `*Note: Changes apply to new button instances. Existing messages need to be re-sent to show updates.*`
                    )
            );

        return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    },

    async handleEditActions(interaction) {
        const buttonId = interaction.options.getString('id');
        const config = loadButtonsConfig();

        if (!config[interaction.guild.id] || !config[interaction.guild.id][buttonId]) {
            const container = new ContainerBuilder()
                .setAccentColor(0xED4245)
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(
                            `# <:Cancel:1521227723916181644> Button Not Found\n\n` +
                            `No button with ID \`${buttonId}\` exists.\n\n` +
                            `Use \`/button-maker list\` to see all available buttons.`
                        )
                );

            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        if (!global.buttonMakerSessions) global.buttonMakerSessions = new Map();
        global.buttonMakerSessions.set(interaction.user.id, { guildId: interaction.guild.id, buttonId });

        const btnData = config[interaction.guild.id][buttonId];
        const container = this.buildActionPanel(buttonId, btnData, interaction.guild.id);

        await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    },

    async handleView(interaction) {
        const buttonId = interaction.options.getString('id');
        const config = loadButtonsConfig();
        const btnData = config[interaction.guild.id]?.[buttonId];

        if (!btnData) {
            return interaction.reply({
                content: `<:Cancel:1521227723916181644> Button \`${buttonId}\` not found. Use \`/button-maker list\` to see available buttons.`,
                flags: MessageFlags.Ephemeral,
            });
        }

        const styleEmoji = { primary: '🔵', secondary: '⚪', success: '🟢', danger: '🔴', link: '🔗' }[btnData.style] || '🔵';
        const created = btnData.createdAt ? `<t:${Math.floor(btnData.createdAt / 1000)}:R>` : 'unknown';
        const creator = btnData.createdBy ? `<@${btnData.createdBy}>` : 'unknown';

        let content = `# <:Document:1521227875016114266> Button: \`${buttonId}\`\n\n`;
        content += `### <:Settings:1521227767780343879> Configuration\n`;
        content += `<:Pin:1521227932625014916> **Label:** ${btnData.label}\n`;
        content += `<:Pin:1521227932625014916> **Style:** ${styleEmoji} ${btnData.style}\n`;
        if (btnData.emoji)  content += `<:Pin:1521227932625014916> **Emoji:** ${btnData.emoji}\n`;
        if (btnData.url)    content += `<:Pin:1521227932625014916> **URL:** <${btnData.url}>\n`;
        content += `<:Pin:1521227932625014916> **Response:** ${btnData.ephemeral !== false ? 'Ephemeral (private)' : 'Public'}\n`;
        content += `<:Pin:1521227932625014916> **Created:** ${created} by ${creator}\n`;
        content += `<:Pin:1521227932625014916> **Total Uses:** \`${btnData.uses || 0}\`\n\n`;

        const actions = btnData.actions || [];
        content += `### <:Bookmark:1521227835526742066> Actions (${actions.length})\n`;
        if (!actions.length) {
            content += `*No actions configured. Add some with* \`/button-maker edit-actions id:${buttonId}\`.`;
        } else {
            actions.forEach((a, i) => {
                content += `**${i + 1}.** ${this.getActionEmoji(a.type)} ${this.getActionDescription(a)}\n`;
            });
        }

        const container = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

        return interaction.reply({
            components: [container],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        });
    },

    async handleClone(interaction) {
        const sourceId = interaction.options.getString('source');
        const newId    = interaction.options.getString('new-id');

        if (!/^[a-z0-9_-]{1,64}$/i.test(newId)) {
            return interaction.reply({
                content: '<:Cancel:1521227723916181644> New button ID must be 1–64 chars, only letters, numbers, underscore and dash.',
                flags: MessageFlags.Ephemeral,
            });
        }

        const config = loadButtonsConfig();
        const guildId = interaction.guild.id;

        if (!config[guildId]?.[sourceId]) {
            return interaction.reply({
                content: `<:Cancel:1521227723916181644> Source button \`${sourceId}\` not found.`,
                flags: MessageFlags.Ephemeral,
            });
        }
        if (config[guildId][newId]) {
            return interaction.reply({
                content: `<:Cancel:1521227723916181644> Button \`${newId}\` already exists. Pick a different new id.`,
                flags: MessageFlags.Ephemeral,
            });
        }

        // Deep-clone source data, reset usage counters & creation metadata
        const cloned = JSON.parse(JSON.stringify(config[guildId][sourceId]));
        cloned.uses = 0;
        cloned.createdAt = Date.now();
        cloned.createdBy = interaction.user.id;
        config[guildId][newId] = cloned;
        saveButtonsConfig(config);

        return interaction.reply({
            content:
                `<:Checkedbox:1521227734943269077> Button \`${sourceId}\` cloned to \`${newId}\` ` +
                `(${cloned.actions?.length || 0} actions copied). Use \`/button-maker edit-actions id:${newId}\` to customize.`,
            flags: MessageFlags.Ephemeral,
        });
    },

    async handleHelp(interaction) {
        const helpContainer = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `# <:Clipboard:1521228175298920448> Button Maker - Complete Guide\n\n` +
                    `Create interactive buttons that perform actions when clicked.\n\n` +
                    `### <:Settings:1521227767780343879> Step-by-Step Setup\n` +
                    `**Step 1:** Create a button\n` +
                    `\`/button-maker create id:verify label:Verify style:success emoji:<:Checkedbox:1521227734943269077>\`\n\n` +
                    `**Step 2:** Add actions (what happens when clicked)\n` +
                    `\`/button-maker edit-actions id:verify\`\n\n` +
                    `**Step 3:** Send to a channel\n` +
                    `\`/button-maker send button-ids:verify message:Click to verify!\`\n\n` +
                    `### <:Palette:1521227950601539755> Button Styles\n` +
                    `🔵 **Primary** - Blue button (default)\n` +
                    `⚪ **Secondary** - Gray button\n` +
                    `🟢 **Success** - Green button\n` +
                    `🔴 **Danger** - Red button\n` +
                    `🔗 **Link** - URL redirect button\n\n` +
                    `### <:Bookmark:1521227835526742066> Available Actions\n` +
                    `**Role Management:**\n` +
                    `• Add Role - Give a role to the user\n` +
                    `• Remove Role - Take away a role\n` +
                    `• Toggle Role - Add if missing, remove if has\n\n` +
                    `**Communication:**\n` +
                    `• Send Message - Send to a channel\n` +
                    `• Send DM - Direct message the user\n` +
                    `• Send Embed - Send a custom embed\n\n` +
                    `**Moderation:**\n` +
                    `• Create Ticket - Open a support ticket\n` +
                    `• Kick User - Kick who clicked\n` +
                    `• Ban User - Ban who clicked\n` +
                    `• Timeout User - Mute temporarily\n\n` +
                    `**Utility:**\n` +
                    `• Create Channel - Make a new channel\n\n` +
                    `### <:Lightbulbalt:1521227880703463675> Pro Tips\n` +
                    `• Multiple buttons: \`button-ids:verify,rules,support\`\n` +
                    `• One button can have multiple actions\n` +
                    `• Link buttons don't need actions (they redirect)\n` +
                    `• Use Toggle Role for self-assignable roles\n\n` +
                    `### <:Document:1521227875016114266> All Commands\n` +
                    `\`/button-maker create\` - Create new button\n` +
                    `\`/button-maker edit-actions\` - Add actions\n` +
                    `\`/button-maker send\` - Send to channel\n` +
                    `\`/button-maker attach\` - Add to existing message\n` +
                    `\`/button-maker list\` - View all buttons\n` +
                    `\`/button-maker delete\` - Remove button\n` +
                    `\`/button-maker help\` - This guide`
                )
            );
        
        await interaction.reply({ components: [helpContainer], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    },

    buildActionPanel(buttonId, btnData, guildId) {
        const styleEmoji = { primary: '🔵', secondary: '⚪', success: '🟢', danger: '🔴', link: '🔗' }[btnData.style] || '🔵';
        const isEphemeral = btnData.ephemeral !== false;
        
        let content = `# <:Settings:1521227767780343879> Button Action Editor\n\n`;
        content += `**Button:** ${styleEmoji} ${btnData.label} (\`${buttonId}\`)\n`;
        content += `**Response:** ${isEphemeral ? '<:Eyeclosed:1521228356463362291> Private (ephemeral)' : '<:Eye:1521227940480815156> Public (visible to all)'}\n\n`;
        content += `### <:Document:1521227875016114266> Actions (${btnData.actions?.length || 0})\n`;

        if (!btnData.actions || btnData.actions.length === 0) {
            content += `*No actions configured yet.*\n`;
            content += `> Select an action type below to add it.\n\n`;
        } else {
            btnData.actions.forEach((action, index) => {
                const canEdit = ['send_message'].includes(action.type);
                content += `**${index + 1}.** ${this.getActionEmoji(action.type)} ${this.getActionDescription(action)}${canEdit ? ' *(editable)*' : ''}\n`;
            });
            content += '\n';
        }

        content += `### <:Add:1521227828199293152> Add Action`;

        const container = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(content)
            );

        if (btnData.actions && btnData.actions.length > 0) {
            const editableActions = btnData.actions
                .map((action, index) => ({ action, index }))
                .filter(({ action }) => ['send_message'].includes(action.type))
                .slice(0, 5);

            if (editableActions.length > 0) {
                const editRow = new ActionRowBuilder();
                editableActions.forEach(({ action, index }) => {
                    editRow.addComponents(
                        new ButtonBuilder()
                            .setCustomId(`btn_edit_action:${guildId}:${buttonId}:${index}`)
                            .setLabel(`Edit #${index + 1}`)
                            .setStyle(ButtonStyle.Secondary)
                            .setEmoji('<:Editalt:1521227921673556019>')
                    );
                });
                const deleteRow = new ActionRowBuilder();
                btnData.actions.slice(0, 5).forEach((action, index) => {
                    deleteRow.addComponents(
                        new ButtonBuilder()
                            .setCustomId(`btn_del_action:${guildId}:${buttonId}:${index}`)
                            .setLabel(`Del #${index + 1}`)
                            .setStyle(ButtonStyle.Danger)
                            .setEmoji('<:Trash:1521227750420254820>')
                    );
                });
                container.addActionRowComponents(editRow, deleteRow);
            }
        }

        const row1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('btn_action_add_role')
                .setLabel('Add Role')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('<:Userplus:1521227719621218477>'),
            new ButtonBuilder()
                .setCustomId('btn_action_remove_role')
                .setLabel('Remove Role')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('<:Trash:1521227750420254820>'),
            new ButtonBuilder()
                .setCustomId('btn_action_toggle_role')
                .setLabel('Toggle Role')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('<:History:1521227863079256278>'),
            new ButtonBuilder()
                .setCustomId('btn_action_send_message')
                .setLabel('Message')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('<:Hashtag:1521227771957870604>')
        );

        const row2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('btn_action_send_dm')
                .setLabel('Send DM')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('<:Editalt:1521227921673556019>'),
            new ButtonBuilder()
                .setCustomId('btn_action_create_ticket')
                .setLabel('Ticket')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('🎫'),
            new ButtonBuilder()
                .setCustomId('btn_action_send_embed')
                .setLabel('Embed')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('<:Document:1521227875016114266>'),
            new ButtonBuilder()
                .setCustomId('btn_action_create_channel')
                .setLabel('Channel')
                .setStyle(ButtonStyle.Success)
                .setEmoji('<:Folderopen:1521227986966417642>')
        );

        const row3 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('btn_action_kick')
                .setLabel('Kick')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('<:Userblock:1521227822641975366>'),
            new ButtonBuilder()
                .setCustomId('btn_action_ban')
                .setLabel('Ban')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('<:banhammer:1521227777083314529>'),
            new ButtonBuilder()
                .setCustomId('btn_action_timeout')
                .setLabel('Timeout')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('<:Timer:1521227971590095070>')
        );

        const row4 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('btn_action_clear_actions')
                .setLabel('Clear All')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('<:Trash:1521227750420254820>'),
            new ButtonBuilder()
                .setCustomId('btn_action_done')
                .setLabel('Save & Exit')
                .setStyle(ButtonStyle.Success)
                .setEmoji('<:Checkedbox:1521227734943269077>')
        );

        container.addActionRowComponents(row1, row2, row3, row4);
        return container;
    },

    getActionEmoji(type) {
        const emojis = {
            'add_role': '<:Userplus:1521227719621218477>',
            'remove_role': '<:Trash:1521227750420254820>',
            'toggle_role': '<:History:1521227863079256278>',
            'send_message': '<:Hashtag:1521227771957870604>',
            'send_dm': '<:Editalt:1521227921673556019>',
            'create_ticket': '🎫',
            'kick': '<:Userblock:1521227822641975366>',
            'ban': '<:banhammer:1521227777083314529>',
            'timeout': '<:Timer:1521227971590095070>',
            'create_channel': '<:Folderopen:1521227986966417642>',
            'send_embed': '<:Document:1521227875016114266>'
        };
        return emojis[type] || '<:Settings:1521227767780343879>';
    },

    getActionDescription(action) {
        switch (action.type) {
            case 'add_role':
                return `Add role <@&${action.roleId}>`;
            case 'remove_role':
                return `Remove role <@&${action.roleId}>`;
            case 'toggle_role':
                return `Toggle role <@&${action.roleId}>`;
            case 'send_message':
                if (action.mode === 'embed') {
                    return `Send embed: "${action.embed?.title?.substring(0, 30) || 'Custom Embed'}${action.embed?.title?.length > 30 ? '...' : ''}"`;
                }
                return `Send: "${action.message?.substring(0, 40)}${action.message?.length > 40 ? '...' : ''}"`;
            case 'send_dm':
                return `DM: "${action.message?.substring(0, 40)}${action.message?.length > 40 ? '...' : ''}"`;
            case 'create_ticket':
                return `Create ticket${action.categoryId ? ` in category` : ''}`;
            case 'kick':
                return `Kick user${action.reason ? `: ${action.reason}` : ''}`;
            case 'ban':
                return `Ban user${action.reason ? `: ${action.reason}` : ''}`;
            case 'timeout':
                return `Timeout for ${action.duration || '60'}s`;
            case 'create_channel':
                return `Create channel: ${action.channelName || 'new-channel'}`;
            case 'send_embed':
                return `Send embed: ${action.title || 'Custom Embed'}`;
            default:
                return 'Unknown action';
        }
    },

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return message.reply('<:Cancel:1521227723916181644> You need **Manage Server** permission to use this command!');
        }

        const subcommand = args[0]?.toLowerCase();

        if (!subcommand || subcommand === 'help') {
            const helpContainer = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(
                            `# <:Palette:1521227950601539755> Button Maker - Quick Guide\n\n` +
                            `Create interactive buttons with custom actions.\n\n` +
                            `### <:Document:1521227875016114266> Slash Commands (Recommended)\n` +
                            `\`/button-maker create\` - Create a new button\n` +
                            `\`/button-maker edit-actions\` - Add actions to button\n` +
                            `\`/button-maker send\` - Send buttons to channel\n` +
                            `\`/button-maker attach\` - Add to existing message\n` +
                            `\`/button-maker list\` - View all buttons\n` +
                            `\`/button-maker delete\` - Remove a button\n` +
                            `\`/button-maker help\` - Full detailed guide\n\n` +
                            `### <:Bookmark:1521227835526742066> Quick Example\n` +
                            `**1.** Create: \`/button-maker create id:verify label:Verify style:success\`\n` +
                            `**2.** Add action: \`/button-maker edit-actions id:verify\`\n` +
                            `**3.** Send: \`/button-maker send button-ids:verify\`\n\n` +
                            `### <:Lightbulbalt:1521227880703463675> Prefix Commands\n` +
                            `\`-button-maker create <id> <label> [style] [emoji]\`\n` +
                            `\`-button-maker send <button-ids> | <message>\`\n` +
                            `\`-button-maker list\`\n` +
                            `\`-button-maker delete <id>\`\n\n` +
                            `*Use slash commands for the best experience!*`
                        )
                );

            return message.reply({
                components: [helpContainer],
                flags: MessageFlags.IsComponentsV2
            });
        }

        if (subcommand === 'create') {
            const buttonId = args[1];
            const label = args[2];
            const style = args[3]?.toLowerCase() || 'primary';
            const emoji = args[4];
            const url = args[5];

            if (!buttonId || !label) {
                return message.reply('<:Cancel:1521227723916181644> **Usage:** `-button-maker create <id> <label> [style] [emoji] [url]`\n**Example:** `-button-maker create verify Verify success <:Checkedbox:1521227734943269077>`');
            }

            // Validate button id (Discord custom_id legal chars + reasonable length)
            if (!/^[a-z0-9_-]{1,64}$/i.test(buttonId)) {
                return message.reply('<:Cancel:1521227723916181644> Button ID must be 1–64 chars, only letters/numbers/underscore/dash.');
            }

            const validStyles = ['primary', 'secondary', 'success', 'danger', 'link'];
            if (!validStyles.includes(style)) {
                return message.reply(`<:Cancel:1521227723916181644> Invalid style. Use one of: ${validStyles.join(', ')}`);
            }

            if (style === 'link' && !url) {
                return message.reply('<:Cancel:1521227723916181644> Link-style buttons require a URL!');
            }

            if (style === 'link' && url && !url.startsWith('http://') && !url.startsWith('https://')) {
                return message.reply('<:Cancel:1521227723916181644> URL must start with `http://` or `https://`');
            }

            const config = loadButtonsConfig();
            const guildId = message.guild.id;

            if (!config[guildId]) config[guildId] = {};

            if (config[guildId][buttonId]) {
                return message.reply('<:Cancel:1521227723916181644> A button with this ID already exists!');
            }

            config[guildId][buttonId] = {
                label: label,
                style: style,
                emoji: emoji || null,
                url: url || null,
                ephemeral: true,
                actions: []
            };

            saveButtonsConfig(config);

            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(
                            `# <:Checkedbox:1521227734943269077> Button Created\n\n` +
                            `**ID:** \`${buttonId}\`\n` +
                            `**Label:** ${label}\n` +
                            `**Style:** ${style}\n` +
                            `${emoji ? `**Emoji:** ${emoji}\n` : ''}` +
                            `${url ? `**URL:** ${url}\n` : ''}\n` +
                            `${style === 'link' ?
                                `*Link buttons redirect users to the URL*` :
                                `Use \`/button-maker edit-actions id:${buttonId}\` to add actions!`
                            }`
                        )
                );

            return message.reply({
                components: [container],
                flags: MessageFlags.IsComponentsV2
            });
        }

        if (subcommand === 'send') {
            const buttonIdsInput = args.slice(1).join(' ').split('|')[0];
            const rest = args.slice(1).join(' ').split('|');
            const messageText = rest[1]?.trim();
            const useContainer = rest.some(p => p.trim().toLowerCase() === 'container');

            if (!buttonIdsInput) {
                return message.reply('<:Cancel:1521227723916181644> **Usage:** `-button-maker send <button-ids> | <message>`\n**Container:** `-button-maker send <button-ids> | <message> | container`\n**Example:** `-button-maker send verify,support | Click a button! | container`');
            }

            const buttonIds = buttonIdsInput.split(',').map(id => id.trim());
            const config = loadButtonsConfig();
            const guildId = message.guild.id;

            if (!config[guildId]) {
                return message.reply('<:Cancel:1521227723916181644> No buttons configured for this server!');
            }

            const rows = createButtonComponents(buttonIds, config, guildId);

            try {
                if (useContainer) {
                    const container = new ContainerBuilder();
                    if (messageText) {
                        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(messageText));
                        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
                    }
                    for (const row of rows) {
                        container.addActionRowComponents(row);
                    }
                    await message.channel.send({ components: [container], flags: MessageFlags.IsComponentsV2 });
                } else {
                    await message.channel.send({
                        content: messageText || null,
                        components: rows
                    });
                }
                return message.reply(`<:Checkedbox:1521227734943269077> Buttons sent!${useContainer ? ' (inside container)' : ''}`);
            } catch (error) {
                console.error('[ButtonMaker] Send error:', error);
                return message.reply('<:Cancel:1521227723916181644> Failed to send buttons. Check bot permissions in this channel.').catch(() => {});
            }
        }

        if (subcommand === 'list') {
            const config = loadButtonsConfig();
            const guildButtons = config[message.guild.id] || {};

            if (Object.keys(guildButtons).length === 0) {
                return message.reply('<:Cancel:1521227723916181644> No buttons created yet. Use `/button-maker create` to create one.');
            }

            let content = `# <:Document:1521227875016114266> Your Buttons\n\n`;
            for (const [id, data] of Object.entries(guildButtons)) {
                const styleEmoji = { primary: '🔵', secondary: '⚪', success: '🟢', danger: '🔴', link: '🔗' }[data.style] || '🔵';
                content += `${styleEmoji} **\`${id}\`** - ${data.label} (${data.actions?.length || 0} actions)\n`;
            }

            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(content)
                );

            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (subcommand === 'delete') {
            const buttonId = args[1];
            if (!buttonId) {
                return message.reply('<:Cancel:1521227723916181644> **Usage:** `-button-maker delete <button-id>`');
            }

            const config = loadButtonsConfig();
            if (!config[message.guild.id] || !config[message.guild.id][buttonId]) {
                return message.reply('<:Cancel:1521227723916181644> Button not found!');
            }

            delete config[message.guild.id][buttonId];
            saveButtonsConfig(config);

            return message.reply(`<:Checkedbox:1521227734943269077> Button \`${buttonId}\` deleted!`);
        }

        return message.reply('<:Lightbulbalt:1521227880703463675> Unknown subcommand. Use `-button-maker help` for usage info.');
    },

    async handleInteraction(interaction) {
        const self = this;
        if (await checkAndExpire(interaction, 'builder')) return true;
        
        if (interaction.customId.startsWith('btnmsg:')) {
            const baseId = actionMsgBuilder.extractPrefixFromCustomId(interaction.customId);
            const parts = baseId.split(':');
            const guildId = parts[1];
            const buttonId = parts.slice(2).join(':');
            const prefix = `btnmsg:${guildId}:${buttonId}`;
            
            const handled = await actionMsgBuilder.handleButtonInteraction(
                interaction, prefix, 'button', guildId, buttonId,
                async (inter, data) => {
                    const config = loadButtonsConfig();
                    if (!config[guildId]) config[guildId] = {};
                    if (!config[guildId][buttonId]) config[guildId][buttonId] = { actions: [] };
                    if (!config[guildId][buttonId].actions) config[guildId][buttonId].actions = [];
                    
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
                    } else {
                        actionData.message = data.content;
                    }
                    
                    const editIndexKey = `${inter.user.id}:${guildId}:${buttonId}`;
                    const editIndex = global.buttonEditActionIndex?.get(editIndexKey);
                    if (editIndex !== undefined && config[guildId][buttonId].actions[editIndex]) {
                        config[guildId][buttonId].actions[editIndex] = actionData;
                        global.buttonEditActionIndex.delete(editIndexKey);
                    } else {
                        config[guildId][buttonId].actions.push(actionData);
                    }
                    saveButtonsConfig(config);
                    
                    const btnData = config[guildId][buttonId];
                    const container = self.buildActionPanel(buttonId, btnData, guildId);
                    await inter.update({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
                },
                async (inter) => {
                    const config = loadButtonsConfig();
                    const btnData = config[guildId]?.[buttonId] || {};
                    const container = self.buildActionPanel(buttonId, btnData, guildId);
                    await inter.update({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
                }
            );
            return handled;
        }

        if (interaction.customId.startsWith('btn_edit_action:')) {
            const parts = interaction.customId.replace('btn_edit_action:', '').split(':');
            const guildId = parts[0];
            const buttonId = parts[1];
            const actionIndex = parseInt(parts[2]);

            const config = loadButtonsConfig();
            const btnData = config[guildId]?.[buttonId];
            if (!btnData || !btnData.actions?.[actionIndex]) {
                await interaction.reply({ content: '<:Cancel:1521227723916181644> Action not found!', flags: MessageFlags.Ephemeral });
                return true;
            }

            const action = btnData.actions[actionIndex];
            if (action.type !== 'send_message') {
                await interaction.reply({ content: '<:Cancel:1521227723916181644> This action type cannot be edited!', flags: MessageFlags.Ephemeral });
                return true;
            }

            const context = `Edit Action #${actionIndex + 1} for: \`${buttonId}\``;
            const existingData = {
                mode: action.mode || 'simple',
                content: action.message || '',
                channelId: action.channelId || '',
                title: action.embed?.title || '',
                description: action.embed?.description || '',
                color: action.embed?.color || '#bcf1e4',
                image: action.embed?.image || '',
                thumbnail: action.embed?.thumbnail || '',
                author: action.embed?.author || '',
                authorIcon: action.embed?.authorIcon || '',
                footer: action.embed?.footer || '',
                footerIcon: action.embed?.footerIcon || '',
                fields: action.embed?.fields || []
            };

            const sessionKey = `${interaction.user.id}:button:${guildId}:${buttonId}`;
            actionMsgBuilder.messageBuilderSessions.set(sessionKey, existingData);
            
            if (!global.buttonEditActionIndex) global.buttonEditActionIndex = new Map();
            global.buttonEditActionIndex.set(`${interaction.user.id}:${guildId}:${buttonId}`, actionIndex);

            const prefix = `btnmsg:${guildId}:${buttonId}`;
            const container = actionMsgBuilder.buildMessageBuilderPanel(existingData, prefix, context);
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            return true;
        }

        if (interaction.customId.startsWith('btn_del_action:')) {
            const parts = interaction.customId.replace('btn_del_action:', '').split(':');
            const guildId = parts[0];
            const buttonId = parts[1];
            const actionIndex = parseInt(parts[2]);

            const config = loadButtonsConfig();
            if (!config[guildId]?.[buttonId]?.actions?.[actionIndex]) {
                await interaction.reply({ content: '<:Cancel:1521227723916181644> Action not found!', flags: MessageFlags.Ephemeral });
                return true;
            }

            config[guildId][buttonId].actions.splice(actionIndex, 1);
            saveButtonsConfig(config);

            const btnData = config[guildId][buttonId];
            const container = this.buildActionPanel(buttonId, btnData, guildId);
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            return true;
        }
        
        if (!interaction.customId.startsWith('btn_action_')) return false;

        const session = global.buttonMakerSessions?.get(interaction.user.id);
        if (!session) {
            await interaction.reply({ content: '<:Cancel:1521227723916181644> Session expired! Use `/button-maker edit-actions` again.', flags: MessageFlags.Ephemeral });
            return true;
        }

        const { guildId, buttonId } = session;
        const actionType = interaction.customId.replace('btn_action_', '');

        // Handle clear all actions
        if (actionType === 'clear_actions') {
            const config = loadButtonsConfig();
            if (config[guildId]?.[buttonId]) {
                config[guildId][buttonId].actions = [];
                saveButtonsConfig(config);
            }
            const btnData = config[guildId]?.[buttonId] || {};
            const container = this.buildActionPanel(buttonId, btnData, guildId);
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            return true;
        }

        // Handle done/save
        if (actionType === 'done') {
            global.buttonMakerSessions.delete(interaction.user.id);
            const config = loadButtonsConfig();
            const btnData = config[guildId]?.[buttonId];
            const actionCount = btnData?.actions?.length || 0;
            
            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# <:Checkedbox:1521227734943269077> Button Saved\n\n` +
                        `**Button:** \`${buttonId}\`\n` +
                        `**Actions:** ${actionCount} configured\n\n` +
                        `Use \`/button-maker send button-ids:${buttonId}\` to send it!`
                    )
                );
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            return true;
        }

        // Show modal for the action type
        if (['add_role', 'remove_role', 'toggle_role'].includes(actionType)) {
            const modal = new ModalBuilder()
                .setCustomId(`btn_modal_role:${guildId}:${buttonId}:${actionType}`)
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
            const context = `Button: \`${buttonId}\``;
            const data = actionMsgBuilder.startMessageBuilderSession(interaction.user.id, 'button', guildId, buttonId, context);
            const prefix = `btnmsg:${guildId}:${buttonId}`;
            const container = actionMsgBuilder.buildMessageBuilderPanel(data, prefix, context);
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            return true;
        }

        if (actionType === 'send_dm') {
            const modal = new ModalBuilder()
                .setCustomId(`btn_modal_dm:${guildId}:${buttonId}`)
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
                .setCustomId(`btn_modal_ticket:${guildId}:${buttonId}`)
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
                .setCustomId(`btn_modal_embed:${guildId}:${buttonId}`)
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
                .setCustomId(`btn_modal_channel:${guildId}:${buttonId}`)
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

        if (actionType === 'kick') {
            const modal = new ModalBuilder()
                .setCustomId(`btn_modal_kick:${guildId}:${buttonId}`)
                .setTitle('Configure Kick Action');

            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('reason')
                        .setLabel('Kick Reason (optional)')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(false)
                )
            );
            await interaction.showModal(modal);
            return true;
        }

        if (actionType === 'ban') {
            const modal = new ModalBuilder()
                .setCustomId(`btn_modal_ban:${guildId}:${buttonId}`)
                .setTitle('Configure Ban Action');

            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('reason')
                        .setLabel('Ban Reason (optional)')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(false)
                )
            );
            await interaction.showModal(modal);
            return true;
        }

        if (actionType === 'timeout') {
            const modal = new ModalBuilder()
                .setCustomId(`btn_modal_timeout:${guildId}:${buttonId}`)
                .setTitle('Configure Timeout Action');

            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('duration')
                        .setLabel('Duration in seconds')
                        .setStyle(TextInputStyle.Short)
                        .setValue('60')
                        .setRequired(true)
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('reason')
                        .setLabel('Reason (optional)')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(false)
                )
            );
            await interaction.showModal(modal);
            return true;
        }

        return false;
    },

    async handleModalSubmit(interaction) {
        if (interaction.customId.startsWith('btnmsg:')) {
            const mainPart = interaction.customId.split('_modal_')[0];
            const parts = mainPart.split(':');
            const guildId = parts[1];
            const buttonId = parts.slice(2).join(':');
            const prefix = `btnmsg:${guildId}:${buttonId}`;
            
            const handled = await actionMsgBuilder.handleModalSubmit(interaction, prefix, 'button', guildId, buttonId);
            return handled;
        }
        
        if (!interaction.customId.startsWith('btn_modal_')) return false;

        const fullId = interaction.customId.replace('btn_modal_', '');
        const config = loadButtonsConfig();

        // Format: role:guildId:buttonId:actionType
        if (fullId.startsWith('role:')) {
            const parts = fullId.replace('role:', '').split(':');
            const guildId = parts[0];
            const buttonId = parts[1];
            const actionType = parts[2];
            const roleId = interaction.fields.getTextInputValue('role_id');

            if (!config[guildId]?.[buttonId]) {
                return interaction.reply({ content: '<:Cancel:1521227723916181644> Button not found!', flags: MessageFlags.Ephemeral });
            }

            if (!config[guildId][buttonId].actions) config[guildId][buttonId].actions = [];
            config[guildId][buttonId].actions.push({ type: actionType, roleId });
            saveButtonsConfig(config);

            const btnData = config[guildId][buttonId];
            const container = this.buildActionPanel(buttonId, btnData, guildId);
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            return true;
        }

        // Format: dm:guildId:buttonId
        if (fullId.startsWith('dm:')) {
            const parts = fullId.replace('dm:', '').split(':');
            const guildId = parts[0];
            const buttonId = parts[1];
            const message = interaction.fields.getTextInputValue('message');

            if (!config[guildId]?.[buttonId]) {
                return interaction.reply({ content: '<:Cancel:1521227723916181644> Button not found!', flags: MessageFlags.Ephemeral });
            }

            if (!config[guildId][buttonId].actions) config[guildId][buttonId].actions = [];
            config[guildId][buttonId].actions.push({ type: 'send_dm', message });
            saveButtonsConfig(config);

            const btnData = config[guildId][buttonId];
            const container = this.buildActionPanel(buttonId, btnData, guildId);
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            return true;
        }

        // Format: ticket:guildId:buttonId
        if (fullId.startsWith('ticket:')) {
            const parts = fullId.replace('ticket:', '').split(':');
            const guildId = parts[0];
            const buttonId = parts[1];
            const ticketName = interaction.fields.getTextInputValue('ticket_name');
            const categoryId = interaction.fields.getTextInputValue('category_id') || null;

            if (!config[guildId]?.[buttonId]) {
                return interaction.reply({ content: '<:Cancel:1521227723916181644> Button not found!', flags: MessageFlags.Ephemeral });
            }

            if (!config[guildId][buttonId].actions) config[guildId][buttonId].actions = [];
            config[guildId][buttonId].actions.push({ type: 'create_ticket', ticketName, categoryId });
            saveButtonsConfig(config);

            const btnData = config[guildId][buttonId];
            const container = this.buildActionPanel(buttonId, btnData, guildId);
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            return true;
        }

        // Format: embed:guildId:buttonId
        if (fullId.startsWith('embed:')) {
            const parts = fullId.replace('embed:', '').split(':');
            const guildId = parts[0];
            const buttonId = parts[1];
            const title = interaction.fields.getTextInputValue('title');
            const description = interaction.fields.getTextInputValue('description');
            const color = interaction.fields.getTextInputValue('color') || '#bcf1e4';

            if (!config[guildId]?.[buttonId]) {
                return interaction.reply({ content: '<:Cancel:1521227723916181644> Button not found!', flags: MessageFlags.Ephemeral });
            }

            if (!config[guildId][buttonId].actions) config[guildId][buttonId].actions = [];
            config[guildId][buttonId].actions.push({ type: 'send_embed', title, description, color });
            saveButtonsConfig(config);

            const btnData = config[guildId][buttonId];
            const container = this.buildActionPanel(buttonId, btnData, guildId);
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            return true;
        }

        // Format: channel:guildId:buttonId
        if (fullId.startsWith('channel:')) {
            const parts = fullId.replace('channel:', '').split(':');
            const guildId = parts[0];
            const buttonId = parts[1];
            const channelName = interaction.fields.getTextInputValue('channel_name');
            const categoryId = interaction.fields.getTextInputValue('category_id') || null;

            if (!config[guildId]?.[buttonId]) {
                return interaction.reply({ content: '<:Cancel:1521227723916181644> Button not found!', flags: MessageFlags.Ephemeral });
            }

            if (!config[guildId][buttonId].actions) config[guildId][buttonId].actions = [];
            config[guildId][buttonId].actions.push({ type: 'create_channel', channelName, categoryId });
            saveButtonsConfig(config);

            const btnData = config[guildId][buttonId];
            const container = this.buildActionPanel(buttonId, btnData, guildId);
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            return true;
        }

        // Format: kick:guildId:buttonId
        if (fullId.startsWith('kick:')) {
            const parts = fullId.replace('kick:', '').split(':');
            const guildId = parts[0];
            const buttonId = parts[1];
            const reason = interaction.fields.getTextInputValue('reason') || null;

            if (!config[guildId]?.[buttonId]) {
                return interaction.reply({ content: '<:Cancel:1521227723916181644> Button not found!', flags: MessageFlags.Ephemeral });
            }

            if (!config[guildId][buttonId].actions) config[guildId][buttonId].actions = [];
            config[guildId][buttonId].actions.push({ type: 'kick', reason });
            saveButtonsConfig(config);

            const btnData = config[guildId][buttonId];
            const container = this.buildActionPanel(buttonId, btnData, guildId);
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            return true;
        }

        // Format: ban:guildId:buttonId
        if (fullId.startsWith('ban:')) {
            const parts = fullId.replace('ban:', '').split(':');
            const guildId = parts[0];
            const buttonId = parts[1];
            const reason = interaction.fields.getTextInputValue('reason') || null;

            if (!config[guildId]?.[buttonId]) {
                return interaction.reply({ content: '<:Cancel:1521227723916181644> Button not found!', flags: MessageFlags.Ephemeral });
            }

            if (!config[guildId][buttonId].actions) config[guildId][buttonId].actions = [];
            config[guildId][buttonId].actions.push({ type: 'ban', reason });
            saveButtonsConfig(config);

            const btnData = config[guildId][buttonId];
            const container = this.buildActionPanel(buttonId, btnData, guildId);
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            return true;
        }

        // Format: timeout:guildId:buttonId
        if (fullId.startsWith('timeout:')) {
            const parts = fullId.replace('timeout:', '').split(':');
            const guildId = parts[0];
            const buttonId = parts[1];
            const duration = interaction.fields.getTextInputValue('duration') || '60';
            const reason = interaction.fields.getTextInputValue('reason') || null;

            if (!config[guildId]?.[buttonId]) {
                return interaction.reply({ content: '<:Cancel:1521227723916181644> Button not found!', flags: MessageFlags.Ephemeral });
            }

            if (!config[guildId][buttonId].actions) config[guildId][buttonId].actions = [];
            config[guildId][buttonId].actions.push({ type: 'timeout', duration: parseInt(duration), reason });
            saveButtonsConfig(config);

            const btnData = config[guildId][buttonId];
            const container = this.buildActionPanel(buttonId, btnData, guildId);
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            return true;
        }

        return false;
    }
};
