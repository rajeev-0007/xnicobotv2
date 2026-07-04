const { createImageCommand } = require('../../utils/imageCommandHelper');

module.exports = createImageCommand({
    name: 'pixelate',
    description: 'Pixelate an image',
    aliases: ['pixel'],
    effectName: 'pixelate effect',
    apiEndpoint: 'pixelate',
    filename: 'pixelate.png',
    title: '<:Attach:1521228039135170722> **Pixelated Image**',
    accentColor: 0xCAD7E6,
    errorMessage: '<:Cancel:1521227723916181644> Failed to pixelate image.',
    prefixOnly: true,
});
