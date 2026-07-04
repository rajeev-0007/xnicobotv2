const { createActionCommand } = require('../../utils/actionCommandFactory');

module.exports = createActionCommand({
    name: 'laugh',
    description: 'Laugh with someone',
    verb: 'laughed at',
    emoji: '😂',
    searchQuery: 'anime laughing funny',
    aliases: []
});
