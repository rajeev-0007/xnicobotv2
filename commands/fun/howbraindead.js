'use strict';

const { createPercentCommand } = require('../../utils/percentCommandFactory');

module.exports = createPercentCommand({
    name: 'howbraindead',
    title: 'How Braindead?',
    description: 'Read a user\'s braindead-meter (a.k.a. brainrot percentage)',
    aliases: ['braindead', 'brainrot'],
    tiers: [
        { max: 5,
          text:   'Sharp as a tack 📌',
          detail: 'Reads end-user license agreements for fun. Owns a real bookshelf.' },
        { max: 15,
          text:   'Occasional buffering ⏳',
          detail: 'Loses one (1) word per conversation. Recovers it eight minutes later.' },
        { max: 30,
          text:   'Mild distraction haze 🌫️',
          detail: 'Has a "wait what was I doing" loop active in three browser tabs.' },
        { max: 45,
          text:   'Mid-grade scroll mode 📜',
          detail: 'Three hours into the algorithm. Vaguely aware that night exists.' },
        { max: 60,
          text:   'Solid TikTok consumer 📱',
          detail: 'You answer questions in 15-second intervals. We are taking notes.' },
        { max: 75,
          text:   'Brain on autopilot 🔁',
          detail: 'Has muttered "skibidi" out loud in a meeting at least once.' },
        { max: 90,
          text:   'Skibidi-level cognition 🚽',
          detail: 'Genuinely believes "rizz" is a verb, a noun, and possibly a planet.' },
        { max: 100,
          text:   'Pure brainrot achieved 🧌',
          detail: 'Internet historians will study this. Actual scientists are shrugging politely.' },
    ],
});
