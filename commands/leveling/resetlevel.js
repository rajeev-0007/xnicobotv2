const { PermissionFlagsBits, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, TextDisplayBuilder } = require('discord.js');
const lui = require('../../utils/levelingUI');

const jsonStore = require('../../utils/jsonStore');
const { resolveUser } = require('../../utils/resolveUser');

function getLeveling() {
    if (!jsonStore.has('leveling')) {
        jsonStore.write('leveling', {});
        return {};
    }
    return jsonStore.read('leveling');
}

function saveLeveling(data) {
    jsonStore.write('leveling', data);
}

module.exports = {
    data: null, // Prefix-only
    name: 'resetlevel',
    prefix: 'resetlevel',
    description: 'Reset a user\'s level or all levels',
    usage: 'resetlevel <@user|all>',
    category: 'leveling',
    aliases: ['lvlreset', 'resetxp'],

    async executePrefix(message, args) {
        const gid = message.guild.id;
        const perr = lui.requirePerm(message.member, gid);
        if (perr) return message.reply(lui.payload(perr));

        const leveling = getLeveling();

        if (args[0]?.toLowerCase() === 'all') {
            const memberCount = Object.keys(leveling[gid] || {}).length;

            const confirmContainer = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# ${lui.E.warn} Confirm Reset All Levels\n\n` +
                    `This will permanently reset leveling data for **${memberCount}** user${memberCount !== 1 ? 's' : ''}.\n\n` +
                    `-# This action cannot be undone.`
                ))
                .addActionRowComponents(new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('resetlevel_confirm_all').setLabel('Reset All').setStyle(ButtonStyle.Danger).setEmoji(lui.E.trash),
                    new ButtonBuilder().setCustomId('resetlevel_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary).setEmoji(lui.E.no)
                ));

            const confirmMsg = await message.reply(lui.payload(lui.applyStyle(confirmContainer, gid, { footer: false })));

            try {
                const filter = i => i.user.id === message.author.id && ['resetlevel_confirm_all', 'resetlevel_cancel'].includes(i.customId);
                const collected = await confirmMsg.awaitMessageComponent({ filter, time: 30000 });

                if (collected.customId === 'resetlevel_confirm_all') {
                    leveling[gid] = {};
                    saveLeveling(leveling);
                    await collected.update(lui.payload(lui.ok(gid, 'All Levels Reset', `All leveling data for **${memberCount}** user${memberCount !== 1 ? 's' : ''} has been wiped.`, {
                        Server: message.guild.name,
                        'Users Affected': `${memberCount}`,
                        'Reset By': `${message.author}`,
                    }, { emoji: lui.E.trash })));
                } else {
                    await collected.update(lui.payload(lui.info(gid, 'Reset Cancelled', 'No leveling data was modified.')));
                }
            } catch {
                await confirmMsg.edit(lui.payload(lui.err(gid, 'Confirmation Expired', 'The reset was cancelled due to timeout.'))).catch(() => {});
            }
            return;
        }

        const target = await resolveUser(message, args);
        if (!target) {
            return message.reply(lui.payload(lui.err(gid, 'Invalid Usage', 'Mention a user or use `all`.', 'Examples: `resetlevel @user` · `resetlevel all`')));
        }

        if (leveling[gid] && leveling[gid][target.id]) {
            const oldData = leveling[gid][target.id];
            const oldLevel = oldData.level || Math.floor(0.1 * Math.sqrt(oldData.xp || 0));
            delete leveling[gid][target.id];
            saveLeveling(leveling);

            return message.reply(lui.payload(lui.ok(gid, 'Level Reset', `${target}'s leveling data has been reset.`, {
                User: `${target}`,
                'Previous Level': `${oldLevel}`,
                'Previous XP': `${(oldData.xp || 0).toLocaleString()}`,
                Status: 'Reset to Level 0',
            }, { emoji: lui.E.trash })));
        }

        return message.reply(lui.payload(lui.err(gid, 'No Data Found', `${target} has no leveling data to reset.`)));
    },
};
