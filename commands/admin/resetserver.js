const { PermissionFlagsBits, SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('resetserver')
        .setDescription('Reset all server configurations')
        .addStringOption(opt =>
            opt.setName('confirm')
                .setDescription('Type "confirm" to confirm the reset')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    prefix: 'resetserver',
    description: 'Reset all server configurations',
    usage: 'resetserver confirm',
    category: 'admin',

    async execute(interaction) {
        try {
            const confirmText = interaction.options.getString('confirm');
            if (confirmText !== 'confirm') {
                return interaction.reply({ 
                    content: '<:Inforect:1521228008285929532> **WARNING:** This will reset ALL bot configurations for this server!\n**Type:** `/resetserver confirm:confirm` to proceed.', 
                    flags: MessageFlags.Ephemeral 
                });
            }

            const jsonStore = require('../../utils/jsonStore');
            const guildId = interaction.guild.id;

            const configFiles = [
                'prefixes.json', 'autorole.json', 'autonick.json', 'antialt.json',
                'antinuke.json', 'antiraid.json', 'automod.json', 'autoresponder.json',
                'autoresponders.json', 'autoreact.json', 'autoreacts.json',
                'welcomer.json', 'tickets.json', 'leveling.json', 'levelchannel.json',
                'levelmultiplier.json', 'levelroles.json', 'levelingtoggle.json',
                'starboard.json', 'logs.json', 'warnings.json', 'verification.json',
                'sticky.json', 'simple-sticky.json', 'media-only.json',
                'ignored-channels.json', 'join2create.json', 'reaction_roles.json',
                'voiceautorole.json', 'join-greet.json'
            ];

            let resetCount = 0;

            for (const file of configFiles) {
                const storeName = file.replace('.json', '');
                try {
                    const config = jsonStore.read(storeName);
                    if (config[guildId]) {
                        delete config[guildId];
                        jsonStore.write(storeName, config);
                        resetCount++;
                    }
                } catch (e) {
                    // Skip corrupted files
                }
            }

            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# <:Checkedbox:1521227734943269077> Server Reset Complete\n\n` +
                        `**${resetCount}** configuration(s) cleared.\n\n` +
                        `All bot settings for this server have been reset to defaults.`
                    )
                );
            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('Resetserver error:', error);
            if (!interaction.replied) {
                await interaction.reply({ content: '<:Cancel:1521227723916181644> An error occurred while resetting!', flags: MessageFlags.Ephemeral }).catch(() => {});
            }
        }
    },

    async executePrefix(message, args) {
        try {
            if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
                return message.reply('<:Cancel:1521227723916181644> You need the **Administrator** permission!');
            }

            if (args[0] !== 'confirm') {
                return message.reply('<:Inforect:1521228008285929532> **WARNING:** This will reset ALL bot configurations for this server!\n**To confirm, type:** `-resetserver confirm`');
            }

            const jsonStore = require('../../utils/jsonStore');
            const guildId = message.guild.id;

            const configFiles = [
                'prefixes.json', 'autorole.json', 'autonick.json', 'antialt.json',
                'antinuke.json', 'antiraid.json', 'automod.json', 'autoresponder.json',
                'autoresponders.json', 'autoreact.json', 'autoreacts.json',
                'welcomer.json', 'tickets.json', 'leveling.json', 'levelchannel.json',
                'levelmultiplier.json', 'levelroles.json', 'levelingtoggle.json',
                'starboard.json', 'logs.json', 'warnings.json', 'verification.json',
                'sticky.json', 'simple-sticky.json', 'media-only.json',
                'ignored-channels.json', 'join2create.json', 'reaction_roles.json',
                'voiceautorole.json', 'join-greet.json'
            ];

            let resetCount = 0;

            for (const file of configFiles) {
                const storeName = file.replace('.json', '');
                try {
                    const config = jsonStore.read(storeName);
                    if (config[guildId]) {
                        delete config[guildId];
                        jsonStore.write(storeName, config);
                        resetCount++;
                    }
                } catch (e) {
                    // Skip corrupted files
                }
            }

            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# <:Checkedbox:1521227734943269077> Server Reset Complete\n\n` +
                        `**${resetCount}** configuration(s) cleared.\n\n` +
                        `All bot settings for this server have been reset to defaults.`
                    )
                );
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('Resetserver error:', error);
        }
    }
};
