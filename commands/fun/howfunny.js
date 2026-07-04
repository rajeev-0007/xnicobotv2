'use strict';

const { createPercentCommand } = require('../../utils/percentCommandFactory');

module.exports = createPercentCommand({
    name: 'howfunny',
    title: 'How Funny?',
    description: 'Calibrate a user\'s comedy meter',
    aliases: ['funny', 'comedy', 'funnyrate'],
    tiers: [
        { max: 5,
          text:   'Crickets only 🦗',
          detail: 'Tells dad jokes to dads. The dads also don\'t laugh.' },
        { max: 15,
          text:   'Light chuckles 🙂',
          detail: 'Nice timing — when it lands. Mostly relies on a good audience.' },
        { max: 30,
          text:   'Mid-tier comic 🎤',
          detail: 'Has a top three pun. Has practised it in the mirror once or twice.' },
        { max: 45,
          text:   'Group-chat MVP 💬',
          detail: 'Reaction images perfectly placed. Drops links right when you need them.' },
        { max: 60,
          text:   'Reliably hilarious 😄',
          detail: 'Could ad-lib a wedding toast and everyone\'s phones come out.' },
        { max: 75,
          text:   'Open-mic ready 🎙️',
          detail: 'Friends say "you should do stand-up" and they actually mean it.' },
        { max: 90,
          text:   'Local headliner 🌟',
          detail: 'Strangers laugh at things you haven\'t said yet. Dangerous gift.' },
        { max: 100,
          text:   'Comedy industry plant 🎭',
          detail: 'Voted "funniest at the wake". Twice. By the same family.' },
    ],
});
