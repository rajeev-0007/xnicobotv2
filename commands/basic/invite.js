const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, SectionBuilder, ThumbnailBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, SeparatorBuilder, SeparatorSpacingSize } = require('discord.js');

function buildInviteResponse(client) {
    const clientId = process.env.CLIENT_ID || client.user.id;
    const inviteLink = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&permissions=8&scope=bot%20applications.commands`;
    const totalMembers = client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0);
    const totalChannels = client.channels.cache.size;

    const container = new ContainerBuilder()
        ;

    const headerSection = new SectionBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `# <:xnico:1521228240440660180> Invite Nico\n\n` +
                `Add me to your server and unlock powerful features!`
            )
        )
        .setThumbnailAccessory(new ThumbnailBuilder({ media: { url: client.user.displayAvatarURL({ size: 256 }) } }));

    container.addSectionComponents(headerSection);

    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `### <:Fire:1521227907647668374> Features\n` +
            `<:Music:1521228141543165982> **Music** • Stream from YouTube, Spotify, SoundCloud\n` +
            `<:banhammer:1521227777083314529> **Moderation** • Anti-nuke, Anti-raid, Auto-mod\n` +
            `<:Lightningalt:1521227851796447472> **Leveling** • XP system with role rewards\n` +
            `<:NICO:1530980063028183082> **Economy** • Currency, shop, gambling\n` +
            `<:Envelopeopen:1521228083049271540> **Tickets** • Support ticket system\n` +
            `<:Present:1521228115655917659> **Giveaways** • Host interactive giveaways\n` +
            `<:rocket:1521228374805057756> **Welcomer** • Custom welcome/leave messages`
        )
    );

    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `### <:Lightning:1521227915537285150> Statistics\n` +
            `<:Folder:1521228095225331765> **${client.guilds.cache.size}** Servers\n` +
            `<:Userplus:1521227719621218477> **${totalMembers.toLocaleString()}** Users\n` +
            `<:Folder:1521228095225331765> **${totalChannels.toLocaleString()}** Channels\n` +
            `<a:glitchy:1531295690448179331> **${client.commands?.size || 517}** Commands`
        )
    );

    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `-# Click the button below to add me to your server!`
        )
    );

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setLabel('Invite Bot')
            .setURL(inviteLink)
            .setStyle(ButtonStyle.Link)
            .setEmoji('<:bots:1521227848101396610>'),
        new ButtonBuilder()
            .setLabel('Support Server')
            .setURL(process.env.SUPPORT_SERVER || 'https://discord.gg/Zs35X7Umak')
            .setStyle(ButtonStyle.Link)
            .setEmoji('<:Userplus:1521227719621218477>'),
        new ButtonBuilder()
            .setLabel('Vote')
            .setURL(`https://top.gg/bot/${clientId}/vote`)
            .setStyle(ButtonStyle.Link)
            .setEmoji('<:topgg:1521228219066482790>')
    );

    return { container, row };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('invite')
        .setDescription('Get the bot invite link'),

    async execute(interaction) {
        try {
            const { container, row } = buildInviteResponse(interaction.client);
            await interaction.reply({ components: [container.addActionRowComponents(row)], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error(`[INVITE] Error:`, error);
            const content = '<:Cancel:1521227723916181644> An error occurred while running this command.';
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content }).catch(() => { });
            } else {
                await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => { });
            }
        }
    },

    async executePrefix(message) {
        try {
            const { container, row } = buildInviteResponse(message.client);
            await message.reply({ components: [container.addActionRowComponents(row)], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error(`[INVITE] Error:`, error);
            await message.reply('<:Cancel:1521227723916181644> An error occurred while running this command.').catch(() => { });
        }
    }
};
