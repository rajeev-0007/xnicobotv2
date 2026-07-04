const { createActionCommand } = require('../../utils/actionCommandFactory');

module.exports = createActionCommand({
    name: 'bite',
    description: 'Bite someone playfully',
    verb: 'bit',
    emoji: ':rage:',
    searchQuery: 'anime bite',
    aliases: ['chomp']
});
