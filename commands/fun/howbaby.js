'use strict';

const { createPercentCommand } = require('../../utils/percentCommandFactory');

module.exports = createPercentCommand({
  name: 'howbaby',
  title: 'How Baby?',
  description: 'Read a user\'s baby-meter (a.k.a. needs-a-blanket percentage)',
  aliases: ['baby', 'babyrate'],
  tiers: [
    {
      max: 5,
      text: 'Battle-hardened veteran 🪖',
      detail: 'Shoulders the world\'s problems before breakfast. Doesn\'t flinch.'
    },
    {
      max: 15,
      text: 'Calm and capable 🧱',
      detail: 'Reads instructions before opening the box. Sometimes.'
    },
    {
      max: 30,
      text: 'Mild softie 🍼',
      detail: 'Will absolutely tear up at a dog reuniting with its owner clip.'
    },
    {
      max: 45,
      text: 'Cute and a little fragile 🎀',
      detail: 'Asks for the wifi password as a love language. Receives it.'
    },
    {
      max: 60,
      text: 'Walking baby energy 🥺',
      detail: 'Has a hoodie that lives on you exclusively. We do not question it.'
    },
    {
      max: 75,
      text: 'Officially baby-coded 🍓',
      detail: 'Refers to all foods as "this little guy". Gets it for free 70% of the time.'
    },
    {
      max: 90,
      text: 'Cosmic-tier softie 🧸',
      detail: 'Has been carried up four flights of stairs at least once. By choice.'
    },
    {
      max: 100,
      text: 'Pure baby ascended 🍼<:Star:1521227981685526568>',
      detail: 'Plushies file taxes for you. The plushies do them correctly. Beautiful.'
    },
  ],
});
