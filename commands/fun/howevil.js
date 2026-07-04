'use strict';

const { createPercentCommand } = require('../../utils/percentCommandFactory');

module.exports = createPercentCommand({
    name: 'howevil',
    title: 'How Evil?',
    description: 'Reveal a user\'s evil percentage on the malice-meter',
    aliases: ['evilrate', 'villain', 'evil'],
    tiers: [
        { max: 5,
          text:   'Pure cinnamon roll 🥐',
          detail: 'Apologises to door frames. Has never once jaywalked.' },
        { max: 15,
          text:   'Mostly harmless mischief 😈',
          detail: 'Will absolutely steal a fry if you turn your head. Polite, but cunning.' },
        { max: 30,
          text:   'Light-grade trouble 🌶️',
          detail: 'Likes a good prank — one of them ends up in a friend group anecdote.' },
        { max: 45,
          text:   'Chaotic neutral energy ⚖️',
          detail: 'Aligned with whichever option is funnier in the moment, no questions asked.' },
        { max: 60,
          text:   'Plotting something 🖤',
          detail: 'Has a notes-app file titled "ideas" and absolutely zero context for it.' },
        { max: 75,
          text:   'Cartoon-villain coded 🎭',
          detail: 'Walks into rooms with intent. Sometimes monologues unprompted.' },
        { max: 90,
          text:   'Black-tie supervillain 🕯️',
          detail: 'Owns a chair that swivels too dramatically. Possibly a moat. Definitely a cat.' },
        { max: 100,
          text:   'Final-boss energy 👑💀',
          detail: 'The end-credits would absolutely roll if anyone tried to stop you now.' },
    ],
});
