const { isOwner } = require('../../utils/helpers');

module.exports = {
    name: 'globalunban',
    prefix: 'globalunban',
    aliases: ['gunban'],
    description: 'Unban a user from every guild the bot is in',
    usage: 'globalunban <userId>',
    category: 'owner',
    ownerOnly: true,

    async executePrefix(message, args, lavalinkManager, client) {
        if (!isOwner(message.author.id)) {
            return message.reply(require('../../utils/ownerUI').ownerOnly());
        }

        const userId = args[0]?.replace(/[<@!>]/g, '');
        if (!userId || !/^\d{17,20}$/.test(userId)) {
            return message.reply(require('../../utils/ownerUI').errReply('Invalid User ID', 'Provide a valid user ID.', { hint: 'Usage: `globalunban <userId>`' }));
        }

        const msg = await message.reply(`<:Lightning:1521227915537285150> Globally unbanning \`${userId}\`...`);

        let success = 0;
        let failed = 0;
        for (const guild of client.guilds.cache.values()) {
            try {
                await guild.members.unban(userId, 'Global unban');
                success++;
            } catch (err) {
                // Most failures are "user not banned" which is expected.
                if (!/Unknown Ban|Unknown User/i.test(err.message)) {
                    failed++;
                    console.error(`[globalunban] ${guild.name}: ${err.message}`);
                }
            }
        }

        await msg.edit(
            `<:Checkedbox:1521227734943269077> Globally unbanned \`${userId}\`\n` +
            `> Unbanned in: **${success}** guild(s)\n` +
            (failed ? `> Failed in: **${failed}** guild(s)` : '')
        ).catch(() => {});
    }
};
