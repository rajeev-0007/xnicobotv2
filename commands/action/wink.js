const { createActionCommand } = require('../../utils/actionCommandFactory');

module.exports = createActionCommand({
    name: 'wink',
    description: 'Wink at someone',
    verb: 'winked at',
    emoji: ':wink:',
    searchQuery: 'anime wink',
    aliases: []
});
