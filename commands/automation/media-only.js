const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { buildErrorResponse, COLORS } = require('../../utils/responseBuilder');
const { paginate, setupPaginationCollector } = require('../../utils/pagination');

const jsonStore = require('../../utils/jsonStore');
module.exports = {
    category: 'automation',
    data: new SlashCommandBuilder()
        .setName('media-only')
        .setDescription('Configure media-only channels (only images/videos/files allowed)')
        .addSubcommand(subcommand =>
            subcommand.setName('add').setDescription('Make a channel media-only')
                .addChannelOption(option =>
                    option.setName('channel').setDescription('The channel to make media-only').addChannelTypes(ChannelType.GuildText).setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand.setName('remove').setDescription('Remove media-only restriction from a channel')
                .addChannelOption(option =>
                    option.setName('channel').setDescription('The channel to remove restriction from').addChannelTypes(ChannelType.GuildText).setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand.setName('list').setDescription('List all media-only channels in this server')
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    async execute(interaction) {
        try {
        const subcommand = interaction.options.getSubcommand();

        let config = {};
        if (jsonStore.has('media-only')) {
            config = jsonStore.read('media-only');
        }

        if (!config[interaction.guild.id]) {
            config[interaction.guild.id] = { channels: [] };
        }

        if (subcommand === 'add') {
            const channel = interaction.options.getChannel('channel');

            if (config[interaction.guild.id].channels.includes(channel.id)) {
                const container = new ContainerBuilder()
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(
                            `# <:Cancel:1521227723916181644> Already Media-Only\n\n${channel} is already configured as a media-only channel.`
                        )
                    );

                return await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            config[interaction.guild.id].channels.push(channel.id);
            jsonStore.write('media-only', config);

            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# <:Checkedbox:1521227734943269077> Media-Only Channel Added\n\n` +
                        `${channel} is now a media-only channel.\n\n` +
                        `Only messages with attachments (images, videos, files) will be allowed.\n\n` +
                        `**<:Bookopen:1521227911137595605> Rules:**\n` +
                        `• Messages must contain at least one attachment\n` +
                        `• Text-only messages will be auto-deleted\n` +
                        `• Moderators and admins are exempt\n\n` +
                        `*Users will be notified when their messages are deleted*`
                    )
                );

            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } else if (subcommand === 'remove') {
            const channel = interaction.options.getChannel('channel');

            if (!config[interaction.guild.id].channels.includes(channel.id)) {
                const container = new ContainerBuilder()
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(
                            `# <:Cancel:1521227723916181644> Not Media-Only\n\n${channel} is not configured as a media-only channel.`
                        )
                    );

                return await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            config[interaction.guild.id].channels = config[interaction.guild.id].channels.filter(id => id !== channel.id);
            jsonStore.write('media-only', config);

            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# <:Checkedbox:1521227734943269077> Media-Only Restriction Removed\n\n${channel} is no longer a media-only channel.\n\nAll message types are now allowed.`
                    )
                );

            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } else if (subcommand === 'list') {
            const channels = config[interaction.guild.id]?.channels || [];

            if (channels.length === 0) {
                const container = new ContainerBuilder()
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(
                            `# <:Image:1521227966435037255> No Media-Only Channels\n\n` +
                            `There are no media-only channels configured in this server.\n\n` +
                            `*Use \`/media-only add\` to create one.*`
                        )
                    );

                return await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            // Filter to channels still present in the guild — surfacing
            // dangling IDs would just confuse the user.
            const lines = channels.map((id, i) => {
                const ch = interaction.guild.channels.cache.get(id);
                const label = ch ? `${ch}` : `~~<#${id}>~~ \`(deleted)\``;
                return `<:Caretright:1521227704953864202> \`${String(i + 1).padStart(2, '0')}.\` ${label}`;
            });

            const result = paginate({
                header:
                    `# <:Image:1521227966435037255> Media-Only Channels\n` +
                    `-# **${channels.length}** channel${channels.length === 1 ? '' : 's'} • only attachments are allowed`,
                lines,
                perPage:     15,
                accentColor: COLORS.INFO });

            const reply = await interaction.reply({ ...result, fetchReply: true });
            setupPaginationCollector(reply, result._pageData, interaction.user.id);
        }
        } catch (error) {
            console.error('[MediaOnly] Error:', error);
            const container = buildErrorResponse('Error', 'An error occurred while executing this command.', error.message);
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }
    },

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return message.reply(`<:Cancel:1521227723916181644> You need Manage Channels permission to use this command.`);
        }

        try {
        let config = {};
        if (jsonStore.has('media-only')) {
            config = jsonStore.read('media-only');
        }

        if (!config[message.guild.id]) {
            config[message.guild.id] = { channels: [] };
        }

        const channels = config[message.guild.id]?.channels || [];

        if (channels.length === 0) {
            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# <:Image:1521227966435037255> No Media-Only Channels\n\n` +
                        `There are no media-only channels configured in this server.\n\n` +
                        `*Use \`/media-only add\` to create one.*`
                    )
                );

            return await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const lines = channels.map((id, i) => {
            const ch = message.guild.channels.cache.get(id);
            const label = ch ? `${ch}` : `~~<#${id}>~~ \`(deleted)\``;
            return `<:Caretright:1521227704953864202> \`${String(i + 1).padStart(2, '0')}.\` ${label}`;
        });

        const result = paginate({
            header:
                `# <:Image:1521227966435037255> Media-Only Channels\n` +
                `-# **${channels.length}** channel${channels.length === 1 ? '' : 's'} • only attachments are allowed`,
            lines,
            perPage:     15,
            accentColor: COLORS.INFO });

        const reply = await message.reply(result);
        setupPaginationCollector(reply, result._pageData, message.author.id);
        } catch (error) {
            console.error('[MediaOnly] Error:', error);
            const container = buildErrorResponse('Error', 'An error occurred while executing this command.', error.message);
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
