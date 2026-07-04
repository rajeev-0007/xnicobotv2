const { createActionCommand } = require('../../utils/actionCommandFactory');

module.exports = createActionCommand({
    name: 'stare',
    description: 'Stare at someone',
    verb: 'stared at',
    emoji: '👀',
    searchQuery: 'anime stare intense',
    aliases: ['glare']
});
