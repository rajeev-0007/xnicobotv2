'use strict';

const { createPercentCommand } = require('../../utils/percentCommandFactory');

module.exports = createPercentCommand({
    name: 'howtoxic',
    title: 'How Toxic?',
    description: 'Measure a user\'s online toxicity reading',
    aliases: ['toxic', 'toxicrate', 'toxicity'],
    tiers: [
        { max: 5,
          text:   'Pure cinnamon roll 🍯',
          detail: 'Replies "good morning ❤️" to argument tweets. Polite to chairs.' },
        { max: 15,
          text:   'Sweet and patient 🌷',
          detail: 'Has reported a slur once and felt bad about it for two weeks.' },
        { max: 30,
          text:   'Mostly chill 🪴',
          detail: 'Mutes drama. Steps away from the keyboard. Pets the cat instead.' },
        { max: 45,
          text:   'Slightly seasoned 🌶️',
          detail: 'Will absolutely roast a friend group chat — but only after consent.' },
        { max: 60,
          text:   'Hot-take haver 🌶️🌶️',
          detail: 'Quote-tweets with surgical precision. The replies are an arena.' },
        { max: 75,
          text:   'Online warrior 🛡️',
          detail: 'Three tabs open arguing about anime, politics, and pineapple pizza.' },
        { max: 90,
          text:   'Walking flame war 🔥',
          detail: 'Three Twitter accounts banned, one Reddit, one Steam forum. A career.' },
        { max: 100,
          text:   'Toxic supernova ☣️',
          detail: 'Discord auto-mods you in advance, just to be safe. Iconic.' },
    ],
});
