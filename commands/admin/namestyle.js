'use strict';

/**
 * namestyle — Per-guild bot display-name styling (Nameplates).
 * Based on: github.com/dray-me/Display-Name-effect
 *
 * Uses raw fetch() to PATCH /guilds/{guild_id}/members/@me with
 * display_name_font_id, display_name_effect_id, display_name_colors.
 *
 * Prefix-only, premium-gated command.
 * © Rajeev (Rexzy) — xNico
 */

const {
    MessageFlags, ContainerBuilder, TextDisplayBuilder,
    SeparatorBuilder, SeparatorSpacingSize, SectionBuilder,
    ThumbnailBuilder, PermissionFlagsBits,
} = require('discord.js');

const premiumManager = require('../../utils/premiumManager');
const jsonStore      = require('../../utils/jsonStore');

const E = {
    palette:  '<:Palette:1521227950601539755>',
    settings: '<:Settings:1521227767780343879>',
    success:  '<:Checkedbox:1521227734943269077>',
    cancel:   '<:Cancel:1521227723916181644>',
    edit:     '<:Edit:1521227886634205298>',
    star:     '<:Star:1521227981685526568>',
    bots:     '<:bots:1521227848101396610>',
    caret:    '<:Caretright:1521227704953864202>',
};

/* ─────────────────── Font & Effect catalogue (all 12 + 6) ─────────────────── */

const FONTS = [
    { id: 1,  key: 'bangers',       label: 'Bangers',        desc: 'Bold comic-style font' },
    { id: 2,  key: 'biorhyme',      label: 'BioRhyme',       desc: 'Elegant serif font' },
    { id: 3,  key: 'cherry_bomb',   label: 'Cherry Bomb',    desc: 'Playful bubble font' },
    { id: 4,  key: 'chicle',        label: 'Chicle',         desc: 'Rounded soft font' },
    { id: 5,  key: 'compagnon',     label: 'Compagnon',      desc: 'Monospaced display font' },
    { id: 6,  key: 'museo_moderno', label: 'Museo Moderno',  desc: 'Modern display font' },
    { id: 7,  key: 'neo_castel',    label: 'Neo-Castel',     desc: 'Gothic medieval font' },
    { id: 8,  key: 'pixelify_sans', label: 'Pixelify Sans',  desc: 'Retro pixel font' },
    { id: 9,  key: 'ribes',         label: 'Ribes',          desc: 'Decorative display font' },
    { id: 10, key: 'sinistre',      label: 'Sinistre',       desc: 'Dark elegant font' },
    { id: 11, key: 'default',       label: 'GG Sans',        desc: 'Standard Discord font' },
    { id: 12, key: 'zilla_slab',    label: 'Zilla Slab',     desc: 'Modern slab-serif font' },
];

const EFFECTS = [
    { id: 1, key: 'solid',    label: 'Solid',    desc: 'Single flat color',        colorSlots: 1 },
    { id: 2, key: 'gradient', label: 'Gradient', desc: 'Two-color gradient',       colorSlots: 2 },
    { id: 3, key: 'neon',     label: 'Neon',     desc: 'Glowing outline effect',   colorSlots: 1 },
    { id: 4, key: 'toon',     label: 'Toon',     desc: 'Subtle gradient + stroke', colorSlots: 1 },
    { id: 5, key: 'pop',      label: 'Pop',      desc: 'Colored drop shadow',      colorSlots: 1 },
    { id: 6, key: 'glow',     label: 'Glow',     desc: 'Soft glow effect',         colorSlots: 2 },
];

