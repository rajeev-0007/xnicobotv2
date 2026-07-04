'use strict';

/**
 * /premium — Unified premium info, status and acquisition guide.
 *
 * Subcommands (slash) / sub-actions (prefix):
 *   /premium status        Show current premium status (default)
 *   /premium features      List all premium features
 *   /premium pricing       Show pricing + how to buy / get a key
 *   /premium [@user]       (prefix only) Check another user's status
 *
 * The command also exposes interactive buttons so a user can jump
 * between Status / Features / Pricing without re-typing the command.
 */

const {
    SlashCommandBuilder,
    ContainerBuilder,
    TextDisplayBuilder,
    SectionBuilder,
    ThumbnailBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags } = require('discord.js');

const premiumManager = require('../../utils/premiumManager');
const { COLORS } = require('../../utils/responseBuilder');

/* ─── Custom emojis ─── */
const E = {
    crown:    '<:Crown:1521227739988889764>',
    sketch:   '<:Sketch:1521228025365004471>',
    fire:     '<:Fire:1521227907647668374>',
    star:     '<:Star:1521227981685526568>',
    check:    '<:Checkedbox:1521227734943269077>',
    cancel:   '<:Cancel:1521227723916181644>',
    user:     '<:User:1521227714227343380>',
    server:   '<:Server:1521228371051413546>',
    clock:    '<:Clock:1521228110408847623>',
    alarm:    '<:Alarm:1521227869047750689>',
    book:     '<:Bookopen:1521227911137595605>',
    info:     '<:Inforect:1521228008285929532>',
    money:    '<:Money:1521228266957045900>',
    rocket:   '<:rocket:1521228374805057756>',
    caret:    '<:Caretright:1521227704953864202>',
    shield:   '<:Shield:1521227694677692467>',
    bots:     '<:bots:1521227848101396610>',
    settings: '<:Settings:1521227767780343879>',
    support:  '<:topgg:1521228219066482790>',
    edit:     '<:Edit:1521227886634205298>',
    lightning:'<:Lightning:1521227915537285150>' };

/* ─── Premium feature catalog ───────────────────────────────────────
 *
 * Single source of truth for what is locked behind premium.  Used by
 * the Features pane and (if requested) by future help-menu rendering
 * to mark commands with a crown icon.
 */
const PREMIUM_FEATURES = [
    {
        title: 'Bot Customization',
        emoji: E.settings,
        description: 'Custom bot nickname, avatar, prefix, embed colors and footer per server.',
        commands: ['/bot-customize'] },
    {
        title: 'AI Chat Assistant',
        emoji: E.bots,
        description: 'Set up a dedicated AI chat channel powered by Llama 3 / Groq.',
        commands: ['/aichat-setup'] },
    {
        title: 'Suggestion + Feedback Systems',
        emoji: E.edit,
        description: 'Numbered suggestion cards with vote bars, threads, mod review, DMs, and star-rated feedback panel.',
        commands: ['/suggestion', '/feedback'] },
    {
        title: 'Anonymous Confessions',
        emoji: E.shield,
        description: 'Anonymous confession channel with reply threads and admin-only audit log.',
        commands: ['/confess', '/confession-setup'] },
    {
        title: 'Auto-Nick',
        emoji: E.user,
        description: 'Automatically nick new members to a custom format with `{user}` placeholders.',
        commands: ['/autonick'] },
    {
        title: 'Vanity Guard',
        emoji: E.shield,
        description: 'Detect, revert, and optionally ban anyone who changes the server vanity URL without permission.',
        commands: ['/vanityguard'] },
    {
        title: 'Night Mode',
        emoji: E.clock,
        description: 'Schedule channel lockdowns based on time of day to fight late-night raids.',
        commands: ['/nightmode'] },
    {
        title: 'Super Threat Mode',
        emoji: E.fire,
        description: 'Tighten every protection (anti-nuke, anti-raid, automod) at once during an active threat.',
        commands: ['/superthreatmode'] },
    {
        title: 'Custom Currency',
        emoji: E.money,
        description: 'Rename and re-emoji the server currency (gems, gold, credits — anything).',
        commands: ['/currency'] },
    {
        title: 'Custom Shop',
        emoji: E.fire,
        description: 'Build a guild-specific shop with custom items and reward actions (give role, DM, add coins...).',
        commands: ['/customshop'] },
    {
        title: 'Loan Office',
        emoji: E.money,
        description: 'Borrow against your bank with daily interest and repay anytime.',
        commands: ['/loan'] },
    {
        title: 'No Cooldowns',
        emoji: E.lightning,
        description: 'Premium users bypass per-server slash and prefix command cooldowns.',
        commands: [] },
    {
        title: 'Premium Profile Badge',
        emoji: E.crown,
        description: 'A premium badge on your `/profile` and `/userinfo` views.',
        commands: [] },
];

