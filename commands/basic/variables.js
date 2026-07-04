'use strict';

/**
 * /variables — Template variable reference.
 *
 * Five paginated pages organised by domain (User, Server, Channel,
 * Roles & Position, Live Examples). All pages share a uniform header,
 * grouped sections with custom emojis, and inline navigation buttons
 * (◀ / 1 of N / ▶) plus a Home + Close pair. Sessions are tracked
 * per-message and self-expire after 5 minutes.
 */

const {
    SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder,
    SeparatorBuilder, SeparatorSpacingSize, ActionRowBuilder,
    ButtonBuilder, ButtonStyle, MessageFlags
} = require('discord.js');

const ACCENT          = 0xCAD7E6;
const SESSION_TIMEOUT = 5 * 60 * 1000;
const MAX_SESSIONS    = 200;

/* ─── Section helpers ───────────────────────────────────────────── */

function row(label, vars) {
    const items = vars.map(([token, desc]) => `\`${token}\` ${desc}`).join(' · ');
    return `> ${items}`;
}

const PAGES = [
    /* Page 1 — Overview ─────────────────────────────────────────── */
    {
        title: '<:Bookopen:1521227911137595605> Template Variables',
        body: [
            'Use these tokens inside any message that supports placeholders. They are auto-replaced with live data when the message is sent.',
            '',
            '<:Settings:1521227767780343879> **Where they work**',
            '> Welcomer · Leave Card · Sticky Messages · Embed & Components Builder · Tickets · Auto-responder · Auto-react'
        ]
    },

    /* Page 2 — User ─────────────────────────────────────────────── */
    {
        title: '<:User:1521227714227343380> User Variables',
        body: [
            '<:User:1521227714227343380> **Identity**',
            row('User', [
                ['{user}',        'mention'],
                ['{username}',    'username'],
                ['{displayname}', 'server nickname'],
                ['{userid}',      'user ID'],
                ['{usertag}',     'user#tag']
            ]),
            '',
            '<:Sketch:1521228025365004471> **Visuals**',
            row('Visuals', [
                ['{useravatar}', 'avatar URL'],
                ['{usericon}',   'avatar URL alias'],
                ['{userbanner}', 'profile banner URL']
            ]),
            '',
            '<:Sandwatch:1521228272426418367> **Timestamps**',
            row('Timestamps', [
                ['{usercreated}', 'account creation date'],
                ['{userjoined}',  'date the user joined this server']
            ])
        ]
    },

    /* Page 3 — Server ───────────────────────────────────────────── */
    {
        title: '<:Folder:1521228095225331765> Server Variables',
        body: [
            '<:Folder:1521228095225331765> **Identity**',
            row('Server', [
                ['{server}',     'server name'],
                ['{servername}', 'server name alias'],
                ['{serverid}',   'server ID'],
                ['{servericon}', 'server icon URL'],
                ['{serverbanner}', 'server banner URL']
            ]),
            '',
            '<:Crown:1521227739988889764> **Owner & Stats**',
            row('Stats', [
                ['{serverowner}', 'owner mention'],
                ['{membercount}', 'total members'],
                ['{boostcount}',  'active boosts'],
                ['{boostlevel}',  'boost tier']
            ])
        ]
    },

    /* Page 4 — Channel & Role ───────────────────────────────────── */
    {
        title: '<:Bullhorn:1521227936575914016> Channel & Role',
        body: [
            '<:Bullhorn:1521227936575914016> **Channel**',
            row('Channel', [
                ['{channelname}',    'channel name'],
                ['{channelid}',      'channel ID'],
                ['{channelmention}', 'mention']
            ]),
            '',
            '<:Crown:1521227739988889764> **Roles & Position**',
            row('Roles', [
                ['{roles}',        'role list'],
                ['{highestrole}',  'highest role'],
                ['{joinposition}', 'join order #']
            ])
        ]
    },

    /* Page 5 — Examples ─────────────────────────────────────────── */
    {
        title: '<:Fire:1521227907647668374> Live Examples',
        body: [
            '<:Sketch:1521228025365004471> **Welcomer**',
            '> `Welcome {user} to {server}! You are member #{membercount}.`',
            '',
            '<:Music:1521228141543165982> **Sticky Message**',
            '> `{user} — read the rules in {channelmention}!`',
            '',
            '<:Inforect:1521228008285929532> **Embed Title / Footer**',
            '> Title: `{displayname} joined {server}!`',
            '> Footer: `Member #{joinposition} • Joined {userjoined}`',
            '',
            '<:Bullhorn:1521227936575914016> **Ticket Welcome**',
            '> `Hello {user}, your support ticket has been created.`',
            '',
            '<:Checkedbox:1521227734943269077> Variables resolve at send time, so every message stays accurate.'
        ]
    }
];

