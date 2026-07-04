const { ContainerBuilder, TextDisplayBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder, SeparatorBuilder, SeparatorSpacingSize } = require('discord.js');
const { confirmAction } = require('../../utils/confirmAction');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('massnick')
        .setDescription('Set or reset nicknames for all members or a specific role')
        .addStringOption(opt =>
            opt.setName('nickname')
                .setDescription('New nickname (use "reset" to clear nicknames)')
                .setRequired(true))
        .addRoleOption(opt =>
            opt.setName('role')
                .setDescription('Only change nicknames for members with this role')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames),
    prefix: 'massnick',
    description: 'Set or reset nicknames for all members or a specific role',
    usage: 'massnick <nickname/reset> [@role]',
    category: 'admin',

    async execute(interaction) {
        try {
            if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageNicknames)) {
                const container = new ContainerBuilder()
                    .setAccentColor(0xED4245)
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                        `# <:Cancel:1521227723916181644> Bot Missing Permissions\n\nI need the **Manage Nicknames** permission.`
                    ));
                return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }

            const nicknameInput = interaction.options.getString('nickname');
            const role = interaction.options.getRole('role');
            const nickname = nicknameInput.toLowerCase() === 'reset' ? null : nicknameInput;

            const { confirmed, button } = await confirmAction(interaction, false, {
                title: 'Confirm Mass Nickname',
                description: `${nickname ? `Set nickname to **${nickname}**` : '**Reset** nicknames'} for ${role ? `members with <@&${role.id}>` : '**all members**'}?`,
                confirmLabel: 'Apply to All',
            });
            if (!confirmed) return;

            const members = role ? role.members : await interaction.guild.members.fetch();
            let changed = 0;
            let failed = 0;

            for (const [id, member] of members) {
                if (member.manageable) {
                    try {
                        await member.setNickname(nickname);
                        changed++;
                    } catch (err) {
                        failed++;
                    }
                } else {
                    failed++;
                }
            }

            const resultContainer = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# <:User:1521227714227343380> Mass Nickname Complete\n\n` +
                    `### <:Document:1521227875016114266> Results\n` +
                    `<:Checkedbox:1521227734943269077> **Changed:** ${changed} members\n` +
                    `<:Cancel:1521227723916181644> **Failed:** ${failed} members\n\n` +
                    `${nickname ? `**New Nickname:** ${nickname}` : '**Action:** Reset nicknames'}` +
                    `${role ? `\n**Role:** ${role.name}` : ''}`
                ));
            resultContainer.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

            await button.editReply({ components: [resultContainer], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        } catch (error) {
            console.error('Massnick error:', error);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply(require('../../utils/adminUI').errReply('Error', 'An error occurred.', { ephemeral: true })).catch(() => {});
            }
        }
    },

    async executePrefix(message, args) {
        try {
            if (!message.member.permissions.has(PermissionFlagsBits.ManageNicknames)) {
                return message.reply(require('../../utils/adminUI').errReply('Missing Permission', 'You need the **Manage Nicknames** permission.'));
            }

            if (!message.guild.members.me.permissions.has(PermissionFlagsBits.ManageNicknames)) {
                return message.reply(require('../../utils/adminUI').errReply('Missing Bot Permission', 'I need the **Manage Nicknames** permission.'));
            }

            if (!args.length) {
                const container = new ContainerBuilder()
                    .addTextDisplayComponents(
                        new TextDisplayBuilder()
                            .setContent(`# <:User:1521227714227343380> Mass Nickname\n\n### <:Document:1521227875016114266> Usage\n\`massnick <nickname> [@role]\`\n\n### <:Edit:1521227886634205298> Examples\n\`massnick VIP Member @VIP\` - Set nickname for all VIP role members\n\`massnick reset @Members\` - Reset nicknames for role members\n\`massnick [EVENT] @Everyone\` - Add prefix to all members\n\n-# Bot must have higher role than target members`)
                    )
;
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            // Parse nickname: everything except role mentions
            const role = message.mentions.roles.first();
            let nickname;
            if (args[0].toLowerCase() === 'reset') {
                nickname = null;
            } else {
                // Filter out role mention from args to get the nickname
                const nicknameArgs = args.filter(a => !a.match(/^<@&\d+>$/));
                nickname = nicknameArgs.join(' ') || null;
            }
            
            const members = role ? role.members : message.guild.members.cache;

            const { confirmed, button } = await confirmAction(message, true, {
                title: 'Confirm Mass Nickname',
                description: `${nickname ? `Set nickname to **${nickname}**` : '**Reset** nicknames'} for ${role ? `members with <@&${role.id}>` : `**all ${members.size} members**`}?`,
                confirmLabel: 'Apply to All',
            });
            if (!confirmed) return;

            let changed = 0;
            let failed = 0;

            for (const [id, member] of members) {
                if (member.manageable) {
                    try {
                        await member.setNickname(nickname);
                        changed++;
                    } catch (err) {
                        failed++;
                    }
                } else {
                    failed++;
                }
            }

            const resultContainer = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`# <:User:1521227714227343380> Mass Nickname Complete\n\n### <:Document:1521227875016114266> Results\n<:Checkedbox:1521227734943269077> **Changed:** ${changed} members\n<:Cancel:1521227723916181644> **Failed:** ${failed} members\n\n${nickname ? `**New Nickname:** ${nickname}` : '**Action:** Reset nicknames'}${role ? `\n**Role:** ${role.name}` : ''}`)
                );
            resultContainer.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

            await button.editReply({ components: [resultContainer], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        } catch (error) {
            console.error('Massnick error:', error);
        }
    }
};
