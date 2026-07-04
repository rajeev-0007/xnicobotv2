const { createActionCommand } = require('../../utils/actionCommandFactory');

module.exports = createActionCommand({
    name: 'poke',
    description: 'Poke someone to get their attention',
    verb: 'poked',
    emoji: ':point_right:',
    searchQuery: 'anime poke',
    aliases: ['boop']
});
