const { createActionCommand } = require('../../utils/actionCommandFactory');

module.exports = createActionCommand({
    name: 'yawn',
    description: 'Yawn in front of someone',
    verb: 'yawned in front of',
    emoji: '😴',
    searchQuery: 'anime yawning tired',
    aliases: []
});
