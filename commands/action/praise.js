const { createActionCommand } = require('../../utils/actionCommandFactory');

module.exports = createActionCommand({
    name: 'praise',
    description: 'Praise someone',
    verb: 'praised',
    emoji: '⭐',
    searchQuery: 'anime praise compliment',
    nekosEndpoint: 'thumbsup',
    waifuEndpoint: 'happy',
    aliases: []
});
