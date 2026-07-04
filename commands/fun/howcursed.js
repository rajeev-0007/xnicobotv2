'use strict';

const { createPercentCommand } = require('../../utils/percentCommandFactory');

module.exports = createPercentCommand({
    name: 'howcursed',
    title: 'How Cursed?',
    description: 'Measure a user\'s ambient cursed-energy reading',
    aliases: ['cursedrate', 'cursemeter', 'cursed'],
    tiers: [
        { max: 5,
          text:   'Wholesome and blessed 😇',
          detail: 'Even the priest looked relieved. Plants thrive within a 5 m radius.' },
        { max: 15,
          text:   'Faintly off-vibe 🍃',
          detail: 'A black cat once crossed your path on purpose, just to say hi.' },
        { max: 30,
          text:   'A little eerie 🔮',
          detail: 'Photos of you sometimes have an extra shadow. Photographers blame the lens.' },
        { max: 45,
          text:   'Mid-grade hex 🕷️',
          detail: 'Wifi drops the second you walk in. Returns the moment you leave.' },
        { max: 60,
          text:   'Walking jinx 💀',
          detail: 'Sports teams refuse to invite you to championship games. They\'re right.' },
        { max: 75,
          text:   'Reality-warping cursed 🌀',
          detail: 'Mirrors lag a tenth of a second behind you. Don\'t mention it to anyone.' },
        { max: 90,
          text:   'Forbidden tome opened 📜🔥',
          detail: 'Three friends have started spelling their names with apostrophes after meeting you.' },
        { max: 100,
          text:   'Reality-tier curse 👁️',
          detail: 'The card has been re-rolled three times. Each result was somehow worse.' },
    ],
});
