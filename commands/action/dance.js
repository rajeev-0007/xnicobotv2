const { createActionCommand } = require('../../utils/actionCommandFactory');

module.exports = createActionCommand({
    name: 'dance',
    description: 'Dance with someone',
    verb: 'danced with',
    emoji: '💃🕺',
    searchQuery: 'anime dancing together',
    aliases: []
});
