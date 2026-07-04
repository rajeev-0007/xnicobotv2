const { createActionCommand } = require('../../utils/actionCommandFactory');

module.exports = createActionCommand({
    name: 'wave',
    description: 'Wave at someone',
    verb: 'waved at',
    emoji: ':wave:',
    searchQuery: 'anime wave hello',
    aliases: ['hi', 'hello'],
    selfAllowed: true
});
