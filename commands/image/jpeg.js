const { createImageCommand } = require('../../utils/imageCommandHelper');

module.exports = createImageCommand({
    name: 'jpeg',
    description: 'Add JPEG compression artifacts',
    aliases: ['jpegify', 'needsmorejpeg'],
    effectName: 'JPEG compression',
    apiEndpoint: 'jpeg',
    filename: 'jpeg.jpg',
    title: '<:Attach:1521228039135170722> **Needs More JPEG!**',
    accentColor: 0x8B4513,
    errorMessage: '<:Cancel:1521227723916181644> Failed to JPEGify image.',
    prefixOnly: true,
});
