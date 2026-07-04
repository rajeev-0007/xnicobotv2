'use strict';

const { createPercentCommand } = require('../../utils/percentCommandFactory');

module.exports = createPercentCommand({
    name: 'howemo',
    title: 'How Emo?',
    description: 'Measure a user\'s emo-meter percentage',
    aliases: ['emo', 'emorate'],
    tiers: [
        { max: 5,
          text:   'Sunshine-pop core ☀️',
          detail: 'Spotify Wrapped is 90% upbeat. The 10% is just lo-fi pillow vibes.' },
        { max: 15,
          text:   'Indie-leaning 🎵',
          detail: 'Owns one (1) hoodie that\'s borderline. Refuses to admit it.' },
        { max: 30,
          text:   'Lightly moody 🖋️',
          detail: 'Listens to one Phoebe Bridgers song every Thursday like clockwork.' },
        { max: 45,
          text:   'Hoodie philosopher 🌧️',
          detail: 'Has saved a tweet about the moon at least once this week.' },
        { max: 60,
          text:   'Heavy fringe energy 💔',
          detail: 'Knows the difference between Hawthorne Heights and Hawthorne Helena.' },
        { max: 75,
          text:   'Black-eyeliner core 🖤',
          detail: 'Owns at least one studded belt. Has used it as a real belt, too.' },
        { max: 90,
          text:   'Mid-2000s ascended 🎸',
          detail: 'Hot Topic gives you the loyalty discount on principle. Iconic.' },
        { max: 100,
          text:   'My Chemical Romance reborn 🤘',
          detail: 'Came back from the dead just to attend the reunion. Welcome home.' },
    ],
});
