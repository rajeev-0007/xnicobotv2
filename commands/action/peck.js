const { createActionCommand } = require('../../utils/actionCommandFactory');

module.exports = createActionCommand({
    name: 'peck',
    description: 'Give someone a quick peck',
    verb: 'gave a peck to',
    emoji: '😘',
    searchQuery: 'anime peck kiss',
    aliases: ['quickkiss']
});
