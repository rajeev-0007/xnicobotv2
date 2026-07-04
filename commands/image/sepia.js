const { createImageCommand } = require('../../utils/imageCommandHelper');

module.exports = createImageCommand({
    name: 'sepia',
    description: 'Apply sepia filter to an image',
    aliases: ['vintage'],
    effectName: 'sepia filter',
    apiEndpoint: 'sepia',
    filename: 'sepia.png',
    title: '<:Attach:1521228039135170722> **Sepia Filter**',
    accentColor: 0xB8860B,
    errorMessage: '<:Cancel:1521227723916181644> Failed to apply sepia filter.',
    prefixOnly: true,
});
