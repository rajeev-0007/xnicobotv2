const { isOwner } = require('../../utils/helpers');
const { MessageFlags, ContainerBuilder, TextDisplayBuilder } = require('discord.js');
const path = require('path');

module.exports = {
    name: 'reload',
    prefix: 'reload',
    aliases: ['reloadcmd', 'rl'],
    description: 'Reload a command at runtime without a restart',
    usage: 'reload <command>',
    category: 'owner',
    ownerOnly: true,

    async executePrefix(message, args, lavalinkManager) {
        if (!isOwner(message.author.id)) {
            return message.reply(require('../../utils/ownerUI').ownerOnly());
        }

        const commandName = args[0]?.toLowerCase();
        if (!commandName) return message.reply(require('../../utils/ownerUI').errReply('Missing Argument', 'Please specify a command to reload.'));

        const command = message.client.commands.get(commandName);

        if (!command) {
            return message.reply(require('../../utils/ownerUI').errReply('Not Found', `Command \`${commandName}\` not found.`));
        }

        const folders = ['music', 'voice', 'basic', 'fun', 'admin', 'automation', 'utility', 'owner', 'economy', 'leveling', 'image', 'social', 'backup', 'webhook', 'dm', 'stats', 'action'];
        let commandPath = null;

        for (const folder of folders) {
            const testPath = path.join(__dirname, '..', folder, `${commandName}.js`);
            try {
                require.resolve(testPath);
                commandPath = testPath;
                break;
            } catch (e) {}
        }

        if (!commandPath) {
            return message.reply(require('../../utils/ownerUI').errReply('Not Found', `Could not find command file for \`${commandName}\`.`));
        }

        delete require.cache[require.resolve(commandPath)];

        try {
            const newCommand = require(commandPath);
            message.client.commands.set(newCommand.data?.name || commandName, newCommand);

            // Re-register aliases
            if (newCommand.aliases) {
                for (const alias of newCommand.aliases) {
                    message.client.commands.set(alias, newCommand);
                }
            }

            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`# <:Checkedbox:1521227734943269077> Command Reloaded\n\n**Command:** \`${commandName}\`\n**Status:** Successfully reloaded`)
                );

            message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('[reload]', error);
            message.reply(require('../../utils/ownerUI').errReply('Reload Failed', `Error reloading command \`${commandName}\`:\n\`${error.message}\``));
        }
    }
};
