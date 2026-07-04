const { createActionCommand } = require('../../utils/actionCommandFactory');

module.exports = createActionCommand({
    name: 'fkick',
    description: 'Kick someone (in fun)',
    verb: 'kicked',
    emoji: '🦵',
    searchQuery: 'anime kick action',
    aliases: [],
    fallbackGifs: [
        'https://media.tenor.com/UOmJlDFPvSQAAAAC/anime-kick.gif',
        'https://media.tenor.com/M2QI4SZK1RcAAAAC/kick-anime.gif',
        'https://media.tenor.com/GQJdF_0oCX0AAAAC/combat-anime.gif',
        'https://media.tenor.com/yrH0fOYUSM4AAAAC/anime-fighting.gif',
        'https://media.tenor.com/kbJ3d9DW5xAAAAAC/attack-anime.gif'
    ]
});
