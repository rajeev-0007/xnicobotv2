const { createActionCommand } = require('../../utils/actionCommandFactory');

module.exports = createActionCommand({
    name: 'facepalm',
    description: 'Facepalm at someone',
    verb: 'facepalmed at',
    emoji: '🤦',
    searchQuery: 'anime facepalm fail',
    aliases: ['facedesk']
});
