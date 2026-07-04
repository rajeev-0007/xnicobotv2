const { createActionCommand } = require('../../utils/actionCommandFactory');

module.exports = createActionCommand({
    name: 'bully',
    description: 'Lightly bully someone',
    verb: 'bullied',
    emoji: '😈',
    searchQuery: 'anime bully',
    aliases: ['tease'],
    selfMessage: 'You can\'t bully yourself!'
});
