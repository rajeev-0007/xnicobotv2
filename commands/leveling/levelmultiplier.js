const { PermissionFlagsBits, ContainerBuilder, TextDisplayBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { buildSafeListText } = require('../../utils/componentHelpers');
const lui = require('../../utils/levelingUI');

const jsonStore = require('../../utils/jsonStore');

function getMultiplier() {
    if (!jsonStore.has('levelmultiplier')) {
        jsonStore.write('levelmultiplier', {});
        return {};
    }
    return jsonStore.read('levelmultiplier');
}

function saveMultiplier(data) {
    jsonStore.write('levelmultiplier', data);
}

module.exports = {
    data: null, // Prefix-only
    name: 'levelmultiplier',
    prefix: 'levelmultiplier',
    description: 'Set XP multiplier for roles',
    usage: 'levelmultiplier <set|remove|list> [@role] [multiplier]',
    category: 'leveling',
    aliases: ['lvlmulti', 'xpmultiplier'],

    async executePrefix(message, args) {
        const gid = message.guild.id;
        const perr = lui.requirePerm(message.member, gid);
        if (perr) return message.reply(lui.payload(perr));

        const subcommand = args[0]?.toLowerCase();

        if (subcommand === 'set') {
            const role = message.mentions.roles.first();
            const multiplier = parseFloat(args[2]);

            if (!role || isNaN(multiplier) || multiplier <= 0) {
                return message.reply(lui.payload(lui.err(gid, 'Invalid Usage', 'Provide a role and a positive multiplier.', 'Example: `levelmultiplier set @Booster 2.0`')));
            }
            if (multiplier > 10) {
                return message.reply(lui.payload(lui.err(gid, 'Invalid Multiplier', 'Multiplier must be between **0.1x** and **10x**.', 'Use a reasonable value to prevent XP inflation.')));
            }

            const multipliers = getMultiplier();
            if (!multipliers[gid]) multipliers[gid] = {};
            multipliers[gid][role.id] = multiplier;
            saveMultiplier(multipliers);

            return message.reply(lui.payload(lui.ok(gid, 'XP Multiplier Set', `Users with ${role} will now earn **${multiplier}x XP** per message.`, {
                Role: `${role}`,
                Multiplier: `${multiplier}x`,
                Effect: `+${Math.round((multiplier - 1) * 100)}% XP gain`,
            }, { emoji: lui.E.xp })));
        }

        if (subcommand === 'remove') {
            const role = message.mentions.roles.first();
            if (!role) {
                return message.reply(lui.payload(lui.err(gid, 'Missing Role', 'Mention the role to remove the multiplier from.', 'Example: `levelmultiplier remove @Booster`')));
            }

            const multipliers = getMultiplier();
            if (!multipliers[gid] || !multipliers[gid][role.id]) {
                return message.reply(lui.payload(lui.warn(gid, 'No Multiplier Found', `No XP multiplier is configured for ${role}.`)));
            }

            delete multipliers[gid][role.id];
            saveMultiplier(multipliers);

            return message.reply(lui.payload(lui.ok(gid, 'Multiplier Removed', `XP multiplier removed for ${role}. They will now earn standard XP.`)));
        }

        if (subcommand === 'list') {
            const multipliers = getMultiplier();
            const guildMultipliers = multipliers[gid] || {};
            const entries = Object.entries(guildMultipliers);

            if (entries.length === 0) {
                return message.reply(lui.payload(lui.list(gid, 'XP Multipliers', [], {
                    emoji: lui.E.xp, empty: 'No multipliers configured yet.', note: 'Use `levelmultiplier set @role <multiplier>` to add one',
                })));
            }

            const lineEntries = entries.map(([roleId, mult]) => {
                const role = message.guild.roles.cache.get(roleId);
                return `${lui.E.bullet} ${role || '`Deleted Role`'} — **${mult}x** XP (+${Math.round((mult - 1) * 100)}%)`;
            });
            const { content } = buildSafeListText({
                header: `# ${lui.E.xp} XP Multipliers`,
                lines: lineEntries,
                separator: '\n',
                footer: `\n-# ${entries.length} multiplier${entries.length !== 1 ? 's' : ''} configured`,
                overflowHint: '\n-# +${n} more not shown — remove some entries to see them all',
            });

            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
            return message.reply(lui.payload(lui.applyStyle(container, gid)));
        }

        // Base help panel
        const container = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `# ${lui.E.xp} XP Multiplier System\n\nBoost XP gain for specific roles to reward active members.`
            ))
            .addSeparatorComponents(lui.divider())
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `### ${lui.E.doc} Commands\n${lui.rows([
                    '`levelmultiplier set @role <multiplier>` — Set XP multiplier',
                    '`levelmultiplier remove @role` — Remove multiplier',
                    '`levelmultiplier list` — View all multipliers',
                ])}`
            ))
            .addActionRowComponents(new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('levelmultiplier_list').setLabel('View Multipliers').setStyle(ButtonStyle.Primary).setEmoji(lui.E.xp),
                new ButtonBuilder().setCustomId('levelmultiplier_help').setLabel('Help').setStyle(ButtonStyle.Secondary).setEmoji(lui.E.bulb)
            ));

        return message.reply(lui.payload(lui.applyStyle(container, gid)));
    },
};
