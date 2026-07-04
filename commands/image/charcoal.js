const { createImageCommand } = require('../../utils/imageCommandHelper');

module.exports = createImageCommand({
    name: 'charcoal',
    description: 'Apply charcoal drawing effect',
    aliases: ['pencil'],
    effectName: 'charcoal effect',
    apiEndpoint: 'charcoal',
    filename: 'charcoal.png',
    title: '<:Editalt:1521227921673556019> **Charcoal Drawing**',
    accentColor: 0x2F4F4F,
    errorMessage: '<:Cancel:1521227723916181644> Failed to apply charcoal effect.',
    prefixOnly: true,
});
