'use strict';

const { createPercentCommand } = require('../../utils/percentCommandFactory');

module.exports = createPercentCommand({
  name: 'howsigma',
  title: 'How Sigma?',
  description: 'Calculate a user\'s sigma-grindset percentage',
  aliases: ['sigma', 'sigmarate', 'grindset'],
  tiers: [
    {
      max: 5,
      text: 'Pure beta energy 📉',
      detail: 'Replies with "k" to everything and accidentally apologises to chairs.'
    },
    {
      max: 15,
      text: 'Mostly NPC dialogue 🗣️',
      detail: 'Uses the same five voice lines per week. The villagers love it.'
    },
    {
      max: 30,
      text: 'Quietly grinding <:Star:1521227981685526568>',
      detail: 'Has a 5 AM alarm. Snoozes it once. Still claims it counts.'
    },
    {
      max: 45,
      text: 'Mid-tier mindset 📊',
      detail: 'Listens to one motivational podcast a week, just enough to buy the merch.'
    },
    {
      max: 60,
      text: 'Lone-wolf vibes 🐺',
      detail: 'Eats lunch alone on purpose, calls it strategy, charges admission.'
    },
    {
      max: 75,
      text: 'Sigma certified 🔥',
      detail: 'Wears noise-cancelling headphones in well-lit cafés. Has Notion stocks.'
    },
    {
      max: 90,
      text: 'Patrick Bateman tier 🎯',
      detail: 'Reads spec sheets at 6 AM. Crushes deadlines. Owns one (1) emotion.'
    },
    {
      max: 100,
      text: 'Built different — peak sigma 🗿',
      detail: 'Refuses to make eye contact with mediocrity. Eats raw goals for breakfast.'
    },
  ],
});
