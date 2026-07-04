const { createImageCommand } = require('../../utils/imageCommandHelper');

module.exports = createImageCommand({
    name: 'trigger',
    description: 'Create a triggered GIF',
    aliases: ['triggered'],
    effectName: 'triggered effect',
    apiEndpoint: 'trigger',
    filename: 'triggered.gif',
    title: '<:Fire:1521227907647668374> **TRIGGERED**',
    accentColor: 0xFF0000,
    errorMessage: '<:Cancel:1521227723916181644> Failed to create triggered GIF.',
    prefixOnly: true,
});
