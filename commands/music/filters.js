'use strict';

const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { buildEQ, resetTimescale } = require('../../utils/musicHelpers');
const {
    preflightPlayer, musicSuccess, musicError, replyMusic, buildMusicContainer, COLOR,
} = require('../../utils/musicResponse');

/**
 * Filter presets — each preset knows how to apply itself to a player.
 * `apply(player)` resets timescale before applying any new pitch/speed
 * preset so they don't stack, and always sends a complete 15-band EQ
 * array so the previous preset doesn't leave stale gain.
 */
const FILTERS = {
    clear:      { label: 'Clear All',  emoji: '<:Trash:1521227750420254820>',          apply: async (p) => { await p.filterManager.resetFilters().catch(() => {}); } },
    bassboost:  { label: 'Bass Boost', emoji: '<:Volumeup:1521228004502536272>',       apply: async (p) => { await p.filterManager.setEQ(buildEQ({ 0: 0.4, 1: 0.3, 2: 0.2 })); } },
    nightcore:  { label: 'Nightcore',  emoji: '<:Lightningalt:1521227851796447472>',   apply: async (p) => { await resetTimescale(p); await p.filterManager.setTimescale({ speed: 1.2, pitch: 1.2 }); } },
    vaporwave:  { label: 'Vaporwave',  emoji: '🌊',                                     apply: async (p) => { await resetTimescale(p); await p.filterManager.setTimescale({ speed: 0.8, pitch: 0.8 }); } },
    daycore:    { label: 'Daycore',    emoji: '<:Music:1521228141543165982>',          apply: async (p) => { await resetTimescale(p); await p.filterManager.setTimescale({ speed: 0.75, pitch: 0.75 }); } },
    chipmunk:   { label: 'Chipmunk',   emoji: '<:Microphone:1521227746376683590>',     apply: async (p) => { await resetTimescale(p); await p.filterManager.setTimescale({ speed: 1.3, pitch: 1.4 }); } },
    china:      { label: 'China',      emoji: '🏮',                                     apply: async (p) => { await resetTimescale(p); await p.filterManager.setTimescale({ speed: 0.7, pitch: 1.3 }); } },
    '8d':       { label: '8D Audio',   emoji: '<:Headphone:1521228310385000478>',      apply: async (p) => { await p.filterManager.setRotation({ rotationHz: 0.2 }); } },
    karaoke:    { label: 'Karaoke',    emoji: '<:Microphone:1521227746376683590>',     apply: async (p) => { await p.filterManager.setKaraoke({ level: 1.0, monoLevel: 1.0, filterBand: 220.0, filterWidth: 100.0 }); } },
    tremolo:    { label: 'Tremolo',    emoji: '<:Music:1521228141543165982>',          apply: async (p) => { await p.filterManager.setTremolo({ frequency: 4.0, depth: 0.75 }); } },
    vibrato:    { label: 'Vibrato',    emoji: '<:Music:1521228141543165982>',          apply: async (p) => { await p.filterManager.setVibrato({ frequency: 10.0, depth: 0.9 }); } },
    distortion: { label: 'Distortion', emoji: '🌀',                                     apply: async (p) => { await p.filterManager.setDistortion({ sinOffset: 0, sinScale: 1, cosOffset: 0, cosScale: 1, tanOffset: 0, tanScale: 1, offset: 0, scale: 1.2 }); } },
    soft:       { label: 'Soft',       emoji: '☁️',                                    apply: async (p) => { await p.filterManager.setEQ(buildEQ({ 4: -0.15, 5: -0.15 })); } },
    pop:        { label: 'Pop',        emoji: '<:Microphone:1521227746376683590>',     apply: async (p) => { await p.filterManager.setEQ(buildEQ({ 0: -0.05, 1: 0.1, 2: 0.1, 3: 0.15, 4: 0.1 })); } },
    party:      { label: 'Party',      emoji: '<:Fire:1521227907647668374>',           apply: async (p) => { await p.filterManager.setEQ(buildEQ({ 0: 0.3, 1: 0.3, 5: 0.3, 6: 0.3 })); } },
    electronic: { label: 'Electronic', emoji: '<:Lightningalt:1521227851796447472>',   apply: async (p) => { await p.filterManager.setEQ(buildEQ({ 0: 0.375, 1: 0.35, 2: 0.125, 4: -0.125, 5: 0.125, 6: 0.25 })); } },
};

