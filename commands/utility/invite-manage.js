const { SlashCommandBuilder, PermissionFlagsBits, ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const { addBonusInvites, resetUserInvites, resetGuildInvites, getUserStats } = require('../../utils/inviteManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('invite-manage')
        .setDescription('Manage invite tracking')
        .addSubcommand(subcommand =>
            subcommand
                .setName('add-bonus')
                .setDescription('Add bonus invites to a user')
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('User to add bonus invites to')
                        .setRequired(true))
                .addIntegerOption(option =>
                    option.setName('amount')
                        .setDescription('Number of bonus invites to add')
                        .setMinValue(1)
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove-bonus')
                .setDescription('Remove bonus invites from a user')
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('User to remove bonus invites from')
                        .setRequired(true))
                .addIntegerOption(option =>
                    option.setName('amount')
                        .setDescription('Number of bonus invites to remove')
                        .setMinValue(1)
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('reset-user')
                .setDescription('Reset invites for a specific user')
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('User to reset invites for')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('reset-server')
                .setDescription('Reset all invite data for this server'))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    
    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        
        if (subcommand === 'add-bonus') {
            const user = interaction.options.getUser('user');
            const amount = interaction.options.getInteger('amount');
            
            await addBonusInvites(interaction.guild.id, user.id, amount, interaction.guild);
            const stats = getUserStats(interaction.guild.id, user.id);
            
            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`# <:Checkedbox:1521227734943269077> Bonus Invites Added\n\nAdded **${amount}** bonus invites to **${user.username}**\n\n**Updated Stats:**\n• Total: ${stats.total}\n• Regular: ${stats.regular}\n• Bonus: ${stats.bonus}`)
                );
            
            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
        
        else if (subcommand === 'remove-bonus') {
            const user = interaction.options.getUser('user');
            const amount = interaction.options.getInteger('amount');
            
            await addBonusInvites(interaction.guild.id, user.id, -amount, interaction.guild);
            const stats = getUserStats(interaction.guild.id, user.id);
            
            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`# <:Checkedbox:1521227734943269077> Bonus Invites Removed\n\nRemoved **${amount}** bonus invites from **${user.username}**\n\n**Updated Stats:**\n• Total: ${stats.total}\n• Regular: ${stats.regular}\n• Bonus: ${stats.bonus}`)
                );
            
            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
        
        else if (subcommand === 'reset-user') {
            const user = interaction.options.getUser('user');
            
            resetUserInvites(interaction.guild.id, user.id);
            
            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`# <:Checkedbox:1521227734943269077> User Invites Reset\n\nAll invite data for **${user.username}** has been reset to 0.`)
                );
            
            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
        
        else if (subcommand === 'reset-server') {
            resetGuildInvites(interaction.guild.id);
            
            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`# <:Checkedbox:1521227734943269077> Server Invites Reset\n\nAll invite tracking data for this server has been reset.\n\n**Note:** Invite tracking is still enabled.`)
                );
            
            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    },

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return message.reply(require('../../utils/utilityUI').errReply('Missing Permission', 'You need the **Manage Guild** permission.'));
        }

        const action = args[0]?.toLowerCase();
        
        if (action === 'add-bonus') {
            const user = message.mentions.users.first();
            const amount = parseInt(args[2]);
            
            if (!user || !amount) {
                return message.reply(require('../../utils/utilityUI').errReply('Invalid Usage', 'Usage: `-invite-manage add-bonus @user <amount>`'));
            }
            
            await addBonusInvites(message.guild.id, user.id, amount, message.guild);
            const stats = getUserStats(message.guild.id, user.id);
            
            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`# <:Checkedbox:1521227734943269077> Bonus Invites Added\n\nAdded **${amount}** bonus invites to **${user.username}**\n\n**Updated Stats:**\n• Total: ${stats.total}\n• Regular: ${stats.regular}\n• Bonus: ${stats.bonus}`)
                );
            
            message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
        
        else if (action === 'remove-bonus') {
            const user = message.mentions.users.first();
            const amount = parseInt(args[2]);
            
            if (!user || !amount) {
                return message.reply(require('../../utils/utilityUI').errReply('Invalid Usage', 'Usage: `-invite-manage remove-bonus @user <amount>`'));
            }
            
            await addBonusInvites(message.guild.id, user.id, -amount, message.guild);
            const stats = getUserStats(message.guild.id, user.id);
            
            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`# <:Checkedbox:1521227734943269077> Bonus Invites Removed\n\nRemoved **${amount}** bonus invites from **${user.username}**\n\n**Updated Stats:**\n• Total: ${stats.total}\n• Regular: ${stats.regular}\n• Bonus: ${stats.bonus}`)
                );
            
            message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
        
        else if (action === 'reset-user') {
            const user = message.mentions.users.first();
            
            if (!user) {
                return message.reply(require('../../utils/utilityUI').errReply('Invalid Usage', 'Usage: `-invite-manage reset-user @user`'));
            }
            
            resetUserInvites(message.guild.id, user.id);
            
            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`# <:Checkedbox:1521227734943269077> User Invites Reset\n\nAll invite data for **${user.username}** has been reset to 0.`)
                );
            
            message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
        
        else if (action === 'reset-server') {
            resetGuildInvites(message.guild.id);
            
            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`# <:Checkedbox:1521227734943269077> Server Invites Reset\n\nAll invite tracking data for this server has been reset.\n\n**Note:** Invite tracking is still enabled.`)
                );
            
            message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
        
        else {
            message.reply(require('../../utils/utilityUI').errReply('Invalid Usage', 'Usage: `-invite-manage <add-bonus|remove-bonus|reset-user|reset-server> [args]`'));
        }
    }
};
