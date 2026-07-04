'use strict';

const { createPercentCommand } = require('../../utils/percentCommandFactory');

module.exports = createPercentCommand({
    name: 'howmature',
    title: 'How Mature?',
    description: 'Calibrate a user\'s maturity reading',
    aliases: ['mature', 'maturerate', 'adult'],
    tiers: [
        { max: 5,
          text:   'Honestly six in a trenchcoat 🦝',
          detail: 'Microwave noodles for dinner. Twice a day. Three days running.' },
        { max: 15,
          text:   'Goblin energy detected 👾',
          detail: 'Says "I\'m an adult" while holding a Capri-Sun, both with conviction.' },
        { max: 30,
          text:   'Trying their best 🪺',
          detail: 'Has a calendar. Forgets to check it. Buys a whiteboard. Forgets that too.' },
        { max: 45,
          text:   'Reasonable adult 🪑',
          detail: 'Knows three insurance terms. Pays bills on the day they\'re due.' },
        { max: 60,
          text:   'Solid grown-up ☕',
          detail: 'Owns a tape measure, a real one. Returns favours within 48 hours.' },
        { max: 75,
          text:   'Boring on purpose 📋',
          detail: 'Reads the small print. Saves receipts. Sleeps before 11 p.m. on weekdays.' },
        { max: 90,
          text:   'Local responsible adult 🪙',
          detail: 'People list you as their primary emergency contact. They are correct.' },
        { max: 100,
          text:   'Council-elder energy 🧙',
          detail: 'Friends call you for tax advice and you give it for free. We bow.' },
    ],
});
