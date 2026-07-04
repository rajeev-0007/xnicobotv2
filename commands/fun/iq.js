'use strict';

/**
 * /iq — Visual IQ card with a stable per-user score in 60–200.
 *
 * Uses the same canvas renderer as the rest of the percent-card
 * family so the look-and-feel stays consistent. Tiers gained an
 * optional `detail` line so the card has a primary verdict + a
 * longer, slightly more thoughtful subtitle underneath.
 */

const {
    SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, MediaGalleryBuilder,
    MediaGalleryItemBuilder, MessageFlags, AttachmentBuilder
} = require('discord.js');
const { renderPercentCard } = require('../../utils/percentCard');
const { hashPercent, pickTier } = require('../../utils/percentCommandFactory');
const funUI = require('../../utils/funUI');

// IQ ranges roughly 60–200 — clamp to a stable per-user value so
// running /iq twice gives the same number unless the user changes.
function userIQ(userId) {
    const p = hashPercent(`iq:${userId}`);   // 0–100
    return 60 + Math.round((p / 100) * 140); // 60–200
}

const tiers = [
    { max: 70,
      text:   'Booting from scratch 🧊',
      detail: 'Currently enjoying the simulation\'s tutorial mode. Hasn\'t found the skip button.' },
    { max: 84,
      text:   'Looking confused most days 🤔',
      detail: 'Confidently explains topics you didn\'t ask about, with conviction we admire.' },
    { max: 99,
      text:   'Solidly average 🙂',
      detail: 'Knows about the same number of facts as the wifi router. Reliable.' },
    { max: 114,
      text:   'A cut above the rest ⚡',
      detail: 'Picks up new tools fast. Wins arguments by quoting documentation.' },
    { max: 129,
      text:   'Sharp thinker 🧠',
      detail: 'Reads patch notes on a Friday night. Spots typos in subtitles.' },
    { max: 144,
      text:   'Big-brain certified 🎓',
      detail: 'Probably has a calendar app *and* uses it. Knows about compound interest.' },
    { max: 165,
      text:   'Dangerously articulate 📚',
      detail: 'Pronounces "Worcestershire" without thinking and corrects others gently.' },
    { max: 200,
      text:   'Galaxy-brain genius 🌌',
      detail: 'Universities cite you in passing. The IQ scale itself is asking for tips.' },
];

async function buildAndSend(targetUser, displayName) {
    const iq = userIQ(targetUser.id);
    const tier = pickTier(iq, tiers);

    const buffer = await renderPercentCard({
        title: 'IQ Test',
        subjectName: displayName || targetUser.username,
        avatarURL: targetUser.displayAvatarURL({ extension: 'png', size: 256 }),
        percent: iq,             // shown as the big number
        barMax: 200,             // scale ring + bar against an IQ-of-200 cap
        verdict: tier.text || '',
        detail:  tier.detail || '',
        unit: '',
    });

    const attachment = new AttachmentBuilder(buffer, { name: 'iq.png' });
    const gallery = new MediaGalleryBuilder()
        .addItems(new MediaGalleryItemBuilder({ media: { url: 'attachment://iq.png' } }));

    const container = new ContainerBuilder()
        .addMediaGalleryComponents(gallery)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            '-# Just a fun random number — please don\'t take it seriously.'
        ));

    return { container, attachment };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('iq')
        .setDescription('Reveal a user\'s IQ score (just for fun)')
        .addUserOption(opt => opt.setName('user').setDescription('Target user (defaults to you)')),
    prefix: 'iq',
    description: 'Reveal a user\'s IQ score (just for fun)',
    usage: 'iq [@user]',
    category: 'fun',
    aliases: ['iqtest'],

    async execute(interaction) {
        await interaction.deferReply().catch(() => {});
        const target = interaction.options.getUser('user') || interaction.user;
        const member = interaction.guild?.members.cache.get(target.id);
        const displayName = member?.displayName || target.username;
        try {
            const { container, attachment } = await buildAndSend(target, displayName);
            await interaction.editReply({ components: [container], files: [attachment], flags: MessageFlags.IsComponentsV2 });
        } catch (err) {
            console.error('[iq] render error:', err);
            await interaction.editReply(funUI.payload(funUI.err(interaction.guild?.id, 'Render Failed', 'Failed to generate the image. Please try again.'))).catch(() => {});
        }
    },

    async executePrefix(message) {
        const target = message.mentions.users.first() || message.author;
        const member = message.guild?.members.cache.get(target.id);
        const displayName = member?.displayName || target.username;
        try {
            const { container, attachment } = await buildAndSend(target, displayName);
            await message.reply({ components: [container], files: [attachment], flags: MessageFlags.IsComponentsV2 });
        } catch (err) {
            console.error('[iq] render error:', err);
            await message.reply(funUI.payload(funUI.err(message.guild?.id, 'Render Failed', 'Failed to generate the image. Please try again.'))).catch(() => {});
        }
    },
};
