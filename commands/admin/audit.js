
const { ContainerBuilder, TextDisplayBuilder, MessageFlags, PermissionFlagsBits, AuditLogEvent } = require('discord.js');

module.exports = {
    prefix: 'audit',
    description: 'Audit',
    usage: 'audit',
    category: 'admin',
    data: null,

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.ViewAuditLog)) {
            return message.reply('<:Cancel:1521227723916181644> You need **View Audit Log** permission to use this command!');
        }

        const limit = parseInt(args[0]) || 5;

        if (limit < 1 || limit > 20) {
            return message.reply('<:Cancel:1521227723916181644> Usage: `audit [limit]`\nLimit must be between 1-20.\nExample: `audit 10`');
        }

        try {
            const auditLogs = await message.guild.fetchAuditLogs({ limit });

            let logText = `# <:Bookopen:1521227911137595605> Recent Audit Logs\n\n`;
            
            auditLogs.entries.forEach((entry, index) => {
                const executor = entry.executor ? entry.executor.username : 'Unknown';
                const target = entry.target ? (entry.target.username || entry.target.name || entry.target.id) : 'Unknown';
                const action = entry.action;
                
                logText += `**${index + 1}.** ${executor} → ${getActionName(action)}\n`;
                logText += `   Target: ${target}\n`;
                logText += `   Time: <t:${Math.floor(entry.createdTimestamp / 1000)}:R>\n\n`;
            });

            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(logText)
                );

            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            await message.reply(`<:Cancel:1521227723916181644> Error: ${error.message}`);
        }
    }
};

function getActionName(action) {
    const actions = {
        1: 'Guild Update',
        10: 'Channel Create',
        11: 'Channel Update',
        12: 'Channel Delete',
        20: 'Member Kick',
        21: 'Member Prune',
        22: 'Member Ban',
        23: 'Member Unban',
        24: 'Member Update',
        25: 'Member Role Update',
        30: 'Role Create',
        31: 'Role Update',
        32: 'Role Delete',
        72: 'Message Delete',
        73: 'Message Bulk Delete',
        74: 'Message Pin',
        75: 'Message Unpin'
    };
    return actions[action] || `Action ${action}`;
}
