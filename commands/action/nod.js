const { createActionCommand } = require('../../utils/actionCommandFactory');

module.exports = createActionCommand({
    name: 'nod',
    description: 'Nod approvingly at someone',
    verb: 'nodded at',
    emoji: '🙂',
    searchQuery: 'anime nodding',
    aliases: ['approve'],
    selfAllowed: true
});
