/**
 * Owner-only command — force a Top.gg stats post and display current
 * sync state. Useful when you want to push an updated guild count
 * immediately instead of waiting for the next 30-minute tick.
 *
 *   -topgg-sync           → force post + show result
 *   -topgg-sync status    → show last-posted count + token presence
 */

const { isOwner } = require('../../utils/helpers');
const {
    MessageFlags,
    ContainerBuilder, TextDisplayBuilder
} = require('discord.js');

const topggPoster = require('../../utils/topggPoster');

function denied() {
    return '<:Cancel:1521227723916181644> This command is only available to the bot owner!';
}

function buildResult({ ok, count, hasToken, hasBotId, error, shardCounts }) {
    const status = ok
        ? '<:Checkedbox:1521227734943269077> **Success**'
        : '<:Cancel:1521227723916181644> **Failed**';

    let lines = [
        `# <:topgg:1521228219066482790> Top.gg Sync`,
        '',
        `> ${status}`,
        `> **Token configured:** ${hasToken ? 'Yes' : 'No (set TOPGG_TOKEN in .env)'}`,
        `> **Bot id available:** ${hasBotId ? 'Yes' : 'No'}`
    ];

    if (Number.isFinite(count)) {
        lines.push(`> **Posted server_count:** \`${count}\``);
    }
    if (Array.isArray(shardCounts) && shardCounts.length > 1) {
        lines.push(`> **Shards:** \`[${shardCounts.join(', ')}]\``);
    }
    if (!ok && error) {
        lines.push('', '```', String(error).slice(0, 800), '```');
    }
    if (!hasToken) {
        lines.push('', '-# Add `TOPGG_TOKEN=<token from top.gg → API tab>` to `.env` and restart.');
    }

    return new ContainerBuilder()
        .setAccentColor(ok ? 0x57F287 : 0xED4245)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
}

async function runSync(client) {
    const hasToken = !!(process.env.TOPGG_TOKEN || '').trim();
    const hasBotId = !!(client?.user?.id || process.env.CLIENT_ID);

    if (!hasToken) {
        const { totalGuilds, shardCounts } = await topggPoster.collectStats(client);
        return buildResult({ ok: false, count: totalGuilds, hasToken, hasBotId, shardCounts });
    }

    try {
        const count = await topggPoster.postNow(client);
        const { shardCounts } = await topggPoster.collectStats(client);
        return buildResult({
            ok: count !== null,
            count,
            hasToken,
            hasBotId,
            shardCounts,
            error: count === null ? 'Post returned null — see log output for details.' : null
        });
    } catch (err) {
        return buildResult({
            ok: false,
            hasToken,
            hasBotId,
            error: err?.message || String(err)
        });
    }
}

module.exports = {
    name: 'topgg-sync',
    prefix: 'topgg-sync',
    aliases: ['topggsync', 'syncguilds', 'postgg'],
    description: 'Force a Top.gg server-count sync',
    usage: 'topgg-sync',
    category: 'owner',
    ownerOnly: true,

    async executePrefix(message) {
        if (!isOwner(message.author.id)) {
            return message.reply(denied());
        }
        const loading = await message.reply('<:Lightning:1521227915537285150> Posting stats to Top.gg…');
        const container = await runSync(message.client);
        await loading.edit({ content: null, components: [container], flags: MessageFlags.IsComponentsV2 });
    }
};
