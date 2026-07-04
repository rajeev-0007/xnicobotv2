'use strict';

/**
 * errortest.js — Owner-only: deliberately throw an error so the global
 * error logger / hook can be exercised. Pairs with `emit` for surface
 * coverage testing.
 */

const { isOwner } = require('../../utils/helpers');

module.exports = {
    name: 'errortest',
    prefix: 'errortest',
    aliases: ['throwerror', 'crashtest'],
    description: 'Owner-only: throw a synthetic error to test error handling',
    usage: 'errortest [sync|async|reject]',
    category: 'owner',
    ownerOnly: true,

    async executePrefix(message, args) {
        if (!isOwner(message.author.id)) {
            return message.reply(require('../../utils/ownerUI').ownerOnly());
        }

        const mode = (args[0] || 'sync').toLowerCase();
        await message.reply(`<:Lightning:1521227915537285150> Triggering **${mode}** error in 1s. Watch the error logger.`);

        setTimeout(() => {
            try {
                if (mode === 'reject') {
                    Promise.reject(new Error('errortest: synthetic unhandled rejection'));
                    return;
                }
                if (mode === 'async') {
                    setImmediate(() => { throw new Error('errortest: synthetic async error'); });
                    return;
                }
                throw new Error('errortest: synthetic sync error');
            } catch (e) {
                // Re-throw onto the next tick so the global handler sees it.
                process.nextTick(() => { throw e; });
            }
        }, 1000);
    }
};
