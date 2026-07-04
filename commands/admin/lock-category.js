'use strict';
const { ContainerBuilder, TextDisplayBuilder, StringSelectMenuBuilder, ActionRowBuilder, MessageFlags, PermissionFlagsBits, ChannelType, SeparatorBuilder, SeparatorSpacingSize, SlashCommandBuilder } = require('discord.js');
const { buildExpiredPanel } = require('../../utils/responseBuilder');

async function processLockCategory(guild, category, targetRole) {
    let locked = 0, failed = 0;
    for (const [, channel] of category.children.cache) {
        try {
            await channel.permissionOverwrites.edit(targetRole, { SendMessages: false, AddReactions: false });
            locked++;
        } catch { failed++; }
    }
    return { locked, failed };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('lock-category')
        .setDescription('Lock all channels in a selected category for a role (defaults to @everyone)')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
        .addRoleOption(option =>
            option.setName('role')
                .setDescription('Role to lock the category for (defaults to @everyone)')
                .setRequired(false)),

    name: 'lock-category',
    prefix: 'lock-category',
    description: 'Lock all channels in a selected category for a role',
    category: 'admin',
    usage: 'lock-category [@role]',
    permissions: ['ManageChannels'],

    async execute(interaction) {
        const targetRole = interaction.options.getRole('role') || interaction.guild.roles.everyone;
        const roleName   = targetRole.id === interaction.guild.roles.everyone.id ? '@everyone' : `<@&${targetRole.id}>`;

        const categories = interaction.guild.channels.cache
            .filter(c => c.type === ChannelType.GuildCategory)
            .sort((a, b) => a.position - b.position)
            .first(25);

        if (!categories.length) {
            const container = new ContainerBuilder()
                .setAccentColor(0xED4245)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# <:Cancel:1521227723916181644> No Categories Found\n\nNo categories found in this server!`
                ));
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('lock_category_select_slash')
            .setPlaceholder('Select a category to lock')
            .addOptions(categories.map(cat => ({
                label: cat.name.slice(0, 100),
                description: `${cat.children.cache.size} channels`,
                value: cat.id,
                emoji: '<:Folderopen:1521227986966417642>'
            })));

        const container = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `# <:Lock:1521227892770734120> Lock Category\n\n> Select a category below to lock all its channels.\n> This will prevent ${roleName} from sending messages.\n> **Role:** ${roleName}`
            ))
            .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
            .addActionRowComponents(new ActionRowBuilder().addComponents(selectMenu));

        const reply = await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2, fetchReply: true });

        const collector = reply.createMessageComponentCollector({
            filter: i => i.user.id === interaction.user.id,
            time: 60000
        });

        collector.on('collect', async (menuInteraction) => {
            await menuInteraction.deferUpdate();

            const category = interaction.guild.channels.cache.get(menuInteraction.values[0]);
            if (!category) {
                const errContainer = new ContainerBuilder()
                    .setAccentColor(0xED4245)
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Cancel:1521227723916181644> Category Not Found`));
                return reply.edit({ components: [errContainer], flags: MessageFlags.IsComponentsV2 });
            }

            const loadingContainer = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# <a:Loading:1521227993995940032> Locking Category\n\n> **Category:** \`${category.name}\`\n> **Role:** ${roleName}\n> Processing ${category.children.cache.size} channels...`
                ));
            await reply.edit({ components: [loadingContainer], flags: MessageFlags.IsComponentsV2 });

            const { locked, failed } = await processLockCategory(interaction.guild, category, targetRole);

            const resultContainer = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# <:Lock:1521227892770734120> Category Locked\n\n> **Category:** \`${category.name}\`\n> **Role:** ${roleName}\n> **Channels Locked:** ${locked}\n> **Failed:** ${failed}\n\n<:Checkedbox:1521227734943269077> All channels in this category are now locked for ${roleName}.`
                ));
            await reply.edit({ components: [resultContainer], flags: MessageFlags.IsComponentsV2 });
            collector.stop();
        });

        collector.on('end', async (collected, reason) => {
            if (reason === 'time' && collected.size === 0) {
                await reply.edit({ components: [buildExpiredPanel('lock-category', 'No category selected.')], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
            }
        });
    },

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return message.reply('<:Cancel:1521227723916181644> You need **Manage Channels** permission to use this command!');
        }

        const targetRole = message.mentions.roles.first() || message.guild.roles.everyone;
        const roleName   = targetRole.id === message.guild.roles.everyone.id ? '@everyone' : `<@&${targetRole.id}>`;

        const categories = message.guild.channels.cache
            .filter(c => c.type === ChannelType.GuildCategory)
            .sort((a, b) => a.position - b.position)
            .first(25);

        if (!categories.length) return message.reply('<:Cancel:1521227723916181644> No categories found in this server!');

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('lock_category_select')
            .setPlaceholder('Select a category to lock')
            .addOptions(categories.map(cat => ({
                label: cat.name.slice(0, 100),
                description: `${cat.children.cache.size} channels`,
                value: cat.id,
                emoji: '<:Folderopen:1521227986966417642>'
            })));

        const container = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `# <:Lock:1521227892770734120> Lock Category\n\n> Select a category below to lock all its channels.\n> **Role:** ${roleName}`
            ))
            .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
            .addActionRowComponents(new ActionRowBuilder().addComponents(selectMenu));

        const reply = await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });

        const collector = reply.createMessageComponentCollector({
            filter: i => i.user.id === message.author.id,
            time: 60000
        });

        collector.on('collect', async (interaction) => {
            await interaction.deferUpdate();

            const category = message.guild.channels.cache.get(interaction.values[0]);
            if (!category) return reply.edit({ components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent('# <:Cancel:1521227723916181644> Error\n\nCategory not found!'))], flags: MessageFlags.IsComponentsV2 });

            const loadingContainer = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# <a:Loading:1521227993995940032> Locking Category\n\n> **Category:** \`${category.name}\`\n> **Role:** ${roleName}\n> Processing ${category.children.cache.size} channels...`
                ));
            await reply.edit({ components: [loadingContainer], flags: MessageFlags.IsComponentsV2 });

            const { locked, failed } = await processLockCategory(message.guild, category, targetRole);

            const resultContainer = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# <:Lock:1521227892770734120> Category Locked\n\n> **Category:** \`${category.name}\`\n> **Role:** ${roleName}\n> **Channels Locked:** ${locked}\n> **Failed:** ${failed}\n\n<:Checkedbox:1521227734943269077> All channels in this category are now locked for ${roleName}.`
                ));
            await reply.edit({ components: [resultContainer], flags: MessageFlags.IsComponentsV2 });
            collector.stop();
        });

        collector.on('end', async (collected, reason) => {
            if (reason === 'time' && collected.size === 0) {
                await reply.edit({ components: [buildExpiredPanel('lock-category', 'No category selected.')], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
            }
        });
    }
};
