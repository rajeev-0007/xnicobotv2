'use strict';

/**
 * covid.js — prefix-only.
 * Fetches COVID-19 statistics from disease.sh and renders a Components V2 container.
 */

const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } = require('discord.js');
const { buildErrorResponse, COLORS } = require('../../utils/responseBuilder');

const API_BASE = 'https://disease.sh/v3/covid-19';

function formatNum(n) {
    return n != null ? n.toLocaleString() : 'N/A';
}

function buildCovidContainer(data, country) {
    const isGlobal = !country || country === 'global';
    const title = isGlobal ? 'Global' : data.country;

    const container = new ContainerBuilder().setAccentColor(COLORS.ERROR);

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`# 🦠 COVID-19 Stats — ${title}`)
    );

    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `**Cases**\n` +
            `> <:Invoice:1521227903956811836> Total: **${formatNum(data.cases)}**\n` +
            `> 📈 Today: **+${formatNum(data.todayCases)}**\n` +
            `> <:Checkedbox:1521227734943269077> Recovered: **${formatNum(data.recovered)}**\n` +
            `> <:dnd:1521228070701502486> Active: **${formatNum(data.active)}**\n` +
            `> <:Infotriangle:1521227710381428926> Critical: **${formatNum(data.critical)}**\n\n` +
            `**Deaths**\n` +
            `> 💀 Total: **${formatNum(data.deaths)}**\n` +
            `> 📈 Today: **+${formatNum(data.todayDeaths)}**\n\n` +
            `**Testing**\n` +
            `> 🧪 Tests: **${formatNum(data.tests)}**\n` +
            `> <:Invoice:1521227903956811836> Tests/million: **${formatNum(data.testsPerOneMillion)}**`
        )
    );

    if (data.updated) {
        container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`-# Updated <t:${Math.floor(data.updated / 1000)}:R> • Data from disease.sh`)
        );
    }

    return container;
}

async function fetchCovid(country) {
    const url = (!country || country === 'global')
        ? `${API_BASE}/all`
        : `${API_BASE}/countries/${encodeURIComponent(country)}`;
    const res = await fetch(url);
    if (!res.ok) {
        if (res.status === 404) return null;
        throw new Error(`API returned ${res.status}`);
    }
    return res.json();
}

module.exports = {
    name: 'covid',
    prefix: 'covid',
    aliases: ['corona', 'covid19'],
    description: 'Get COVID-19 statistics for a country or globally',
    usage: 'covid [country]',
    category: 'basic',

    async executePrefix(message, args) {
        const country = args.join(' ').trim() || 'global';
        try {
            const data = await fetchCovid(country);
            if (!data) {
                const err = buildErrorResponse('Not Found', `No data found for **${country}**. Check the country name.`);
                return message.reply({ components: [err], flags: MessageFlags.IsComponentsV2 });
            }
            const container = buildCovidContainer(data, country);
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            const err = buildErrorResponse('Error', 'Failed to fetch COVID data.', error.message);
            await message.reply({ components: [err], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
