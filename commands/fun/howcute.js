'use strict';

const { createPercentCommand } = require('../../utils/percentCommandFactory');

module.exports = createPercentCommand({
    name: 'howcute',
    title: 'How Cute?',
    description: 'Measure a user\'s cuteness on the official xNico cute-meter',
    aliases: ['cuterate', 'cuteness', 'cute'],
    tiers: [
        { max: 5,
          text:   'Try smiling once in a while 🙂',
          detail: 'Even the cute-meter looked away — show some teeth and we\'ll re-test.' },
        { max: 15,
          text:   'A tolerable little gremlin 🐀',
          detail: 'Small fangs, big plans. Not exactly cuddly, but oddly endearing.' },
        { max: 30,
          text:   'Mildly adorable 🐭',
          detail: 'Ranks roughly between a wholesome meme and a surprisingly polite raccoon.' },
        { max: 45,
          text:   'Pretty cute, ngl 🌸',
          detail: 'You hit "good photo, bad day" levels of cute on a Wednesday morning.' },
        { max: 60,
          text:   'Heart-melting energy 🫠',
          detail: 'Strangers smile at you in elevators. You don\'t notice. That\'s the cute part.' },
        { max: 75,
          text:   'Dangerously adorable ⚠️',
          detail: 'Should come with an airbag and a safety briefing for new acquaintances.' },
        { max: 90,
          text:   'Plushie-tier cute 🧸',
          detail: 'Hugged by friends, photographed by strangers, fed snacks by aunties.' },
        { max: 100,
          text:   'Certified ultimate plushie 🧸💖',
          detail: 'Cuteness exceeds operating limits. Local laws of physics politely abstain.' },
    ],
});
