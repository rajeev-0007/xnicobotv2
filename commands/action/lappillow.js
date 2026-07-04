const { createActionCommand } = require('../../utils/actionCommandFactory');

module.exports = createActionCommand({
    name: 'lappillow',
    description: 'Offer your lap as a pillow',
    verb: 'offered a lap pillow to',
    emoji: '💤',
    searchQuery: 'anime lap pillow',
    aliases: ['lap'],
    selfMessage: 'You need someone else to share a lap pillow!'
});
