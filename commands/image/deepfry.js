const { createImageCommand } = require('../../utils/imageCommandHelper');

module.exports = createImageCommand({
    name: 'deepfry',
    description: 'Deepfry an image',
    aliases: ['fry', 'fried'],
    effectName: 'deepfry effect',
    apiEndpoint: 'deepfry',
    filename: 'deepfry.png',
    title: '<:Fire:1521227907647668374> **Deepfried Image**',
    accentColor: 0xFF4500,
    errorMessage: '<:Cancel:1521227723916181644> Failed to deepfry image.',
    prefixOnly: true,
});
