const { isOwner } = require('../../utils/helpers');

module.exports = {
    name: 'globalban',
    prefix: 'globalban',
    aliases: ['gban', 'banall'],
    description: 'Ban a user from every guild the bot is in',
    usage: 'globalban <userId> [reason]',
    category: 'owner',
    ownerOnly: true,

    async executePrefix(message, args, lavalinkManager, client) {
        if (!isOwner(message.author.id)) {
            return message.reply(require('../../utils/ownerUI').ownerOnly());
        }

        const userId = args[0]?.replace(/[<@!>]/g, '');
        if (!userId || !/^\d{17,20}$/.test(userId)) {
            return message.reply(require('../../utils/ownerUI').errReply('Invalid User ID', 'Provide a valid user ID.', { hint: 'Usage: `globalban <userId> [reason]`' }));
        }

        const reason = args.slice(1).join(' ') || 'Global ban';
        const msg = await message.reply(`<:Lightning:1521227915537285150> Globally banning \`${userId}\` from ${client.guilds.cache.size} guild(s)...`);

        let success = 0;
        let failed = 0;
        for (const guild of client.guilds.cache.values()) {
            try {
                await guild.members.ban(userId, { reason: `[GLOBAL BAN] ${reason}` });
                success++;
            } catch (err) {
                failed++;
                console.error(`[globalban] ${guild.name}: ${err.message}`);
            }
        }

        await msg.edit(
            `<:Checkedbox:1521227734943269077> Globally banned \`${userId}\`\n` +
            `> Banned in: **${success}** guild(s)\n` +
            (failed ? `> Failed in: **${failed}** guild(s)\n` : '') +
            `> Reason: ${reason}`
        ).catch(() => {});
    }
};
