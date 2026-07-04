const { createActionCommand } = require('../../utils/actionCommandFactory');

module.exports = createActionCommand({
    name: 'punch',
    description: 'Punch someone (in fun)',
    verb: 'punched',
    emoji: '👊',
    searchQuery: 'anime punch action',
    aliases: []
});
