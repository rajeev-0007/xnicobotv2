const { createActionCommand } = require('../../utils/actionCommandFactory');

module.exports = createActionCommand({
    name: 'blush',
    description: 'Blush around someone',
    verb: 'blushed around',
    emoji: '😳',
    searchQuery: 'anime blush embarrassed',
    aliases: ['shy']
});
