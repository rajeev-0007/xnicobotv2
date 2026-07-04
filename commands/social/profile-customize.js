const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } = require('discord.js');
const { getUserData } = require('../../utils/dataManager');
const { FONT_FAMILIES } = require('../../utils/fontRegistry');

module.exports = {
    /**
     * Premium-gated feature. `premiumOnly` is read by the
     * command dispatcher in index.js — non-premium users get a
     * polite premium-gate message instead of execution.
     *
     * Re-validation happens at component level (profile_* button
     * handler in utils/interactionHandlers.js) so that panels keep
     * working only as long as the user / server is premium.
     */
    premiumOnly: true,

    data: new SlashCommandBuilder()
        .setName('profile-customize')
        .setDescription('Customize your profile card appearance')
        .addSubcommand(sub => sub.setName('panel').setDescription('Open the profile customization panel'))
        .addSubcommand(sub => sub.setName('help').setDescription('View detailed help for profile customization'))
        .addSubcommand(sub => sub.setName('visibility').setDescription('Configure what shows on your profile')),
    
    name: 'profile-customize',
    prefix: 'profile-customize',
    aliases: ['profilecustomize', 'customizeprofile', 'pcard', 'myprofile'],
    description: 'Customize your profile card appearance',
    category: 'social',

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        if (subcommand === 'help') {
            await this.showHelpPanel(interaction);
        } else if (subcommand === 'visibility') {
            await this.showVisibilityPanel(interaction, true);
        } else {
            await this.showCustomizationPanel(interaction, true);
        }
    },

    async executePrefix(message) {
        const args = message.content.split(' ').slice(1);
        if (args[0]?.toLowerCase() === 'help') {
            await this.showHelpPanel(message, false);
        } else {
            await this.showCustomizationPanel(message, false);
        }
    },

    async showHelpPanel(context, isSlash = true) {
        const container = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder()
                    .setContent(
                        `# 📖 Profile Card Customization Guide\n\n` +
                        `Personalize your profile card to stand out! Here's everything you can customize:\n\n` +
                        `## ⮞ Visual Options\n\n` +
                        `### ⮞ Background Image\n` +
                        `Set a custom background image using any direct image URL.\n` +
                        `**Supported formats:** JPG, PNG, GIF, WebP\n` +
                        `**Tip:** Use sites like Imgur or Discord CDN for reliable hosting.\n\n` +
                        `### ⮞ Background Color\n` +
                        `Set a solid background color using hex codes.\n` +
                        `**Examples:** \`#bcf1e4\` (Discord blue), \`#2f3136\` (Dark), \`#ffffff\` (White)\n\n` +
                        `### 💫 Accent Color\n` +
                        `The highlight color used for borders and decorations.\n` +
                        `**Default:** \`#bcf1e4\` (Discord Blurple)\n\n` +
                        `### ⮞ Text Color\n` +
                        `Change the color of text on your profile card.\n` +
                        `**Default:** \`#ffffff\` (White)\n\n` +
                        `## ⮞ Display Options\n\n` +
                        `### 🏅 Badge Style\n` +
                        `Choose how your badges are displayed:\n` +
                        `• **Default** - Standard badge layout\n` +
                        `• **Compact** - Smaller, condensed badges\n` +
                        `• **Minimal** - Only show top badges\n` +
                        `• **Hidden** - Hide badges completely\n\n` +
                        `### ⮞ Bio\n` +
                        `Write a short bio (up to 150 characters).\n` +
                        `**Tip:** Custom Discord emojis work in your bio!\n\n` +
                        `## ⮞ Actions\n\n` +
                        `• **Preview** - See how your card looks before saving\n` +
                        `• **Reset All** - Restore all settings to defaults\n` +
                        `• **Refresh** - Update the panel with current settings`
                    )
            );

        const replyOptions = { components: [container], flags: MessageFlags.IsComponentsV2 };
        if (isSlash) replyOptions.flags |= MessageFlags.Ephemeral;
        
        if (isSlash) {
            await context.reply(replyOptions);
        } else {
            await context.reply(replyOptions);
        }
    },

    async showCustomizationPanel(context, isSlash, isUpdate = false) {
        try {
            const user = isSlash ? context.user : context.author;
            const userData = await getUserData(user.id);
            
            const currentSettings = {
                background: userData.profile?.profileCard?.customBackground || userData.profile?.customBackground || null,
                banner: userData.profile?.profileCard?.bannerImage || null,
                bannerMode: userData.profile?.profileCard?.bannerMode || 'strip',
                bgColor: userData.profile?.profileCard?.backgroundColor || userData.profile?.backgroundColor || '#2f3136',
                textColor: userData.profile?.profileCard?.textColor || userData.profile?.textColor || '#ffffff',
                accentColor: userData.profile?.profileCard?.accentColor || userData.profile?.accentColor || '#bcf1e4',
                badgeStyle: userData.profile?.profileCard?.badgeStyle || userData.profile?.badgeStyle || 'Default',
                cardStyle: userData.profile?.profileCard?.cardStyle || 'Default',
                bio: userData.social?.bio || null,
                fontFamily: userData.profile?.profileCard?.fontFamily || 'Inter'
            };

            const CARD_STYLES = {
                'Default': { emoji: '🎴' }, 'Minimal': { emoji: '◻' }, 'Neon': { emoji: '💫' },
                'Classic': { emoji: '🏛' }, 'Modern': { emoji: '🔷' }
            };
            const styleInfo = CARD_STYLES[currentSettings.cardStyle] || CARD_STYLES['Default'];

            const fontInfo = FONT_FAMILIES[currentSettings.fontFamily] || FONT_FAMILIES['Inter'];

            const accentHex = parseInt(currentSettings.accentColor.replace('#', ''), 16);

            const setupButtons1 = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('profile_set_background')
                        .setLabel('Background')
                        .setStyle(currentSettings.background ? ButtonStyle.Success : ButtonStyle.Secondary)
                        .setEmoji('<:Picture:1521227954191995024>'),
                    new ButtonBuilder()
                        .setCustomId('profile_set_banner')
                        .setLabel('Banner')
                        .setStyle(currentSettings.banner ? ButtonStyle.Success : ButtonStyle.Secondary)
                        .setEmoji('<:Picture:1521227954191995024>'),
                    new ButtonBuilder()
                        .setCustomId('profile_set_bgcolor')
                        .setLabel('BG Color')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('<:Palette:1521227950601539755>'),
                    new ButtonBuilder()
                        .setCustomId('profile_set_accentcolor')
                        .setLabel('Accent')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('💫'),
                    new ButtonBuilder()
                        .setCustomId('profile_set_textcolor')
                        .setLabel('Text')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('<:Editalt:1521227921673556019>')
                );

            const setupButtons2 = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('profile_set_bannermode')
                        .setLabel(currentSettings.bannerMode === 'full' ? 'Banner: Full' : 'Banner: Strip')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('<:Eye:1521227940480815156>'),
                    new ButtonBuilder()
                        .setCustomId('profile_set_font')
                        .setLabel('Font')
                        .setStyle(currentSettings.fontFamily !== 'Inter' ? ButtonStyle.Success : ButtonStyle.Primary)
                        .setEmoji('🔤'),
                    new ButtonBuilder()
                        .setCustomId('profile_set_opacity')
                        .setLabel('Opacity')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('<:Eye:1521227940480815156>'),
                    new ButtonBuilder()
                        .setCustomId('profile_set_cardstyle')
                        .setLabel('Style')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('🎴'),
                    new ButtonBuilder()
                        .setCustomId('profile_set_badgestyle')
                        .setLabel('Badges')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('🏅')
                );

            const setupButtons3 = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('profile_set_bio')
                        .setLabel('Bio')
                        .setStyle(currentSettings.bio ? ButtonStyle.Success : ButtonStyle.Secondary)
                        .setEmoji('<:Edit:1521227886634205298>'),
                    new ButtonBuilder()
                        .setCustomId('profile_preview')
                        .setLabel('Preview')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('<:Eye:1521227940480815156>')
                );

            const actionButtons = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('profile_help_btn')
                        .setLabel('Help')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('<:Lightbulbalt:1521227880703463675>'),
                    new ButtonBuilder()
                        .setCustomId('profile_reset')
                        .setLabel('Reset All')
                        .setStyle(ButtonStyle.Danger)
                        .setEmoji('<:Trash:1521227750420254820>'),
                    new ButtonBuilder()
                        .setCustomId('profile_refresh')
                        .setLabel('Refresh')
                        .setStyle(ButtonStyle.Success)
                        .setEmoji('<:History:1521227863079256278>')
                );

            const bgDisplay = currentSettings.background 
                ? (currentSettings.background.length > 35 ? currentSettings.background.substring(0, 35) + '...' : currentSettings.background)
                : '`Default`';

            const bannerDisplay = currentSettings.banner
                ? (currentSettings.banner.length > 35 ? currentSettings.banner.substring(0, 35) + '...' : currentSettings.banner)
                : '`None`';
            const bannerModeLabel = currentSettings.bannerMode === 'full' ? 'Full background' : 'Top strip';

            const bioDisplay = currentSettings.bio 
                ? (currentSettings.bio.length > 40 ? `"${currentSettings.bio.substring(0, 40)}..."` : `"${currentSettings.bio}"`)
                : '`Not set`';

            const container = new ContainerBuilder()
                .setAccentColor(isNaN(accentHex) ? 0xCAD7E6 : accentHex)
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`# <:User:1521227714227343380> Profile Card Studio\n-# Customize how your \`/socialprofile\` card looks. Changes save instantly — hit **Preview** to see them.`)
                )
                .addSeparatorComponents(
                    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
                )
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(
                            `### <:Palette:1521227950601539755> Current Theme\n` +
                            `\`\`\`ansi\n` +
                            `Background Color  ${currentSettings.bgColor}\n` +
                            `Accent Color      ${currentSettings.accentColor}\n` +
                            `Text Color        ${currentSettings.textColor}\n` +
                            `Card Style        ${currentSettings.cardStyle}\n` +
                            `Badge Style       ${currentSettings.badgeStyle}\n` +
                            `Font              ${fontInfo.name}\n` +
                            `\`\`\`\n` +
                            `<:Picture:1521227954191995024> **Background:** ${bgDisplay}\n` +
                            `<:Picture:1521227954191995024> **Banner:** ${bannerDisplay}\n` +
                            `<:Eye:1521227940480815156> **Banner Mode:** ${bannerModeLabel}\n` +
                            `<:Edit:1521227886634205298> **Bio:** ${bioDisplay}`
                        )
                )
                .addSeparatorComponents(
                    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
                )
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`### <:Settings:1521227767780343879> Customization`)
                )
                .addActionRowComponents(setupButtons1)
                .addActionRowComponents(setupButtons2)
                .addActionRowComponents(setupButtons3)
                .addSeparatorComponents(
                    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
                )
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`### <:Settings:1521227767780343879> Actions`)
                )
                .addActionRowComponents(actionButtons);

            if (isUpdate && context.update) {
                await context.update({
                    components: [container],
                    flags: MessageFlags.IsComponentsV2
                });
            } else if (isSlash) {
                await context.reply({
                    components: [container],
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
                });
            } else {
                await context.reply({
                    components: [container],
                    flags: MessageFlags.IsComponentsV2
                });
            }
        } catch (error) {
            console.error('Error in profile-customize command:', error);
            const errorMsg = '<:Cancel:1521227723916181644> Failed to load profile customization. Please try again!';
            if (context.reply) {
                await context.reply({ content: errorMsg, flags: MessageFlags.Ephemeral });
            }
        }
    },

    async showVisibilityPanel(context, isSlash = true) {
        const user = isSlash ? context.user : context.author;
        const userData = await getUserData(user.id);
        
        const visibility = userData.profile?.visibility || {
            showLevel: true,
            showXP: true,
            showBalance: true,
            showBadges: true,
            showBio: true,
            showJoinDate: true,
            showRep: true,
            showMarriage: true,
            showVoiceTime: true,
            showMessageCount: true
        };

        const settingsText = `\`\`\`ansi
\u001b[1;35m╔════════════════════════════════════╗
\u001b[1;35m║    \u001b[1;37mProfile Visibility Settings    \u001b[1;35m║
\u001b[1;35m╠════════════════════════════════════╣
\u001b[1;35m║ \u001b[1;36m<:Invoice:1521227903956811836> Level & XP:    ${visibility.showLevel !== false ? '\u001b[1;32m✓ Visible' : '\u001b[1;31m✗ Hidden '}  \u001b[1;35m║
\u001b[1;35m║ \u001b[1;36m💰 Balance:       ${visibility.showBalance !== false ? '\u001b[1;32m✓ Visible' : '\u001b[1;31m✗ Hidden '}  \u001b[1;35m║
\u001b[1;35m║ \u001b[1;36m🏅 Badges:        ${visibility.showBadges !== false ? '\u001b[1;32m✓ Visible' : '\u001b[1;31m✗ Hidden '}  \u001b[1;35m║
\u001b[1;35m║ \u001b[1;36m<:Edit:1521227886634205298> Bio:           ${visibility.showBio !== false ? '\u001b[1;32m✓ Visible' : '\u001b[1;31m✗ Hidden '}  \u001b[1;35m║
\u001b[1;35m║ \u001b[1;36m<:Bookopen:1521227911137595605> Join Date:     ${visibility.showJoinDate !== false ? '\u001b[1;32m✓ Visible' : '\u001b[1;31m✗ Hidden '}  \u001b[1;35m║
\u001b[1;35m║ \u001b[1;36m<:Star:1521227981685526568> Reputation:    ${visibility.showRep !== false ? '\u001b[1;32m✓ Visible' : '\u001b[1;31m✗ Hidden '}  \u001b[1;35m║
\u001b[1;35m║ \u001b[1;36m💕 Marriage:      ${visibility.showMarriage !== false ? '\u001b[1;32m✓ Visible' : '\u001b[1;31m✗ Hidden '}  \u001b[1;35m║
\u001b[1;35m║ \u001b[1;36m<:Microphone:1521227746376683590> Voice Time:    ${visibility.showVoiceTime !== false ? '\u001b[1;32m✓ Visible' : '\u001b[1;31m✗ Hidden '}  \u001b[1;35m║
\u001b[1;35m║ \u001b[1;36m<:Hashtag:1521227771957870604> Messages:      ${visibility.showMessageCount !== false ? '\u001b[1;32m✓ Visible' : '\u001b[1;31m✗ Hidden '}  \u001b[1;35m║
\u001b[1;35m╚════════════════════════════════════╝
\`\`\``;

        const row1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('profile_vis_level')
                .setLabel('Level/XP')
                .setStyle(visibility.showLevel !== false ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setEmoji('<:Invoice:1521227903956811836>'),
            new ButtonBuilder()
                .setCustomId('profile_vis_balance')
                .setLabel('Balance')
                .setStyle(visibility.showBalance !== false ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setEmoji('💰'),
            new ButtonBuilder()
                .setCustomId('profile_vis_badges')
                .setLabel('Badges')
                .setStyle(visibility.showBadges !== false ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setEmoji('🏅'),
            new ButtonBuilder()
                .setCustomId('profile_vis_bio')
                .setLabel('Bio')
                .setStyle(visibility.showBio !== false ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setEmoji('<:Edit:1521227886634205298>')
        );

        const row2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('profile_vis_joindate')
                .setLabel('Join Date')
                .setStyle(visibility.showJoinDate !== false ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setEmoji('<:Bookopen:1521227911137595605>'),
            new ButtonBuilder()
                .setCustomId('profile_vis_rep')
                .setLabel('Reputation')
                .setStyle(visibility.showRep !== false ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setEmoji('<:Star:1521227981685526568>'),
            new ButtonBuilder()
                .setCustomId('profile_vis_marriage')
                .setLabel('Marriage')
                .setStyle(visibility.showMarriage !== false ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setEmoji('💕'),
            new ButtonBuilder()
                .setCustomId('profile_vis_voicetime')
                .setLabel('Voice')
                .setStyle(visibility.showVoiceTime !== false ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setEmoji('<:Microphone:1521227746376683590>')
        );

        const row3 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('profile_vis_messages')
                .setLabel('Messages')
                .setStyle(visibility.showMessageCount !== false ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setEmoji('<:Hashtag:1521227771957870604>'),
            new ButtonBuilder()
                .setCustomId('profile_vis_show_all')
                .setLabel('Show All')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('<:Eye:1521227940480815156>'),
            new ButtonBuilder()
                .setCustomId('profile_vis_hide_all')
                .setLabel('Hide All')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('<:Commentblock:1521227898101432331>'),
            new ButtonBuilder()
                .setCustomId('profile_vis_back')
                .setLabel('Back')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('<:Caretleft:1521227977495543838>')
        );

        const container = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent('# <:Eye:1521227940480815156> Profile Visibility\n-# Choose what information to show on your profile')
            )
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(settingsText))
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent('-# Click buttons to toggle visibility • Green = Visible, Gray = Hidden')
            )
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
            .addActionRowComponents(row1)
            .addActionRowComponents(row2)
            .addActionRowComponents(row3);

        const replyOptions = { components: [container], flags: MessageFlags.IsComponentsV2 };
        if (isSlash) replyOptions.flags |= MessageFlags.Ephemeral;
        
        await context.reply(replyOptions);
    }
};
