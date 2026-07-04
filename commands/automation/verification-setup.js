const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, PermissionFlagsBits, MessageFlags, SeparatorBuilder, SeparatorSpacingSize, EmbedBuilder, ChannelType } = require('discord.js');
const { setVerificationConfig, getVerificationConfig, deleteVerificationConfig } = require('../../utils/verificationManager');
const { startMessageBuilderSession, handleButtonInteraction, handleModalSubmit: handleMsgBuilderModal, buildMessageBuilderPanel, buildPreviewEmbed, buildComponentsV2Message, replacePlaceholders: msgReplacePlaceholders, extractPrefixFromCustomId } = require('../../utils/actionMessageBuilder');
const { checkAndExpire } = require('../../utils/panelExpiration');

const captchaTypeNames = {
    math: 'Math Problem',
    text: 'Unscramble Word',
    emoji: 'Emoji Recognition',
    button: 'Button Letter Input',
    random: 'Random (Any Type)'
};

const captchaDescriptions = {
    math: 'Solve a simple math equation (e.g., 5 + 3 = ?)',
    text: 'Unscramble a shuffled word to reveal the answer',
    emoji: 'Identify the correct emoji from a selection',
    button: 'Type letters shown on randomized buttons',
    random: 'Randomly selects from all captcha types'
};

const captchaDifficulty = {
    math: '<:Star:1521227981685526568> Easy',
    text: '<:Star:1521227981685526568><:Star:1521227981685526568> Medium',
    emoji: '<:Star:1521227981685526568> Easy',
    button: '<:Star:1521227981685526568><:Star:1521227981685526568><:Star:1521227981685526568> Hard',
    random: '<:Star:1521227981685526568><:Star:1521227981685526568> Varies'
};

function buildDefaultVerificationPayload(title, description, captchaType, btnRow) {
    const container = new ContainerBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `# ${title}\n\n` +
                `${description}\n\n` +
                `### <:Document:1521227875016114266> How to Verify\n` +
                `**Step 1:** Click the **<:Checkedbox:1521227734943269077> Verify Me** button below\n` +
                `**Step 2:** Complete the captcha challenge that appears\n` +
                `**Step 3:** Submit your answer to get verified!\n\n` +
                `### <:Bookmark:1521227835526742066> Captcha Type: ${captchaTypeNames[captchaType]}\n` +
                `${captchaDescriptions[captchaType]}\n` +
                `**Difficulty:** ${captchaDifficulty[captchaType]}\n\n` +
                `*This verification protects our community from bots and spam*`
            )
        );
    return { components: [container, btnRow], flags: MessageFlags.IsComponentsV2 };
}

function buildVerificationPanelPayload(panelConfig, guild, btnRow) {
    if (panelConfig.mode === 'components') {
        const container = buildComponentsV2Message(panelConfig, null, guild, null);
        container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
        container.addActionRowComponents(btnRow);
        return { components: [container], flags: MessageFlags.IsComponentsV2 };
    } else if (panelConfig.mode === 'embed') {
        const embed = new EmbedBuilder();
        if (panelConfig.title) embed.setTitle(msgReplacePlaceholders(panelConfig.title, null, guild));
        if (panelConfig.description) embed.setDescription(msgReplacePlaceholders(panelConfig.description, null, guild));
        if (panelConfig.color) embed.setColor(panelConfig.color);
        if (panelConfig.image) embed.setImage(panelConfig.image);
        if (panelConfig.thumbnail) embed.setThumbnail(panelConfig.thumbnail);
        if (panelConfig.author) embed.setAuthor({ name: msgReplacePlaceholders(panelConfig.author, null, guild), iconURL: panelConfig.authorIcon || undefined });
        if (panelConfig.footer) embed.setFooter({ text: msgReplacePlaceholders(panelConfig.footer, null, guild), iconURL: panelConfig.footerIcon || undefined });
        if (panelConfig.fields?.length) {
            for (const f of panelConfig.fields.slice(0, 25)) {
                embed.addFields({ name: msgReplacePlaceholders(f.name, null, guild), value: msgReplacePlaceholders(f.value, null, guild), inline: f.inline || false });
            }
        }
        return { embeds: [embed], components: [btnRow] };
    } else {
        const content = msgReplacePlaceholders(panelConfig.content || '', null, guild);
        const container = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
        return { components: [container, btnRow], flags: MessageFlags.IsComponentsV2 };
    }
}

// ── Shared helpers (used by BOTH slash execute and prefix executePrefix) ──────
// Keeping the server-wide permission logic in ONE place means the slash and
// prefix paths run identical, proven code — no risk of the two drifting apart.

// Hide every channel from @everyone and grant the verified role view access.
// Returns { hiddenCount, failedCount }.
async function applyEnablePermissions(guild, channel, role) {
    let hiddenCount = 0;
    let failedCount = 0;
    for (const [, ch] of guild.channels.cache) {
        if (ch.id === channel.id) continue;
        try {
            await ch.permissionOverwrites.edit(guild.id, { ViewChannel: false });
            await ch.permissionOverwrites.edit(role.id, { ViewChannel: true });
            hiddenCount++;
        } catch (err) {
            console.error(`Verification setup: Failed to set permissions on channel ${ch.name} (${ch.id}):`, err.message);
            failedCount++;
        }
    }
    // Verification channel stays visible to @everyone (read-only) + the role.
    try {
        await channel.permissionOverwrites.edit(guild.id, { ViewChannel: true, SendMessages: false });
        await channel.permissionOverwrites.edit(role.id, { ViewChannel: true });
    } catch (err) {
        console.error(`Verification setup: Failed to set verification channel permissions:`, err.message);
    }
    return { hiddenCount, failedCount };
}

