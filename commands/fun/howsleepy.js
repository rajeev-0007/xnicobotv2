'use strict';

const { createPercentCommand } = require('../../utils/percentCommandFactory');

module.exports = createPercentCommand({
    name: 'howsleepy',
    title: 'How Sleepy?',
    description: 'Read a user\'s drowsiness reading on the sleep-meter',
    aliases: ['sleepy', 'tired', 'sleepyrate'],
    random: true,
    tiers: [
        { max: 5,
          text:   'Wide awake ☀️',
          detail: 'Already up. Already running. Already had two coffees and an idea.' },
        { max: 15,
          text:   'Alert and ready 🦉',
          detail: 'Sharp eyes, calm mind. Could solve a sudoku with one hand.' },
        { max: 30,
          text:   'Lightly awake 🌅',
          detail: 'Could go for a nap, but politely declines on grown-up grounds.' },
        { max: 45,
          text:   'Comfortable yawn 🌙',
          detail: 'Productivity is dropping at a polite, professional rate.' },
        { max: 60,
          text:   'Drowsy and dreamy 💤',
          detail: 'Caught staring at a wall for 14 seconds, no complaints filed.' },
        { max: 75,
          text:   'Sleepy bear mode 🐻',
          detail: 'Considered taking off shoes mid-meeting. Still considering.' },
        { max: 90,
          text:   'Eyelids on strike 😴',
          detail: 'Has accidentally said "g\'night" to a co-worker. At 11 a.m.' },
        { max: 100,
          text:   'Functionally hibernating 💤❄️',
          detail: 'Plants are watering themselves out of pity. Pillow has been alerted.' },
    ],
});
