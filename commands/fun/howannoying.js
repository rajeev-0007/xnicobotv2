'use strict';

const { createPercentCommand } = require('../../utils/percentCommandFactory');

module.exports = createPercentCommand({
    name: 'howannoying',
    title: 'How Annoying?',
    description: 'Diagnose a user\'s annoyance percentage',
    aliases: ['annoying', 'annoyrate'],
    tiers: [
        { max: 5,
          text:   'Genuinely calming presence 🌿',
          detail: 'Could narrate a meditation app. Plants nod when you walk past.' },
        { max: 15,
          text:   'Quietly pleasant 🍃',
          detail: 'Listens more than talks. Friends thank you in their group chats.' },
        { max: 30,
          text:   'Mildly endearing 🐝',
          detail: 'A bit cheeky, mostly forgiven. Brings energy, not chaos.' },
        { max: 45,
          text:   'Office-fly tier 🪰',
          detail: 'You hum, you forward chain emails, you survive the room anyway.' },
        { max: 60,
          text:   'Notification storm 🔔',
          detail: 'Three replies for every one message. Voice notes regularly. Iconic.' },
        { max: 75,
          text:   'Absolute pest 🐛',
          detail: 'Co-workers schedule meetings about you and forget to invite you.' },
        { max: 90,
          text:   'Mute-button tester 🔕',
          detail: 'Mute button gets warm. Then hot. Then it gives up and we agree.' },
        { max: 100,
          text:   'Universal kick-from-call 🚪',
          detail: 'Three Discord servers banned you simultaneously. Two of them by accident.' },
    ],
});
