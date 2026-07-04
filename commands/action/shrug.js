const { createActionCommand } = require('../../utils/actionCommandFactory');

module.exports = createActionCommand({
    name: 'shrug',
    description: 'Shrug it off',
    verb: 'shrugged',
    emoji: '🤷',
    solo: true,
    searchQuery: 'anime shrug',
    aliases: ['idk']
});
