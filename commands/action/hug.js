const { createActionCommand } = require('../../utils/actionCommandFactory');

module.exports = createActionCommand({
    name: 'hug',
    description: 'Give someone a warm hug',
    verb: 'hugged',
    emoji: ':hugging:',
    searchQuery: 'anime hug',
    aliases: ['embrace'],
    selfMessage: 'You can\'t hug yourself! But here\'s a virtual hug anyway!'
});
