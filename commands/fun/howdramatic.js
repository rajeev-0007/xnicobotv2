'use strict';

const { createPercentCommand } = require('../../utils/percentCommandFactory');

module.exports = createPercentCommand({
    name: 'howdramatic',
    title: 'How Dramatic?',
    description: 'Measure a user\'s dramatic-meter reading',
    aliases: ['dramatic', 'dramaticrate', 'drama'],
    tiers: [
        { max: 5,
          text:   'Stable narrator energy 📓',
          detail: 'Says "ok" to everything. Even fireworks. Especially fireworks.' },
        { max: 15,
          text:   'Quietly composed 🪷',
          detail: 'Sips tea while the world ends. Adjusts the cup. Sips again.' },
        { max: 30,
          text:   'Mild side-character 🎭',
          detail: 'Sometimes pauses dramatically before saying nothing. Iconic.' },
        { max: 45,
          text:   'Plot-twist haver 🌪️',
          detail: 'Group chat goes silent when you start a sentence with "okay so…".' },
        { max: 60,
          text:   'Solid lead role 🎬',
          detail: 'Stories take 30 minutes minimum. Three intermissions. Snacks served.' },
        { max: 75,
          text:   'Award-bait monologue 🎤',
          detail: 'Friends rehearse their reactions ahead of time. Just in case.' },
        { max: 90,
          text:   'Theatre kid permanent 🎭',
          detail: 'There is an Oscar nominee who would lose to your morning routine.' },
        { max: 100,
          text:   'Telenovela in human form 🌹',
          detail: 'Streaming services have asked for the rights. You are negotiating.' },
    ],
});
