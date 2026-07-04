const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, SectionBuilder, ThumbnailBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');

function buildAvatarResponse(user, member, mode = 'auto') {
    // Determine which avatar to show
    const hasServerAvatar = member && member.avatar;
    let avatarURL, title, activeMode;

    if (mode === 'server' && hasServerAvatar) {
        avatarURL = member.displayAvatarURL({ size: 4096 });
        title = `${member.displayName}'s Server Avatar`;
        activeMode = 'server';
    } else if (mode === 'global' || !hasServerAvatar) {
        avatarURL = user.displayAvatarURL({ size: 4096 });
        title = `${user.username}'s Global Avatar`;
        activeMode = 'global';
    } else {
        // auto — show server avatar if available, else global
        if (hasServerAvatar) {
            avatarURL = member.displayAvatarURL({ size: 4096 });
            title = `${member.displayName}'s Server Avatar`;
            activeMode = 'server';
        } else {
            avatarURL = user.displayAvatarURL({ size: 4096 });
            title = `${user.username}'s Global Avatar`;
            activeMode = 'global';
        }
    }

    // Build download links from the active source
    const source = activeMode === 'server' && hasServerAvatar ? member : user;
    const rawAvatar = activeMode === 'server' ? member.avatar : user.avatar;
    const isAnimated = rawAvatar && rawAvatar.startsWith('a_');

    const links = [
        `[PNG](${source.displayAvatarURL({ extension: 'png', size: 4096 })})`,
        `[JPG](${source.displayAvatarURL({ extension: 'jpg', size: 4096 })})`,
        `[WEBP](${source.displayAvatarURL({ extension: 'webp', size: 4096 })})`
    ];
    if (isAnimated) {
        links.push(`[GIF](${source.displayAvatarURL({ extension: 'gif', size: 4096 })})`);
    }

    const section = new SectionBuilder();
    section.addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${title}\n\n${links.join(' | ')}`));
    section.setThumbnailAccessory(new ThumbnailBuilder({ media: { url: source.displayAvatarURL({ size: 256 }) } }));

    const container = new ContainerBuilder()
        .addSectionComponents(section)
        .addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL(avatarURL)
            )
        )

    // Build action row with toggle buttons + open in browser
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`avatar_global_${user.id}`)
            .setEmoji('<:User:1521227714227343380>')
            .setLabel('Global Avatar')
            .setStyle(activeMode === 'global' ? ButtonStyle.Primary : ButtonStyle.Secondary)
            .setDisabled(activeMode === 'global'),
        new ButtonBuilder()
            .setCustomId(`avatar_server_${user.id}`)
            .setEmoji('<:User:1521227714227343380>')
            .setLabel('Server Avatar')
            .setStyle(activeMode === 'server' ? ButtonStyle.Primary : ButtonStyle.Secondary)
            .setDisabled(!hasServerAvatar || activeMode === 'server'),
        new ButtonBuilder()
            .setLabel('Open in Browser')
            .setStyle(ButtonStyle.Link)
            .setURL(avatarURL)
    );

    return { container, row };
}

module.exports = {
    prefix: 'avatar',
    description: 'Display a user\'s avatar (global or per-server)',
    usage: 'avatar [@user] [--global/--server]',
    category: 'basic',
    aliases: ['av', 'pfp', 'pic', 'avatar-url', 'avatarurl', 'sav', 'serveravatar'],
    dmAllowed: true,
    
    data: new SlashCommandBuilder()
        .setName('avatar')
        .setDescription('Display a user\'s avatar')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user whose avatar to display')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('type')
                .setDescription('Which avatar to show')
                .setRequired(false)
                .addChoices(
                    { name: 'Global', value: 'global' },
                    { name: 'Server', value: 'server' }
                )),
    
    async execute(interaction) {
        const user = interaction.options.getUser('user') || interaction.user;
        const mode = interaction.options.getString('type') || 'auto';
        
        // Fetch the guild member to get server-specific avatar
        let member = null;
        if (interaction.guild) {
            try {
                member = await interaction.guild.members.fetch(user.id);
            } catch {}
        }

        const { container, row } = buildAvatarResponse(user, member, mode);
        await interaction.reply({ components: [container.addActionRowComponents(row)], flags: MessageFlags.IsComponentsV2 });
    },

    async executePrefix(message, args) {
        let user = message.author;
        let mode = 'auto';
        
        // Check for --global or --server flags, or sav/serveravatar alias
        const flagArgs = args.filter(a => a.startsWith('--'));
        const nonFlagArgs = args.filter(a => !a.startsWith('--'));
        
        if (flagArgs.includes('--global')) mode = 'global';
        if (flagArgs.includes('--server') || flagArgs.includes('--sv')) mode = 'server';
        
        // If invoked via "sav" or "serveravatar" alias, default to server mode
        const invokedCmd = message.content.trim().split(/\s+/)[0].toLowerCase();
        if (invokedCmd.endsWith('sav') || invokedCmd.endsWith('serveravatar')) {
            mode = 'server';
        }

        if (message.mentions.users.size > 0) {
            user = message.mentions.users.first();
        } else if (nonFlagArgs[0]) {
            try {
                user = await message.client.users.fetch(nonFlagArgs[0]);
            } catch {}
        }

        // Fetch the guild member to get server-specific avatar
        let member = null;
        if (message.guild) {
            try {
                member = await message.guild.members.fetch(user.id);
            } catch {}
        }
        
        const { container, row } = buildAvatarResponse(user, member, mode);
        await message.reply({ components: [container.addActionRowComponents(row)], flags: MessageFlags.IsComponentsV2 });
    },

    // Handle button interactions for toggling between global/server avatar
    async handleButton(interaction) {
        const [, mode, userId] = interaction.customId.split('_');
        if (!userId) return;

        let user;
        try {
            user = await interaction.client.users.fetch(userId);
        } catch {
            return interaction.reply({ content: 'Could not fetch that user.', flags: MessageFlags.Ephemeral });
        }

        let member = null;
        if (interaction.guild) {
            try {
                member = await interaction.guild.members.fetch(userId);
            } catch {}
        }

        const { container, row } = buildAvatarResponse(user, member, mode);
        await interaction.update({ components: [container.addActionRowComponents(row)], flags: MessageFlags.IsComponentsV2 });
    }
};
