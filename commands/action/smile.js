const { createActionCommand } = require('../../utils/actionCommandFactory');

module.exports = createActionCommand({
    name: 'smile',
    description: 'Smile at someone',
    verb: 'smiled at',
    emoji: '😊',
    searchQuery: 'anime smile happy',
    aliases: ['grin']
});
