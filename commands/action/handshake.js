const { createActionCommand } = require('../../utils/actionCommandFactory');

module.exports = createActionCommand({
    name: 'handshake',
    description: 'Shake hands with someone',
    verb: 'shook hands with',
    emoji: '🤝',
    searchQuery: 'anime handshake',
    aliases: ['shakehand', 'shake'],
    selfMessage: 'You can\'t shake your own hand!'
});
