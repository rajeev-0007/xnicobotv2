'use strict';

/**
 * /pp — Visual PP-size card. Random 1–15 inches mapped to a 0–100%
 * bar fill for the visual. Stable per-user via the shared hash.
 */

const {
    SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, MediaGalleryBuilder,
    MediaGalleryItemBuilder, MessageFlags, AttachmentBuilder,
} = require('discord.js');
const { renderPercentCard } = require('../../utils/percentCard');
const { hashPercent, pickTier } = require('../../utils/percentCommandFactory');
const funUI = require('../../utils/funUI');

const tiers = [
    {
        max: 5,
        text: 'Microscope required 🔬',
        detail: 'Submitted to the lab for closer inspection. Lab politely declined.'
    },
    {
        max: 15,
        text: 'A modest specimen 🐛',
        detail: 'Compact, efficient, fits in any glove compartment. Travel-friendly!'
    },
    {
        max: 30,
        text: 'Pocket-sized confidence 🍃',
        detail: 'Knows their value isn\'t measured in inches. Wears it well.'
    },
    {
        max: 45,
        text: 'Solid average 🍌',
        detail: 'The Goldilocks zone — not too small, not too much, just statistically calm.'
    },
    {
        max: 60,
        text: 'Above the curve 📈',
        detail: 'Survey results suggest this score is mildly above the average bell curve.'
    },
    {
        max: 75,
        text: 'Anaconda territory 🐍',
        detail: 'Sir, this is a Wendy\'s. Sir. SIR. Please put it away — children are present.'
    },
    {
        max: 90,
        text: 'Legendary unit 🐉',
        detail: 'Geologists have asked permission to study the formation. Approval pending.'
    },
    {
        max: 100,
        text: 'Mythic-tier appendage <:Star:1521227981685526568>',
        detail: 'Listed as a national landmark. Tour buses stop here twice a day.'
    },
];

function userInches(userId) {
    // 1–15 inch range from a stable hash so the same user always
    // gets the same number for /pp.
    const p = hashPercent(`pp:${userId}`);   // 0–100
    return 1 + Math.round((p / 100) * 14);   // 1–15
}

async function buildAndSend(targetUser, displayName) {
    const inches = userInches(targetUser.id);
    const barFill = Math.round((inches / 15) * 100);
    const tier = pickTier(barFill, tiers);

    const buffer = await renderPercentCard({
        title: 'PP Inspector',
        subjectName: displayName || targetUser.username,
        avatarURL: targetUser.displayAvatarURL({ extension: 'png', size: 256 }),
        percent: inches,
        barMax: 15,
        unit: '"',
        verdict: tier.text || '',
        detail: tier.detail || '',
    });

    const attachment = new AttachmentBuilder(buffer, { name: 'pp.png' });
    const gallery = new MediaGalleryBuilder()
        .addItems(new MediaGalleryItemBuilder({ media: { url: 'attachment://pp.png' } }));

    const container = new ContainerBuilder()
        .addMediaGalleryComponents(gallery)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            '-# Just a fun random number — please don\'t take it seriously.'
        ));

    return { container, attachment };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('pp')
        .setDescription('Check PP size for a user')
        .addUserOption(opt =>
            opt.setName('user')
                .setDescription('The user to check')
                .setRequired(false)),
    prefix: 'pp',
    description: 'Check PP size for a user',
    usage: 'pp [@user]',
    category: 'fun',
    aliases: ['ppsize', 'dick'],

    async execute(interaction) {
        await interaction.deferReply().catch(() => { });
        const target = interaction.options.getUser('user') || interaction.user;
        const member = interaction.guild?.members.cache.get(target.id);
        const displayName = member?.displayName || target.username;
        try {
            const { container, attachment } = await buildAndSend(target, displayName);
            await interaction.editReply({ components: [container], files: [attachment], flags: MessageFlags.IsComponentsV2 });
        } catch (err) {
            console.error('[pp] render error:', err);
            await interaction.editReply(funUI.payload(funUI.err(interaction.guild?.id, 'Render Failed', 'Failed to generate the image. Please try again.'))).catch(() => { });
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
            console.error('[pp] render error:', err);
            await message.reply(funUI.payload(funUI.err(message.guild?.id, 'Render Failed', 'Failed to generate the image. Please try again.'))).catch(() => { });
        }
    }
};
