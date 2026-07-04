const { createActionCommand } = require('../../utils/actionCommandFactory');

module.exports = createActionCommand({
    name: 'stretch',
    description: 'Stretch near someone',
    verb: 'stretched near',
    emoji: '🤸',
    searchQuery: 'anime stretching',
    nekosEndpoint: 'yawn',
    waifuEndpoint: null,
    aliases: []
});
