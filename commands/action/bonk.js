const { createActionCommand } = require('../../utils/actionCommandFactory');

module.exports = createActionCommand({
    name: 'bonk',
    description: 'Bonk someone on the head',
    verb: 'bonked',
    emoji: ':hammer:',
    searchQuery: 'anime bonk head',
    aliases: ['bop']
});
