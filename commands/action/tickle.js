const { createActionCommand } = require('../../utils/actionCommandFactory');

module.exports = createActionCommand({
    name: 'tickle',
    description: 'Tickle someone',
    verb: 'tickled',
    emoji: ':laughing:',
    searchQuery: 'anime tickle',
    aliases: []
});
