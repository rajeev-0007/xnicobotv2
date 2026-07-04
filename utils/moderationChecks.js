// Moderation checks utility for command validation
const { PermissionFlagsBits } = require('discord.js');

function requireGuild(target) {
    const guild = target.guild || target.message?.guild;
    if (!guild) {
        return 'This command can only be used in a server.';
    }
    return null;
}

function requireUserPermission(target, permission, permissionName) {
    const member = target.member || target.message?.member;
    if (!member) {
        return 'Could not verify your permissions.';
    }

    if (!member.permissions.has(permission)) {
        return `You need the **${permissionName}** permission to use this command.`;
    }

    return null;
}

function parsePositiveInt(value, defaultValue, min = 1, max = Number.MAX_SAFE_INTEGER) {
    if (value === null || value === undefined) {
        return defaultValue;
    }

    const parsed = parseInt(value, 10);
    if (isNaN(parsed) || parsed < min || parsed > max) {
        return defaultValue;
    }

    return parsed;
}

module.exports = {
    requireGuild,
    requireUserPermission,
    parsePositiveInt
};
