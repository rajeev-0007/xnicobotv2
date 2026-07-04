const { SlashCommandBuilder, PermissionFlagsBits, ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const { setReward, removeReward, getRewards } = require('../../utils/inviteManager');
const { buildSafeListText } = require('../../utils/componentHelpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('invite-rewards')
        .setDescription('Manage invite reward roles')
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Add a reward role for reaching invite milestones')
                .addIntegerOption(option =>
                    option.setName('invites')
                        .setDescription('Number of invites required')
                        .setMinValue(1)
                        .setRequired(true))
                .addRoleOption(option =>
                    option.setName('role')
                        .setDescription('Role to give when milestone is reached')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Remove an invite reward')
                .addIntegerOption(option =>
                    option.setName('invites')
                        .setDescription('Invite count to remove reward for')
                        .setMinValue(1)
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('List all invite rewards'))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    
    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        
        if (subcommand === 'add') {
            const invites = interaction.options.getInteger('invites');
            const role = interaction.options.getRole('role');
            
            setReward(interaction.guild.id, invites, role.id);
            
            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`# <:Checkedbox:1521227734943269077> Reward Added\n\n**Milestone:** ${invites} invites\n**Role:** ${role}\n\nUsers will automatically receive this role when they reach ${invites} total invites!`)
                );
            
            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
        
        else if (subcommand === 'remove') {
            const invites = interaction.options.getInteger('invites');
            
            removeReward(interaction.guild.id, invites);
            
            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`# <:Checkedbox:1521227734943269077> Reward Removed\n\nReward for **${invites} invites** has been removed.`)
                );
            
            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
        
        else if (subcommand === 'list') {
            const rewards = getRewards(interaction.guild.id);
            
            if (rewards.length === 0) {
                return interaction.reply(require('../../utils/utilityUI').errReply('No Rewards', 'No invite rewards configured yet.', { ephemeral: true }));
            }
            
            // Trim to fit Discord's 4 000-char per-TextDisplay cap.
            const lineEntries = rewards.map(reward => {
                const role = interaction.guild.roles.cache.get(reward.roleId);
                const roleName = role ? role.toString() : 'Unknown Role';
                return `• **${reward.invites} invites** → ${roleName}`;
            });
            const { content: rewardText } = buildSafeListText({
                header: '# <:Present:1521228115655917659> Invite Rewards',
                lines: lineEntries,
                separator: '\n',
                overflowHint: '\n-# +${n} more not shown — remove some entries to see them all',
            });
            
            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(rewardText)
                );
            
            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    },

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return message.reply(require('../../utils/utilityUI').errReply('Missing Permission', 'You need the **Manage Guild** permission.'));
        }

        const action = args[0]?.toLowerCase();
        
        if (action === 'add') {
            const invites = parseInt(args[1]);
            const role = message.mentions.roles.first();
            
            if (!invites || !role) {
                return message.reply(require('../../utils/utilityUI').errReply('Invalid Usage', 'Usage: `-invite-rewards add <invites> @role`'));
            }
            
            setReward(message.guild.id, invites, role.id);
            
            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`# <:Checkedbox:1521227734943269077> Reward Added\n\n**Milestone:** ${invites} invites\n**Role:** ${role}\n\nUsers will automatically receive this role when they reach ${invites} total invites!`)
                );
            
            message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
        
        else if (action === 'remove') {
            const invites = parseInt(args[1]);
            
            if (!invites) {
                return message.reply(require('../../utils/utilityUI').errReply('Invalid Usage', 'Usage: `-invite-rewards remove <invites>`'));
            }
            
            removeReward(message.guild.id, invites);
            
            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`# <:Checkedbox:1521227734943269077> Reward Removed\n\nReward for **${invites} invites** has been removed.`)
                );
            
            message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
        
        else if (action === 'list') {
            const rewards = getRewards(message.guild.id);
            
            if (rewards.length === 0) {
                return message.reply(require('../../utils/utilityUI').errReply('No Rewards', 'No invite rewards configured yet.'));
            }
            
            // Trim to fit Discord's 4 000-char per-TextDisplay cap.
            const lineEntries = rewards.map(reward => {
                const role = message.guild.roles.cache.get(reward.roleId);
                const roleName = role ? role.toString() : 'Unknown Role';
                return `• **${reward.invites} invites** → ${roleName}`;
            });
            const { content: rewardText } = buildSafeListText({
                header: '# <:Present:1521228115655917659> Invite Rewards',
                lines: lineEntries,
                separator: '\n',
                overflowHint: '\n-# +${n} more not shown — remove some entries to see them all',
            });
            
            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(rewardText)
                );
            
            message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
        
        else {
            message.reply(require('../../utils/utilityUI').errReply('Invalid Usage', 'Usage: `-invite-rewards <add|remove|list> [args]`'));
        }
    }
};
