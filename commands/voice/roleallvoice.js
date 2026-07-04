'use strict';

const {
    SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags,
    ContainerBuilder, TextDisplayBuilder,
    SeparatorBuilder, SeparatorSpacingSize
} = require('discord.js');
const {
    BRANDING, buildPermissionDenied, buildErrorResponse, buildInvalidUsage
} = require('../../utils/responseBuilder');

const jsonStore = require('../../utils/jsonStore');
const STORE = 'voiceautorole';

function loadConfig() {
    if (!jsonStore.has(STORE)) {
        jsonStore.write(STORE, {});
        return {};
    }
    return jsonStore.read(STORE) || {};
}

function saveConfig(config) {
    jsonStore.write(STORE, config);
}

function panel(content, color) {
    return new ContainerBuilder()
        .setAccentColor(color)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
;
}

function buildAppliedPanel(role, affectedCount) {
    return panel(
        `# <:Checkedbox:1521227734943269077> Voice Autorole Applied\n\n` +
        `**Role:** ${role}\n` +
        `**Members affected:** \`${affectedCount}\`\n\n` +
        `> All members currently in voice channels now have this role.\n` +
        `> The role will be **automatically removed** when they disconnect.\n\n` +
        `-# Use \`roleallvoice-off\` to disable auto-removal`,
        0x57F287
    );
}

function buildHelpPanel(guild) {
    const config = loadConfig();
    const roleId = config[guild.id];
    const role = roleId ? guild.roles.cache.get(roleId) : null;

    const voiceChannels = guild.channels.cache.filter(ch =>
        ch.type === ChannelType.GuildVoice || ch.type === ChannelType.GuildStageVoice
    );
    let membersInVoice = 0;
    for (const [, channel] of voiceChannels) {
        membersInVoice += channel.members.filter(m => !m.user.bot).size;
    }

    return panel(
        `# <:Volumeup:1521228004502536272> Voice Autorole\n\n` +
        `**Auto-assigned role:** ${role ? `${role}` : '`Not set`'}\n` +
        `**Members in VC right now:** \`${membersInVoice}\`\n\n` +
        `### <:Document:1521227875016114266> Usage\n` +
        `> \`roleallvoice @role\` — Give the role to every member currently in VC\n` +
        `> \`roleallvoice-off\` — Disable auto-removal\n\n` +
        `-# The role is automatically removed when the user disconnects from VC.`,
        0x5865F2
    );
}

async function applyRoleToVoice(guild, role) {
    let affected = 0;
    const voiceChannels = guild.channels.cache.filter(ch =>
        ch.type === ChannelType.GuildVoice || ch.type === ChannelType.GuildStageVoice
    );
    for (const [, channel] of voiceChannels) {
        for (const [, member] of channel.members) {
            if (member.user.bot) continue;
            if (member.roles.cache.has(role.id)) continue;
            try {
                await member.roles.add(role, 'Voice autorole applied');
                affected++;
            } catch { /* counter only counts real successes */ }
        }
    }
    return affected;
}

function validateRole(guild, member, role) {
    if (role.position >= guild.members.me.roles.highest.position) {
        return buildErrorResponse(
            'Role Hierarchy Error',
            `I cannot assign **${role.name}** because it is higher than or equal to my highest role.`,
            'Move my role above the target role in Server Settings → Roles.'
        );
    }
    if (member && role.position >= member.roles.highest.position) {
        return buildErrorResponse(
            'Insufficient Permissions',
            `You cannot assign **${role.name}** because it is higher than or equal to your highest role.`
        );
    }
    if (role.managed) {
        return buildErrorResponse(
            'Managed Role',
            `**${role.name}** is managed by an integration or bot and cannot be assigned manually.`
        );
    }
    return null;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('roleallvoice')
        .setDescription('Give a role to every member currently in voice channels (auto-removes on leave)')
        .addRoleOption(opt => opt.setName('role').setDescription('Role to assign to all VC members').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

    name: 'roleallvoice',
    prefix: 'roleallvoice',
    description: 'Give a role to every member currently in voice channels (auto-removes on leave)',
    usage: 'roleallvoice <@role>',
    category: 'voice',
    aliases: ['rav', 'voicerole', 'vrav'],
    permissions: ['ManageRoles'],

    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
            return interaction.reply({ components: [buildPermissionDenied('Manage Roles')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        await interaction.deferReply();

        const role = interaction.options.getRole('role');
        const err = validateRole(interaction.guild, interaction.member, role);
        if (err) return interaction.editReply({ components: [err], flags: MessageFlags.IsComponentsV2 });

        const config = loadConfig();
        config[interaction.guild.id] = role.id;
        saveConfig(config);

        const affected = await applyRoleToVoice(interaction.guild, role);
        return interaction.editReply({ components: [buildAppliedPanel(role, affected)], flags: MessageFlags.IsComponentsV2 });
    },

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
            return message.reply({ components: [buildPermissionDenied('Manage Roles')], flags: MessageFlags.IsComponentsV2 });
        }

        if (!args[0]) {
            return message.reply({ components: [buildHelpPanel(message.guild)], flags: MessageFlags.IsComponentsV2 });
        }

        const role = message.mentions.roles.first() || message.guild.roles.cache.get(args[0].replace(/[<@&>]/g, ''));
        if (!role) {
            return message.reply({
                components: [buildInvalidUsage('roleallvoice', 'roleallvoice <@role>', ['roleallvoice @Gamer', 'roleallvoice 1234567890'])],
                flags: MessageFlags.IsComponentsV2
            });
        }

        const err = validateRole(message.guild, message.member, role);
        if (err) return message.reply({ components: [err], flags: MessageFlags.IsComponentsV2 });

        const config = loadConfig();
        config[message.guild.id] = role.id;
        saveConfig(config);

        const affected = await applyRoleToVoice(message.guild, role);
        return message.reply({ components: [buildAppliedPanel(role, affected)], flags: MessageFlags.IsComponentsV2 });
    }
};
