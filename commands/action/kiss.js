const { createActionCommand } = require('../../utils/actionCommandFactory');

module.exports = createActionCommand({
    name: 'kiss',
    description: 'Give someone a kiss',
    verb: 'kissed',
    emoji: ':kissing_heart:',
    searchQuery: 'anime kiss',
    aliases: ['smooch'],
    selfMessage: 'Try finding someone else!'
});
