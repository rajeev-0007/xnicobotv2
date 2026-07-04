const { createActionCommand } = require('../../utils/actionCommandFactory');

module.exports = createActionCommand({
    name: 'yeet',
    description: 'Yeet someone into oblivion',
    verb: 'yeeted',
    emoji: '🚀',
    searchQuery: 'anime yeet',
    aliases: ['toss', 'launch'],
    selfMessage: 'You can\'t yeet yourself!'
});
