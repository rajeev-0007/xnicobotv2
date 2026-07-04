const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { buildErrorResponse, buildPermissionDenied, COLORS } = require('../../utils/responseBuilder');
const { paginate, setupPaginationCollector } = require('../../utils/pagination');
const { createContainer, addTextDisplay, addSeparator } = require('../../utils/componentHelpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('banlist')
        .setDescription('Show all banned users in the server')
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
    
    prefix: 'banlist',
    description: 'Show all banned users in the server',
    usage: 'banlist',
    category: 'admin',
    aliases: ['bans', 'banned'],
    
    async execute(interaction) {
        try {
            await interaction.deferReply();
            
            const bans = await interaction.guild.bans.fetch();
            
            if (bans.size === 0) {
                const container = createContainer(COLORS.INFO);
                addTextDisplay(container, `# <:Shield:1521227694677692467> Ban List\n\n> No banned users found in this server.`);
                addSeparator(container);
                return interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            const bansArray = [...bans.values()];
            const allLines = bansArray.map((ban, index) => {
                const reason = ban.reason ? ban.reason.slice(0, 50) : 'No reason';
                return `> **${index + 1}.** \`${ban.user.username}\` (${ban.user.id})\n> -# ${reason}`;
            });

            const result = paginate({
                header: `# <:Shield:1521227694677692467> Ban List — ${bans.size} Banned Users`,
                lines: allLines,
                perPage: 15,
                accentColor: COLORS.PRIMARY });

            const reply = await interaction.editReply(result);
            setupPaginationCollector(reply, result._pageData, interaction.user.id);
        } catch (error) {
            console.error('Banlist Error:', error);
            const container = buildErrorResponse(
                'Failed to Fetch Bans',
                'An error occurred while fetching the ban list.',
                `Error: ${error.message}`
            );
            if (interaction.deferred) {
                await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            } else {
                await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }
        }
    },

    async executePrefix(message) {
        if (!message.member.permissions.has(PermissionFlagsBits.BanMembers)) {
            const container = buildPermissionDenied('Ban Members');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        try {
            const bans = await message.guild.bans.fetch();
            
            if (bans.size === 0) {
                const container = createContainer(COLORS.INFO);
                addTextDisplay(container, `# <:Shield:1521227694677692467> Ban List\n\n> No banned users found in this server.`);
                addSeparator(container);
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            const bansArray = [...bans.values()];
            const allLines = bansArray.map((ban, index) => {
                const reason = ban.reason ? ban.reason.slice(0, 50) : 'No reason';
                return `<:Caretright:1521227704953864202> **${index + 1}.** \`${ban.user.username}\` (${ban.user.id})\n> -# ${reason}`;
            });

            const result = paginate({
                header: `# <:Shield:1521227694677692467> Ban List — ${bans.size} Banned Users`,
                lines: allLines,
                perPage: 15,
                accentColor: COLORS.PRIMARY });

            const reply = await message.reply(result);
            setupPaginationCollector(reply, result._pageData, message.author.id);
        } catch (error) {
            console.error('Banlist Error:', error);
            const container = buildErrorResponse(
                'Failed to Fetch Bans',
                'An error occurred while fetching the ban list.',
                `Error: ${error.message}`
            );
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
