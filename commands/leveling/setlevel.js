const { PermissionFlagsBits } = require('discord.js');
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

function xpForLevel(level) {
    return Math.pow(level / 0.1, 2);
}

module.exports = {
    data: null, // Prefix-only
    name: 'setlevel',
    prefix: 'setlevel',
    description: 'Set a user\'s level',
    usage: 'setlevel <@user> <level>',
    category: 'leveling',
    aliases: ['lvlset', 'setxp'],

    async executePrefix(message, args) {
        const gid = message.guild.id;
        const perr = lui.requirePerm(message.member, gid);
        if (perr) return message.reply(lui.payload(perr));

        const target = await resolveUser(message, args);
        const level = parseInt(args[1]);

        if (!target || isNaN(level) || level < 0) {
            return message.reply(lui.payload(lui.err(gid, 'Invalid Usage', 'Provide a user and a level.', 'Example: `setlevel @user 10`')));
        }
        if (level > 1000) {
            return message.reply(lui.payload(lui.err(gid, 'Invalid Level', 'Level must be between **0** and **1000**.')));
        }

        const leveling = getLeveling();
        if (!leveling[gid]) leveling[gid] = {};

        const oldData = leveling[gid][target.id];
        const oldLevel = oldData ? (oldData.level || Math.floor(0.1 * Math.sqrt(oldData.xp || 0))) : 0;
        const xpNeeded = Math.ceil(xpForLevel(level));

        leveling[gid][target.id] = {
            ...(leveling[gid][target.id] || {}),
            xp: xpNeeded,
            level: level,
            lastXpGain: leveling[gid][target.id]?.lastXpGain || 0,
        };
        saveLeveling(leveling);

        return message.reply(lui.payload(lui.ok(gid, 'Level Updated', `Successfully set ${target}'s level.`, {
            User: `${target}`,
            'Previous Level': `${oldLevel}`,
            'New Level': `${level}`,
            'Total XP': `${xpNeeded.toLocaleString()}`,
        }, { emoji: lui.E.xp })));
    },
};
