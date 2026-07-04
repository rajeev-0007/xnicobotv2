'use strict';

const { createPercentCommand } = require('../../utils/percentCommandFactory');

module.exports = createPercentCommand({
    name: 'howstraight',
    title: 'How Straight?',
    description: 'Measure a user\'s straight-meter reading',
    aliases: ['straightrate', 'straight'],
    tiers: [
        { max: 5,
          text:   'Bent like a paperclip 📎',
          detail: 'The meter read this and immediately filed for early retirement.' },
        { max: 15,
          text:   'Mostly off the path 🚧',
          detail: 'Detour signs everywhere — but honestly the scenic route is better anyway.' },
        { max: 30,
          text:   'Walking a curvy line 🌀',
          detail: 'Says "I\'m straight, but" with the conviction of a coin balanced on its edge.' },
        { max: 45,
          text:   'Slightly off-axis 📐',
          detail: 'Mostly straight on the surface, occasionally side-quests on weekends.' },
        { max: 60,
          text:   'Walking the line 🚶',
          detail: 'Identifies as straight, owns three coloured highlighters, and we accept it.' },
        { max: 75,
          text:   'Pretty straight, mostly 🧍',
          detail: 'Watches romantic comedies for the plot and only the plot, allegedly.' },
        { max: 90,
          text:   'Straight-arrow energy 🏹',
          detail: 'Could probably cut a metre stick lengthwise with your gaze alone.' },
        { max: 100,
          text:   'Certified heteronormative 🧱',
          detail: 'Diagnosed by three independent grandmothers. Comes with a free toolbelt.' },
    ],
});
