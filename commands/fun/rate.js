'use strict';

/**
 * /rate — Score anything from 0 to 10 with a flavour line.
 *
 * No canvas needed; we render a Components V2 card with a clean
 * progress bar, a coloured accent based on the score, and a tiered
 * verdict that reads like a real review (instead of just a single
 * exclamation). Same look as the rest of the percent-card family.
 */

const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } = require('discord.js');
const { buildErrorResponse, COLORS } = require('../../utils/responseBuilder');

/* Each entry: emoji, headline verdict, longer subtitle. */
const SCORE_TABLE = [
    { emoji: '💀', text: 'Absolutely diabolical',     detail: 'Whoever invented this owes everybody a sincere apology and possibly compensation.', color: 0xED4245 },
    { emoji: '🤢', text: 'Very bad',                  detail: 'A chaotic, unpleasant experience. Please consider rebranding entirely.',            color: 0xED4245 },
    { emoji: '😕', text: 'Disappointing',             detail: 'Not what was on the box. Hard to recommend, hard to forget.',                       color: 0xE67E22 },
    { emoji: '😐', text: 'Below average',             detail: 'Functional, occasionally interesting, mostly forgettable.',                          color: 0xE67E22 },
    { emoji: '🙂', text: 'Okay, I guess',             detail: 'Has its moments. The kind of thing you\'d try once on a slow weekend.',              color: 0xFEE75C },
    { emoji: '😊', text: 'Average — perfectly mid',   detail: 'Solid foundation, predictable execution. Reliable for what it is.',                  color: 0xFEE75C },
    { emoji: '😃', text: 'Pretty decent',             detail: 'A noticeable step up. You\'d recommend it to a friend with low expectations.',       color: 0x57F287 },
    { emoji: '😍', text: 'Genuinely great',           detail: 'Made the day a little better. Worth coming back for the second pass.',               color: 0x57F287 },
    { emoji: '🤩', text: 'Phenomenal',                detail: 'Punches well above its weight. The kind of thing you\'d pin on a fridge.',           color: 0x3498DB },
    { emoji: '⭐', text: 'Almost perfect',            detail: 'Microscopic faults at most. Friends should be paying attention to this.',            color: 0x3498DB },
    { emoji: '💎', text: 'Absolutely perfect',        detail: 'A rare 10/10. Tell everyone you know. Frame it. Tweet about it.',                    color: 0xA855F7 },
];

function buildRating(thing) {
    const score = Math.floor(Math.random() * 11); // 0..10
    const t = SCORE_TABLE[score];
    const bar = '█'.repeat(score) + '░'.repeat(10 - score);

    const safeThing = String(thing).slice(0, 200);
    const content = [
        `# <:Star:1521227981685526568>  Rating Verdict`,
        `-# Score from the official xNico rating bench`,
        ``,
        `### Subject`,
        `> ${safeThing}`,
        ``,
        `### Result · ${t.emoji} **${score}/10**`,
        `> \`${bar}\``,
        `> *${t.text}*`,
        ``,
        `-# ${t.detail}`,
    ].join('\n');

    return new ContainerBuilder()
        .setAccentColor(t.color)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rate')
        .setDescription('Rate anything from 0 to 10 with a verdict')
        .addStringOption(opt =>
            opt.setName('thing')
                .setDescription('The thing to rate')
                .setRequired(true)),
    prefix: 'rate',
    description: 'Rate anything from 0 to 10 with a verdict',
    usage: 'rate <thing>',
    category: 'fun',
    aliases: ['rating'],

    async execute(interaction) {
        const thing = interaction.options.getString('thing');
        const container = buildRating(thing);
        await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    },

    async executePrefix(message, args) {
        const thing = args.join(' ').trim();
        if (!thing) {
            const container = buildErrorResponse(
                'Nothing to Rate',
                'Tell me what to rate.',
                '**Examples:**\n`rate pizza`\n`rate the new Spider-Man movie`\n`rate my taste in music`'
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
        const container = buildRating(thing);
        await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    },
};
