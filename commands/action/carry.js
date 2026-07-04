const { createActionCommand } = require('../../utils/actionCommandFactory');

module.exports = createActionCommand({
    name: 'carry',
    description: 'Carry someone in your arms',
    verb: 'carried',
    emoji: '🫶',
    searchQuery: 'anime princess carry',
    aliases: ['princesscarry'],
    selfMessage: 'You can\'t carry yourself!'
});
