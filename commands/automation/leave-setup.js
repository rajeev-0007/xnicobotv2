const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');

const jsonStore = require('../../utils/jsonStore');
const { buildPermissionDenied } = require('../../utils/responseBuilder');

function loadConfig() {
    if (!jsonStore.has('welcomer')) {
        jsonStore.write('welcomer', {});
        return {};
    }
    return jsonStore.read('welcomer');
}

module.exports = {
    category: 'automation',
    data: new SlashCommandBuilder()
        .setName('leave-setup')
        .setDescription('Interactive setup for the leave message system')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(interaction) {
        const config = loadConfig();
        const guildConfig = config[interaction.guild.id] || {};

        const container = this.buildPanel(guildConfig, interaction.guild);
        await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    },

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return message.reply({ components: [buildPermissionDenied('Manage Guild')], flags: MessageFlags.IsComponentsV2 });
        }

        const config = loadConfig();
        const guildConfig = config[message.guild.id] || {};

        const container = this.buildPanel(guildConfig, message.guild);
        await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    },

    buildPanel(guildConfig, guild) {
        const controlButtons = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('leave_setup_channel')
                    .setLabel('Set Channel')
                    .setStyle(guildConfig.leaveChannelId ? ButtonStyle.Success : ButtonStyle.Primary)
                    .setEmoji('📺'),
                new ButtonBuilder()
                    .setCustomId('welcomer_leave_msg')
                    .setLabel('Set Message')
                    .setStyle(guildConfig.leaveMessage ? ButtonStyle.Success : ButtonStyle.Primary)
                    .setEmoji('<:Envelope:1521228013910626426>'),
                new ButtonBuilder()
                    .setCustomId('welcomer_leave_toggle')
                    .setLabel(guildConfig.leaveEnabled ? 'Disable' : 'Enable')
                    .setStyle(guildConfig.leaveEnabled ? ButtonStyle.Danger : ButtonStyle.Success)
                    .setEmoji(guildConfig.leaveEnabled ? '<:Toggleoff:1521227763816595559>' : '<:Toggleon:1521227758011809964>'),
                new ButtonBuilder()
                    .setCustomId('leave_preview')
                    .setLabel('Preview')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('<:Eye:1521227940480815156>')
            );

        const leaveMsg = guildConfig.leaveMessage || 'Goodbye {username}! <:Userplus:1521227719621218477>';
        const previewMsg = leaveMsg.length > 50 ? leaveMsg.substring(0, 50) + '...' : leaveMsg;

        return new ContainerBuilder()
            .setAccentColor(guildConfig.leaveEnabled ? 0x57F287 : 0xED4245)
            .addTextDisplayComponents(
                new TextDisplayBuilder()
                    .setContent(
                        `# <:Userplus:1521227719621218477> Leave Message System\n\n` +
                        `Send automatic goodbye messages when members leave your server.\n\n` +
                        `### <:Bookopen:1521227911137595605> Current Configuration\n` +
                        `**Status:** ${guildConfig.leaveEnabled ? '<:Toggleon:1521227758011809964> Enabled' : '<:Toggleoff:1521227763816595559> Disabled'}\n` +
                        `**Channel:** ${guildConfig.leaveChannelId ? `<#${guildConfig.leaveChannelId}>` : '*Not set (will use welcome channel)*'}\n` +
                        `**Message:** \`${previewMsg}\`\n\n` +
                        `### <:Hashtag:1521227771957870604> How to Use\n` +
                        `**1.** Click **Set Channel** to choose where leave messages appear\n` +
                        `**2.** Click **Set Message** to customize your goodbye message\n` +
                        `**3.** Click ** to activate leave messages\n` +
                        `**4.** Use **Preview** to see how messages will look\n\n` +
                        `### <:Edit:1521227886634205298> Available Variables\n` +
                        `\`{user}\` - Member mention | \`{username}\` - Username\n` +
                        `\`{displayname}\` - Display name | \`{server}\` - Server name\n` +
                        `\`{membercount}\` - Total members | \`{userid}\` - User ID`
                    )
            )
            .addActionRowComponents(controlButtons);
    }
};
