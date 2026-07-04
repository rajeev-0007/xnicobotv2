'use strict';

const { createPercentCommand } = require('../../utils/percentCommandFactory');

module.exports = createPercentCommand({
  name: 'howsus',
  title: 'How Sus?',
  description: 'Run a sus-detector sweep on a user',
  aliases: ['sus', 'susrate', 'susmeter'],
  tiers: [
    {
      max: 5,
      text: 'Crewmate confirmed <:Checkedbox:1521227734943269077>',
      detail: 'Tasks completed efficiently. Never been near a vent in their life.'
    },
    {
      max: 15,
      text: 'Slightly off, but probably fine 🙃',
      detail: 'Caught skipping medbay once — could be innocent, could be a long con.'
    },
    {
      max: 30,
      text: 'A little fishy 🐟',
      detail: 'Did the wires task, but blinked twice on the way out. Noted.'
    },
    {
      max: 45,
      text: 'Worth keeping an eye on 👀',
      detail: 'Always near the body, never the witness. Suspicious by association.'
    },
    {
      max: 60,
      text: 'High alert engaged 🚨',
      detail: 'Three teammates have already mentioned them in the chat. Coincidence?'
    },
    {
      max: 75,
      text: 'Definitely venting 🚪',
      detail: 'Last seen disappearing into electrical exactly when bodies started showing up.'
    },
    {
      max: 90,
      text: 'You are not the impostor 🔪',
      detail: 'You absolutely are. The crew already voted. The crew is correct.'
    },
    {
      max: 100,
      text: 'Maximum sus protocol engaged 🚨',
      detail: 'Kicked from the lobby. Kicked from the discord. Kicked from the will.'
    },
  ],
});
