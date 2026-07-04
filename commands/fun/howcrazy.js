'use strict';

const { createPercentCommand } = require('../../utils/percentCommandFactory');

module.exports = createPercentCommand({
    name: 'howcrazy',
    title: 'How Crazy?',
    description: 'Read a user\'s chaos coefficient',
    aliases: ['crazy', 'crazyrate', 'chaos'],
    tiers: [
        { max: 5,
          text:   'Calm waters 🌊',
          detail: 'Predictable in the best way. The friend group\'s designated grown-up.' },
        { max: 15,
          text:   'Steady operator ⚓',
          detail: 'Has a routine. Loves the routine. The routine survived three pandemics.' },
        { max: 30,
          text:   'Mild spice 🌶️',
          detail: 'Picks the chaos restaurant on group nights. Lets fate decide the bill.' },
        { max: 45,
          text:   'Lightly unhinged 🪩',
          detail: 'Has booked a flight on a Tuesday morning, "just to see". Returned a hero.' },
        { max: 60,
          text:   'Chaotic neutral certified 🎲',
          detail: 'Three group chats use you as a tiebreaker. Two of them regret it.' },
        { max: 75,
          text:   'Genuine wildcard 🃏',
          detail: 'Said "trust me" once. Friends did. They survived. They tell the story.' },
        { max: 90,
          text:   'Uncontrollable plot point 🌪️',
          detail: 'Bartenders shake their head. They mean it lovingly. They mean it.' },
        { max: 100,
          text:   'Force of nature 🌋',
          detail: 'Local news ran a segment titled "stay safe out there". Featured you.' },
    ],
});
