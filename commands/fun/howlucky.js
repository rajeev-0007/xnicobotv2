'use strict';

const { createPercentCommand } = require('../../utils/percentCommandFactory');

/**
 * /howlucky — luck rerolls every call (`random: true`) so a user can
 * keep checking through the day. The detail line plays into that —
 * "today" framing matches the flavour.
 */
module.exports = createPercentCommand({
  name: 'howlucky',
  title: 'How Lucky?',
  description: 'Read a user\'s luck percentage for today',
  aliases: ['luck', 'luckrate', 'fortune'],
  random: true,
  tiers: [
    {
      max: 5,
      text: 'Cosmic ban hammer ⚒️',
      detail: 'Stay home. Eat snacks. Avoid stairs. The stars are doing renovations.'
    },
    {
      max: 15,
      text: 'Unlucky day — stay indoors ⛈️',
      detail: 'Today\'s vibe: dropped toast, lands jam-side. Buttered jam, somehow.'
    },
    {
      max: 30,
      text: 'Bad-luck adjacent 🌧️',
      detail: 'Coin flips will tilt away from you. Don\'t bet your lunch money.'
    },
    {
      max: 45,
      text: 'Coin-flip kind of day 🪙',
      detail: 'Could go either way — pick your battles and skip the lottery.'
    },
    {
      max: 60,
      text: 'Fortune is on your side 🍀',
      detail: 'Free upgrades, surprise discounts, lights green. Run a small errand or two.'
    },
    {
      max: 75,
      text: 'Lottery-ticket energy 🎫',
      detail: 'Buy the scratch-off, take the long way, accept the unexpected coffee.'
    },
    {
      max: 90,
      text: 'Cosmically blessed 🌟',
      detail: 'Avoid casinos out of fairness — the house deserves a break too.'
    },
    {
      max: 100,
      text: 'Reality is cheating in your favour <:Star:1521227981685526568>',
      detail: 'Your phone never dies, traffic parts, baristas spell your name correctly.'
    },
  ],
});
