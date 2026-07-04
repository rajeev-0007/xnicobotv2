const { createActionCommand } = require('../../utils/actionCommandFactory');

module.exports = createActionCommand({
    name: 'spin',
    description: 'Spin around in circles',
    verb: 'is spinning',
    emoji: '🌀',
    solo: true,
    searchQuery: 'anime spinning',
    aliases: ['twirl', 'spinaround']
});
