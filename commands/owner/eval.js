'use strict';

/**
 * eval.js — prefix-only.
 * Owner-only JavaScript REPL inside the bot process. Output and any
 * thrown error are formatted into a Components V2 container.
 */

const { isOwner } = require('../../utils/helpers');
const { MessageFlags, ContainerBuilder, TextDisplayBuilder } = require('discord.js');
const util = require('util');

const MAX_OUTPUT = 1500;
const MAX_INPUT  = 1000;

function buildEvalContainer(code, output, isError = false) {
    return new ContainerBuilder()
        .setAccentColor(isError ? 0xFF0000 : 0x00FF00)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `# ${isError ? '<:Cancel:1521227723916181644> Eval Error' : '<:Bookopen:1521227911137595605> Eval Result'}\n\n` +
                `**<:Fire:1521227907647668374> Input:**\n\`\`\`js\n${code.substring(0, MAX_INPUT)}\n\`\`\`\n` +
                `**<:Image:1521227966435037255> ${isError ? 'Error' : 'Output'}:**\n\`\`\`js\n${output}\n\`\`\``
            )
        );
}

function truncate(value) {
    return value.length > MAX_OUTPUT ? value.substring(0, MAX_OUTPUT) + '…' : value;
}

module.exports = {
    name: 'eval',
    prefix: 'eval',
    aliases: ['ev', 'js'],
    description: 'Owner-only: evaluate raw JavaScript inside the bot',
    usage: 'eval <code>',
    category: 'owner',
    ownerOnly: true,

    async executePrefix(message, args, lavalinkManager) {
        if (!isOwner(message.author.id)) {
            return message.reply(require('../../utils/ownerUI').ownerOnly());
        }

        const code = args.join(' ');
        if (!code) return message.reply(require('../../utils/ownerUI').errReply('Missing Code', 'Please provide code to evaluate.'));

        const client = message.client; // exposed for use in evaluated code
        try {
            // eslint-disable-next-line no-eval
            let evaled = eval(code);
            if (evaled instanceof Promise) evaled = await evaled;

            const output = typeof evaled === 'string' ? evaled : util.inspect(evaled, { depth: 0 });
            const container = buildEvalContainer(code, truncate(output));
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            const container = buildEvalContainer(code, truncate(error.stack || error.message), true);
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
