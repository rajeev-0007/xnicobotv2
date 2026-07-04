const { createActionCommand } = require('../../utils/actionCommandFactory');

module.exports = createActionCommand({
    name: 'cuddle',
    description: 'Cuddle with someone',
    verb: 'cuddled',
    emoji: ':heartpulse:',
    searchQuery: 'anime cuddle',
    aliases: []
});
