'use strict';

const { createPercentCommand } = require('../../utils/percentCommandFactory');

module.exports = createPercentCommand({
    name: 'howsmart',
    title: 'How Smart?',
    description: 'Estimate a user\'s smart-meter reading',
    aliases: ['smartrate', 'smartness', 'smart'],
    tiers: [
        { max: 5,
          text:   'Stuck on the loading screen 💀',
          detail: 'Brain has been buffering for three business days. We\'ve sent a tech.' },
        { max: 15,
          text:   'Wikipedia is your best friend 📖',
          detail: 'Confidently misquotes facts at parties — but the energy is *unshakeable*.' },
        { max: 30,
          text:   'Average human, no notes ⚙️',
          detail: 'Knows when to use "their" vs "they\'re" — eventually, after one re-read.' },
        { max: 45,
          text:   'Bright on a good day 💡',
          detail: 'Comes alive after the first coffee. Comes online after the second.' },
        { max: 60,
          text:   'Quick on the uptake 🚀',
          detail: 'Solves crosswords without looking at the clues, just to flex.' },
        { max: 75,
          text:   'Big-brain hours 🧠',
          detail: 'Understands compound interest *and* the GDP joke. Hard combo.' },
        { max: 90,
          text:   'Sharp as a scalpel ⚡',
          detail: 'Reads patch notes for fun and points out the typos in the changelog.' },
        { max: 100,
          text:   'Certified genius 🎓',
          detail: 'Universities cite you in passing. You corrected this card\'s grammar in your head.' },
    ],
});
