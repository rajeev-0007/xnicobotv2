const { createActionCommand } = require('../../utils/actionCommandFactory');

module.exports = createActionCommand({
    name: 'baka',
    description: 'Call someone a baka!',
    verb: 'called',
    emoji: '😤',
    searchQuery: 'anime baka',
    aliases: ['idiot'],
    selfMessage: 'You\'re not a baka!'
});
