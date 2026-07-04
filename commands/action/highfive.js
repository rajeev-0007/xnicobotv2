const { createActionCommand } = require('../../utils/actionCommandFactory');

module.exports = createActionCommand({
    name: 'highfive',
    description: 'High five someone',
    verb: 'high-fived',
    emoji: ':raised_hands:',
    searchQuery: 'anime high five',
    aliases: ['hifive', 'hi5']
});
