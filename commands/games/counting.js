const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { db } = require('../../utils/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('counting')
        .setDescription('Manage the counting game')
        .addSubcommand(sub =>
            sub.setName('setup')
                .setDescription('Set up a counting channel')
                .addChannelOption(opt =>
                    opt.setName('channel')
                        .setDescription('The channel for counting')
                        .setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('stats')
                .setDescription('View counting statistics'))
        .addSubcommand(sub =>
            sub.setName('reset')
                .setDescription('Reset the count to 0'))
        .addSubcommand(sub =>
            sub.setName('disable')
                .setDescription('Disable counting in this server'))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    prefix: 'counting',
    description: 'Set up and manage a counting game channel',
    usage: 'counting <setup/stats/reset/disable>',
    category: 'games',
    aliases: ['count'],

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();

        if (sub === 'setup') {
            const channel = interaction.options.getChannel('channel');
            
            await db.set(`counting_${interaction.guild.id}`, {
                channelId: channel.id,
                currentCount: 0,
                lastUserId: null,
                lastMessageId: null,
                highScore: 0,
                totalCounts: 0,
                fails: 0
            });

            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# <:Checkedbox:1521227734943269077> Counting Game Set Up!\n\n` +
                        `Counting channel: <#${channel.id}>\n\n` +
                        `**Rules:**\n` +
                        `> 1. Count up from 1\n` +
                        `> 2. You can't count twice in a row\n` +
                        `> 3. Wrong numbers reset the count\n\n` +
                        `Start counting now!`
                    )
                );
            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        else if (sub === 'stats') {
            const data = await db.get(`counting_${interaction.guild.id}`);
            
            if (!data) {
                const container = new ContainerBuilder()
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(
                            `# <:Cancel:1521227723916181644> Not Set Up\n\nCounting game is not set up in this server.\nUse \`/counting setup\` to get started!`
                        )
                    );
                return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# 🔢 Counting Statistics\n\n` +
                        `**Channel:** <#${data.channelId}>\n` +
                        `**Current Count:** ${data.currentCount}\n` +
                        `**High Score:** ${data.highScore} <:Award:1521228119640375336>\n` +
                        `**Total Counts:** ${data.totalCounts}\n` +
                        `**Fails:** ${data.fails}`
                    )
                );
            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        else if (sub === 'reset') {
            const data = await db.get(`counting_${interaction.guild.id}`);
            
            if (!data) {
                const container = new ContainerBuilder()
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(
                            `# <:Cancel:1521227723916181644> Not Set Up\n\nCounting game is not set up in this server.`
                        )
                    );
                return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            data.currentCount = 0;
            data.lastUserId = null;
            data.lastMessageId = null;
            await db.set(`counting_${interaction.guild.id}`, data);

            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# <:Checkedbox:1521227734943269077> Count Reset!\n\nThe count has been reset to **0**.\nStart counting from 1!`
                    )
                );
            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        else if (sub === 'disable') {
            await db.delete(`counting_${interaction.guild.id}`);

            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# <:Checkedbox:1521227734943269077> Counting Disabled\n\nThe counting game has been disabled for this server.`
                    )
                );
            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    },

    async executePrefix(message, args) {
        const sub = args[0]?.toLowerCase();

        if (!message.guild) {
            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# <:Cancel:1521227723916181644> Server Only\n\nThis command can only be used in a server.`
                    )
                );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# <:Cancel:1521227723916181644> Missing Permission\n\nYou need **Manage Channels** permission to use this command.`
                    )
                );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (sub === 'setup') {
            const channel = message.mentions.channels.first() || message.channel;
            
            await db.set(`counting_${message.guild.id}`, {
                channelId: channel.id,
                currentCount: 0,
                lastUserId: null,
                lastMessageId: null,
                highScore: 0,
                totalCounts: 0,
                fails: 0
            });

            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# <:Checkedbox:1521227734943269077> Counting Game Set Up!\n\n` +
                        `Counting channel: <#${channel.id}>\n\n` +
                        `**Rules:**\n` +
                        `> 1. Count up from 1\n` +
                        `> 2. You can't count twice in a row\n` +
                        `> 3. Wrong numbers reset the count\n\n` +
                        `Start counting now!`
                    )
                );
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        else if (sub === 'stats') {
            const data = await db.get(`counting_${message.guild.id}`);
            
            if (!data) {
                const container = new ContainerBuilder()
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(
                            `# <:Cancel:1521227723916181644> Not Set Up\n\nCounting game is not set up. Use \`-counting setup\` to get started!`
                        )
                    );
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# 🔢 Counting Statistics\n\n` +
                        `**Channel:** <#${data.channelId}>\n` +
                        `**Current Count:** ${data.currentCount}\n` +
                        `**High Score:** ${data.highScore} <:Award:1521228119640375336>\n` +
                        `**Total Counts:** ${data.totalCounts}\n` +
                        `**Fails:** ${data.fails}`
                    )
                );
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        else if (sub === 'reset') {
            const data = await db.get(`counting_${message.guild.id}`);
            
            if (!data) {
                const container = new ContainerBuilder()
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(
                            `# <:Cancel:1521227723916181644> Not Set Up\n\nCounting game is not set up in this server.`
                        )
                    );
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            data.currentCount = 0;
            data.lastUserId = null;
            data.lastMessageId = null;
            await db.set(`counting_${message.guild.id}`, data);

            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# <:Checkedbox:1521227734943269077> Count Reset!\n\nThe count has been reset to **0**.\nStart counting from 1!`
                    )
                );
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        else if (sub === 'disable') {
            await db.delete(`counting_${message.guild.id}`);

            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# <:Checkedbox:1521227734943269077> Counting Disabled\n\nThe counting game has been disabled for this server.`
                    )
                );
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        else {
            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# <:Cancel:1521227723916181644> Invalid Usage\n\n` +
                        `**Usage:** \`-counting <setup/stats/reset/disable>\`\n\n` +
                        `**Examples:**\n` +
                        `> \`-counting setup #counting\` - Set up counting channel\n` +
                        `> \`-counting stats\` - View counting statistics\n` +
                        `> \`-counting reset\` - Reset the count\n` +
                        `> \`-counting disable\` - Disable counting`
                    )
                );
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