// Revert @everyone ViewChannel overrides and remove the verified-role override.
// Returns { revertedCount, revertFailedCount }.
async function applyRevertPermissions(guild, config) {
    let revertedCount = 0;
    let revertFailedCount = 0;
    const roleId = config.roleId;
    for (const [, ch] of guild.channels.cache) {
        try {
            const permsToReset = { ViewChannel: null };
            if (ch.id === config.channelId) permsToReset.SendMessages = null;
            await ch.permissionOverwrites.edit(guild.id, permsToReset);
            const roleOverwrite = ch.permissionOverwrites.cache.get(roleId);
            if (roleOverwrite) await roleOverwrite.delete('Verification system disabled - reverting permissions');
            revertedCount++;
        } catch (err) {
            console.error(`Verification disable: Failed to revert permissions on channel ${ch.name} (${ch.id}):`, err.message);
            revertFailedCount++;
        }
    }
    return { revertedCount, revertFailedCount };
}

// Send the verification panel into the channel and return the sent Message.
async function sendVerificationPanel(guild, channel, { title, description, captchaType, panelConfig }) {
    const button = new ButtonBuilder()
        .setCustomId('verification_start')
        .setLabel('Verify Me')
        .setStyle(ButtonStyle.Success)
        .setEmoji('<:Checkedbox:1521227734943269077>');
    const btnRow = new ActionRowBuilder().addComponents(button);
    const payload = (panelConfig && panelConfig.mode)
        ? buildVerificationPanelPayload(panelConfig, guild, btnRow)
        : buildDefaultVerificationPayload(title, description, captchaType, btnRow);
    return channel.send(payload);
}

function buildNoConfigContainer() {
    return new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `# <:Infotriangle:1521227710381428926> Verification Not Configured\n\n` +
            `The verification system is not enabled on this server.\n\n` +
            `### 🚀 Get Started\n` +
            `Use \`/verification-setup enable\` (or \`verification-setup enable #channel @role\`) to set up verification.\n\n` +
            `### <:Lightbulbalt:1521227880703463675> Tip\n` +
            `Use \`verification-setup help\` for a detailed setup guide.`
        )
    );
}

function buildStatusContainer(guild, config) {
    const channel = guild.channels.cache.get(config.channelId);
    const role = guild.roles.cache.get(config.roleId);
    const captchaTypeDisplay = captchaTypeNames[config.captchaType] || 'Random (Any Type)';
    const captchaDesc = captchaDescriptions[config.captchaType] || captchaDescriptions.random;
    const difficulty = captchaDifficulty[config.captchaType] || captchaDifficulty.random;
    return new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `# <:Shield:1521227694677692467> Verification System Status\n\n` +
            `Protect your server from bots with captcha verification.\n\n` +
            `### <:Invoice:1521227903956811836> Current Configuration\n` +
            `**Status:** <:Toggleon:1521227758011809964> Enabled\n` +
            `**Verification Channel:** ${channel ? `${channel}` : '*<:Infotriangle:1521227710381428926> Channel not found*'}\n` +
            `**Verified Role:** ${role ? `${role}` : '*<:Infotriangle:1521227710381428926> Role not found*'}\n` +
            `**Captcha Type:** ${captchaTypeDisplay}\n` +
            `**Difficulty:** ${difficulty}\n\n` +
            `### <:Bookmark:1521227835526742066> Challenge Description\n` +
            `${captchaDesc}\n\n` +
            `### <:Document:1521227875016114266> Management\n` +
            `\`enable\` reconfigure · \`disable\` turn off · \`help\` detailed guide`
        )
    );
}

function buildHelpContainer() {
    return new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `# <:Clipboard:1521228175298920448> Verification System Guide\n\n` +
            `Works with **both** \`/verification-setup\` and the prefix \`verification-setup\`.\n\n` +
            `### <:Settings:1521227767780343879> Setup\n` +
            `**1.** Create a verification channel and a "Verified" role.\n` +
            `**2.** Run \`enable #channel @role [captcha-type]\`.\n` +
            `**3.** The bot hides all other channels from \`@everyone\` and posts a Verify panel.\n` +
            `**4.** Members complete a captcha → receive the role → gain access.\n\n` +
            `### <:Bookmark:1521227835526742066> Captcha Types\n` +
            `\`math\` · \`text\` (unscramble) · \`emoji\` · \`button\` (most secure) · \`random\`\n\n` +
            `### <:Infotriangle:1521227710381428926> Notes\n` +
            `• The bot's role must be **above** the verified role.\n` +
            `• Panel customization (\`panel\`) is interactive — use the slash command \`/verification-setup panel\`.\n\n` +
            `### <:Document:1521227875016114266> Commands\n` +
            `\`enable\` · \`disable\` · \`status\` · \`help\` · \`reset-panel\``
        )
    );
}

