const { createActionCommand } = require('../../utils/actionCommandFactory');

module.exports = createActionCommand({
    name: 'smug',
    description: 'Show off your smug face',
    verb: 'is smug',
    emoji: '😏',
    solo: true,
    searchQuery: 'anime smug',
    aliases: ['smirk']
});
