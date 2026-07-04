'use strict';

/**
 * /roleall — Bulk role management for the entire server (slash-only).
 *
 *   /roleall everyone add    role:<role>
 *   /roleall everyone remove role:<role>
 *   /roleall humans   add    role:<role>
 *   /roleall humans   remove role:<role>
 *   /roleall bots     add    role:<role>
 *   /roleall bots     remove role:<role>
 *
 *  © xNico
 */

const {
    PermissionFlagsBits,
    SlashCommandBuilder,
    MessageFlags,
} = require('discord.js');

const {
    buildErrorResponse,
} = require('../../utils/responseBuilder');

const {
    runFromInteraction,
    runFromMessage,
    VALID_TARGETS,
    VALID_ACTIONS,
} = require('../../utils/roleAllHelper');

// ── Slash command registration ──────────────────────────────────────
const TARGETS = [
    { name: 'everyone', label: 'all members in the server' },
    { name: 'humans',   label: 'all human members'         },
    { name: 'bots',     label: 'all bot members'           },
];

function addAddRemove(group, target) {
    return group
        .addSubcommand(s => s
            .setName('add')
            .setDescription(`Give a role to ${target.label}`)
            .addRoleOption(o => o
                .setName('role')
                .setDescription('The role to assign')
                .setRequired(true)))
        .addSubcommand(s => s
            .setName('remove')
            .setDescription(`Remove a role from ${target.label}`)
            .addRoleOption(o => o
                .setName('role')
                .setDescription('The role to remove')
                .setRequired(true)));
}

const data = new SlashCommandBuilder()
    .setName('roleall')
    .setDescription('Bulk add or remove a role across the server')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles);

for (const t of TARGETS) {
    data.addSubcommandGroup(g =>
        addAddRemove(
            g.setName(t.name).setDescription(`Manage roles for ${t.label}`),
            t
        )
    );
}

// ── Module export ───────────────────────────────────────────────────
module.exports = {
    data,
    name: 'roleall',
    description: 'Bulk add or remove a role for everyone, humans, or bots',
    usage: 'roleall <everyone|humans|bots> <add|remove> <@role>',
    category: 'admin',
    aliases: ['rall', 'massrole'],

    async execute(interaction) {
        try {
            const group  = interaction.options.getSubcommandGroup(true); // everyone | humans | bots
            const action = interaction.options.getSubcommand(true);      // add | remove
            const role   = interaction.options.getRole('role', true);

            await runFromInteraction(interaction, { targetType: group, action, role });
        } catch (error) {
            console.error('[RoleAll] Slash Error:', error);
            const container = buildErrorResponse(
                'Role All Failed',
                'An error occurred while processing the request.',
                `\`${error.message}\``
            );
            if (interaction.replied || interaction.deferred) {
                await interaction.editReply({
                    components: [container],
                    flags: MessageFlags.IsComponentsV2,
                }).catch(() => {});
            } else {
                await interaction.reply({
                    components: [container],
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                }).catch(() => {});
            }
        }
    },

    // Prefix usage: roleall <everyone|humans|bots> <add|remove> <@role>
    async executePrefix(message, args) {
        try {
            const targetType = (args[0] || '').toLowerCase();
            const action = (args[1] || '').toLowerCase();
            const roleToken = args.slice(2).join(' ').trim();

            if (!VALID_TARGETS.has(targetType) || !VALID_ACTIONS.has(action) || !roleToken) {
                return message.reply({
                    components: [buildErrorResponse(
                        'Invalid Usage',
                        'Usage: `roleall <everyone|humans|bots> <add|remove> <@role>`',
                        'Example: `roleall humans add @Member`'
                    )],
                    flags: MessageFlags.IsComponentsV2,
                }).catch(() => {});
            }

            // Resolve the role from a mention, ID, or exact name.
            const id = roleToken.replace(/[<@&>]/g, '');
            const role = message.guild.roles.cache.get(id)
                || message.guild.roles.cache.find(r => r.name.toLowerCase() === roleToken.toLowerCase());

            if (!role) {
                return message.reply({
                    components: [buildErrorResponse('Role Not Found', `Could not find a role matching \`${roleToken}\`.`)],
                    flags: MessageFlags.IsComponentsV2,
                }).catch(() => {});
            }

            await runFromMessage(message, { targetType, action, role });
        } catch (error) {
            console.error('[RoleAll] Prefix Error:', error);
            await message.reply({
                components: [buildErrorResponse(
                    'Role All Failed',
                    'An error occurred while processing the request.',
                    `\`${error.message}\``
                )],
                flags: MessageFlags.IsComponentsV2,
            }).catch(() => {});
        }
    },
};
