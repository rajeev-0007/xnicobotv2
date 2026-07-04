const { createActionCommand } = require('../../utils/actionCommandFactory');

module.exports = createActionCommand({
    name: 'sleep',
    description: 'Take a nap',
    verb: 'fell asleep',
    emoji: '😴',
    solo: true,
    searchQuery: 'anime sleeping',
    aliases: ['nap']
});
