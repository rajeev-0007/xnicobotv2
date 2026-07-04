const { SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize } = require('discord.js');

const jsonStore = require('../../utils/jsonStore');

function loadConfig() {
    try {
        if (jsonStore.has('invites')) {
            return jsonStore.read('invites');
        }
    } catch {}
    return {};
}

module.exports = {
    prefix: 'invited',
    description: 'Check who invited a user, with which link and when',
    usage: 'invited [@user]',
    category: 'utility',
    aliases: ['invitedby', 'whoinvited'],

    data: new SlashCommandBuilder()
        .setName('invited')
        .setDescription('Check who invited a user, which invite link was used, and when')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to check (leave empty for yourself)')
                .setRequired(false)),

    async execute(interaction) {
        try {
            const targetUser = interaction.options.getUser('user') || interaction.user;
            const guildId = interaction.guild.id;
            const config = loadConfig();
            const guildConfig = config[guildId];

            if (!guildConfig || !guildConfig.enabled) {
                return interaction.reply({
                    content: '<:Cancel:1521227723916181644> Invite tracking is not enabled in this server! An admin needs to run `/invite-setup enable` first.',
                    flags: MessageFlags.Ephemeral
                });
            }

            const memberData = guildConfig.members?.[targetUser.id];

            if (!memberData) {
                const container = new ContainerBuilder()
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(
                            `# <:Bookopen:1521227911137595605> Invite Info — ${targetUser.username}\n\n` +
                            `No invite data found for this user.\n\n` +
                            `-# They may have joined before invite tracking was enabled, or via Server Discovery / a bot.`
                        )
                    );
                return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            const inviterId = memberData.inviterId;
            const inviteCode = memberData.inviteCode;
            const joinedAt = memberData.joinedAt;
            const hasLeft = memberData.left || false;

            const joinedTimestamp = joinedAt ? `<t:${Math.floor(joinedAt / 1000)}:F> (<t:${Math.floor(joinedAt / 1000)}:R>)` : 'Unknown';
            const inviteLink = inviteCode && inviteCode !== 'unknown' ? `https://discord.gg/${inviteCode}` : null;

            let inviterInfo;
            if (inviterId === 'unknown') {
                inviterInfo = '`Unknown` — Could not determine the inviter';
            } else {
                const inviterStats = guildConfig.totals?.[inviterId];
                const totalInvites = inviterStats ? (inviterStats.regular + inviterStats.bonus) : 0;
                inviterInfo = `<@${inviterId}> — **${totalInvites}** total invites`;
            }

            const container = new ContainerBuilder()
                .setAccentColor(hasLeft ? 0xED4245 : 0x57F287)
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# <:Bookopen:1521227911137595605> Invite Info — ${targetUser.username}`
                    )
                )
                .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `**User:** <@${targetUser.id}> ${hasLeft ? '*(left the server)*' : ''}\n\n` +
                        `**Invited By:** ${inviterInfo}\n\n` +
                        `**Invite Link:** ${inviteLink ? `[\`${inviteCode}\`](${inviteLink})` : '`Unknown`'}\n\n` +
                        `**Joined At:** ${joinedTimestamp}\n\n` +
                        `**Status:** ${hasLeft ? '<:Userblock:1521227822641975366> Left the server' : '<:Userplus:1521227719621218477> Currently in server'}`
                    )
                );

            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('Invited Error:', error);
            const msg = error.message || 'An unknown error occurred';
            if (interaction.replied || interaction.deferred) await interaction.followUp({ content: `<:Cancel:1521227723916181644> ${msg}`, flags: MessageFlags.Ephemeral }).catch(() => {});
            else await interaction.reply({ content: `<:Cancel:1521227723916181644> ${msg}`, flags: MessageFlags.Ephemeral }).catch(() => {});
        }
    },

    async executePrefix(message, args) {
        try {
            const targetUser = message.mentions.users.first() || message.author;
            const guildId = message.guild.id;
            const config = loadConfig();
            const guildConfig = config[guildId];

            if (!guildConfig || !guildConfig.enabled) {
                return message.reply(require('../../utils/utilityUI').errReply('Not Enabled', 'Invite tracking is not enabled in this server! An admin needs to run `invite-setup enable` first.'));
            }

            const memberData = guildConfig.members?.[targetUser.id];

            if (!memberData) {
                const container = new ContainerBuilder()
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(
                            `# <:Bookopen:1521227911137595605> Invite Info — ${targetUser.username}\n\n` +
                            `No invite data found for this user.\n\n` +
                            `-# They may have joined before invite tracking was enabled, or via Server Discovery / a bot.`
                        )
                    );
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            const inviterId = memberData.inviterId;
            const inviteCode = memberData.inviteCode;
            const joinedAt = memberData.joinedAt;
            const hasLeft = memberData.left || false;

            const joinedTimestamp = joinedAt ? `<t:${Math.floor(joinedAt / 1000)}:F> (<t:${Math.floor(joinedAt / 1000)}:R>)` : 'Unknown';
            const inviteLink = inviteCode && inviteCode !== 'unknown' ? `https://discord.gg/${inviteCode}` : null;

            let inviterInfo;
            if (inviterId === 'unknown') {
                inviterInfo = '`Unknown` — Could not determine the inviter';
            } else {
                const inviterStats = guildConfig.totals?.[inviterId];
                const totalInvites = inviterStats ? (inviterStats.regular + inviterStats.bonus) : 0;
                inviterInfo = `<@${inviterId}> — **${totalInvites}** total invites`;
            }

            const container = new ContainerBuilder()
                .setAccentColor(hasLeft ? 0xED4245 : 0x57F287)
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# <:Bookopen:1521227911137595605> Invite Info — ${targetUser.username}`
                    )
                )
                .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `**User:** <@${targetUser.id}> ${hasLeft ? '*(left the server)*' : ''}\n\n` +
                        `**Invited By:** ${inviterInfo}\n\n` +
                        `**Invite Link:** ${inviteLink ? `[\`${inviteCode}\`](${inviteLink})` : '`Unknown`'}\n\n` +
                        `**Joined At:** ${joinedTimestamp}\n\n` +
                        `**Status:** ${hasLeft ? '<:Userblock:1521227822641975366> Left the server' : '<:Userplus:1521227719621218477> Currently in server'}`
                    )
                );

            message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('Invited Error:', error);
            message.reply(require('../../utils/utilityUI').errReply('Error', error.message || 'Unknown error')).catch(() => {});
        }
    }
};
