const { createImageCommand } = require('../../utils/imageCommandHelper');

module.exports = createImageCommand({
    name: 'sketch',
    description: 'Convert image to sketch',
    aliases: ['draw', 'pencilsketch'],
    effectName: 'sketch effect',
    apiEndpoint: 'sketch',
    filename: 'sketch.png',
    title: '<:Editalt:1521227921673556019> **Sketch Effect**',
    accentColor: 0x696969,
    errorMessage: '<:Cancel:1521227723916181644> Failed to convert image to sketch.',
    prefixOnly: true,
});
