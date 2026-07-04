const { createActionCommand } = require('../../utils/actionCommandFactory');

module.exports = createActionCommand({
    name: 'pat',
    description: 'Pat someone on the head',
    verb: 'patted',
    emoji: '✋',
    searchQuery: 'anime head pat',
    aliases: []
});
