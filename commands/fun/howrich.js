'use strict';

const { createPercentCommand } = require('../../utils/percentCommandFactory');

module.exports = createPercentCommand({
    name: 'howrich',
    title: 'How Rich?',
    description: 'Reveal a user\'s wealth percentage (purely fictional, blame Bezos)',
    aliases: ['richrate', 'wealth', 'rich'],
    tiers: [
        { max: 5,
          text:   'Counting coins under the couch 🛋️',
          detail: 'The fridge has more contents than the bank account. We see you.' },
        { max: 15,
          text:   'Living paycheck-to-paycheck 💸',
          detail: 'Aware of every direct debit. Adept at the "ignore the receipt" lifestyle.' },
        { max: 30,
          text:   'Comfortable middle ground 🏡',
          detail: 'Splurges occasionally on artisanal coffee. Reasonable. Relatable.' },
        { max: 45,
          text:   'Quietly comfortable 💼',
          detail: 'Owns a thirty-litre rice cooker for "just in case" reasons. Iconic.' },
        { max: 60,
          text:   'Casually flexing 🔑',
          detail: 'Tips well, never asks for the price, drives a car the colour of money.' },
        { max: 75,
          text:   'New-money energy 💎',
          detail: 'Just bought a trampoline for the rooftop. The rooftop didn\'t need one.' },
        { max: 90,
          text:   'Old-money discretion 🥂',
          detail: 'Doesn\'t mention the yacht. Has the yacht. Has another yacht for the yacht.' },
        { max: 100,
          text:   'Bezos-tier billionaire 🚀',
          detail: 'Buys whole companies the way you buy oat milk. They\'re still on the receipt.' },
    ],
});
