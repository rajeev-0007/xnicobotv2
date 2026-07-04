const { createActionCommand } = require('../../utils/actionCommandFactory');

module.exports = createActionCommand({
    name: 'feed',
    description: 'Feed someone something tasty',
    verb: 'fed',
    emoji: '🍜',
    searchQuery: 'anime feeding',
    aliases: ['givefood']
});
