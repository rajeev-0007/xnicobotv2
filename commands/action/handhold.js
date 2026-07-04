const { createActionCommand } = require('../../utils/actionCommandFactory');

module.exports = createActionCommand({
    name: 'handhold',
    description: 'Hold someone\'s hand',
    verb: 'held hands with',
    emoji: '🤝',
    searchQuery: 'anime hand holding',
    aliases: ['holdhand']
});
