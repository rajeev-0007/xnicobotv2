'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ChannelType, ContainerBuilder, TextDisplayBuilder } = require('discord.js');
const animeDrops = require('../../utils/animeDrops');

function panel(color, title, body) {
    const c = new ContainerBuilder().setAccentColor(color);
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}\n${body}`));
    return { components: [c], flags: MessageFlags.IsComponentsV2 };
}

async function handle(reply, guild, sub, channel) {
    if (sub === 'enable') {
        await animeDrops.setGuildConfig(guild.id, { enabled: true, channelId: channel?.id || null });
        return reply(panel(0x57F287, '<:Checkedbox:1521227734943269077> Anime Drops Enabled',
            `> Random character cards will now drop as chat stays active.\n` +
            (channel ? `> Channel: <#${channel.id}>\n` : `> Channel: **any active channel**\n`) +
            `-# First to click **Claim** keeps the card! Disable with \`adropsetup disable\`.`));
    }
    if (sub === 'disable') {
        await animeDrops.disableGuild(guild.id);
        return reply(panel(0xED4245, '<:Cancel:1521227723916181644> Anime Drops Disabled', `> Character drops are now off for this server.`));
    }
    // status
    const cfg = await animeDrops.getGuildConfig(guild.id);
    return reply(panel(0x5865F2, '<:Present:1521228115655917659> Anime Drops',
        `> **Status:** ${cfg?.enabled ? 'Enabled' : 'Disabled'}\n` +
        `> **Channel:** ${cfg?.channelId ? `<#${cfg.channelId}>` : 'Any active channel'}\n\n` +
        `-# \`adropsetup enable [#channel]\` • \`adropsetup disable\``));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('adropsetup')
        .setDescription('Configure automated anime character drops')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(s => s.setName('enable').setDescription('Enable drops')
            .addChannelOption(o => o.setName('channel').setDescription('Restrict drops to one channel').addChannelTypes(ChannelType.GuildText).setRequired(false)))
        .addSubcommand(s => s.setName('disable').setDescription('Disable drops'))
        .addSubcommand(s => s.setName('status').setDescription('View drop settings')),
    prefix: 'adropsetup',
    description: 'Configure automated anime character drops (enable/disable/status)',
    usage: 'adropsetup <enable|disable|status> [#channel]',
    aliases: ['animedrops', 'dropsetup'],
    category: 'anime',

    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return interaction.reply(panel(0xED4245, '<:Cancel:1521227723916181644> Permission Denied', '> You need **Manage Server** permission.'));
        }
        const sub = interaction.options.getSubcommand();
        const channel = interaction.options.getChannel('channel');
        return handle(interaction.reply.bind(interaction), interaction.guild, sub, channel);
    },

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return message.reply(panel(0xED4245, '<:Cancel:1521227723916181644> Permission Denied', '> You need **Manage Server** permission.'));
        }
        const sub = (args[0] || 'status').toLowerCase();
        const channel = message.mentions.channels.first() || null;
        return handle(message.reply.bind(message), message.guild, ['enable', 'disable', 'status'].includes(sub) ? sub : 'status', channel);
    },
};
