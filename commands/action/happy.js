const { createActionCommand } = require('../../utils/actionCommandFactory');

module.exports = createActionCommand({
    name: 'happy',
    description: 'Show how happy you are',
    verb: 'is happy',
    emoji: '😊',
    solo: true,
    searchQuery: 'anime happy',
    aliases: ['joy']
});
