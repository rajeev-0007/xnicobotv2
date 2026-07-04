'use strict';

const { createPercentCommand } = require('../../utils/percentCommandFactory');

module.exports = createPercentCommand({
    name: 'howfriendly',
    title: 'How Friendly?',
    description: 'Read a user\'s friendliness reading',
    aliases: ['friendly', 'friendlyrate', 'sociable'],
    tiers: [
        { max: 5,
          text:   'Reserved and cautious 🌧️',
          detail: 'Replies politely, exits quietly. Cats relate. Cats approve.' },
        { max: 15,
          text:   'Quietly friendly 🪴',
          detail: 'Smiles at neighbours. Knows the names of everyone in their floor.' },
        { max: 30,
          text:   'Pleasant and warm 🌷',
          detail: 'Will hold the elevator. Will text "you good?" when you go quiet.' },
        { max: 45,
          text:   'Definitely your kind ☕',
          detail: 'Friends-of-friends become friends within ninety seconds, somehow.' },
        { max: 60,
          text:   'Group hug magnet 🤝',
          detail: 'Strangers ask for directions. You walk them there. Unbothered.' },
        { max: 75,
          text:   'Local friendliness icon 🌞',
          detail: 'Has memorised three baristas\' coffee orders for emergencies.' },
        { max: 90,
          text:   'Walking sunshine ☀️',
          detail: 'Pets in the building know you. So do their humans, slightly less.' },
        { max: 100,
          text:   'Universal best friend 🤍',
          detail: 'A Nobel-grade niceness sample. Three towns are fighting over you.' },
    ],
});