function buildPickerContainer() {
    const body =
        'Pick a preset to apply to the current track. Re-pick the same filter to clear it,\n' +
        'or use **Clear All** to reset every filter at once.\n\n' +
        '**Bass / EQ:** Bass Boost · Soft · Pop · Party · Electronic\n' +
        '**Pitch / Speed:** Nightcore · Vaporwave · Daycore · Chipmunk · China\n' +
        '**Effects:** 8D Audio · Karaoke · Tremolo · Vibrato · Distortion';

    const container = buildMusicContainer({
        title: 'Audio Filters',
        emoji: '<:Fire:1521227907647668374>',
        body,
        color: COLOR.BRAND,
        brand: false,
    });

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('filter_bassboost').setLabel('Bass Boost').setStyle(ButtonStyle.Primary).setEmoji(FILTERS.bassboost.emoji),
        new ButtonBuilder().setCustomId('filter_nightcore').setLabel('Nightcore').setStyle(ButtonStyle.Primary).setEmoji(FILTERS.nightcore.emoji),
        new ButtonBuilder().setCustomId('filter_vaporwave').setLabel('Vaporwave').setStyle(ButtonStyle.Primary).setEmoji(FILTERS.vaporwave.emoji),
        new ButtonBuilder().setCustomId('filter_8d').setLabel('8D Audio').setStyle(ButtonStyle.Primary).setEmoji(FILTERS['8d'].emoji),
    );
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('filter_karaoke').setLabel('Karaoke').setStyle(ButtonStyle.Primary).setEmoji(FILTERS.karaoke.emoji),
        new ButtonBuilder().setCustomId('filter_tremolo').setLabel('Tremolo').setStyle(ButtonStyle.Primary).setEmoji(FILTERS.tremolo.emoji),
        new ButtonBuilder().setCustomId('filter_vibrato').setLabel('Vibrato').setStyle(ButtonStyle.Primary).setEmoji(FILTERS.vibrato.emoji),
        new ButtonBuilder().setCustomId('filter_china').setLabel('China').setStyle(ButtonStyle.Primary).setEmoji(FILTERS.china.emoji),
    );
    const row3 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('filter_distortion').setLabel('Distortion').setStyle(ButtonStyle.Primary).setEmoji(FILTERS.distortion.emoji),
        new ButtonBuilder().setCustomId('filter_pop').setLabel('Pop').setStyle(ButtonStyle.Primary).setEmoji(FILTERS.pop.emoji),
        new ButtonBuilder().setCustomId('filter_party').setLabel('Party').setStyle(ButtonStyle.Primary).setEmoji(FILTERS.party.emoji),
        new ButtonBuilder().setCustomId('filter_clear').setLabel('Clear All').setStyle(ButtonStyle.Danger).setEmoji(FILTERS.clear.emoji),
    );

    container.addActionRowComponents(row1, row2, row3);
    return container;
}

async function applyFilter(player, filter) {
    const preset = FILTERS[filter];
    if (!preset) return null;
    await preset.apply(player);
    return preset.label;
}

function buildAppliedContainer(filterName, filter) {
    if (filter === 'clear') {
        return musicSuccess('Filters Cleared', 'Audio is back to default.');
    }
    return musicSuccess('Filter Applied', `**${filterName}** is now applied.`);
}

async function run(target, lavalinkManager, filter) {
    const player  = lavalinkManager.getPlayer(target.guild.id);
    const isSlash = typeof target.isRepliable === 'function';

    const pre = preflightPlayer({ player, member: target.member });
    if (!pre.ok) return replyMusic(target, pre.container, { ephemeral: pre.ephemeral });

    if (!filter) {
        return replyMusic(target, buildPickerContainer());
    }
    const label = await applyFilter(player, filter);
    if (!label) {
        return replyMusic(target, musicError(
            'Unknown Filter',
            `\`${filter}\` is not a valid preset.`,
            `Available: ${Object.keys(FILTERS).join(', ')}`
        ), { ephemeral: isSlash });
    }
    return replyMusic(target, buildAppliedContainer(label, filter));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('filters')
        .setDescription('Apply audio filters to the music')
        .addStringOption(o => o.setName('filter')
            .setDescription('Pick a filter (omit to open the picker)').setRequired(false)
            .addChoices(...Object.keys(FILTERS).map(k => ({ name: FILTERS[k].label, value: k })))),

    prefix: 'filters',
    description: 'Apply audio filters to the music',
    usage: 'filters [preset]',
    category: 'music',
    aliases: ['filter', 'fx'],

    async execute(interaction, lavalinkManager) {
        return run(interaction, lavalinkManager, interaction.options.getString('filter'));
    },
    async executePrefix(message, args, lavalinkManager) {
        return run(message, lavalinkManager, args[0]?.toLowerCase());
    },

    // Exported so panel filter buttons (handled in index.js) can reuse the same map.
    _FILTERS: FILTERS,
    _applyFilter: applyFilter,
    _buildAppliedContainer: buildAppliedContainer,
};
