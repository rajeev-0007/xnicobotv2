'use strict';

const { createPercentCommand } = require('../../utils/percentCommandFactory');

module.exports = createPercentCommand({
    name: 'howsimp',
    title: 'How Simp?',
    description: 'Calculate a user\'s simp percentage',
    aliases: ['simp', 'simprate', 'simplevel'],
    tiers: [
        { max: 5,
          text:   'Stone-cold and unbothered ❄️',
          detail: 'Has not "left them on read" — they were never even opened.' },
        { max: 15,
          text:   'Mildly affectionate 🌷',
          detail: 'Sends "wyd" maybe once a month. The phone screen flickers in surprise.' },
        { max: 30,
          text:   'Budding crush, suppressed well 🌸',
          detail: 'Liked the old Instagram post. Unliked it. Re-liked it. Repeat for 90 minutes.' },
        { max: 45,
          text:   'Catching feelings 😍',
          detail: 'You\'ve already drafted three "u up?" messages and deleted all of them.' },
        { max: 60,
          text:   'Weekly Amazon-gift simp 💸',
          detail: 'They mentioned a hobby once. There\'s a starter kit at their door tomorrow.' },
        { max: 75,
          text:   'PayPal\'s favourite customer 💜',
          detail: 'Recurring monthly transfers labelled "snacks" that are very much not snacks.' },
        { max: 90,
          text:   'Maximum simp protocol 👑',
          detail: 'Owns at least one item of clothing in "their colour" and won\'t admit why.' },
        { max: 100,
          text:   'Legendary simp ascension 💝',
          detail: 'A monument is being built in their honour. You are paying for the marble.' },
    ],
});
