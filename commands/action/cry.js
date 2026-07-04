const { createActionCommand } = require('../../utils/actionCommandFactory');

module.exports = createActionCommand({
    name: 'cry',
    description: 'Cry with someone',
    verb: 'cried with',
    emoji: '😭',
    searchQuery: 'anime crying sad',
    aliases: []
});