// Resolve a channel/role from a prefix-command token (mention, ID, or name).
function resolvePrefixChannel(guild, token) {
    if (!token) return null;
    const id = String(token).replace(/[<#>]/g, '');
    return guild.channels.cache.get(id) || guild.channels.cache.find(c => c.name?.toLowerCase() === String(token).toLowerCase()) || null;
}
function resolvePrefixRole(guild, token) {
    if (!token) return null;
    const id = String(token).replace(/[<@&>]/g, '');
    return guild.roles.cache.get(id) || guild.roles.cache.find(r => r.name?.toLowerCase() === String(token).toLowerCase()) || null;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('verification-setup')
        .setDescription('Setup a captcha verification system to protect your server from bots')
        .addSubcommand(subcommand =>
            subcommand.setName('enable').setDescription('Enable the verification system with captcha protection')
                .addChannelOption(option => option.setName('channel').setDescription('Channel where the verification panel will be displayed').setRequired(true))
                .addRoleOption(option => option.setName('role').setDescription('Role to give members after successful verification').setRequired(true))
                .addStringOption(option => option.setName('title').setDescription('Custom title for the verification message').setRequired(false))
                .addStringOption(option => option.setName('description').setDescription('Custom description for the verification message').setRequired(false))
                .addStringOption(option =>
                    option.setName('captcha-type').setDescription('Type of captcha challenge to use')
                        .addChoices(
                            { name: 'Math Problem - Solve equations', value: 'math' },
                            { name: 'Unscramble Word - Rearrange letters', value: 'text' },
                            { name: 'Emoji Recognition - Identify emojis', value: 'emoji' },
                            { name: 'Button Letter Input - Click letters', value: 'button' },
                            { name: 'Random (Any Type) - Varies each time', value: 'random' }
                        ).setRequired(false)))
        .addSubcommand(subcommand => subcommand.setName('disable').setDescription('Disable the verification system'))
        .addSubcommand(subcommand => subcommand.setName('status').setDescription('View current verification system configuration'))
        .addSubcommand(subcommand => subcommand.setName('help').setDescription('View detailed guide on how to use the verification system'))
        .addSubcommand(subcommand => subcommand.setName('panel').setDescription('Customize the verification panel message displayed in the channel'))
        .addSubcommand(subcommand => subcommand.setName('reset-panel').setDescription('Reset the verification panel message to default'))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    
    description: 'Setup a captcha verification system to protect your server from bots',
    category: 'automation',
    aliases: ['vsetup', 'verifysetup'],
    usage: 'verification-setup <enable #channel @role [type] | disable | status | help | reset-panel>',

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'panel') {
            return this.handlePanel(interaction);
        }

        if (subcommand === 'reset-panel') {
            return this.handleResetPanel(interaction);
        }
        
        if (subcommand === 'enable') {
            const channel = interaction.options.getChannel('channel');
            const role = interaction.options.getRole('role');
            const title = interaction.options.getString('title') || '<:Shield:1521227694677692467> Server Verification';
            const description = interaction.options.getString('description') || 'Complete a quick captcha to verify you are human and gain access to the server!';
            const captchaType = interaction.options.getString('captcha-type') || 'random';

            // Count channels that will be affected
            const allChannels = interaction.guild.channels.cache.filter(c => c.id !== channel.id);
            const channelCount = allChannels.filter(c => c.type !== ChannelType.GuildCategory).size;
            const categoryCount = allChannels.filter(c => c.type === ChannelType.GuildCategory).size;

            // Build confirmation prompt
            const confirmContainer = new ContainerBuilder()
                .setAccentColor(0xFEE75C)
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# <:Infotriangle:1521227710381428926> Confirmation Required\n\n` +
                        `You are about to activate the **Verification System** for this server.\n\n` +
                        `### <:Shield:1521227694677692467> What Will Happen\n` +
                        `• **All channels** will be **hidden** from \`@everyone\` (${channelCount} channels, ${categoryCount} categories)\n` +
                        `• Only members with the ${role} role will be able to see channels\n` +
                        `• The verification channel ${channel} will remain **visible** to everyone\n` +
                        `• A captcha verification panel will be sent in ${channel}\n` +
                        `• New members must complete a **${captchaTypeNames[captchaType]}** captcha to gain access\n\n` +
                        `### <:Key:1521228000467878111> Permission Changes\n` +
                        `\`@everyone\` → **ViewChannel: ✘ Denied** on all channels\n` +
                        `${role} → **ViewChannel: ✔ Allowed** on all channels\n` +
                        `${channel} → **ViewChannel: ✔ Allowed** for \`@everyone\`\n\n` +
                        `### <:Infotriangle:1521227710381428926> Important\n` +
                        `• This will make your server **fully private and secured**\n` +
                        `• Unverified members will **only** see the verification channel\n` +
                        `• Existing members without ${role} will lose channel access until verified\n\n` +
                        `**Are you sure you want to activate this?**`
                    )
                )
                .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
                .addActionRowComponents(
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId('verify_setup_confirm')
                            .setLabel('Activate Verification System')
                            .setStyle(ButtonStyle.Danger)
                            .setEmoji('<:Shield:1521227694677692467>'),
                        new ButtonBuilder()
                            .setCustomId('verify_setup_cancel')
                            .setLabel('Cancel')
                            .setStyle(ButtonStyle.Secondary)
                            .setEmoji('<:Cancel:1521227723916181644>')
                    )
                );

            const reply = await interaction.reply({ components: [confirmContainer], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, fetchReply: true });

            const collector = reply.createMessageComponentCollector({
                filter: i => i.user.id === interaction.user.id,
                time: 60000
            });

            collector.on('collect', async (btn) => {
                if (btn.customId === 'verify_setup_cancel') {
                    const cancelContainer = new ContainerBuilder()
                        .setAccentColor(0xED4245)
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(
                                `# <:Cancel:1521227723916181644> Setup Cancelled\n\n` +
                                `Verification system setup has been cancelled. No changes were made.\n\n` +
                                `Use \`/verification-setup enable\` to try again.`
                            )
                        );
                    await btn.update({ components: [cancelContainer] });
                    collector.stop();
                    return;
                }

                if (btn.customId === 'verify_setup_confirm') {
                    // Show loading state
                    const loadingContainer = new ContainerBuilder()
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(
                                `# <a:Loading:1521227993995940032> Activating Verification System\n\n` +
                                `Setting up channel permissions and securing your server...\n` +
                                `This may take a moment depending on the number of channels.`
                            )
                        );
                    await btn.update({ components: [loadingContainer] });

                    try {
                        // Apply permissions to all channels (shared helper)
                        const { hiddenCount, failedCount } = await applyEnablePermissions(interaction.guild, channel, role);

                        // Send verification panel (shared helper)
                        const existingCfg = getVerificationConfig(interaction.guild.id);
                        const panelConfig = existingCfg?.panelMessage || null;
                        const message = await sendVerificationPanel(interaction.guild, channel, { title, description, captchaType, panelConfig });

                        // Save config
                        const cfgData = {
                            enabled: true,
                            channelId: channel.id,
                            roleId: role.id,
                            messageId: message.id,
                            title: title,
                            description: description,
                            captchaType: captchaType
                        };
                        if (panelConfig) cfgData.panelMessage = panelConfig;
                        setVerificationConfig(interaction.guild.id, cfgData);

                        // Show success
                        const successContainer = new ContainerBuilder()
                            .setAccentColor(0x57F287)
                            .addTextDisplayComponents(
                                new TextDisplayBuilder().setContent(
                                    `# <:Checkedbox:1521227734943269077> Verification System Activated\n\n` +
                                    `Your server is now **fully private and secured** with captcha verification!\n\n` +
                                    `### <:Shield:1521227694677692467> Security Applied\n` +
                                    `**Channels Secured:** ${hiddenCount} channels hidden from \`@everyone\`\n` +
                                    (failedCount > 0 ? `**Failed:** ${failedCount} *(check bot permissions for these channels)*\n` : '') +
                                    `**Verification Channel:** ${channel} *(visible to everyone)*\n` +
                                    `**Verified Role:** ${role}\n\n` +
                                    `### <:Invoice:1521227903956811836> Configuration\n` +
                                    `**Captcha Type:** ${captchaTypeNames[captchaType]}\n` +
                                    `**Difficulty:** ${captchaDifficulty[captchaType]}\n\n` +
                                    `### <:Settings:1521227767780343879> How It Works Now\n` +
                                    `**1.** New members join → They can **only** see ${channel}\n` +
                                    `**2.** They click **Verify Me** → Captcha challenge appears\n` +
                                    `**3.** ${captchaDescriptions[captchaType]}\n` +
                                    `**4.** After verification → They receive ${role} and can see all channels\n\n` +
                                    `### <:Document:1521227875016114266> Management Commands\n` +
                                    `\`/verification-setup status\` - View current configuration\n` +
                                    `\`/verification-setup disable\` - Turn off verification\n` +
                                    `\`/verification-setup help\` - View detailed guide`
                                )
                            );
                        await reply.edit({ components: [successContainer] });
                    } catch (error) {
                        console.error('Error setting up verification:', error);
                        const errorContainer = new ContainerBuilder()
                            .setAccentColor(0xED4245)
                            .addTextDisplayComponents(
                                new TextDisplayBuilder().setContent(
                                    `# <:Cancel:1521227723916181644> Setup Failed\n\n` +
                                    `Failed to set up the verification system.\n\n` +
                                    `### <:Infotriangle:1521227710381428926> Possible Causes\n` +
                                    `• Bot lacks **Manage Channels** permission\n` +
                                    `• Bot lacks **Manage Roles** permission\n` +
                                    `• Bot's role is below the verified role in the hierarchy\n` +
                                    `• Missing access to the verification channel\n\n` +
                                    `Please check bot permissions and try again.`
                                )
                            );
                        await reply.edit({ components: [errorContainer] });
                    }
                    collector.stop();
                }
            });

            collector.on('end', async (collected, reason) => {
                if (reason === 'time' && collected.size === 0) {
                    const expiredContainer = new ContainerBuilder()
                        .setAccentColor(0x95A5A6)
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(
                                `# <:History:1521227863079256278> Setup Timed Out\n\n` +
                                `The verification setup confirmation has expired. No changes were made.\n\n` +
                                `Use \`/verification-setup enable\` to try again.`
                            )
                        );
                    await reply.edit({ components: [expiredContainer] }).catch(() => {});
                }
            });
        } else if (subcommand === 'disable') {
            const config = getVerificationConfig(interaction.guild.id);
            
            if (!config) {
                return await interaction.reply({ content: '<:Cancel:1521227723916181644> Verification system is not enabled.', flags: MessageFlags.Ephemeral });
            }

            const verifyChannel = interaction.guild.channels.cache.get(config.channelId);
            const verifyRole = interaction.guild.roles.cache.get(config.roleId);

            // Count channels affected
            const affectedChannels = interaction.guild.channels.cache.filter(c => c.id !== config.channelId);
            const channelCount = affectedChannels.filter(c => c.type !== ChannelType.GuildCategory).size;

            // Build confirmation prompt
            const confirmContainer = new ContainerBuilder()
                .setAccentColor(0xFEE75C)
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# <:Infotriangle:1521227710381428926> Disable Verification System?\n\n` +
                        `You are about to **disable** the verification system for this server.\n\n` +
                        `### <:Settings:1521227767780343879> What Will Happen\n` +
                        `• The verification panel will **stop working**\n` +
                        `• New members will **no longer** need to verify\n` +
                        `• Existing verified members keep their ${verifyRole || 'verified'} role\n\n` +
                        `### <:Key:1521228000467878111> Channel Permissions\n` +
                        `Choose whether to **revert channel permissions** (make all ${channelCount} channels visible to \`@everyone\` again) or keep the current restricted permissions.\n\n` +
                        `**Are you sure you want to disable verification?**`
                    )
                )
                .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
                .addActionRowComponents(
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId('verify_disable_revert')
                            .setLabel('Disable & Revert Permissions')
                            .setStyle(ButtonStyle.Danger)
                            .setEmoji('<:History:1521227863079256278>'),
                        new ButtonBuilder()
                            .setCustomId('verify_disable_keep')
                            .setLabel('Disable Only')
                            .setStyle(ButtonStyle.Primary)
                            .setEmoji('<:Cancel:1521227723916181644>'),
                        new ButtonBuilder()
                            .setCustomId('verify_disable_cancel')
                            .setLabel('Cancel')
                            .setStyle(ButtonStyle.Secondary)
                    )
                );

            const reply = await interaction.reply({ components: [confirmContainer], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, fetchReply: true });

            const collector = reply.createMessageComponentCollector({
                filter: i => i.user.id === interaction.user.id,
                time: 60000
            });

            collector.on('collect', async (btn) => {
                if (btn.customId === 'verify_disable_cancel') {
                    const cancelContainer = new ContainerBuilder()
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(
                                `# <:Cancel:1521227723916181644> Cancelled\n\n` +
                                `Verification system remains **active**. No changes were made.`
                            )
                        );
                    await btn.update({ components: [cancelContainer] });
                    collector.stop();
                    return;
                }

                const shouldRevert = btn.customId === 'verify_disable_revert';

                if (shouldRevert) {
                    // Show loading state
                    const loadingContainer = new ContainerBuilder()
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(
                                `# <a:Loading:1521227993995940032> Disabling Verification System\n\n` +
                                `Reverting channel permissions and cleaning up...\n` +
                                `This may take a moment.`
                            )
                        );
                    await btn.update({ components: [loadingContainer] });

                    // Revert permissions on all channels (shared helper)
                    const { revertedCount, revertFailedCount } = await applyRevertPermissions(interaction.guild, config);

                    deleteVerificationConfig(interaction.guild.id);

                    const container = new ContainerBuilder()
                        .setAccentColor(0xED4245)
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(
                                `# <:Toggleoff:1521227763816595559> Verification System Disabled\n\n` +
                                `The verification system has been disabled and channel permissions have been reverted.\n\n` +
                                `### <:Settings:1521227767780343879> Permissions Reverted\n` +
                                `**Channels Restored:** ${revertedCount} channels made visible to \`@everyone\`\n` +
                                (revertFailedCount > 0 ? `**Failed:** ${revertFailedCount} *(check bot permissions)*\n` : '') +
                                `**Verified Role Overwrites:** Removed from all channels\n\n` +
                                `### <:Infotriangle:1521227710381428926> Notes\n` +
                                `• Existing verified members keep their role\n` +
                                `• The verification panel in the channel will stop working\n\n` +
                                `### <:History:1521227863079256278> Re-enable Verification\n` +
                                `Use \`/verification-setup enable #channel @role\` to set up verification again.`
                            )
                        );

                    await reply.edit({ components: [container] });
                } else {
                    // Disable only - keep permissions
                    deleteVerificationConfig(interaction.guild.id);

                    const container = new ContainerBuilder()
                        .setAccentColor(0xED4245)
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(
                                `# <:Toggleoff:1521227763816595559> Verification System Disabled\n\n` +
                                `The verification system has been disabled for this server.\n\n` +
                                `### <:Infotriangle:1521227710381428926> Important Notes\n` +
                                `• New members will no longer need to complete captcha verification\n` +
                                `• The verification panel in the channel will stop working\n` +
                                `• Existing verified members keep their role\n` +
                                `• **Channel permissions were kept as-is** — channels may still be hidden from \`@everyone\`\n\n` +
                                `### <:Lightbulbalt:1521227880703463675> Tip\n` +
                                `If you want to make all channels visible again, use \`/verification-setup enable\` and then disable with **Revert Permissions**.\n\n` +
                                `### <:History:1521227863079256278> Re-enable Verification\n` +
                                `Use \`/verification-setup enable #channel @role\` to set up verification again.`
                            )
                        );

                    await btn.update({ components: [container] });
                }
                collector.stop();
            });

            collector.on('end', async (collected, reason) => {
                if (reason === 'time' && collected.size === 0) {
                    const expiredContainer = new ContainerBuilder()
                        .setAccentColor(0x95A5A6)
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(
                                `# <:History:1521227863079256278> Timed Out\n\n` +
                                `The disable confirmation has expired. Verification system remains **active**.\n\n` +
                                `Use \`/verification-setup disable\` to try again.`
                            )
                        );
                    await reply.edit({ components: [expiredContainer] }).catch(() => {});
                }
            });
        } else if (subcommand === 'status') {
            const config = getVerificationConfig(interaction.guild.id);
            if (!config) {
                return await interaction.reply({ components: [buildNoConfigContainer()], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }
            await interaction.reply({ components: [buildStatusContainer(interaction.guild, config)], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        } else if (subcommand === 'help') {
            await interaction.reply({ components: [buildHelpContainer()], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }
    },

    // ── Prefix usage — mirrors the slash command via the shared helpers above ──
    async executePrefix(message, args) {
        if (!message.guild) return;
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply({ content: '<:Cancel:1521227723916181644> You need the **Administrator** permission to manage verification.' }).catch(() => {});
        }

        const sub = (args[0] || 'status').toLowerCase();
        const guild = message.guild;

        if (sub === 'status') {
            const config = getVerificationConfig(guild.id);
            return message.reply({ components: [config ? buildStatusContainer(guild, config) : buildNoConfigContainer()], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }
        if (sub === 'help') {
            return message.reply({ components: [buildHelpContainer()], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }
        if (sub === 'panel') {
            return message.reply({ content: '<:Infotriangle:1521227710381428926> Panel customization is interactive — please use the slash command `/verification-setup panel`.' }).catch(() => {});
        }
        if (sub === 'reset-panel' || sub === 'resetpanel') {
            const config = getVerificationConfig(guild.id);
            if (!config) return message.reply({ components: [buildNoConfigContainer()], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
            delete config.panelMessage;
            setVerificationConfig(guild.id, config);
            return message.reply({ content: '<:Checkedbox:1521227734943269077> Verification panel reset to default. Re-run `verification-setup enable` to repost it.' }).catch(() => {});
        }

        if (sub === 'enable') {
            const channel = resolvePrefixChannel(guild, args[1]);
            const role = resolvePrefixRole(guild, args[2]);
            const captchaType = ['math', 'text', 'emoji', 'button', 'random'].includes((args[3] || '').toLowerCase()) ? args[3].toLowerCase() : 'random';
            if (!channel || channel.type === ChannelType.GuildCategory) {
                return message.reply({ content: '<:Cancel:1521227723916181644> Usage: `verification-setup enable #channel @role [math|text|emoji|button|random]`' }).catch(() => {});
            }
            if (!role) {
                return message.reply({ content: '<:Cancel:1521227723916181644> Provide a valid **role**. Usage: `verification-setup enable #channel @role [type]`' }).catch(() => {});
            }
            if (role.position >= guild.members.me.roles.highest.position) {
                return message.reply({ content: '<:Cancel:1521227723916181644> My highest role must be **above** the verified role for me to assign it.' }).catch(() => {});
            }

            const confirmRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('vsetup_pfx_confirm').setLabel('Activate Verification').setStyle(ButtonStyle.Danger).setEmoji('<:Shield:1521227694677692467>'),
                new ButtonBuilder().setCustomId('vsetup_pfx_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary).setEmoji('<:Cancel:1521227723916181644>')
            );
            const confirmContainer = new ContainerBuilder().setAccentColor(0xFEE75C).addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `# <:Infotriangle:1521227710381428926> Confirm Verification Setup\n\n` +
                    `This will **hide all channels** from \`@everyone\` so only ${role} can see them. ` +
                    `${channel} stays visible as the verification channel.\n\n` +
                    `**Captcha:** ${captchaTypeNames[captchaType]}\n\n` +
                    `Click **Activate** to continue.`
                )
            ).addActionRowComponents(confirmRow);

            const promptMsg = await message.reply({ components: [confirmContainer], flags: MessageFlags.IsComponentsV2 }).catch(() => null);
            if (!promptMsg) return;

            const collector = promptMsg.createMessageComponentCollector({ filter: i => i.user.id === message.author.id, time: 60000 });
            collector.on('collect', async (btn) => {
                if (btn.customId === 'vsetup_pfx_cancel') {
                    collector.stop();
                    return btn.update({ components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent('# <:Cancel:1521227723916181644> Cancelled\n\nNo changes were made.'))] }).catch(() => {});
                }
                if (btn.customId !== 'vsetup_pfx_confirm') return;
                await btn.update({ components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent('# <a:Loading:1521227993995940032> Activating…\n\nSecuring channels — this may take a moment.'))] }).catch(() => {});
                try {
                    const { hiddenCount, failedCount } = await applyEnablePermissions(guild, channel, role);
                    const existingCfg = getVerificationConfig(guild.id);
                    const panelConfig = existingCfg?.panelMessage || null;
                    const title = '<:Shield:1521227694677692467> Server Verification';
                    const description = 'Complete a quick captcha to verify you are human and gain access to the server!';
                    const panelMsg = await sendVerificationPanel(guild, channel, { title, description, captchaType, panelConfig });
                    const cfgData = { enabled: true, channelId: channel.id, roleId: role.id, messageId: panelMsg.id, title, description, captchaType };
                    if (panelConfig) cfgData.panelMessage = panelConfig;
                    setVerificationConfig(guild.id, cfgData);
                    await promptMsg.edit({ components: [new ContainerBuilder().setAccentColor(0x57F287).addTextDisplayComponents(new TextDisplayBuilder().setContent(
                        `# <:Checkedbox:1521227734943269077> Verification Activated\n\n` +
                        `**Channels secured:** ${hiddenCount}${failedCount ? ` (failed: ${failedCount})` : ''}\n` +
                        `**Verification channel:** ${channel}\n` +
                        `**Verified role:** ${role}\n` +
                        `**Captcha:** ${captchaTypeNames[captchaType]}`
                    ))] }).catch(() => {});
                } catch (err) {
                    console.error('Error setting up verification (prefix):', err);
                    await promptMsg.edit({ components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent('# <:Cancel:1521227723916181644> Setup Failed\n\nCheck that I have **Manage Channels** + **Manage Roles** and that my role is above the verified role.'))] }).catch(() => {});
                }
                collector.stop();
            });
            collector.on('end', (collected, reason) => {
                if (reason === 'time' && collected.size === 0) {
                    promptMsg.edit({ components: [new ContainerBuilder().setAccentColor(0x95A5A6).addTextDisplayComponents(new TextDisplayBuilder().setContent('# <:History:1521227863079256278> Timed Out\n\nNo changes were made.'))] }).catch(() => {});
                }
            });
            return;
        }

        if (sub === 'disable') {
            const config = getVerificationConfig(guild.id);
            if (!config) {
                return message.reply({ content: '<:Cancel:1521227723916181644> Verification system is not enabled.' }).catch(() => {});
            }
            const confirmRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('vsetup_pfx_disable_revert').setLabel('Disable & Revert Permissions').setStyle(ButtonStyle.Danger).setEmoji('<:History:1521227863079256278>'),
                new ButtonBuilder().setCustomId('vsetup_pfx_disable_keep').setLabel('Disable Only').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('vsetup_pfx_disable_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
            );
            const confirmContainer = new ContainerBuilder().setAccentColor(0xFEE75C).addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`# <:Infotriangle:1521227710381428926> Disable Verification?\n\nChoose whether to also **revert channel permissions** (make channels visible to \`@everyone\` again).`)
            ).addActionRowComponents(confirmRow);
            const promptMsg = await message.reply({ components: [confirmContainer], flags: MessageFlags.IsComponentsV2 }).catch(() => null);
            if (!promptMsg) return;
            const collector = promptMsg.createMessageComponentCollector({ filter: i => i.user.id === message.author.id, time: 60000 });
            collector.on('collect', async (btn) => {
                if (btn.customId === 'vsetup_pfx_disable_cancel') {
                    collector.stop();
                    return btn.update({ components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent('# <:Cancel:1521227723916181644> Cancelled\n\nVerification remains **active**.'))] }).catch(() => {});
                }
                const revert = btn.customId === 'vsetup_pfx_disable_revert';
                await btn.update({ components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent('# <a:Loading:1521227993995940032> Disabling…'))] }).catch(() => {});
                let summary = '';
                if (revert) {
                    const { revertedCount, revertFailedCount } = await applyRevertPermissions(guild, config);
                    summary = `\n**Channels restored:** ${revertedCount}${revertFailedCount ? ` (failed: ${revertFailedCount})` : ''}`;
                }
                deleteVerificationConfig(guild.id);
                await promptMsg.edit({ components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Toggleoff:1521227763816595559> Verification Disabled${summary}`))] }).catch(() => {});
                collector.stop();
            });
            collector.on('end', (collected, reason) => {
                if (reason === 'time' && collected.size === 0) {
                    promptMsg.edit({ components: [new ContainerBuilder().setAccentColor(0x95A5A6).addTextDisplayComponents(new TextDisplayBuilder().setContent('# <:History:1521227863079256278> Timed Out\n\nVerification remains **active**.'))] }).catch(() => {});
                }
            });
            return;
        }

        // Unknown subcommand → show the guide.
        return message.reply({ components: [buildHelpContainer()], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
    },

    async handlePanel(interaction) {
        const config = getVerificationConfig(interaction.guild.id);
        if (!config) {
            return interaction.reply({ content: '<:Cancel:1521227723916181644> Verification system is not set up yet! Use `/verification-setup enable` first.', flags: MessageFlags.Ephemeral });
        }

        const prefix = `verifypanel:${interaction.guild.id}`;
        const data = startMessageBuilderSession(interaction.user.id, 'verifypanel', interaction.guild.id, 'panel', 'Verification Panel Message');

        if (config.panelMessage) {
            const pm = config.panelMessage;
            data.mode = pm.mode || 'simple';
            data.content = pm.content || '';
            data.title = pm.title || '';
            data.description = pm.description || '';
            data.color = pm.color || '#5865F2';
            data.image = pm.image || '';
            data.thumbnail = pm.thumbnail || '';
            data.footer = pm.footer || '';
            data.footerIcon = pm.footerIcon || '';
            data.author = pm.author || '';
            data.authorIcon = pm.authorIcon || '';
            data.fields = pm.fields || [];
        }

        const container = buildMessageBuilderPanel(data, prefix, 'Verification Panel Message');
        await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    },

    async handleResetPanel(interaction) {
        const config = getVerificationConfig(interaction.guild.id);
        if (!config) {
            return interaction.reply({ content: '<:Cancel:1521227723916181644> Verification system is not set up yet!', flags: MessageFlags.Ephemeral });
        }

        delete config.panelMessage;
        setVerificationConfig(interaction.guild.id, config);

        // Update the live panel message
        try {
            const channel = await interaction.guild.channels.fetch(config.channelId).catch(() => null);
            if (channel && config.messageId) {
                const oldMsg = await channel.messages.fetch(config.messageId).catch(() => null);
                if (oldMsg) {
                    const button = new ButtonBuilder()
                        .setCustomId('verification_start')
                        .setLabel('Verify Me')
                        .setStyle(ButtonStyle.Success)
                        .setEmoji('<:Checkedbox:1521227734943269077>');
                    const btnRow = new ActionRowBuilder().addComponents(button);
                    const payload = buildDefaultVerificationPayload(
                        config.title || '<:Shield:1521227694677692467> Server Verification',
                        config.description || 'Complete a quick captcha to verify you are human and gain access to the server!',
                        config.captchaType || 'random',
                        btnRow
                    );
                    await oldMsg.edit(payload);
                }
            }
        } catch {}

        const container = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `# <:Checkedbox:1521227734943269077> Panel Message Reset\n\n` +
                    `The verification panel message has been reset to the default.\n\n` +
                    `Use \`/verification-setup panel\` to customize it again.`
                )
            );
        await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    },

    async handleInteraction(interaction) {
        if (!interaction.isButton()) return false;
        if (await checkAndExpire(interaction, 'config')) return true;
        const prefix = extractPrefixFromCustomId(interaction.customId);
        if (!prefix.startsWith('verifypanel:')) return false;

        const guildId = prefix.replace('verifypanel:', '');

        const onSave = async (btnInteraction, data) => {
            const config = getVerificationConfig(guildId);
            if (!config) {
                return btnInteraction.update({ content: '<:Cancel:1521227723916181644> Verification config not found!', components: [], flags: MessageFlags.Ephemeral });
            }

            config.panelMessage = {
                mode: data.mode,
                content: data.content || '',
                title: data.title || '',
                description: data.description || '',
                color: data.color || '#5865F2',
                image: data.image || '',
                thumbnail: data.thumbnail || '',
                footer: data.footer || '',
                footerIcon: data.footerIcon || '',
                author: data.author || '',
                authorIcon: data.authorIcon || '',
                fields: data.fields || []
            };
            setVerificationConfig(guildId, config);

            // Update the live panel message
            try {
                const guild = btnInteraction.guild;
                const channel = await guild.channels.fetch(config.channelId).catch(() => null);
                if (channel && config.messageId) {
                    const oldMsg = await channel.messages.fetch(config.messageId).catch(() => null);
                    if (oldMsg) {
                        const button = new ButtonBuilder()
                            .setCustomId('verification_start')
                            .setLabel('Verify Me')
                            .setStyle(ButtonStyle.Success)
                            .setEmoji('<:Checkedbox:1521227734943269077>');
                        const btnRow = new ActionRowBuilder().addComponents(button);
                        const payload = buildVerificationPanelPayload(config.panelMessage, guild, btnRow);
                        await oldMsg.edit(payload);
                    }
                }
            } catch {}

            const confirmContainer = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# <:Checkedbox:1521227734943269077> Panel Message Saved!\n\n` +
                        `Your custom verification panel message has been saved and applied.\n\n` +
                        `**Mode:** ${data.mode === 'embed' ? '<:Document:1521227875016114266> Embed' : data.mode === 'components' ? '<:Settings:1521227767780343879> Components V2' : '<:Hashtag:1521227771957870604> Simple'}\n\n` +
                        `The panel in the verification channel has been updated.\n\n` +
                        `Use \`/verification-setup reset-panel\` to revert to default.`
                    )
                );
            await btnInteraction.update({ components: [confirmContainer], flags: MessageFlags.IsComponentsV2 });
        };

        const onCancel = async (btnInteraction) => {
            await btnInteraction.update({ content: '<:Cancel:1521227723916181644> Panel builder cancelled.', components: [], flags: MessageFlags.Ephemeral });
        };

        return await handleButtonInteraction(interaction, prefix, 'verifypanel', guildId, 'panel', onSave, onCancel);
    },

    async handleModalSubmit(interaction) {
        const prefix = extractPrefixFromCustomId(interaction.customId);
        if (!prefix.startsWith('verifypanel:')) return false;

        const guildId = prefix.replace('verifypanel:', '');
        return await handleMsgBuilderModal(interaction, prefix, 'verifypanel', guildId, 'panel');
    }
};


// Exported so the dashboard→bot action runner (utils/dashActionRunner.js) can
// post the verification panel on the dashboard's behalf. Same builder the
// slash/prefix `enable` path uses, so both stay identical.
module.exports.sendVerificationPanel = sendVerificationPanel;
