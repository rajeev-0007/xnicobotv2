const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } = require('discord.js');
const { getUserData } = require('../../utils/dataManager');
const { FONT_FAMILIES } = require('../../utils/fontRegistry');

const CARD_STYLES = {
    'Default': { emoji: '⮞', description: 'Classic rank card design' },
    'Minimal': { emoji: '⮞', description: 'Clean, simple aesthetic' },
    'Neon': { emoji: '⮞', description: 'Glowing cyberpunk style' },
    'Classic': { emoji: '⮞', description: 'Traditional elegant look' },
    'Modern': { emoji: '⮞', description: 'Contemporary flat design' }
};

module.exports = {
    /**
     * Premium-gated feature. `premiumOnly` is read by the
     * command dispatcher in index.js — non-premium users get a
     * polite premium-gate message instead of execution.
     *
     * Re-validation happens at component level (rankcard_* button
     * handler in utils/interactionHandlers.js) so that panels keep
     * working only as long as the user / server is premium.
     */
    premiumOnly: true,

    data: new SlashCommandBuilder()
        .setName('rank-customize')
        .setDescription('Customize your rank card appearance')
        .addSubcommand(sub => sub.setName('panel').setDescription('Open the rank card customization panel'))
        .addSubcommand(sub => sub.setName('help').setDescription('View detailed help for rank card customization'))
        .addSubcommand(sub => sub.setName('styles').setDescription('View all available card styles')),

    name: 'rank-customize',
    prefix: 'rank-customize',
    aliases: ['rankcustomize', 'customizerank', 'rcard', 'myrank'],
    description: 'Customize your rank card appearance',
    usage: 'rank-customize <panel|help|styles>',
    category: 'leveling',

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        if (subcommand === 'help') {
            await this.showHelpPanel(interaction);
        } else if (subcommand === 'styles') {
            await this.showStylesPanel(interaction);
        } else {
            await this.showCustomizationPanel(interaction, true);
        }
    },

    async executePrefix(message) {
        const args = message.content.split(' ').slice(1);
        if (args[0]?.toLowerCase() === 'help') {
            await this.showHelpPanel(message, false);
        } else if (args[0]?.toLowerCase() === 'styles') {
            await this.showStylesPanel(message, false);
        } else {
            await this.showCustomizationPanel(message, false);
        }
    },

    async showHelpPanel(context, isSlash = true) {
        const container = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder()
                    .setContent(
                        `# 📖 Rank Card Customization Guide\n\n` +
                        `Create a unique rank card that showcases your level and progress!\n\n` +
                        `## ⮞ Visual Options\n\n` +
                        `### ⮞ Background Image\n` +
                        `Set a custom background image using any direct image URL.\n` +
                        `**Supported formats:** JPG, PNG, GIF, WebP\n` +
                        `**Recommended size:** 934x282 pixels\n\n` +
                        `### ⮞ Background Color\n` +
                        `Set a solid background color using hex codes.\n` +
                        `**Examples:** \`#2f3136\` (Dark), \`#1a1a2e\` (Navy)\n\n` +
                        `### ⮞ Progress Bar Color\n` +
                        `Customize your XP progress bar color.\n` +
                        `**Default:** \`#bcf1e4\` (Discord Blurple)\n` +
                        `**Suggestions:** \`#57F287\` (Green), \`#FEE75C\` (Yellow)\n\n` +
                        `### ⮞ Text Color\n` +
                        `Change the color of all text on your rank card.\n` +
                        `**Default:** \`#ffffff\` (White)\n\n` +
                        `## ⮞ Card Styles\n\n` +
                        `Choose from 5 unique card layouts:\n` +
                        `• **Default** - Classic rank card design\n` +
                        `• **Minimal** - Clean, simple aesthetic\n` +
                        `• **Neon** - Glowing cyberpunk style\n` +
                        `• **Classic** - Traditional elegant look\n` +
                        `• **Modern** - Contemporary flat design\n\n` +
                        `## ⮞ Font Families\n\n` +
                        `Choose from 9 unique fonts for your card text:\n` +
                        `• **Inter** - Clean & versatile (default)\n` +
                        `• **Poppins** - Geometric & friendly\n` +
                        `• **Montserrat** - Bold & modern\n` +
                        `• **Outfit** - Rounded & warm\n` +
                        `• **Space Grotesk** - Techy & sharp\n` +
                        `• **JetBrains Mono** - Developer style\n` +
                        `• **Comfortaa** - Soft & playful\n` +
                        `• **Orbitron** - Futuristic sci-fi\n` +
                        `• **Rajdhani** - Sporty & condensed\n\n` +
                        `## ⮞ Actions\n\n` +
                        `• **Preview** - See how your card looks\n` +
                        `• **Reset All** - Restore all settings to defaults\n` +
                        `• **Refresh** - Update the panel with current settings`
                    )
            );

        const replyOptions = { components: [container], flags: MessageFlags.IsComponentsV2 };
        if (isSlash) replyOptions.flags |= MessageFlags.Ephemeral;
        await context.reply(replyOptions);
    },

    async showStylesPanel(context, isSlash = true) {
        let stylesContent = `# 🎴 Available Card Styles\n\n`;
        for (const [name, info] of Object.entries(CARD_STYLES)) {
            stylesContent += `### ${info.emoji} ${name}\n${info.description}\n\n`;
        }
        stylesContent += `*Use the Card Style button in the panel to select your preferred style!*`;

        const container = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(stylesContent));

        const replyOptions = { components: [container], flags: MessageFlags.IsComponentsV2 };
        if (isSlash) replyOptions.flags |= MessageFlags.Ephemeral;
        await context.reply(replyOptions);
    },

    async showCustomizationPanel(context, isSlash, isUpdate = false) {
        try {
            const user = isSlash ? context.user : context.author;
            const userData = await getUserData(user.id);
            
            const currentSettings = {
                background: userData.profile?.rankCard?.customBackground || userData.profile?.customBackground || null,
                banner: userData.profile?.rankCard?.bannerImage || null,
                bannerMode: userData.profile?.rankCard?.bannerMode || 'strip',
                bgColor: userData.profile?.rankCard?.backgroundColor || userData.profile?.backgroundColor || '#2f3136',
                progressColor: userData.profile?.rankCard?.progressBarColor || userData.profile?.progressBarColor || '#bcf1e4',
                textColor: userData.profile?.rankCard?.textColor || userData.profile?.textColor || '#ffffff',
                cardStyle: userData.profile?.rankCard?.cardStyle || userData.profile?.cardStyle || 'Default',
                fontFamily: userData.profile?.rankCard?.fontFamily || 'Inter'
            };

            const fontInfo = FONT_FAMILIES[currentSettings.fontFamily] || FONT_FAMILIES['Inter'];

            const progressHex = parseInt(currentSettings.progressColor.replace('#', ''), 16);
            const styleInfo = CARD_STYLES[currentSettings.cardStyle] || CARD_STYLES['Default'];

            const setupButtons1 = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('rankcard_set_background')
                        .setLabel('Background')
                        .setStyle(currentSettings.background ? ButtonStyle.Success : ButtonStyle.Secondary)
                        .setEmoji('<:Picture:1521227954191995024>'),
                    new ButtonBuilder()
                        .setCustomId('rankcard_set_banner')
                        .setLabel('Banner')
                        .setStyle(currentSettings.banner ? ButtonStyle.Success : ButtonStyle.Secondary)
                        .setEmoji('<:Picture:1521227954191995024>'),
                    new ButtonBuilder()
                        .setCustomId('rankcard_set_bgcolor')
                        .setLabel('BG Color')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('<:Palette:1521227950601539755>'),
                    new ButtonBuilder()
                        .setCustomId('rankcard_set_progresscolor')
                        .setLabel('Progress')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('<:Invoice:1521227903956811836>'),
                    new ButtonBuilder()
                        .setCustomId('rankcard_set_textcolor')
                        .setLabel('Text')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('<:Editalt:1521227921673556019>')
                );

            const setupButtons2 = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('rankcard_set_bannermode')
                        .setLabel(currentSettings.bannerMode === 'full' ? 'Banner: Full' : 'Banner: Strip')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('<:Eye:1521227940480815156>'),
                    new ButtonBuilder()
                        .setCustomId('rankcard_set_opacity')
                        .setLabel('Opacity')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('<:Eye:1521227940480815156>'),
                    new ButtonBuilder()
                        .setCustomId('rankcard_set_cardstyle')
                        .setLabel('Style')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('<:Picture:1521227954191995024>'),
                    new ButtonBuilder()
                        .setCustomId('rankcard_set_font')
                        .setLabel('Font')
                        .setStyle(currentSettings.fontFamily !== 'Inter' ? ButtonStyle.Success : ButtonStyle.Primary)
                        .setEmoji('<:Document:1521227875016114266>'),
                    new ButtonBuilder()
                        .setCustomId('rankcard_preview')
                        .setLabel('Preview')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('<:Eye:1521227940480815156>')
                );

            const actionButtons = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('rankcard_help_btn')
                        .setLabel('Help')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('<:Lightbulbalt:1521227880703463675>'),
                    new ButtonBuilder()
                        .setCustomId('rankcard_reset')
                        .setLabel('Reset All')
                        .setStyle(ButtonStyle.Danger)
                        .setEmoji('<:Trash:1521227750420254820>'),
                    new ButtonBuilder()
                        .setCustomId('rankcard_refresh')
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

            const container = new ContainerBuilder()
                .setAccentColor(isNaN(progressHex) ? 0xCAD7E6 : progressHex)
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`# <:Award:1521228119640375336> Rank Card Studio\n-# Customize how your \`/rank\` card looks. Changes save instantly — hit **Preview** to see them.`)
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
                            `Progress Bar      ${currentSettings.progressColor}\n` +
                            `Text Color        ${currentSettings.textColor}\n` +
                            `Card Style        ${currentSettings.cardStyle}\n` +
                            `Font              ${fontInfo.name}\n` +
                            `\`\`\`\n` +
                            `<:Picture:1521227954191995024> **Background:** ${bgDisplay}\n` +
                            `<:Picture:1521227954191995024> **Banner:** ${bannerDisplay}\n` +
                            `<:Eye:1521227940480815156> **Banner Mode:** ${bannerModeLabel}`
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
            console.error('Error in rank-customize command:', error);
            const errorMsg = '<:Cancel:1521227723916181644> Failed to load rank card customization. Please try again!';
            if (context.reply) {
                await context.reply({ content: errorMsg, flags: MessageFlags.Ephemeral });
            }
        }
    }
};