/* ─── Helpers ─── */

function tsR(date) {
    if (!date) return '*never*';
    return `<t:${Math.floor(new Date(date).getTime() / 1000)}:R>`;
}
function tsF(date) {
    if (!date) return '*never*';
    return `<t:${Math.floor(new Date(date).getTime() / 1000)}:F>`;
}

/* ─── View builders ─── */

function buildButtonRow(active) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('premium_view_status')
            .setLabel('Status')
            .setEmoji(E.check)
            .setStyle(active === 'status' ? ButtonStyle.Primary : ButtonStyle.Secondary)
            .setDisabled(active === 'status'),
        new ButtonBuilder()
            .setCustomId('premium_view_features')
            .setLabel('Features')
            .setEmoji(E.fire)
            .setStyle(active === 'features' ? ButtonStyle.Primary : ButtonStyle.Secondary)
            .setDisabled(active === 'features'),
        new ButtonBuilder()
            .setCustomId('premium_view_pricing')
            .setLabel('Pricing & Get')
            .setEmoji(E.crown)
            .setStyle(active === 'pricing' ? ButtonStyle.Primary : ButtonStyle.Secondary)
            .setDisabled(active === 'pricing'),
    );
}

function buildLinkRow(client) {
    const supportUrl = process.env.SUPPORT_SERVER || 'https://discord.gg/Zs35X7Umak';
    const voteUrl = client?.user?.id ? `https://top.gg/bot/${client.user.id}/vote` : 'https://top.gg';
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel('Support Server').setEmoji(E.bots).setStyle(ButtonStyle.Link).setURL(supportUrl),
        new ButtonBuilder().setLabel('Vote on top.gg').setEmoji(E.support).setStyle(ButtonStyle.Link).setURL(voteUrl),
    );
}