const STYLE_PRESETS = [
    { key: 'sinistre-neon-white',         label: 'Sinistre Neon White',         font_id: 10, effect_id: 3, colors: [16777215] },
    { key: 'ribes-neon-pink',             label: 'Ribes Neon Pink',             font_id: 9,  effect_id: 3, colors: [16711935] },
    { key: 'neo-castel-gradient',         label: 'Neo-Castel Blue/White',       font_id: 7,  effect_id: 2, colors: [5865, 16777215] },
    { key: 'pixelify-pop-purple',         label: 'Pixelify Pop Purple',         font_id: 8,  effect_id: 5, colors: [8388736] },
    { key: 'bangers-glow-pink',           label: 'Bangers Pink/Purple Glow',    font_id: 1,  effect_id: 6, colors: [16711935, 8388736] },
    { key: 'cherry-toon-white',           label: 'Cherry Bomb Toon White',      font_id: 3,  effect_id: 4, colors: [16777215] },
    { key: 'zilla-solid-blue',            label: 'Zilla Slab Solid Blue',       font_id: 12, effect_id: 1, colors: [5865] },
];

function findFont(query) {
    const q = String(query).toLowerCase().trim();
    return FONTS.find(f => f.key === q || f.label.toLowerCase() === q || String(f.id) === q);
}

function findEffect(query) {
    const q = String(query).toLowerCase().trim();
    return EFFECTS.find(e => e.key === q || e.label.toLowerCase() === q || String(e.id) === q);
}

function findPreset(query) {
    const q = String(query).toLowerCase().trim();
    return STYLE_PRESETS.find(p => p.key === q || p.label.toLowerCase() === q);
}

/* ─────────────────── Storage ─────────────────── */

function loadConfig() {
    try {
        if (!jsonStore.has('namestyle')) { jsonStore.write('namestyle', {}); return {}; }
        return jsonStore.read('namestyle');
    } catch { return {}; }
}

function saveConfig(config) { jsonStore.writeImmediate('namestyle', config).catch(() => {}); }

function defaults() { return { font_id: 11, effect_id: 1, colors: [16777215] }; }

function getGuild(config, guildId) {
    if (!config[guildId]) config[guildId] = defaults();
    return config[guildId];
}

/* ─────────────────── Colour helpers ─────────────────── */

