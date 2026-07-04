const { createImageCommand } = require('../../utils/imageCommandHelper');

module.exports = createImageCommand({
    name: 'invertcolors',
    description: 'Invert colors of an image',
    aliases: ['invert', 'negative'],
    effectName: 'color inversion',
    apiEndpoint: 'invert',
    filename: 'invert.png',
    title: '<:Attach:1521228039135170722> **Inverted Colors**',
    accentColor: 0xCAD7E6,
    errorMessage: '<:Cancel:1521227723916181644> Failed to invert image colors.',
    prefixOnly: true,
});
