const { createActionCommand } = require('../../utils/actionCommandFactory');

module.exports = createActionCommand({
    name: 'think',
    description: 'Think hard about something',
    verb: 'is thinking',
    emoji: '🤔',
    solo: true,
    searchQuery: 'anime thinking',
    aliases: ['ponder']
});
