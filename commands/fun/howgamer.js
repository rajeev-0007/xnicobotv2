'use strict';

const { createPercentCommand } = require('../../utils/percentCommandFactory');

module.exports = createPercentCommand({
    name: 'howgamer',
    title: 'How Gamer?',
    description: 'Measure a user\'s gamer-grade certification',
    aliases: ['gamer', 'gamerrate'],
    tiers: [
        { max: 5,
          text:   'Casual button-presser 🎮',
          detail: 'Plays once a year, gets surprised by inverted Y. Genuinely respectable.' },
        { max: 15,
          text:   'Mobile-only mode 📱',
          detail: 'Royal Match expert. Knows three Genshin characters by mistake.' },
        { max: 30,
          text:   'Weekend warrior 🕹️',
          detail: 'Owns one (1) controller. Wins a Mario Kart cup once a quarter.' },
        { max: 45,
          text:   'Steady gamer 🎯',
          detail: 'Has a Steam library too big to play. Sale guilt is your aesthetic.' },
        { max: 60,
          text:   'Headset-on regular 🎧',
          detail: 'Knows what a "comp queue" is. Yells "rotate" with conviction.' },
        { max: 75,
          text:   'Tryhard certified ⚔️',
          detail: 'Has crosshair settings memorised. Texts "one more" at 2 a.m.' },
        { max: 90,
          text:   'Local legend 🏆',
          detail: 'Voted MVP by friends, opponents and the scoreboard, in that order.' },
        { max: 100,
          text:   'Esports-tier menace 🐉',
          detail: 'Coaches new players for free. Makes them better. Then beats them.' },
    ],
});
