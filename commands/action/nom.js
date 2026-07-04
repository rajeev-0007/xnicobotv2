const { createActionCommand } = require('../../utils/actionCommandFactory');

module.exports = createActionCommand({
    name: 'nom',
    description: 'Take a nom out of someone',
    verb: 'nommed',
    emoji: '😋',
    searchQuery: 'anime nom',
    aliases: ['eat', 'munch'],
    selfMessage: 'Don\'t nom yourself!'
});
