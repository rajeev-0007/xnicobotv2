'use strict';

const { createPercentCommand } = require('../../utils/percentCommandFactory');

module.exports = createPercentCommand({
    name: 'howlazy',
    title: 'How Lazy?',
    description: 'Read a user\'s lazy-meter percentage',
    aliases: ['lazy', 'lazyrate'],
    tiers: [
        { max: 5,
          text:   'Productivity machine ⚙️',
          detail: 'Five-tab spreadsheet of life goals, all colour-coded, all on track.' },
        { max: 15,
          text:   'Solid worker 🐝',
          detail: 'Replies before the second reminder. Friends find this unnerving.' },
        { max: 30,
          text:   'Healthy balance 🪴',
          detail: 'Knows when to nap. Knows when not to. Mostly knows.' },
        { max: 45,
          text:   'Light loafer 🛋️',
          detail: 'Has set a weekend timer to water the plants. Hits snooze, twice.' },
        { max: 60,
          text:   'Couch ambassador 🛏️',
          detail: 'Has eaten three meals from the same blanket without standing up.' },
        { max: 75,
          text:   'Professional procrastinator 🐢',
          detail: 'Tomorrow has a calendar. Tomorrow\'s calendar has a tomorrow.' },
        { max: 90,
          text:   'Permanent vacation mode 🏝️',
          detail: 'Wakes up tired, takes a nap to recover. The system is working.' },
        { max: 100,
          text:   'Grand-master sloth 🦥',
          detail: 'Outsourced standing up to the dog. The dog also outsourced it.' },
    ],
});
