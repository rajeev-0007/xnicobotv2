const { createActionCommand } = require('../../utils/actionCommandFactory');

module.exports = createActionCommand({
    name: 'confused',
    description: 'Express your confusion',
    verb: 'is confused',
    emoji: '😕',
    solo: true,
    searchQuery: 'anime confused',
    aliases: ['huh']
});
