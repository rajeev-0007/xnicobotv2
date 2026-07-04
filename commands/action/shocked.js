const { createActionCommand } = require('../../utils/actionCommandFactory');

module.exports = createActionCommand({
    name: 'shocked',
    description: 'Show your shock',
    verb: 'is shocked',
    emoji: '😱',
    solo: true,
    searchQuery: 'anime shocked',
    aliases: ['surprised']
});
