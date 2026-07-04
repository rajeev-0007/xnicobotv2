const { PermissionFlagsBits, ContainerBuilder, TextDisplayBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getGuildConfig, updateGuildConfig } = require('../../utils/database');
const { buildSafeListText } = require('../../utils/componentHelpers');
const lui = require('../../utils/levelingUI');

const jsonStore = require('../../utils/jsonStore');

function getLevelRoles() {
    if (!jsonStore.has('levelroles')) {
        jsonStore.write('levelroles', {});
        return {};
    }
    return jsonStore.read('levelroles');
}

function saveLevelRoles(data) {
    jsonStore.write('levelroles', data);
}

module.exports = {
    data: null, // Prefix-only
    name: 'levelroles',
    prefix: 'levelroles',
    description: 'Configure roles awarded at specific levels',
    usage: 'levelroles <add|remove|list> [level] [@role]',
    category: 'leveling',
    aliases: ['lvlroles', 'levelrole'],

    async executePrefix(message, args) {
        const gid = message.guild.id;
        const perr = lui.requirePerm(message.member, gid);
        if (perr) return message.reply(lui.payload(perr));

        const subcommand = args[0]?.toLowerCase();

        if (subcommand === 'add') {
            const level = parseInt(args[1]);
            const role = message.mentions.roles.first();

            if (isNaN(level) || !role) {
                return message.reply(lui.payload(lui.err(gid, 'Invalid Usage', 'Provide a level number and a role.', 'Example: `levelroles add 10 @VIP`')));
            }
            if (level < 1 || level > 1000) {
                return message.reply(lui.payload(lui.err(gid, 'Invalid Level', 'Level must be between **1** and **1000**.')));
            }

            const levelRoles = getLevelRoles();
            if (!levelRoles[gid]) levelRoles[gid] = [];

            const existingIndex = levelRoles[gid].findIndex(lr => lr.level === level);
            if (existingIndex >= 0) levelRoles[gid][existingIndex].roleId = role.id;
            else levelRoles[gid].push({ level, roleId: role.id });
            levelRoles[gid].sort((a, b) => a.level - b.level);
            saveLevelRoles(levelRoles);

            // Mirror to DB config used by the XP handler
            const guildConfig = await getGuildConfig(gid);
            const dbRoles = guildConfig.leveling?.roles || [];
            const dbExisting = dbRoles.findIndex(r => r.level === level);
            if (dbExisting >= 0) dbRoles[dbExisting].roleId = role.id;
            else dbRoles.push({ level, roleId: role.id });
            await updateGuildConfig(gid, { 'leveling.roles': dbRoles }).catch(() => {});

            const isUpdate = existingIndex >= 0;
            return message.reply(lui.payload(lui.ok(gid,
                isUpdate ? 'Level Role Updated' : 'Level Role Added',
                `Users who reach **Level ${level}** will ${isUpdate ? 'now ' : ''}receive ${role}.`,
                { Level: `${level}`, Role: `${role}`, 'Total Rewards': `${levelRoles[gid].length}` },
                { emoji: lui.E.bookmark })));
        }

        if (subcommand === 'remove') {
            const level = parseInt(args[1]);
            if (isNaN(level)) {
                return message.reply(lui.payload(lui.err(gid, 'Invalid Usage', 'Provide the level number to remove.', 'Example: `levelroles remove 10`')));
            }

            const levelRoles = getLevelRoles();
            if (!levelRoles[gid]) levelRoles[gid] = [];

            const beforeLength = levelRoles[gid].length;
            levelRoles[gid] = levelRoles[gid].filter(lr => lr.level !== level);
            saveLevelRoles(levelRoles);

            const guildConfig = await getGuildConfig(gid);
            const dbRoles = (guildConfig.leveling?.roles || []).filter(r => r.level !== level);
            await updateGuildConfig(gid, { 'leveling.roles': dbRoles }).catch(() => {});

            if (beforeLength === levelRoles[gid].length) {
                return message.reply(lui.payload(lui.warn(gid, 'Not Found', `No role reward is configured for **Level ${level}**.`)));
            }

            return message.reply(lui.payload(lui.ok(gid, 'Level Role Removed', `Role reward for **Level ${level}** has been removed.`, {
                Level: `${level}`, 'Remaining Rewards': `${levelRoles[gid].length}`,
            })));
        }

        if (subcommand === 'list') {
            const levelRoles = getLevelRoles();
            const guildRoles = levelRoles[gid] || [];

            if (guildRoles.length === 0) {
                return message.reply(lui.payload(lui.list(gid, 'Level Roles', [], {
                    emoji: lui.E.bookmark, empty: 'No level roles configured yet.', note: 'Use `levelroles add <level> @role` to create your first reward',
                })));
            }

            const lineEntries = guildRoles.map(lr => {
                const role = message.guild.roles.cache.get(lr.roleId);
                return `${lui.E.bullet} **Level ${lr.level}** → ${role || '`Deleted Role`'}`;
            });
            const { content } = buildSafeListText({
                header: `# ${lui.E.bookmark} Level Role Rewards`,
                lines: lineEntries,
                separator: '\n',
                footer: `\n-# ${guildRoles.length} reward${guildRoles.length !== 1 ? 's' : ''} configured`,
                overflowHint: '\n-# +${n} more not shown — remove some entries to see them all',
            });

            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
            return message.reply(lui.payload(lui.applyStyle(container, gid)));
        }

        // Base help panel
        const container = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `# ${lui.E.bookmark} Level Roles System\n\nAutomatically assign roles when members reach specific levels.`
            ))
            .addSeparatorComponents(lui.divider())
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `### ${lui.E.doc} Commands\n${lui.rows([
                    '`levelroles add <level> @role` — Add level role reward',
                    '`levelroles remove <level>` — Remove level role reward',
                    '`levelroles list` — View all level roles',
                ])}`
            ))
            .addActionRowComponents(new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('levelroles_list').setLabel('View List').setStyle(ButtonStyle.Primary).setEmoji('<:Bookopen:1521227911137595605>'),
                new ButtonBuilder().setCustomId('levelroles_help').setLabel('Help').setStyle(ButtonStyle.Secondary).setEmoji(lui.E.bulb)
            ));

        return message.reply(lui.payload(lui.applyStyle(container, gid)));
    },
};
