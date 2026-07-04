const { createActionCommand } = require('../../utils/actionCommandFactory');

module.exports = createActionCommand({
    name: 'tableflip',
    description: 'Flip a table in rage',
    verb: 'flipped a table',
    emoji: '(╯°□°)╯︵ ┻━┻',
    solo: true,
    searchQuery: 'anime table flip',
    aliases: []
});
