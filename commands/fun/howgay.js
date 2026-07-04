'use strict';

const { createPercentCommand } = require('../../utils/percentCommandFactory');

/**
 * /howgay — playful "gay rate" card.
 *
 * Eight-tier ladder so the result feels meaningful at every score
 * instead of jumping in big chunks. The `text` line is the punchy
 * one-liner that lands on the card next to the percent; the
 * `detail` line is the longer, slightly more thoughtful subtitle
 * rendered underneath in a smaller muted style.
 */
module.exports = createPercentCommand({
  name: 'howgay',
  title: 'How Gay?',
  description: 'Run a (totally fake) gay-meter scan on a user',
  aliases: ['gayrate', 'gaymeter', 'gay'],
  tiers: [
    {
      max: 5,
      text: 'Straight as a ruler 📏',
      detail: 'Calibration test passed — not a single rainbow particle detected on the first sweep.'
    },
    {
      max: 15,
      text: 'Honestly pretty straight 🙂',
      detail: 'Maybe a flicker once a year, but you could ride a bull-flag float and stay this score.'
    },
    {
      max: 30,
      text: 'Mostly straight, slight wobble 👀',
      detail: 'You laughed at one too many "no homo" jokes and the meter took notes.'
    },
    {
      max: 45,
      text: 'Curious mood today 🤔',
      detail: 'Caught googling "is it gay if…" — the answer is usually yes, by the way.'
    },
    {
      max: 60,
      text: 'Hitting the rainbow notes 🌈',
      detail: 'You know which Pride month you go feral on Spotify and we respect it.'
    },
    {
      max: 75,
      text: 'Pretty undeniably gay 💖',
      detail: 'You\'ve memorised at least three Chappell Roan tracks and we love that for you.'
    },
    {
      max: 90,
      text: 'Loud and proud 🏳️‍🌈',
      detail: 'Local government should consider naming a bench after you in the Pride parade route.'
    },
    {
      max: 100,
      text: 'Certified maximum gay <:Star:1521227981685526568>🏳️‍🌈',
      detail: 'The meter just rebooted itself in awe. Witnessed by all the gays before you.'
    },
  ],
});