/* ─── Renderer ──────────────────────────────────────────────────── */

function buildContainer(page, requesterTag) {
    const total = PAGES.length;
    const idx = Math.max(0, Math.min(total - 1, page));
    const data = PAGES[idx];

    const container = new ContainerBuilder().setAccentColor(ACCENT);

    // Header
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `## ${data.title}\n-# Page ${idx + 1} of ${total} · Requested by ${requesterTag}`
        )
    );

    container.addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    );

    // Body
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(data.body.join('\n'))
    );

    container.addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false)
    );

    // Pagination row
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('var_first')
            .setEmoji('<:Skipprev:1521228277891731616>')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(idx === 0),
        new ButtonBuilder()
            .setCustomId('var_prev')
            .setEmoji('<:Caretleft:1521227977495543838>')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(idx === 0),
        new ButtonBuilder()
            .setCustomId('var_indicator')
            .setLabel(`${idx + 1} / ${total}`)
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true),
        new ButtonBuilder()
            .setCustomId('var_next')
            .setEmoji('<:Caretright:1521227704953864202>')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(idx === total - 1),
        new ButtonBuilder()
            .setCustomId('var_last')
            .setEmoji('<:Caretright:1521227704953864202>')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(idx === total - 1)
    ));

    return container;
}

/* ─── Session tracking ──────────────────────────────────────────── */

function trackSession(messageId, userId, page) {
    if (!global.varSessions) global.varSessions = new Map();
    if (global.varSessions.size >= MAX_SESSIONS) {
        // Drop the oldest 25% to keep the map bounded
        const oldest = [...global.varSessions.entries()]
            .sort((a, b) => a[1].ts - b[1].ts)
            .slice(0, Math.floor(MAX_SESSIONS / 4));
        for (const [k] of oldest) global.varSessions.delete(k);
    }
    global.varSessions.set(messageId, { ts: Date.now(), userId, page });
    setTimeout(() => global.varSessions?.delete(messageId), SESSION_TIMEOUT);
}

/* ─── Module ────────────────────────────────────────────────────── */

module.exports = {
    data: new SlashCommandBuilder()
        .setName('variables')
        .setDescription('Browse every template variable supported by the bot'),
    prefix: 'variables',
    aliases: ['vars', 'placeholders'],
    description: 'Browse every template variable supported by the bot',
    usage: 'variables',
    category: 'basic',

    async execute(interaction) {
        try {
            const tag = interaction.user.username;
            const container = buildContainer(0, tag);
            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            const reply = await interaction.fetchReply();
            trackSession(reply.id, interaction.user.id, 0);
        } catch (err) {
            console.error('[VARIABLES] Slash error:', err);
            const content = '<:Cancel:1521227723916181644> Failed to open the variables panel.';
            if (interaction.deferred || interaction.replied) await interaction.editReply({ content }).catch(() => {});
            else await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
        }
    },

    async executePrefix(message) {
        try {
            const tag = message.author.username;
            const container = buildContainer(0, tag);
            const reply = await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            trackSession(reply.id, message.author.id, 0);
        } catch (err) {
            console.error('[VARIABLES] Prefix error:', err);
            await message.reply('<:Cancel:1521227723916181644> Failed to open the variables panel.').catch(() => {});
        }
    },

    async handleButton(interaction) {
        const id = interaction.customId;
        if (!id.startsWith('var_') || id === 'var_indicator') return false;

        if (!global.varSessions) global.varSessions = new Map();
        const session = global.varSessions.get(interaction.message.id);

        if (session && session.userId !== interaction.user.id) {
            await interaction.reply({
                content: '<:Cancel:1521227723916181644> Run `/variables` to open your own panel.',
                flags: MessageFlags.Ephemeral
            }).catch(() => {});
            return true;
        }

        const total = PAGES.length;
        const cur = session?.page ?? 0;
        let next = cur;
        if (id === 'var_first')      next = 0;
        else if (id === 'var_prev')  next = Math.max(0, cur - 1);
        else if (id === 'var_next')  next = Math.min(total - 1, cur + 1);
        else if (id === 'var_last')  next = total - 1;
        else return false;

        if (session) session.page = next;
        else trackSession(interaction.message.id, interaction.user.id, next);

        const container = buildContainer(next, interaction.user.username);
        await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
        return true;
    }
};