function buildStatusContainer({ targetUser, requesterUser, guild, client }) {
    const status = premiumManager.getPremiumStatus(targetUser.id);
    const serverStatus = guild ? premiumManager.getServerPremiumStatus(guild.id) : null;
    const hasAccess = premiumManager.hasPremiumAccess(targetUser.id, guild?.id);

    const accent = hasAccess ? 0xF1C40F : 0x5865F2;
    const container = new ContainerBuilder().setAccentColor(accent);

    container.addSectionComponents(
        new SectionBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `# ${E.crown} Premium Status\n` +
                `${E.user} **User:** ${targetUser.username}` +
                (guild ? `\n${E.server} **Server:** ${guild.name}` : '')
            ))
            .setThumbnailAccessory(new ThumbnailBuilder({ media: { url: targetUser.displayAvatarURL({ size: 256 }) } }))
    );

    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

    // Overall verdict
    const verdictLine = hasAccess
        ? `${E.check} **Premium is active** — every premium feature is unlocked.`
        : `${E.cancel} **No active premium** — see the **Pricing** tab to unlock.`;
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(verdictLine));

    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

    // User-tier block
    let userBlock = `### ${E.user} User Premium\n`;
    if (status.isPremium) {
        userBlock += `${E.check} **Active**\n`;
        userBlock += `${E.book} Activated: ${tsR(status.activatedAt)}\n`;
        if (status.expiresAt) {
            userBlock += `${E.alarm} Expires: ${tsF(status.expiresAt)} (${tsR(status.expiresAt)})`;
        } else {
            userBlock += `${E.alarm} Duration: **Permanent** ♾️`;
        }
    } else {
        userBlock += `${E.cancel} *Not active for ${targetUser.username}.*\n-# Run \`/redeemkey <KEY>\` to activate.`;
    }
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(userBlock));

    // Server-tier block
    if (guild) {
        container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
        let serverBlock = `### ${E.server} Server Premium\n`;
        if (serverStatus?.isPremium) {
            serverBlock += `${E.check} **Active for this server**\n`;
            serverBlock += `${E.book} Activated: ${tsR(serverStatus.activatedAt)}\n`;
            if (serverStatus.expiresAt) {
                serverBlock += `${E.alarm} Expires: ${tsF(serverStatus.expiresAt)} (${tsR(serverStatus.expiresAt)})\n`;
            } else {
                serverBlock += `${E.alarm} Duration: **Permanent** ♾️\n`;
            }
            if (serverStatus.activatedBy) {
                serverBlock += `${E.user} Activated by: <@${serverStatus.activatedBy}>`;
            }
        } else {
            serverBlock += `${E.cancel} *Not active for this server.*\n-# An admin can run \`/redeemserverkey <KEY>\` to activate it for everyone.`;
        }
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(serverBlock));
    }

    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

    return container;
}

function buildFeaturesContainer({ hasAccess }) {
    const container = new ContainerBuilder().setAccentColor(0xF1C40F);

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `# ${E.fire} Premium Features\n` +
        (hasAccess
            ? `${E.check} You already have premium — all of the below is unlocked for you.`
            : `Everything below unlocks the moment you redeem a premium key.`)
    ));

    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

    // Group features in groups of 6 per text block to stay under Discord's
    // 4 000-char limit per text component.
    const chunked = [];
    for (let i = 0; i < PREMIUM_FEATURES.length; i += 6) {
        chunked.push(PREMIUM_FEATURES.slice(i, i + 6));
    }
    for (const group of chunked) {
        const lines = group.map(f => {
            const cmds = f.commands.length > 0 ? `\n  ${E.caret} ${f.commands.map(c => `\`${c}\``).join(' · ')}` : '';
            return `${f.emoji} **${f.title}**\n  ${f.description}${cmds}`;
        }).join('\n\n');
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines));
        container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
    }

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `-# More premium-only features ship every release �`
    ));

    return container;
}

function buildPricingContainer({ hasAccess }) {
    const container = new ContainerBuilder().setAccentColor(0xF1C40F);

    let header = `# ${E.crown} Get Premium\n`;
    header += hasAccess
        ? `${E.check} You're already premium — share this with friends or your server admins.`
        : `Unlock every feature listed in **/premium features**.`;
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(header));

    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

    // Tiers — kept generic so price changes don't require a code change.
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `### ${E.user} User Premium\n` +
        `Unlocks every premium feature on your account, in any server you're in.\n` +
        `${E.caret} Activate with: \`/redeemkey <KEY>\`\n` +
        `${E.caret} Available durations: 7 days · 30 days · 90 days · Permanent\n\n` +
        `### ${E.server} Server Premium\n` +
        `Unlocks every premium feature for **everyone** in your server.\n` +
        `${E.caret} Activate with: \`/redeemserverkey <KEY>\` (Manage Server perm required)\n` +
        `${E.caret} Best for community servers — single key, whole guild benefits.`
    ));

    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `### ${E.book} How to Get a Key\n` +
        `${E.caret} **Buy** — Open a ticket in our support server, or DM the bot owner directly.\n` +
        `${E.caret} **Vote rewards** — Top voters on top.gg can request short-term keys.\n` +
        `${E.caret} **Free trials** — Occasional drops in our support server.\n` +
        `${E.caret} **Bug bounties / contributions** — High-impact bug reports earn keys.\n\n` +
        `### ${E.lightning} After You Get a Key\n` +
        `${E.caret} Run \`/redeemkey <KEY>\` (user) or \`/redeemserverkey <KEY>\` (server)\n` +
        `${E.caret} Keys expire **24 hours** after creation if not redeemed — redeem fast.\n` +
        `${E.caret} Use \`/premium status\` any time to verify your activation.`
    ));

    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `-# Questions? Open a ticket in the support server. �`
    ));

    return container;
}

