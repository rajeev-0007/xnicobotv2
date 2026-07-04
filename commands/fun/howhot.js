'use strict';

const { createPercentCommand } = require('../../utils/percentCommandFactory');

module.exports = createPercentCommand({
  name: 'howhot',
  title: 'How Hot?',
  description: 'Calibrate the hotness-meter on a user',
  aliases: ['hotrate', 'hotness', 'hot'],
  tiers: [
    {
      max: 5,
      text: 'Below freezing 🧊',
      detail: 'The thermometer cracked. Engineering is being called in for repairs.'
    },
    {
      max: 15,
      text: 'Just lukewarm 🌡️',
      detail: 'Solid IDP photo, mid-afternoon edition. Nothing personal, brain.'
    },
    {
      max: 30,
      text: 'Warm and inviting ☕',
      detail: 'The kind of hot that makes friends comfortable, not jealous.'
    },
    {
      max: 45,
      text: 'Cute-hot crossover 🌷',
      detail: 'Compliments come from waiters first, exes second, strangers third.'
    },
    {
      max: 60,
      text: 'Smoking hot 🔥',
      detail: 'Selfies require a content warning. The sunglasses are doing serious work.'
    },
    {
      max: 75,
      text: 'Volcanic energy 🌋',
      detail: 'Walking into rooms causes drafts. Plants tilt toward you out of confusion.'
    },
    {
      max: 90,
      text: 'Solar-flare tier 🌞',
      detail: 'Should be experienced through welder\'s glass. Witnesses confirm visible damage.'
    },
    {
      max: 100,
      text: 'Hottest in the galaxy ☀️<:Star:1521227981685526568>',
      detail: 'NASA has filed a query. It is not a star — it is just you. Apologies issued.'
    },
  ],
});
