'use strict';

const { createPercentCommand } = require('../../utils/percentCommandFactory');

module.exports = createPercentCommand({
  name: 'howkind',
  title: 'How Kind?',
  description: 'Read a user\'s kindness percentage',
  aliases: ['kind', 'kindrate'],
  tiers: [
    {
      max: 5,
      text: 'Frosty exterior ❄️',
      detail: 'Replies in haiku form. The haiku is technically polite, technically chilly.'
    },
    {
      max: 15,
      text: 'Quietly considerate 🪺',
      detail: 'Holds doors. Says "thank you" twice when meals are dropped off.'
    },
    {
      max: 30,
      text: 'Mild sweetheart 🌷',
      detail: 'Sends "you ok?" with sincerity. Tips the delivery driver, every time.'
    },
    {
      max: 45,
      text: 'Pretty kind, actually 🍵',
      detail: 'Gifts get wrapped. Notes get hand-written. Plants get watered.'
    },
    {
      max: 60,
      text: 'Wholesome unit 🌼',
      detail: 'You\'ve been the highlight of someone\'s week without realising it.'
    },
    {
      max: 75,
      text: 'Heart-of-gold operator <:Star:1521227981685526568>',
      detail: 'Friends mention you to strangers. Strangers smile, knowingly.'
    },
    {
      max: 90,
      text: 'Local kindness ambassador 🤍',
      detail: 'There is a small group chat dedicated to thanking you. You are not in it.'
    },
    {
      max: 100,
      text: 'Patron saint of nice 🕊️',
      detail: 'Weather forecasts get gentler when you\'re outside. The sun nods.'
    },
  ],
});
