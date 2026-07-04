const { createActionCommand } = require('../../utils/actionCommandFactory');

module.exports = createActionCommand({
    name: 'thumbsup',
    description: 'Give someone a thumbs-up',
    verb: 'gave a thumbs-up to',
    emoji: '👍',
    searchQuery: 'anime thumbs up',
    aliases: ['gj', 'goodjob'],
    selfAllowed: true
});
