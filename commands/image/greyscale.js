const { createImageCommand } = require('../../utils/imageCommandHelper');

module.exports = createImageCommand({
    name: 'greyscale',
    description: 'Convert image to greyscale',
    aliases: ['grayscale', 'gray', 'grey'],
    effectName: 'greyscale filter',
    apiEndpoint: 'greyscale',
    filename: 'greyscale.png',
    title: '<:Attach:1521228039135170722> **Greyscale Filter**',
    accentColor: 0x808080,
    errorMessage: '<:Cancel:1521227723916181644> Failed to convert image to greyscale.',
    prefixOnly: true,
});
