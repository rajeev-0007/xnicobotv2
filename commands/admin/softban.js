const { PermissionFlagsBits, SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder } = require('discord.js');
const { buildModerationResponse, buildErrorResponse, buildPermissionDenied, buildUserNotFound, buildInvalidUsage, COLORS } = require('../../utils/responseBuilder');
const { confirmAction } = require('../../utils/confirmAction');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('softban')
        .setDescription('Ban and immediately unban a user to clear their messages (7 days)')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to softban')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for the softban')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

    prefix: 'softban',
    description: 'Ban and immediately unban a user to clear their messages (7 days)',
    usage: 'softban <@user> [reason]',
    category: 'admin',

    async execute(interaction) {
        const user = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason') || 'No reason provided';
        
        let member;
        try {
            member = await interaction.guild.members.fetch(user.id);
        } catch (e) {
            const container = buildUserNotFound(user.username);
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        if (!member) {
            const container = buildUserNotFound(user.username);
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        if (user.id === interaction.user.id) {
            const container = buildErrorResponse('Cannot Softban Yourself', 'You cannot softban yourself.');
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        if (user.id === interaction.client.user.id) {
            const container = buildErrorResponse('Cannot Softban Me', 'You cannot softban me.');
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        if (!member.bannable) {
            const container = buildErrorResponse(
                'Cannot Softban User',
                'I cannot softban this user. They may have a higher role than me.',
                'Ensure my role is positioned above the target user\'s role.'
            );
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        // ── Confirmation prompt ──
        const { confirmed, button } = await confirmAction(interaction, false, {
            title: 'Confirm Softban',
            description: `Are you sure you want to **softban** <@${user.id}> (\`${user.username}\`)?\n\nThis bans and instantly unbans them to **delete their last 7 days of messages**.\n\n**Reason:** ${reason}`,
            confirmLabel: 'Softban User',
        });
        if (!confirmed) return;

        try {
            await member.ban({ 
                reason: `${reason} | Softbanned by ${interaction.user.username}`, 
                deleteMessageSeconds: 604800 
            });
            await interaction.guild.members.unban(user.id, `Softban - Auto unban | Moderator: ${interaction.user.username}`);
            
            let content = `# <:banhammer:1521227777083314529> User Softbanned\n\n`;
            content += `**Target:** ${user.username} (${user.id})\n`;
            content += `**Reason:** ${reason}\n`;
            content += `**Moderator:** ${interaction.user.username}\n\n`;
            content += `> <:Trash:1521227750420254820> Messages from the last 7 days have been deleted.\n`;
            content += `> The user has been unbanned and can rejoin.`;
            
            const container = new ContainerBuilder()
                .setAccentColor(COLORS.WARNING)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
            
            await button.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            const container = buildErrorResponse(
                'Softban Failed',
                'Failed to softban the user.',
                `Error: ${error.message}`
            );
            await button.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    },
    
    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.BanMembers)) {
            const container = buildPermissionDenied('Ban Members');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const member = message.mentions.members.first();
        if (!member) {
            const container = buildInvalidUsage(
                'softban',
                '-softban @user [reason]',
                ['-softban @Spammer Spam cleanup', '-softban @User Clear messages']
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (member.id === message.author.id) {
            const container = buildErrorResponse('Cannot Softban Yourself', 'You cannot softban yourself.');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (member.id === message.client.user.id) {
            const container = buildErrorResponse('Cannot Softban Me', 'You cannot softban me.');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const reason = args.slice(1).join(' ') || 'No reason provided';

        if (!member.bannable) {
            const container = buildErrorResponse(
                'Cannot Softban User',
                'I cannot softban this user. They may have a higher role than me.'
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        // ── Confirmation prompt ──
        const { confirmed, button } = await confirmAction(message, true, {
            title: 'Confirm Softban',
            description: `Are you sure you want to **softban** <@${member.id}> (\`${member.user.username}\`)?\n\nThis bans and instantly unbans them to **delete their last 7 days of messages**.\n\n**Reason:** ${reason}`,
            confirmLabel: 'Softban User',
        });
        if (!confirmed) return;

        try {
            await member.ban({ 
                reason: `${reason} | Softbanned by ${message.author.username}`, 
                deleteMessageSeconds: 604800 
            });
            await message.guild.members.unban(member.id, `Softban - Auto unban | Moderator: ${message.author.username}`);
            
            let content = `# <:banhammer:1521227777083314529> User Softbanned\n\n`;
            content += `**Target:** ${member.user.username} (${member.id})\n`;
            content += `**Reason:** ${reason}\n`;
            content += `**Moderator:** ${message.author.username}\n\n`;
            content += `> <:Trash:1521227750420254820> Messages from the last 7 days have been deleted.\n`;
            content += `> The user has been unbanned and can rejoin.`;
            
            const container = new ContainerBuilder()
                .setAccentColor(COLORS.WARNING)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
            
            await button.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('Softban Error:', error);
            const container = buildErrorResponse(
                'Softban Failed',
                'Failed to softban the user.',
                `Error: ${error.message}`
            );
            await button.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
