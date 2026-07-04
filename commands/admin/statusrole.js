const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { buildErrorResponse, buildSuccessResponse, buildPermissionDenied, COLORS, EMOJIS } = require('../../utils/responseBuilder');
const jsonStore = require('../../utils/jsonStore');

function loadConfig() {
    try {
        if (jsonStore.has('statusrole')) return jsonStore.read('statusrole');
    } catch {}
    return {};
}

function saveConfig(config) {
    jsonStore.write('statusrole', config);
}

module.exports = {
    prefix: 'statusrole',
    description: 'Assign a role to users who set a specific text in their Discord custom status',
    usage: 'statusrole <set|remove|status|scan|list> [status text] [@role]',
    category: 'admin',
    aliases: ['sr', 'statusreward', 'customstatus'],
    permissions: ['ManageRoles'],
    loadConfig,
    saveConfig,

    async executePrefix(message, args, lavalinkManager, client) {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
            const container = buildPermissionDenied('Manage Roles');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const sub = args[0]?.toLowerCase();
        const config = loadConfig();
        if (!config[message.guild.id]) config[message.guild.id] = { entries: [], enabled: true };
        const guildConfig = config[message.guild.id];

        // --- SET / ADD ---
        if (sub === 'set' || sub === 'add') {
            const role = message.mentions.roles.first();
            if (!role) {
                const container = buildErrorResponse(
                    'Missing Role',
                    'Please mention the role to assign.',
                    '**Example:** `statusrole set .gg/myserver @StatusRole`\n**Example:** `statusrole set "Playing xNico" @Gamer`'
                );
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            // Extract status text — everything between sub and the role mention
            const rawContent = message.content;
            const subIdx = rawContent.toLowerCase().indexOf(sub) + sub.length;
            const roleIdx = rawContent.indexOf(`<@&${role.id}>`);
            let statusText = rawContent.substring(subIdx, roleIdx).trim();

            // If the role was mentioned before the text (or text after role)
            if (!statusText || statusText.length === 0) {
                const afterRole = rawContent.substring(roleIdx + `<@&${role.id}>`.length).trim();
                if (afterRole) statusText = afterRole;
            }

            // Remove quotes if wrapped
            if ((statusText.startsWith('"') && statusText.endsWith('"')) || (statusText.startsWith("'") && statusText.endsWith("'"))) {
                statusText = statusText.slice(1, -1);
            }

            if (!statusText || statusText.length === 0) {
                const container = buildErrorResponse(
                    'Missing Status Text',
                    'Please provide the status text that users should set.',
                    '**Example:** `statusrole set .gg/myserver @StatusRole`'
                );
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            if (statusText.length > 128) {
                const container = buildErrorResponse('Text Too Long', 'Status text must be 128 characters or less.');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            if (role.position >= message.guild.members.me.roles.highest.position) {
                const container = buildErrorResponse(
                    'Role Hierarchy Error',
                    'I cannot assign a role that is higher than or equal to my highest role.',
                    'Move my role above the target role in Server Settings > Roles.'
                );
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            if (role.managed) {
                const container = buildErrorResponse('Managed Role', 'I cannot assign bot-managed or integration roles.');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            // Check for duplicates
            const existing = guildConfig.entries.find(e => e.text.toLowerCase() === statusText.toLowerCase());
            if (existing) {
                existing.roleId = role.id;
                existing.updatedAt = new Date().toISOString();
            } else {
                guildConfig.entries.push({
                    text: statusText,
                    roleId: role.id,
                    setBy: message.author.id,
                    setAt: new Date().toISOString()
                });
            }
            guildConfig.enabled = true;
            saveConfig(config);

            const container = buildSuccessResponse(
                'Status Role Configured',
                `Users who set **${statusText}** in their custom status will receive the role.`,
                {
                    'Status Text': statusText,
                    'Reward Role': `${role}`,
                    'Match Type': 'Contains (case-insensitive)',
                    'Total Rules': `${guildConfig.entries.length}`,
                    'Configured By': `<@${message.author.id}>`
                }
            );
            container.setAccentColor(0x57F287);
            container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Tip: Use \`statusrole scan\` to check existing members • Role auto-updates on status changes`));

            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        // --- REMOVE ---
        if (sub === 'remove' || sub === 'delete') {
            const query = args.slice(1).join(' ').toLowerCase();

            if (!query) {
                const container = buildErrorResponse(
                    'Missing Status Text',
                    'Provide the status text to remove, or use `statusrole removeall` to clear all.',
                    '**Example:** `statusrole remove .gg/myserver`'
                );
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            const idx = guildConfig.entries.findIndex(e => e.text.toLowerCase() === query || e.text.toLowerCase().includes(query));
            if (idx === -1) {
                const container = buildErrorResponse('Not Found', `No status role rule matches "${args.slice(1).join(' ')}".`);
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            const removed = guildConfig.entries.splice(idx, 1)[0];
            saveConfig(config);

            // Remove role from members who have it
            const role = message.guild.roles.cache.get(removed.roleId);
            let removedCount = 0;
            if (role) {
                for (const [, member] of role.members) {
                    try {
                        await member.roles.remove(role);
                        removedCount++;
                    } catch {}
                }
            }

            const container = buildSuccessResponse(
                'Status Role Removed',
                `The status role rule has been removed.`,
                {
                    'Status Text': removed.text,
                    'Role Removed From': `${removedCount} member(s)`,
                    'Remaining Rules': `${guildConfig.entries.length}`
                }
            );
            container.setAccentColor(COLORS.ERROR);

            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        // --- REMOVEALL ---
        if (sub === 'removeall' || sub === 'clear' || sub === 'reset') {
            if (guildConfig.entries.length === 0) {
                const container = buildErrorResponse('Nothing to Remove', 'No status role rules are configured.');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            // Remove all roles
            let removedCount = 0;
            for (const entry of guildConfig.entries) {
                const role = message.guild.roles.cache.get(entry.roleId);
                if (role) {
                    for (const [, member] of role.members) {
                        try { await member.roles.remove(role); removedCount++; } catch {}
                    }
                }
            }

            const count = guildConfig.entries.length;
            guildConfig.entries = [];
            guildConfig.enabled = false;
            saveConfig(config);

            const container = buildSuccessResponse(
                'All Status Roles Cleared',
                `Removed **${count}** rule(s) and revoked roles from **${removedCount}** member(s).`
            );
            container.setAccentColor(COLORS.ERROR);

            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        // --- SCAN ---
        if (sub === 'scan') {
            if (!guildConfig.entries.length) {
                const container = buildErrorResponse('No Rules', 'No status role rules are configured yet.', '**Setup:** `statusrole set <status text> @role`');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            const statusRoleHandler = require('../../utils/statusRoleHandler');
            const progress = await message.reply({
                components: [buildSuccessResponse('Scanning Members', 'Checking member statuses and syncing roles. This may take a moment for large servers...')],
                flags: MessageFlags.IsComponentsV2
            }).catch(() => null);

            let summary;
            try {
                summary = await statusRoleHandler.scanGuild(message.guild);
            } catch (e) {
                const container = buildErrorResponse('Scan Failed', `Could not complete the scan: ${e.message}`);
                if (progress) return progress.edit({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            const container = buildSuccessResponse(
                'Scan Complete',
                'All members have been checked against your status role rules.',
                {
                    'Members Scanned': `${summary.scanned}`,
                    'Roles Updated': `${summary.updated} member(s)`,
                    'Active Rules': `${guildConfig.entries.length}`
                }
            );
            container.setAccentColor(0x57F287);
            if (progress) return progress.edit({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        // --- LIST ---
        if (sub === 'list') {
            if (!guildConfig.entries.length) {
                const container = buildErrorResponse('No Rules', 'No status role rules are configured yet.', '**Setup:** `statusrole set <status text> @role`');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            let content = `# ${EMOJIS.LIST} Status Role Rules\n\n`;
            for (let i = 0; i < guildConfig.entries.length; i++) {
                const entry = guildConfig.entries[i];
                const role = message.guild.roles.cache.get(entry.roleId);
                const roleName = role ? role.toString() : '~~Deleted Role~~';
                content += `**${i + 1}.** \`${entry.text}\` → ${roleName}\n`;
            }
            content += `\n-# ${guildConfig.entries.length} rule(s) • Status: ${guildConfig.enabled ? '<:Toggleon:1521227758011809964> Active' : '<:Toggleoff:1521227763816595559> Paused'}`;

            const container = new ContainerBuilder()
                .setAccentColor(COLORS.CYAN)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
;

            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        // --- TOGGLE ---
        if (sub === 'toggle' || sub === 'enable' || sub === 'disable' || sub === 'pause') {
            if (!guildConfig.entries.length) {
                const container = buildErrorResponse('Not Configured', 'Set up a status role first with `statusrole set <text> @role`.');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            guildConfig.enabled = !guildConfig.enabled;
            saveConfig(config);

            const container = buildSuccessResponse(
                `Status Roles ${guildConfig.enabled ? 'Enabled' : 'Paused'}`,
                guildConfig.enabled
                    ? 'Status role monitoring is now active. Roles will be assigned/removed based on user statuses.'
                    : 'Status role monitoring is paused. No role changes will be made until re-enabled.'
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        // --- STATUS / INFO (default) ---
        if (!sub || sub === 'status' || sub === 'info' || sub === 'help') {
            if (!guildConfig.entries.length) {
                let content = `# ${EMOJIS.SETTINGS} Status Role System\n\n`;
                content += `Automatically assign roles to users based on their Discord custom status.\n\n`;
                content += `### How It Works\n`;
                content += `> **1.** Set a status text and reward role with \`statusrole set\`\n`;
                content += `> **2.** When users set matching text in their custom status, they get the role\n`;
                content += `> **3.** When they change/remove their status, the role is automatically removed\n`;
                content += `> **4.** Supports multiple rules — each status text → role pair\n\n`;
                content += `### Commands\n`;
                content += `> \`statusrole set <text> @role\` — Add a status → role rule\n`;
                content += `> \`statusrole remove <text>\` — Remove a rule\n`;
                content += `> \`statusrole removeall\` — Clear all rules\n`;
                content += `> \`statusrole list\` — View all rules\n`;
                content += `> \`statusrole scan\` — Scan all members and sync roles\n`;
                content += `> \`statusrole toggle\` — Enable/disable the system\n`;
                content += `> \`statusrole status\` — View current configuration\n\n`;
                content += `### Examples\n`;
                content += `> \`statusrole set .gg/myserver @Repper\`\n`;
                content += `> \`statusrole set "I love xNico" @Supporter\`\n`;
                content += `> \`statusrole set dsc.gg/invite @Advertiser\``;

                const container = new ContainerBuilder()
                    .setAccentColor(COLORS.CYAN)
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
;

                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            let content = `# ${EMOJIS.SETTINGS} Status Role Configuration\n\n`;
            content += `### System Status\n`;
            content += `> **Status:** ${guildConfig.enabled ? '<:Toggleon:1521227758011809964> Active' : '<:Toggleoff:1521227763816595559> Paused'}\n`;
            content += `> **Rules:** ${guildConfig.entries.length}\n\n`;
            content += `### Active Rules\n`;
            for (let i = 0; i < Math.min(guildConfig.entries.length, 10); i++) {
                const entry = guildConfig.entries[i];
                const role = message.guild.roles.cache.get(entry.roleId);
                content += `> **${i + 1}.** \`${entry.text}\` → ${role || '~~Deleted~~'}\n`;
            }
            if (guildConfig.entries.length > 10) {
                content += `> ... and ${guildConfig.entries.length - 10} more\n`;
            }
            content += `\n-# Use \`statusrole scan\` to sync • \`statusrole list\` for full list • \`statusrole toggle\` to pause`;

            const container = new ContainerBuilder()
                .setAccentColor(0x57F287)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
;

            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        // Unknown subcommand
        const container = buildErrorResponse(
            'Unknown Subcommand',
            `\`${sub}\` is not a valid option.`,
            '**Available:** `set`, `remove`, `removeall`, `list`, `scan`, `toggle`, `status`'
        );
        return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
};
