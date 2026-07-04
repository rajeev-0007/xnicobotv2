const { createActionCommand } = require('../../utils/actionCommandFactory');

module.exports = createActionCommand({
    name: 'shoot',
    description: 'Pretend-shoot someone (anime style!)',
    verb: 'shot',
    emoji: '🔫',
    searchQuery: 'anime shoot finger gun',
    aliases: ['fingergun'],
    selfMessage: 'Don\'t shoot yourself!'
});
