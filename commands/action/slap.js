const { createActionCommand } = require('../../utils/actionCommandFactory');

module.exports = createActionCommand({
    name: 'slap',
    description: 'Slap someone (just for fun!)',
    verb: 'slapped',
    emoji: ':punch:',
    searchQuery: 'anime slap',
    aliases: ['smack'],
    selfMessage: 'Find someone else to slap!'
});
