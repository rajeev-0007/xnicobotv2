const { createActionCommand } = require('../../utils/actionCommandFactory');

module.exports = createActionCommand({
    name: 'salute',
    description: 'Salute someone with respect',
    verb: 'saluted',
    emoji: '🫡',
    searchQuery: 'anime salute',
    aliases: ['respect'],
    selfAllowed: true
});
