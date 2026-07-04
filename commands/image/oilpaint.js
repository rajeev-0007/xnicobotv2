const { createImageCommand } = require('../../utils/imageCommandHelper');

module.exports = createImageCommand({
    name: 'oilpaint',
    description: 'Apply oil paint effect to an image',
    aliases: ['oil', 'paint'],
    effectName: 'oil paint effect',
    apiEndpoint: 'oilpaint',
    filename: 'oilpaint.png',
    title: '<:Editalt:1521227921673556019> **Oil Painting**',
    accentColor: 0x8B4513,
    errorMessage: '<:Cancel:1521227723916181644> Failed to apply oil paint effect.',
    prefixOnly: true,
});
