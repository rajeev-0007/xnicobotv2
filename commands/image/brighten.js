const { createImageCommand } = require('../../utils/imageCommandHelper');

module.exports = createImageCommand({
    name: 'brighten',
    description: 'Brighten an image',
    aliases: ['bright', 'light'],
    effectName: 'brightness',
    apiEndpoint: 'brighten',
    filename: 'brighten.png',
    title: '<:Lightningalt:1521227851796447472> **Brightened Image**',
    accentColor: 0xFFD700,
    errorMessage: '<:Cancel:1521227723916181644> Failed to brighten image.',
    prefixOnly: true,
});
