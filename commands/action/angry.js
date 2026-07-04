const { createActionCommand } = require('../../utils/actionCommandFactory');

module.exports = createActionCommand({
    name: 'angry',
    description: 'Show how angry you are',
    verb: 'is angry',
    emoji: '😠',
    solo: true,
    searchQuery: 'anime angry',
    aliases: ['mad']
});
