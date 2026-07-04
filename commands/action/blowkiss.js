const { createActionCommand } = require('../../utils/actionCommandFactory');

module.exports = createActionCommand({
    name: 'blowkiss',
    description: 'Blow a kiss to someone',
    verb: 'blew a kiss to',
    emoji: '😘',
    searchQuery: 'anime blow kiss',
    aliases: ['flyingkiss'],
    selfMessage: 'Save that kiss for someone special!'
});
