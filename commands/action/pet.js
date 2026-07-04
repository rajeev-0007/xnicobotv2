const { createActionCommand } = require('../../utils/actionCommandFactory');

module.exports = createActionCommand({
    name: 'pet',
    description: 'Give someone a gentle pet/pat',
    verb: 'petted',
    emoji: ':sparkling_heart:',
    searchQuery: 'anime head pat',
    nekosEndpoint: 'pat',
    waifuEndpoint: 'pat',
    aliases: ['headpat']
});
