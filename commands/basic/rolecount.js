'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { buildErrorResponse, COLORS } = require('../../utils/responseBuilder');
const { paginate, setupPaginationCollector } = require('../../utils/pagination');

function buildLines(guild) {
    const roles = [...guild.roles.cache.values()]
        .filter(r => r.id !== guild.id)
        .sort((a, b) => b.position - a.position);

    const totalAssigned = roles.reduce((sum, r) => sum + r.members.size, 0);
    const longest = String(Math.max(...roles.map(r => r.members.size), 0)).length;

    const lines = roles.map((role, i) => {
        const count = String(role.members.size).padStart(longest, ' ');
        const idx = `\`${String(i + 1).padStart(3, '0')}.\``;
        return `${idx} ${role} — \`${count}\` member${role.members.size === 1 ? '' : 's'}`;
    });

    const header =
        `# <:Userplus:1521227719621218477> Role Member Counts — ${guild.name}\n` +
        `-# **${roles.length}** roles • **${totalAssigned}** total assignments`;

    return { lines, header };
}

module.exports = {
    prefix: 'rolecount',
    description: 'View the member count for every role',
    usage: 'rolecount',
    category: 'basic',
    aliases: ['rolemembercount', 'rolemembers'],

    data: new SlashCommandBuilder()
        .setName('rolecount')
        .setDescription('View the member count for every role'),

    async execute(interaction) {
        try {
            const { lines, header } = buildLines(interaction.guild);
            if (lines.length === 0) {
                const container = buildErrorResponse('No Roles', 'This server has no custom roles yet.');
                return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }
            const result = paginate({ header, lines, perPage: 15, accentColor: COLORS.INFO });
            const reply = await interaction.reply({ ...result, fetchReply: true });
            setupPaginationCollector(reply, result._pageData, interaction.user.id);
        } catch (error) {
            console.error('[ROLECOUNT] Slash error:', error);
            const container = buildErrorResponse('Failed', 'Could not load role data.', error.message);
            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }
    },

    async executePrefix(message) {
        try {
            const { lines, header } = buildLines(message.guild);
            if (lines.length === 0) {
                const container = buildErrorResponse('No Roles', 'This server has no custom roles yet.');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }
            const result = paginate({ header, lines, perPage: 15, accentColor: COLORS.INFO });
            const reply = await message.reply(result);
            setupPaginationCollector(reply, result._pageData, message.author.id);
        } catch (error) {
            console.error('[ROLECOUNT] Prefix error:', error);
            const container = buildErrorResponse('Failed', 'Could not load role data.', error.message);
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }
    } };
