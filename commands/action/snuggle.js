const { createActionCommand } = require('../../utils/actionCommandFactory');

module.exports = createActionCommand({
    name: 'snuggle',
    description: 'Snuggle close with someone',
    verb: 'snuggled with',
    emoji: '🤗',
    searchQuery: 'anime snuggle',
    nekosEndpoint: 'cuddle',
    waifuEndpoint: 'cuddle',
    aliases: ['nuzzle'],
    selfMessage: 'You need someone to snuggle with!'
});
