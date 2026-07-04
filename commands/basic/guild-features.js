const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, SectionBuilder, ThumbnailBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } = require('discord.js');
const { buildErrorResponse, COLORS } = require('../../utils/responseBuilder');

const featureEmojis = {
    'ANIMATED_BANNER': '<:Palette:1521227950601539755>',
    'ANIMATED_ICON': '<:Palette:1521227950601539755>',
    'BANNER': '<:Picture:1521227954191995024>',
    'COMMUNITY': '<:Userplus:1521227719621218477>',
    'DISCOVERABLE': '<:Search:1521228231263387738>',
    'INVITE_SPLASH': '<:Picture:1521227954191995024>',
    'MEMBER_VERIFICATION_GATE_ENABLED': '<:Checkedbox:1521227734943269077>',
    'MONETIZATION_ENABLED': '<:Invoice:1521227903956811836>',
    'MORE_STICKERS': '<:Edit:1521227886634205298>',
    'NEWS': '<:Bullhorn:1521227936575914016>',
    'PARTNERED': '<:Attach:1521228039135170722>',
    'PREVIEW_ENABLED': '<:Eye:1521227940480815156>',
    'ROLE_ICONS': '<:Userplus:1521227719621218477>',
    'VANITY_URL': '<:Attach:1521228039135170722>',
    'VERIFIED': '<:Checkedbox:1521227734943269077>',
    'VIP_REGIONS': '<:Star:1521227981685526568>',
    'WELCOME_SCREEN_ENABLED': '<:Userplus:1521227719621218477>'
};

function buildGuildFeatures(guild) {
    const features = guild.features.length > 0 
        ? guild.features.map(f => {
            const emoji = featureEmojis[f] || '<:Star:1521227981685526568>';
            const name = f.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
            return `> ${emoji} ${name}`;
        }).join('\n')
        : '> *No special features enabled*';

    let content = `# 🌟 Server Features\n\n`;
    content += `**Server:** ${guild.name}\n`;
    content += `**Feature Count:** ${guild.features.length}\n`;
    content += `**Boost Level:** ${guild.premiumTier}\n\n`;
    content += `### Enabled Features\n`;
    content += features;

    const section = new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

    if (guild.iconURL()) {
        section.setThumbnailAccessory(new ThumbnailBuilder({ media: { url: guild.iconURL({ size: 256 }) } }));
    }

    return new ContainerBuilder()
        .setAccentColor(COLORS.INFO)
        .addSectionComponents(section)
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('guild-features')
        .setDescription('View server features and perks'),

    prefix: 'guild-features',
    description: 'View server features and perks',
    usage: 'guild-features',
    category: 'basic',
    aliases: ['features', 'serverfeatures'],

    async execute(interaction) {
        try {
            const container = buildGuildFeatures(interaction.guild);
            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            const container = buildErrorResponse('Error', 'Failed to fetch server features.', error.message);
            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    },

    async executePrefix(message) {
        try {
            const container = buildGuildFeatures(message.guild);
            message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            const container = buildErrorResponse('Error', 'Failed to fetch server features.', error.message);
            message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
