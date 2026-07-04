const { PermissionFlagsBits } = require('discord.js');

const jsonStore = require('../../utils/jsonStore');
module.exports = {
    name: 'delcustomcmd',
    description: 'Delete a custom command',
    /**
     * Premium-gated feature. `premiumOnly` is read by the prefix
     * command dispatcher in index.js — non-premium servers get the
     * standard premium gate instead of execution. Pairs with
     * `customcmd` (creation) which is also premium-gated.
     */
    premiumOnly: true,
    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply(require('../../utils/utilityUI').errReply('Missing Permission', 'You need the **Administrator** permission.'));
        }

        const cmdName = args[0]?.toLowerCase();
        if (!cmdName) {
            return message.reply(require('../../utils/utilityUI').errReply('Invalid Usage', 'Usage: `-delcustomcmd <name>`'));
        }

        let config = {};

        if (jsonStore.has('customcmds')) {
            config = jsonStore.read('customcmds');
        }

        if (!config[message.guild.id] || !config[message.guild.id][cmdName]) {
            return message.reply(require('../../utils/utilityUI').errReply('Not Found', 'That custom command does not exist.'));
        }

        delete config[message.guild.id][cmdName];
        jsonStore.write('customcmds', config);

        await message.reply(`<:Checkedbox:1521227734943269077> Custom command **${cmdName}** has been deleted!`);
    }
};
