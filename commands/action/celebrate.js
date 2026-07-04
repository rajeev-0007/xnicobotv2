const { createActionCommand } = require('../../utils/actionCommandFactory');

module.exports = createActionCommand({
    name: 'celebrate',
    description: 'Celebrate with someone',
    verb: 'celebrated with',
    emoji: '🎉',
    searchQuery: 'anime celebrating happy',
    nekosEndpoint: 'happy',
    waifuEndpoint: 'happy',
    aliases: ['party', 'cheer']
});
