'use strict';

const { createPercentCommand } = require('../../utils/percentCommandFactory');

module.exports = createPercentCommand({
  name: 'howweeb',
  title: 'How Weeb?',
  description: 'Calibrate a user\'s anime-meter (a.k.a. weeb percentage)',
  aliases: ['weeb', 'weebrate', 'otaku'],
  tiers: [
    {
      max: 5,
      text: 'Civilian-grade 🎬',
      detail: 'Has watched maybe one Studio Ghibli film, says it was "alright".'
    },
    {
      max: 15,
      text: 'Casual viewer 🍿',
      detail: 'Knows about Dragon Ball. Sometimes says "Naruto run" ironically.'
    },
    {
      max: 30,
      text: 'Light dabbler 🍙',
      detail: 'Has finished one shounen and is "thinking about" another.'
    },
    {
      max: 45,
      text: 'Genuine fan 🎌',
      detail: 'Owns one figure. Pretends it was a gift. It was not a gift.'
    },
    {
      max: 60,
      text: 'Seasonal binger 📺',
      detail: 'Tracks the Friday subs. Has at least three favourite OPs on loop.'
    },
    {
      max: 75,
      text: 'Deep in the trenches ⛩️',
      detail: 'Owns merch from a series no one in your timezone has heard of.'
    },
    {
      max: 90,
      text: 'Weeb royalty 👑',
      detail: 'Books flights around Comiket. Has a "favourite mangaka" list. Iconic.'
    },
    {
      max: 100,
      text: 'Ultimate otaku <:Star:1521227981685526568>🎌',
      detail: 'Speaks to plushies in three languages. Two of them are anime-only.'
    },
  ],
});