function hexToDecimal(hex) {
    if (!hex) return null;
    let h = String(hex).trim().replace(/^#/, '');
    if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
    return parseInt(h, 16);
}

function decToHex(dec) {
    if (dec == null) return null;
    return '#' + Number(dec).toString(16).padStart(6, '0').toUpperCase();
}

function parseColorArg(raw) {
    if (!raw) return null;
    const asNum = parseInt(raw, 10);
    if (!isNaN(asNum) && asNum >= 0 && asNum <= 0xFFFFFF) return asNum;
    return hexToDecimal(raw);
}

/* ─────────────────── Raw Discord API (like reference impl) ─────────────────── */

const API_BASE = 'https://discord.com/api/v10';

async function patchMember(token, guildId, body, maxRetries = 2) {
    const url = `${API_BASE}/guilds/${guildId}/members/@me`;
    let lastErr = 'Unknown error';

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const res = await fetch(url, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bot ${token}`,
                    'Content-Type': 'application/json',
                    'User-Agent': 'DiscordBot (xNico, 1.0)',
                },
                body: JSON.stringify(body),
            });

            if (res.status === 429) {
                const data = await res.json().catch(() => ({}));
                const retryAfter = (data.retry_after || 2) * 1000;
                await new Promise(r => setTimeout(r, retryAfter));
                continue;
            }

            if (res.ok) {
                const data = await res.json().catch(() => ({}));
                return { success: true, data };
            }

            const errData = await res.json().catch(() => ({}));
            lastErr = errData.message || `HTTP ${res.status}`;

            if ([500, 502, 503, 504].includes(res.status) && attempt < maxRetries) {
                await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
                continue;
            }
            break;
        } catch (e) {
            lastErr = e.message;
            if (attempt < maxRetries) {
                await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
                continue;
            }
        }
    }
    return { success: false, error: lastErr };
}

async function applyStyle(token, guildId, style) {
    return patchMember(token, guildId, {
        display_name_font_id:   style.font_id,
        display_name_effect_id: style.effect_id,
        display_name_colors:    style.colors,
    });
}

async function resetStyle(token, guildId) {
    return patchMember(token, guildId, {
        display_name_font_id:   null,
        display_name_effect_id: null,
        display_name_colors:    null,
    });
}

/* ─────────────────── UI panel ─────────────────── */

function buildPanel(cfg, guild, client) {
    const container = new ContainerBuilder();
    const bot = guild.members.me;
    const font   = FONTS.find(f => f.id === cfg.font_id)   || FONTS[10];
    const effect = EFFECTS.find(e => e.id === cfg.effect_id) || EFFECTS[0];
    const colorsDisplay = (cfg.colors || []).map(c => `\`${decToHex(c)}\``).join(' → ') || '*Default*';

    const header = new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `# ${E.palette} Nameplate Style\n-# Customise **${client.user.username}**'s display name in **${guild.name}**`
        ))
        .setThumbnailAccessory(new ThumbnailBuilder({
            media: { url: bot?.displayAvatarURL({ size: 256 }) || client.user.displayAvatarURL({ size: 256 }) },
        }));
    container.addSectionComponents(header);
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

    let info = `### ${E.settings} Current Configuration\n`;
    info += `${E.edit} **Font** — ${font.label} (ID ${font.id})\n`;
    info += `${E.star} **Effect** — ${effect.label} (ID ${effect.id})\n`;
    info += `${E.palette} **Colors** — ${colorsDisplay}\n`;
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(info));
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

    let cmds = `### Commands\n`;
    cmds += `${E.caret} \`namestyle font <name|id>\` — Set font\n`;
    cmds += `${E.caret} \`namestyle effect <name|id>\` — Set effect\n`;
    cmds += `${E.caret} \`namestyle color <hex|dec> [hex2]\` — Set colors\n`;
    cmds += `${E.caret} \`namestyle preset <name>\` — Apply a preset\n`;
    cmds += `${E.caret} \`namestyle apply\` — Push to Discord\n`;
    cmds += `${E.caret} \`namestyle reset\` — Reset to defaults\n`;
    cmds += `${E.caret} \`namestyle fonts\` — List all fonts\n`;
    cmds += `${E.caret} \`namestyle effects\` — List all effects\n`;
    cmds += `${E.caret} \`namestyle presets\` — List style presets\n`;
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(cmds));

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${E.bots} xNico • Nameplate customisation • Premium feature`));
    return container;
}

/* ─────────────────── Module ─────────────────── */

module.exports = {
    name: 'namestyle',
    prefix: 'namestyle',
    description: 'Customise the bot\'s display name font, effect & colours per server',
    usage: 'namestyle [font|effect|color|preset|apply|reset|fonts|effects|presets]',
    category: 'admin',
    aliases: ['nameplate', 'nstyle', 'displayname'],
    premiumOnly: true,
    prefixOnly: true,

    FONTS, EFFECTS, STYLE_PRESETS, applyStyle, loadConfig,

    async executePrefix(message, args) {
        if (!message.member?.permissions?.has?.(PermissionFlagsBits.ManageGuild))
            return message.reply(`${E.cancel} You need **Manage Server** permission.`);
        if (!premiumManager.hasPremiumAccess(message.author.id, message.guild?.id))
            return message.reply(`${E.cancel} This feature requires **Premium**.`);

        const token   = message.client.token;
        const guildId = message.guild.id;
        const config  = loadConfig();
        const cfg     = getGuild(config, guildId);
        const sub     = args[0]?.toLowerCase();

        /* ── No args → panel ── */
        if (!sub) return message.reply({ components: [buildPanel(cfg, message.guild, message.client)], flags: MessageFlags.IsComponentsV2 });

        /* ── FONTS list ── */
        if (sub === 'fonts') {
            const list = FONTS.map(f => `\`${f.id}\` **${f.label}** — ${f.desc}`).join('\n');
            const c = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${E.edit} Available Fonts\n\n${list}\n\n-# Use \`namestyle font <name or id>\``));
            return message.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
        }

        /* ── EFFECTS list ── */
        if (sub === 'effects') {
            const list = EFFECTS.map(e => `\`${e.id}\` **${e.label}** — ${e.desc} (${e.colorSlots} color${e.colorSlots > 1 ? 's' : ''})`).join('\n');
            const c = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${E.star} Available Effects\n\n${list}\n\n-# Use \`namestyle effect <name or id>\``));
            return message.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
        }

        /* ── PRESETS list ── */
        if (sub === 'presets') {
            const list = STYLE_PRESETS.map(p => {
                const f = FONTS.find(x => x.id === p.font_id);
                const e = EFFECTS.find(x => x.id === p.effect_id);
                return `**${p.label}** — \`${p.key}\`\n-# ${f?.label || '?'} + ${e?.label || '?'} • Colors: ${p.colors.map(c => decToHex(c)).join(', ')}`;
            }).join('\n');
            const c = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${E.palette} Style Presets\n\n${list}\n\n-# Use \`namestyle preset <key>\``));
            return message.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
        }

        /* ── FONT ── */
        if (sub === 'font') {
            const font = findFont(args.slice(1).join(' ') || '');
            if (!font) return message.reply(`${E.cancel} Unknown font. Use \`namestyle fonts\` to see all options.`);
            cfg.font_id = font.id;
            saveConfig(config);
            const c = new ContainerBuilder().setAccentColor(0x57F287)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${E.success} Font → ${font.label}\n\nID \`${font.id}\` — ${font.desc}\n\n-# Run \`namestyle apply\` to push to Discord.`));
            return message.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
        }

        /* ── EFFECT ── */
        if (sub === 'effect') {
            const effect = findEffect(args.slice(1).join(' ') || '');
            if (!effect) return message.reply(`${E.cancel} Unknown effect. Use \`namestyle effects\` to see all options.`);
            cfg.effect_id = effect.id;
            if (effect.colorSlots < 2 && cfg.colors?.length > 1) cfg.colors = [cfg.colors[0]];
            saveConfig(config);
            const c = new ContainerBuilder().setAccentColor(0x57F287)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${E.success} Effect → ${effect.label}\n\nID \`${effect.id}\` — ${effect.desc}\n\n-# Run \`namestyle apply\` to push to Discord.`));
            return message.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
        }

        /* ── COLOR ── */
        if (['color', 'colour', 'colors', 'colours'].includes(sub)) {
            if (!args[1]) return message.reply(`${E.cancel} Usage: \`namestyle color #FF00FF\` or \`namestyle color #FF00FF #800080\``);
            const c1 = parseColorArg(args[1]);
            if (c1 === null) return message.reply(`${E.cancel} **\`${args[1]}\`** is not a valid color. Use \`#RRGGBB\` or a decimal number.`);
            const colors = [c1];
            if (args[2]) {
                const c2 = parseColorArg(args[2]);
                if (c2 === null) return message.reply(`${E.cancel} **\`${args[2]}\`** is not a valid second color.`);
                const eff = EFFECTS.find(e => e.id === cfg.effect_id) || EFFECTS[0];
                if (eff.colorSlots < 2) return message.reply(`${E.cancel} **${eff.label}** only supports 1 color. Switch to \`gradient\` or \`glow\` first.`);
                colors.push(c2);
            }
            cfg.colors = colors;
            saveConfig(config);
            const display = colors.map(c => `\`${decToHex(c)}\` (${c})`).join(' → ');
            const c = new ContainerBuilder().setAccentColor(colors[0])
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${E.success} Colors Updated\n\n${display}\n\n-# Run \`namestyle apply\` to push to Discord.`));
            return message.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
        }

        /* ── PRESET ── */
        if (sub === 'preset') {
            const preset = findPreset(args.slice(1).join(' ') || args[1] || '');
            if (!preset) return message.reply(`${E.cancel} Unknown preset. Use \`namestyle presets\` to see all options.`);
            cfg.font_id = preset.font_id;
            cfg.effect_id = preset.effect_id;
            cfg.colors = [...preset.colors];
            saveConfig(config);
            const f = FONTS.find(x => x.id === preset.font_id);
            const e = EFFECTS.find(x => x.id === preset.effect_id);
            const c = new ContainerBuilder().setAccentColor(0x57F287)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# ${E.success} Preset Applied — ${preset.label}\n\n` +
                    `**Font:** ${f?.label} • **Effect:** ${e?.label}\n` +
                    `**Colors:** ${preset.colors.map(c => decToHex(c)).join(' → ')}\n\n` +
                    `-# Run \`namestyle apply\` to push to Discord.`
                ));
            return message.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
        }

        /* ── APPLY ── */
        if (sub === 'apply') {
            const thinking = await message.reply(`${E.settings} Applying nameplate style via Discord API…`);
            const result = await applyStyle(token, guildId, cfg);
            if (result.success) {
                const f = FONTS.find(x => x.id === cfg.font_id) || { label: '?' };
                const e = EFFECTS.find(x => x.id === cfg.effect_id) || { label: '?' };
                const c = new ContainerBuilder().setAccentColor(0x57F287)
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                        `# ${E.success} Nameplate Applied\n\n` +
                        `**Font:** ${f.label} (${cfg.font_id})\n` +
                        `**Effect:** ${e.label} (${cfg.effect_id})\n` +
                        `**Colors:** ${(cfg.colors||[]).map(c => decToHex(c)).join(' → ')}\n\n` +
                        `-# Style is now live in this server.`
                    ));
                return thinking.edit({ content: null, components: [c], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
            }
            const c = new ContainerBuilder().setAccentColor(0xED4245)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# ${E.cancel} Apply Failed\n\n**Error:** ${result.error}\n\n-# The bot may lack permissions or the feature is unavailable.`
                ));
            return thinking.edit({ content: null, components: [c], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }

        /* ── RESET ── */
        if (sub === 'reset') {
            const thinking = await message.reply(`${E.settings} Resetting nameplate…`);
            config[guildId] = defaults();
            saveConfig(config);
            const result = await resetStyle(token, guildId);
            const ok = result.success;
            const c = new ContainerBuilder().setAccentColor(ok ? 0x57F287 : 0xED4245)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    ok ? `# ${E.success} Nameplate Reset\n\nDisplay name style cleared to Discord defaults.`
                       : `# ${E.cancel} Reset Partial\n\nLocal config cleared but API failed: **${result.error}**`
                ));
            return thinking.edit({ content: null, components: [c], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }

        /* ── Unknown → panel ── */
        return message.reply({ components: [buildPanel(cfg, message.guild, message.client)], flags: MessageFlags.IsComponentsV2 });
    },

    /** Re-apply saved styles on startup. */
    async reapplyAll(client, log) {
        try {
            const config = loadConfig();
            const def = defaults();
            let applied = 0;
            for (const [guildId, cfg] of Object.entries(config)) {
                if (cfg.font_id === def.font_id && cfg.effect_id === def.effect_id &&
                    JSON.stringify(cfg.colors) === JSON.stringify(def.colors)) continue;
                if (!client.guilds.cache.has(guildId)) continue;
                if (!premiumManager.isServerPremium(guildId)) continue;
                const result = await applyStyle(client.token, guildId, cfg);
                if (result.success) applied++;
                await new Promise(r => setTimeout(r, 1500)); // rate limit safety
            }
            if (applied > 0 && log) log.success(`Nameplates re-applied: ${applied} guild(s)`);
        } catch (err) {
            if (log) log.error(`Nameplate re-apply failed: ${err.message}`);
        }
    },
};
