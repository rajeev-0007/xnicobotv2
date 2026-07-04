const { createActionCommand } = require('../../utils/actionCommandFactory');

module.exports = createActionCommand({
    name: 'bored',
    description: 'Show how bored you are',
    verb: 'is bored',
    emoji: '😑',
    solo: true,
    searchQuery: 'anime bored',
    aliases: []
});
