'use strict';

const {
    SlashCommandBuilder,
    AttachmentBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
} = require('discord.js');
const { generateLeaderboardCard } = require('../../utils/leaderboardCard');
const { formatCoins, formatCoinsShort , coinIcon } = require('../../utils/currencyHelper');
const economyManager = require('../../utils/economyManager');

/* ══════════════════════════════════════════════════
   SORT MODES
══════════════════════════════════════════════════ */

const SORT_MODES = {
    total:        { label: 'Richest',      emoji: '<:Sketch:1521228025365004471>', accentInt: 0xFFD700, icon: '<:Money:1521228266957045900>', unit: 'Net Worth'    },
    coins:        { label: 'Wallet',       emoji: '<:Money:1521228266957045900>', accentInt: 0x22C55E, icon: '👛', unit: 'Wallet'       },
    bank:         { label: 'Bank',         emoji: '<:Invoice:1521227903956811836>', accentInt: 0x3B82F6, icon: '<:Invoice:1521227903956811836>', unit: 'Bank'         },
    workCount:    { label: 'Most Worked',  emoji: '💼', accentInt: 0xF97316, icon: '🔨', unit: 'Shifts'       },
    totalGambled: { label: 'Top Gamblers', emoji: '🎰', accentInt: 0x8B5CF6, icon: '🎲', unit: 'Gambled'      },
    miningCount:  { label: 'Top Miners',   emoji: '⛏',  accentInt: 0x78716C, icon: '⛏️', unit: 'Times Mined' },
};

const PER_PAGE = 7;

/* ══════════════════════════════════════════════════
   HELPERS
══════════════════════════════════════════════════ */

function getMetric(e, sortBy) {
    return ({
        total: e.total, coins: e.coins, bank: e.bank,
        workCount: e.workCount, totalGambled: e.totalGambled, miningCount: e.miningCount,
    })[sortBy] ?? e.total;
}

function fmtNum(n) {
    n = Number(n) || 0;
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
    if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K';
    return n.toLocaleString();
}

function statLine(e, sortBy, guildId) {
    if (sortBy === 'total')        return `${coinIcon(guildId)} ${fmtNum(e.coins)} wallet  ·  <:Invoice:1521227903956811836> ${fmtNum(e.bank)} bank`;
    if (sortBy === 'coins')        return `<:Invoice:1521227903956811836> ${fmtNum(e.bank)} bank  ·  ${coinIcon(guildId)} ${fmtNum(e.total)} net`;
    if (sortBy === 'bank')         return `${coinIcon(guildId)} ${fmtNum(e.coins)} wallet  ·  ${coinIcon(guildId)} ${fmtNum(e.total)} net`;
    if (sortBy === 'workCount')    return `${coinIcon(guildId)} ${fmtNum(e.total)} net worth`;
    if (sortBy === 'totalGambled') return `${coinIcon(guildId)} ${fmtNum(e.total)} net worth`;
    if (sortBy === 'miningCount')  return `${coinIcon(guildId)} ${fmtNum(e.total)} net worth`;
    return `${coinIcon(guildId)} ${fmtNum(e.total)} net worth`;
}

/* ══════════════════════════════════════════════════
   BUILD IMAGE + CONTROLS
══════════════════════════════════════════════════ */

async function buildResponse(client, guild, scope, sortBy, page, requesterId) {
    const mode    = SORT_MODES[sortBy] ?? SORT_MODES.total;
    const economy = economyManager.loadEconomy();

    /* Collect, filter, sort */
    let all = Object.entries(economy).map(([userId, raw]) => {
        const coins = Number(raw.coins) || 0;
        const bank  = Number(raw.bank)  || 0;
        return {
            userId, coins, bank, total: coins + bank,
            workCount:    Number(raw.workCount)    || 0,
            totalGambled: Number(raw.totalGambled) || 0,
            miningCount:  Number(raw.miningCount)  || 0,
        };
    }).filter(e => e.total > 0 || e.workCount > 0 || e.totalGambled > 0 || e.miningCount > 0);

    if (scope === 'local' && guild) {
        const ids = new Set(guild.members.cache.keys());
        all = all.filter(e => ids.has(e.userId));
    }

    all.sort((a, b) => getMetric(b, sortBy) - getMetric(a, sortBy));

    const totalPages = Math.max(1, Math.ceil(all.length / PER_PAGE));
    page = Math.max(0, Math.min(page, totalPages - 1));

    const slice = all.slice(page * PER_PAGE, (page + 1) * PER_PAGE);

    /* Resolve users */
    const entries = await Promise.all(
        slice.map(async (e, i) => {
            const user = client.users.cache.get(e.userId)
                || await client.users.fetch(e.userId).catch(() => null);
            return {
                ...e,
                rank:         page * PER_PAGE + i + 1,
                name:         user?.globalName ?? user?.username ?? 'Unknown',
                avatar:       user?.displayAvatarURL({ size: 128, extension: 'png' }) ?? null,
                isRequester:  e.userId === requesterId,
                primaryValue: getMetric(e, sortBy),
                primaryLabel: mode.unit,
                statLine:     statLine(e, sortBy, guild?.id),
            };
        })
    );

    /* Requester position */
    const rIdx   = all.findIndex(e => e.userId === requesterId);
    const rRank  = rIdx >= 0 ? rIdx + 1 : null;
    const rEntry = rIdx >= 0 ? all[rIdx] : null;

    let requester = null;
    if (rRank && rEntry) {
        const above = all[rIdx - 1];
        const gap   = above ? getMetric(above, sortBy) - getMetric(rEntry, sortBy) : 0;
        requester = {
            rank:         rRank,
            primaryValue: getMetric(rEntry, sortBy),
            statLine:     statLine(rEntry, sortBy, guild?.id),
            gapText:      above && gap > 0 ? `${fmtNum(gap)} behind rank #${rRank - 1}` : null,
        };
    }

    /* Generate canvas image */
    const imgBuf = await generateLeaderboardCard(entries, {
        accentInt:  mode.accentInt,
        accentEmoji: mode.emoji,
        modeLabel:  mode.label,
        scopeLabel: scope === 'local' ? 'Server' : 'Global',
        scopeEmoji: scope === 'local' ? '🏠' : '🌍',
        totalCount: all.length,
        page,
        totalPages,
        requester,
    });

    const attachment = new AttachmentBuilder(imgBuf, { name: 'economy-leaderboard.png' });

    /* Sort dropdown */
    const sortRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`elb_sort_select_${scope}_${page}`)
            .setPlaceholder(`${mode.emoji}  Sort by: ${mode.label}`)
            .addOptions(
                Object.entries(SORT_MODES).map(([key, m]) =>
                    new StringSelectMenuOptionBuilder()
                        .setLabel(m.label)
                        .setValue(key)
                        .setEmoji(m.emoji)
                        .setDefault(key === sortBy)
                )
            )
    );

    /* Scope + page buttons */
    const ctrlRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`elb_scope_${scope === 'local' ? 'global' : 'local'}_${sortBy}_0`)
            .setLabel(scope === 'local' ? '🌍 Global' : '🏠 Server')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`elb_page_${scope}_${sortBy}_${page - 1}`)
            .setEmoji('<:History:1521227863079256278>')
            .setLabel('Prev')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page === 0),
        new ButtonBuilder()
            .setCustomId('elb_page_info')
            .setLabel(`${page + 1} / ${totalPages}`)
            .setStyle(ButtonStyle.Primary)
            .setDisabled(true),
        new ButtonBuilder()
            .setCustomId(`elb_page_${scope}_${sortBy}_${page + 1}`)
            .setEmoji('<:Caretright:1521227704953864202>')
            .setLabel('Next')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page >= totalPages - 1)
    );

    return { files: [attachment], components: [sortRow, ctrlRow] };
}

