'use strict';

const { createPercentCommand } = require('../../utils/percentCommandFactory');

module.exports = createPercentCommand({
    name: 'howlesbian',
    title: 'How Lesbian?',
    description: 'Run a lesbian-radar sweep on a user',
    aliases: ['lesbianrate', 'lesrate', 'lesbian'],
    tiers: [
        { max: 5,
          text:   'No signal detected 📡',
          detail: 'Antenna pointed every direction and still picked up nothing but static.' },
        { max: 15,
          text:   'Faint blip on the radar 🛰️',
          detail: 'Either a passing flock of crows or a faint cottagecore Pinterest board.' },
        { max: 30,
          text:   'A tiny bit lesbian 🌸',
          detail: 'Has at least three Hayley Kiyoko songs saved without quite knowing why.' },
        { max: 45,
          text:   'Cottagecore energy rising 🍓',
          detail: 'Started watching Heartstopper "for research" three episodes in.' },
        { max: 60,
          text:   'Solid sapphic vibes 🪴',
          detail: 'Owns more flannel than the average lumberjack and twice the dogs.' },
        { max: 75,
          text:   'Strong lesbian aura 🏳️‍🌈',
          detail: 'Coffee-shop staff already know your usual and your situationship\'s pronouns.' },
        { max: 90,
          text:   'Local lesbian icon 💜',
          detail: 'Pride parades adjust their route to walk past your apartment, respectfully.' },
        { max: 100,
          text:   'Lesbian royalty crowned 👑🏳️‍🌈',
          detail: 'The crown was knitted by the community. It comes with a Subaru and a toolbox.' },
    ],
});