function buildView(view, ctx) {
    if (view === 'features') return buildFeaturesContainer(ctx);
    if (view === 'pricing')  return buildPricingContainer(ctx);
    return buildStatusContainer(ctx);
}

/* ─── Command export ─── */

module.exports = {
    name: 'premium',
    prefix: 'premium',
    aliases: ['premiumstatus', 'checkpremium', 'perks', 'premiumperks', 'premiumfeatures', 'getpremium'],
    description: 'View premium status, features, and how to get premium',
    usage: 'premium [status|features|pricing] [@user]',
    category: 'utility',
    dmAllowed: true,

    data: new SlashCommandBuilder()
        .setName('premium')
        .setDescription('View premium status, features, and how to get premium')
        .addSubcommand(s => s.setName('status')
            .setDescription('Show your current premium status')
            .addUserOption(o => o.setName('user').setDescription('User to check').setRequired(false)))
        .addSubcommand(s => s.setName('features')
            .setDescription('List every premium feature'))
        .addSubcommand(s => s.setName('pricing')
            .setDescription('Show pricing and how to get a premium key')),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand(false) || 'status';
        const targetUser = interaction.options.getUser('user') || interaction.user;
        const ctx = {
            targetUser,
            requesterUser: interaction.user,
            guild: interaction.guild,
            client: interaction.client,
            hasAccess: premiumManager.hasPremiumAccess(targetUser.id, interaction.guild?.id) };
        const components = [
            buildView(sub, ctx),
            buildButtonRow(sub),
            buildLinkRow(interaction.client),
        ];
        return interaction.reply({ components, flags: MessageFlags.IsComponentsV2 });
    },

    async executePrefix(message, args) {
        const arg0 = (args[0] || '').toLowerCase();
        let view = 'status';
        if (['features', 'feature', 'perks', 'list'].includes(arg0)) view = 'features';
        else if (['pricing', 'buy', 'price', 'get', 'how'].includes(arg0)) view = 'pricing';

        const targetUser = message.mentions.users.first() || message.author;
        const ctx = {
            targetUser,
            requesterUser: message.author,
            guild: message.guild,
            client: message.client,
            hasAccess: premiumManager.hasPremiumAccess(targetUser.id, message.guild?.id) };
        const components = [
            buildView(view, ctx),
            buildButtonRow(view),
            buildLinkRow(message.client),
        ];
        return message.reply({ components, flags: MessageFlags.IsComponentsV2 });
    },

    /**
     * Button handler — wired from index.js's button dispatcher.
     * Returns true when a button is consumed.
     */
    async handleButton(interaction) {
        if (!interaction.customId.startsWith('premium_view_')) return false;

        const view = interaction.customId.replace('premium_view_', '');
        const targetUser = interaction.user;
        const ctx = {
            targetUser,
            requesterUser: interaction.user,
            guild: interaction.guild,
            client: interaction.client,
            hasAccess: premiumManager.hasPremiumAccess(targetUser.id, interaction.guild?.id) };
        const components = [
            buildView(view, ctx),
            buildButtonRow(view),
            buildLinkRow(interaction.client),
        ];
        await interaction.update({ components, flags: MessageFlags.IsComponentsV2 });
        return true;
    },

    PREMIUM_FEATURES };
