'use strict';

const { createPercentCommand } = require('../../utils/percentCommandFactory');

module.exports = createPercentCommand({
    name: 'howcaring',
    title: 'How Caring?',
    description: 'Measure a user\'s caring percentage',
    aliases: ['caring', 'caringrate'],
    tiers: [
        { max: 5,
          text:   'Distantly polite 🪨',
          detail: 'Notices things, files them away, never mentions them. Mysterious vibe.' },
        { max: 15,
          text:   'Reserved kindness 🌒',
          detail: 'Quietly hands out tissues during sad scenes without comment.' },
        { max: 30,
          text:   'Soft check-ins 💌',
          detail: 'Sends "hope you\'re ok" and means it. No further questions asked.' },
        { max: 45,
          text:   'Always shows up 🪴',
          detail: 'On time, in slippers, with snacks. Quietly making things better.' },
        { max: 60,
          text:   'Soup-bringer tier 🍲',
          detail: 'Has driven across town for a friend who said "I\'m fine" once.' },
        { max: 75,
          text:   'Emotional first responder 🛟',
          detail: 'Friends call you first. So do their parents. So does your barista.' },
        { max: 90,
          text:   'Walking warm hug 🤗',
          detail: 'Strangers tell you secrets. You guard them like ancient treasure.' },
        { max: 100,
          text:   'Patron saint of friendship 🤍',
          detail: 'Three friend groups list you as their primary emergency contact.' },
    ],
});
