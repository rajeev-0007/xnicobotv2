'use strict';

const { createPercentCommand } = require('../../utils/percentCommandFactory');

module.exports = createPercentCommand({
    name: 'howbroke',
    title: 'How Broke?',
    description: 'Read a user\'s broke-meter (the inverse of the rich-meter)',
    aliases: ['broke', 'brokerate'],
    tiers: [
        { max: 5,
          text:   'Stacked and stable 💵',
          detail: 'Auto-tips, never opens a receipt. Has multiple savings accounts.' },
        { max: 15,
          text:   'Comfortably comfortable 🛋️',
          detail: 'Splurges occasionally on a quiet, expensive coffee. Reasonable.' },
        { max: 30,
          text:   'Fine on payday 💼',
          detail: 'Calendar marked. Knows the exact ATM that doesn\'t charge fees.' },
        { max: 45,
          text:   'Coupons activated 🪙',
          detail: 'Owns a folder labelled "Take-Out". The folder is empty for a reason.' },
        { max: 60,
          text:   'Eating instant noodles 🍜',
          detail: 'Three cups, one egg, zero shame. Could survive a recession smiling.' },
        { max: 75,
          text:   'Side-hustle SOS 📦',
          detail: 'Currently selling a printer to fund a printer cartridge. Iconic loop.' },
        { max: 90,
          text:   'Bank says no 🏧',
          detail: 'Card declined twice this week — both times, theatrically.' },
        { max: 100,
          text:   'Counting couch coins 🛏️',
          detail: 'Found 47 cents and a button. Counted it as a win and we agree.' },
    ],
});
