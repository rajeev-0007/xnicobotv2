const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { getGuildConfig, updateGuildConfig } = require('../../utils/database');
const lui = require('../../utils/levelingUI');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leveling-announcement')
        .setDescription('Configure level-up announcements')
        .addSubcommand(sub => sub.setName('toggle').setDescription('Enable or disable level-up announcements')
            .addStringOption(o => o.setName('status').setDescription('Enable or disable').setRequired(true).addChoices({ name: 'Enable', value: 'enable' }, { name: 'Disable', value: 'disable' })))
        .addSubcommand(sub => sub.setName('channel').setDescription('Set announcement channel')
            .addStringOption(o => o.setName('type').setDescription('Channel type').setRequired(true).addChoices({ name: 'Same Channel', value: 'same' }, { name: 'DM', value: 'dm' }, { name: 'Custom Channel', value: 'custom' }))
            .addChannelOption(o => o.setName('custom-channel').setDescription('Channel for custom type')))
        .addSubcommand(sub => sub.setName('message').setDescription('Set level-up message')
            .addStringOption(o => o.setName('text').setDescription('Custom message ({user}, {level}, {xp})').setRequired(true)))
        .addSubcommand(sub => sub.setName('view').setDescription('View current announcement settings')),
    name: 'leveling-announcement',
    prefix: 'leveling-announcement',
    description: 'Configure level-up announcements (prefix-only)',
    usage: 'leveling-announcement <toggle|channel|message> [options]',
    category: 'leveling',
    aliases: ['lvlannounce', 'levelannounce'],

    async execute(interaction) {
        const gid = interaction.guild.id;
        if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ ...lui.payload(lui.permError(gid)), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        const subcommand = interaction.options.getSubcommand();
        const guildConfig = await getGuildConfig(gid);

        if (subcommand === 'toggle') {
            const enabled = interaction.options.getString('status') === 'enable';
            await updateGuildConfig(gid, { 'leveling.announcements.enabled': enabled });

            return interaction.reply(lui.payload(lui.ok(gid,
                `Level-Up Announcements ${enabled ? 'Enabled' : 'Disabled'}`,
                enabled ? 'Users will be notified when they level up.' : 'Level-up announcements have been disabled.',
                null,
                { emoji: enabled ? lui.E.bullhorn : lui.E.off }
            )));
        }

        if (subcommand === 'channel') {
            const type = interaction.options.getString('type');
            const customChannel = interaction.options.getChannel('custom-channel');

            if (type === 'custom' && !customChannel) {
                return interaction.reply({ ...lui.payload(lui.err(gid, 'Missing Channel', 'You must provide a custom channel when using the custom type.')), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }

            const updates = { 'leveling.announcements.channel': type };
            if (type === 'custom' && customChannel) {
                updates['leveling.announcements.customChannelId'] = customChannel.id;
                updates['leveling.announcementChannel'] = customChannel.id;
            } else {
                updates['leveling.announcementChannel'] = null;
            }
            await updateGuildConfig(gid, updates);

            const locationText = type === 'same' ? 'Same channel where the user leveled up'
                : type === 'dm' ? 'Direct Messages'
                : `<#${customChannel.id}>`;

            return interaction.reply(lui.payload(lui.ok(gid, 'Announcement Location Updated', 'Level-up messages will be sent here.', {
                Location: locationText,
            })));
        }

        if (subcommand === 'message') {
            const text = interaction.options.getString('text');
            await updateGuildConfig(gid, { 'leveling.announcements.message': text });

            const preview = text
                .replace('{user}', `<@${interaction.user.id}>`)
                .replace('{level}', '5')
                .replace('{xp}', '1000');

            return interaction.reply(lui.payload(lui.ok(gid, 'Announcement Message Updated', `**Preview:**\n${preview}`, {
                '{user}': 'User mention', '{level}': 'New level', '{xp}': 'Total XP',
            }, { emoji: lui.E.doc })));
        }

        if (subcommand === 'view') {
            return interaction.reply(lui.payload(buildView(gid, guildConfig)));
        }
    },

    async executePrefix(message) {
        const gid = message.guild.id;
        const perr = lui.requirePerm(message.member, gid);
        if (perr) return message.reply(lui.payload(perr));

        const guildConfig = await getGuildConfig(gid);
        return message.reply(lui.payload(buildView(gid, guildConfig, true)));
    }
};

function buildView(gid, guildConfig, prefix = false) {
    const config = guildConfig.leveling?.announcements || {};
    const locationText = config.channel === 'same' ? 'Same Channel'
        : config.channel === 'dm' ? 'Direct Messages'
        : config.customChannelId ? `<#${config.customChannelId}>` : 'Not Set';

    return lui.info(gid, 'Announcement Configuration', null, {
        Status: config.enabled !== false ? `${lui.E.on} Enabled` : `${lui.E.off} Disabled`,
        Location: locationText,
        Message: config.message || 'GG {user}, you just advanced to **Level {level}**!',
    }, prefix ? 'Use `/leveling-announcement` for configuration options' : null);
}
