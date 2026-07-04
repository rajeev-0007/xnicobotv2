const { PermissionFlagsBits } = require('discord.js');

const jsonStore = require('../../utils/jsonStore');
module.exports = {
    name: 'customcmd',
    description: 'Create a custom command',
    /**
     * Premium-gated feature. `premiumOnly` is read by the prefix
     * command dispatcher in index.js — non-premium servers get the
     * standard premium gate instead of execution.
     *
     * Note: this only gates CREATION of new custom commands. Running
     * an existing custom command (e.g. `-mycmd`) is dispatched
     * earlier in the prefix handler via the `customcmds` lookup, so
     * members on a non-premium server can still use the commands an
     * admin set up while premium was active.
     */
    premiumOnly: true,
    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply(require('../../utils/utilityUI').errReply('Missing Permission', 'You need the **Administrator** permission.'));
        }

        if (args.length < 2) {
            return message.reply(require('../../utils/utilityUI').errReply('Invalid Usage', 'Usage: `-customcmd <name> <response>`'));
        }

        const cmdName = args[0].toLowerCase();
        const response = args.slice(1).join(' ');

        let config = {};

        if (jsonStore.has('customcmds')) {
            config = jsonStore.read('customcmds');
        }

        if (!config[message.guild.id]) {
            config[message.guild.id] = {};
        }

        config[message.guild.id][cmdName] = response;
        jsonStore.write('customcmds', config);

        await message.reply(`<:Checkedbox:1521227734943269077> Custom command **${cmdName}** created!\n*Use with: \`-${cmdName}\`*`);
    }
};
