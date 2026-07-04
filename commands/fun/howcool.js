'use strict';

const { createPercentCommand } = require('../../utils/percentCommandFactory');

module.exports = createPercentCommand({
  name: 'howcool',
  title: 'How Cool?',
  description: 'Read a user\'s cool factor on the chill-meter',
  aliases: ['coolrate', 'coolness', 'cool'],
  tiers: [
    {
      max: 5,
      text: 'Lukewarm at best 🧊',
      detail: 'High-fives missed, jokes landed in the hallway. We\'re rooting for you.'
    },
    {
      max: 15,
      text: 'Room-temperature swag 👕',
      detail: 'You\'re fine. Just fine. The vibe is "office break room on a Tuesday".'
    },
    {
      max: 30,
      text: 'Quietly chill 🫥',
      detail: 'Says one cool thing per week. Walks away before the laugh, like a pro.'
    },
    {
      max: 45,
      text: 'Solidly chill 🧃',
      detail: 'Nods at strangers. They feel mysteriously validated for the rest of the day.'
    },
    {
      max: 60,
      text: 'Sub-zero swagger ❄️',
      detail: 'Thermostats lower themselves out of respect when you walk in.'
    },
    {
      max: 75,
      text: 'Sunglasses-indoors energy 🕶️',
      detail: 'You ordered a coffee black. They gave you a free pastry. We saw it.'
    },
    {
      max: 90,
      text: 'Glacier-cold legend 🏔️',
      detail: 'Cool enough that bouncers nod first. The DJ asks for your aux.'
    },
    {
      max: 100,
      text: 'Climate-altering levels of cool 🌊<:Star:1521227981685526568>',
      detail: 'Local weather services blame you for the cold front. They\'re not wrong.'
    },
  ],
});
