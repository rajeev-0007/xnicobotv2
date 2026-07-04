'use strict';

const { createPercentCommand } = require('../../utils/percentCommandFactory');

module.exports = createPercentCommand({
    name: 'howedgy',
    title: 'How Edgy?',
    description: 'Measure a user\'s edge factor — chrome-and-eyeliner edition',
    aliases: ['edgyrate', 'edgelord', 'edgy'],
    tiers: [
        { max: 5,
          text:   'Soft as a marshmallow ☁️',
          detail: 'Wears pastels on purpose. Owns one (1) cardigan in every weather.' },
        { max: 15,
          text:   'Mildly spicy 🌶️',
          detail: 'Quotes a couple of dark anime lines, mostly ironically. We\'ll allow it.' },
        { max: 30,
          text:   'Hoodie-and-headphones aura 🎧',
          detail: 'You walk like you\'re in a music video and we respect the commitment.' },
        { max: 45,
          text:   'Lightly brooding 🖋️',
          detail: 'Mood playlists titled in lowercase. Shoes always laced very intentionally.' },
        { max: 60,
          text:   'Black-eyeliner energy 🎸',
          detail: 'Has owned at least one studded belt. Knows three Linkin Park songs by heart.' },
        { max: 75,
          text:   'Edgelord on the loose ⚡',
          detail: 'Has typed "the night is calm but I am not" into a Discord status, unironically.' },
        { max: 90,
          text:   'Mall-goth ascension 🦇',
          detail: 'Hot Topic gives you the loyalty discount on principle. Nice fingerless gloves.' },
        { max: 100,
          text:   'My Chemical Romance reborn 🤘',
          detail: 'You came back from the dead just to attend the reunion tour. Welcome home.' },
    ],
});
