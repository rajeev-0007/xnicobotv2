'use strict';

const { MessageFlags, PermissionFlagsBits, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder } = require('discord.js');
const { buildErrorResponse, buildSuccessResponse } = require('../../utils/responseBuilder');
const jsonStore = require('../../utils/jsonStore');

module.exports = {
    name: 'roleallvoice-off',
    prefix: 'roleallvoice-off',
    description: 'Disable voice autorole and remove the role from every member who has it',
    usage: 'roleallvoice-off',
    category: 'voice',
    aliases: ['disablevoicerole', 'vravoff'],
    permissions: ['ManageRoles'],

    async executePrefix(message) {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
            const container = buildErrorResponse('Missing Permission', 'You need the **Manage Roles** permission.');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const config = jsonStore.has('voiceautorole')
            ? jsonStore.read('voiceautorole')
            : {};

        if (!config[message.guild.id]) {
            const container = buildErrorResponse('Not Enabled', 'Voice autorole is not enabled in this server.');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const roleId = config[message.guild.id];
        delete config[message.guild.id];
        jsonStore.write('voiceautorole', config);

        const role = message.guild.roles.cache.get(roleId);
        let removed = 0;
        let failed  = 0;

        if (role) {
            for (const [, member] of message.guild.members.cache) {
                if (!member.roles.cache.has(roleId)) continue;
                try {
                    await member.roles.remove(role, 'Voice autorole disabled');
                    removed++;
                } catch {
                    failed++;
                }
            }
        }

        const container = buildSuccessResponse(
            'Voice Autorole Disabled',
            'Auto-removal has been turned off and the role was cleared from members who still had it.',
            {
                'Role':         role ? `${role}` : '`Deleted role`',
                'Removed From': `${removed} member${removed === 1 ? '' : 's'}`,
                ...(failed ? { 'Failed': `${failed}` } : {}),
                'Moderator':    message.author.username
            }
        );
        container.setAccentColor(0x57F287);
        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

        return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
};