/* ══════════════════════════════════════════════════
   COMMAND EXPORT
══════════════════════════════════════════════════ */

module.exports = {
    data: new SlashCommandBuilder()
        .setName('economy-leaderboard')
        .setDescription('View the economy leaderboard as a rich canvas image')
        .addStringOption(o => o.setName('scope').setDescription('Scope').setRequired(false)
            .addChoices(
                { name: '🌍 Global', value: 'global' },
                { name: '🏠 Server', value: 'local'  }
            ))
        .addStringOption(o => o.setName('sort').setDescription('Sort by').setRequired(false)
            .addChoices(
                { name: '<:Sketch:1521228025365004471> Net Worth',    value: 'total'        },
                { name: '<:Money:1521228266957045900> Wallet',       value: 'coins'        },
                { name: '<:Invoice:1521227903956811836> Bank',         value: 'bank'         },
                { name: '💼 Most Worked',  value: 'workCount'    },
                { name: '🎰 Top Gamblers', value: 'totalGambled' },
                { name: '⛏ Top Miners',   value: 'miningCount'  }
            )),

    prefix: 'eleaderboard',
    aliases: ['elb', 'rich', 'etop', 'richest', 'baltop'],
    category: 'economy',
    description: 'Canvas image leaderboard — shows top players with avatars, stats, and progress',
    usage: 'rich [local|global]',

    async executePrefix(message, args) {
        const s     = args[0]?.toLowerCase();
        const scope = (s === 'local' || s === 'server') ? 'local' : 'global';
        const { files, components } = await buildResponse(message.client, message.guild, scope, 'total', 0, message.author.id);
        return message.reply({ files, components });
    },

    async execute(interaction) {
        await interaction.deferReply();
        const scope  = interaction.options.getString('scope') || 'global';
        const sortBy = interaction.options.getString('sort')  || 'total';
        const { files, components } = await buildResponse(interaction.client, interaction.guild, scope, sortBy, 0, interaction.user.id);
        return interaction.editReply({ files, components });
    },

    /* ── BUTTON ── */
    async handleButton(interaction) {
        const { customId } = interaction;
        if (customId === 'elb_page_info') { await interaction.deferUpdate(); return true; }

        const m = customId.match(/^elb_(?:scope|page)_(\w+)_(\w+)_(\d+)$/);
        if (!m) return false;

        await interaction.deferUpdate();
        const [, scope, sortBy, pageStr] = m;
        const { files, components } = await buildResponse(
            interaction.client, interaction.guild,
            scope === 'local' ? 'local' : 'global',
            SORT_MODES[sortBy] ? sortBy : 'total',
            parseInt(pageStr),
            interaction.user.id
        );
        await interaction.editReply({ files, components });
        return true;
    },

    /* ── SELECT ── */
    async handleStringSelect(interaction) {
        const m = interaction.customId.match(/^elb_sort_select_(\w+)_(\d+)$/);
        if (!m) return false;

        await interaction.deferUpdate();
        const [, scope] = m;
        const { files, components } = await buildResponse(
            interaction.client, interaction.guild,
            scope === 'local' ? 'local' : 'global',
            SORT_MODES[interaction.values[0]] ? interaction.values[0] : 'total',
            0,
            interaction.user.id
        );
        await interaction.editReply({ files, components });
        return true;
    },
};
