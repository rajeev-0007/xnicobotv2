const { createActionCommand } = require('../../utils/actionCommandFactory');

module.exports = createActionCommand({
    name: 'pout',
    description: 'Pout cutely',
    verb: 'is pouting',
    emoji: '😤',
    solo: true,
    searchQuery: 'anime pout',
    aliases: ['hmph']
});
