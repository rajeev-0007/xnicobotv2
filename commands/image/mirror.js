const { createImageCommand } = require('../../utils/imageCommandHelper');

module.exports = createImageCommand({
    name: 'mirror',
    description: 'Mirror/flip an image',
    aliases: ['reflect'],
    effectName: 'mirror effect',
    apiEndpoint: 'flip',
    filename: 'mirror.png',
    title: '<:Refresh:1521227946441052420> **Mirrored Image**',
    accentColor: 0xCAD7E6,
    errorMessage: '<:Cancel:1521227723916181644> Failed to mirror image.',
    prefixOnly: true,
});
