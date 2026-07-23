const { SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, SeparatorBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, ChannelSelectMenuBuilder, ChannelType, EmbedBuilder } = require('discord.js');
const path = require('path');

const jsonStore = require('../../utils/jsonStore');
const { checkAndExpire } = require('../../utils/panelExpiration');

/**
 * Format a stored pingRole value into a Discord-renderable mention.
 * Accepts:
 *   - "everyone" / "@everyone"  → "@everyone"
 *   - "here"     / "@here"      → "@here"
 *   - role ID                   → "<@&id>"
 *   - "<@&id>" (legacy)         → as-is
 *   - null / empty              → "" (caller decides what to show)
 */
function formatPingRole(raw) {
    if (!raw) return '';
    const s = String(raw);
    const lc = s.toLowerCase();
    if (lc === 'everyone' || lc === '@everyone') return '@everyone';
    if (lc === 'here' || lc === '@here') return '@here';
    const m = s.match(/(\d{17,20})/);
    return m ? `<@&${m[1]}>` : s;
}

function loadConfig() {
    try {
        const data = jsonStore.read('social-notify');
        return data && typeof data === 'object' ? data : {};
    } catch { return {}; }
}

function saveConfig(config) {
    jsonStore.write('social-notify', config);
}

// ─── Defaults ────────────────────────────────────────────

function getDefaultGuildConfig() {
    return {
        youtube: {
            enabled: false, channels: [], notifyChannel: null, pingRole: null,
            message: '<:YoutubeLive:1521228137541927022> **{channel}** just uploaded a new video!\n\n**{title}**\n{url}',
            liveEnabled: true,
            liveMessage: '<:YoutubeLive:1521228137541927022> **{channel}** is now **LIVE** on YouTube!\n\n**{title}**\n{url}'
        },
        twitch: { enabled: false, streamers: [], notifyChannel: null, pingRole: null, message: '🟣 **{streamer}** is now live on Twitch!\n\n**{title}**\nPlaying: {game}\n{url}' },
        instagram: { enabled: false, accounts: [], notifyChannel: null, pingRole: null, message: '📸 **{account}** posted something new on Instagram!\n{url}' },
        facebook: { enabled: false, pages: [], notifyChannel: null, pingRole: null, message: '📘 **{page}** posted something new!\n{url}' },
        twitter: { enabled: false, accounts: [], notifyChannel: null, pingRole: null, message: '🐦 **{account}** just tweeted!\n{url}' },
        tiktok: { enabled: false, accounts: [], notifyChannel: null, pingRole: null, message: '<:Music:1521228141543165982> **{account}** posted a new TikTok!\n{url}' }
    };
}

const PLATFORM_INFO = {
    youtube:   { emoji: '<:YoutubeLive:1521228137541927022>',             name: 'YouTube',    color: '#FF0000', itemKey: 'channels',  itemLabel: 'Channels',  placeholder: '@MrBeast or UCX6OQ3DkcsbYNE6H8uQQuVA' },
    twitch:    { emoji: '🟣',                                      name: 'Twitch',     color: '#9146FF', itemKey: 'streamers', itemLabel: 'Streamers', placeholder: 'ninja' },
    instagram: { emoji: '📸',                                      name: 'Instagram',  color: '#E1306C', itemKey: 'accounts',  itemLabel: 'Accounts',  placeholder: 'instagram_username' },
    facebook:  { emoji: '📘',                                      name: 'Facebook',   color: '#1877F2', itemKey: 'pages',     itemLabel: 'Pages',     placeholder: 'page_name_or_id' },
    twitter:   { emoji: '🐦',                                      name: 'Twitter/X',  color: '#1DA1F2', itemKey: 'accounts',  itemLabel: 'Accounts',  placeholder: '@username' },
    tiktok:    { emoji: '<:Music:1521228141543165982>',           name: 'TikTok',     color: '#000000', itemKey: 'accounts',  itemLabel: 'Accounts',  placeholder: '@tiktok_user' }
};

// ─── Helpers ─────────────────────────────────────────────

function getAccountList(pConfig, platform) {
    const key = PLATFORM_INFO[platform].itemKey;
    return pConfig[key] || [];
}

function ensureArray(pConfig, platform) {
    const key = PLATFORM_INFO[platform].itemKey;
    if (!pConfig[key]) pConfig[key] = [];
    return pConfig[key];
}

function ensureYouTubeExtras(ytConfig) {
    if (ytConfig.liveEnabled === undefined) ytConfig.liveEnabled = true;
    if (!ytConfig.liveMessage) ytConfig.liveMessage = '<:YoutubeLive:1521228137541927022> **{channel}** is now **LIVE** on YouTube!\n\n**{title}**\n{url}';
}

// ─── Panel Builders ──────────────────────────────────────

function buildMainPanel(guildConfig) {
    const container = new ContainerBuilder();

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            '# 📡 Social Media Notifications\n' +
            '-# Centralized hub for all social media alerts — videos, streams, posts & more'
        )
    );
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    // ── Dashboard overview ──
    let dashboard = '```ansi\n\u001b[1;37m  Platform        Status      Tracked   Channel\n';
    dashboard += '  ───────────────────────────────────────────────────\n';

    for (const [platform, info] of Object.entries(PLATFORM_INFO)) {
        const pConfig = guildConfig[platform] || {};
        const on = pConfig.enabled;
        const status = on ? '\u001b[1;32m  ✓ ON ' : '\u001b[1;31m  ✗ OFF';
        const count = getAccountList(pConfig, platform).length;
        const ch = pConfig.notifyChannel ? '  #set' : '  —';
        const name = info.name.padEnd(14);
        dashboard += `\u001b[1;36m  ${name} ${status}\u001b[0m       ${String(count).padEnd(9)}${ch}\n`;
    }
    dashboard += '```';
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(dashboard));

    // ── Quick-stats row ──
    const totalTracked = Object.entries(PLATFORM_INFO).reduce((n, [p]) => n + getAccountList(guildConfig[p] || {}, p).length, 0);
    const activePlatforms = Object.entries(PLATFORM_INFO).filter(([p]) => guildConfig[p]?.enabled).length;
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `> <:Toggleon:1521227758011809964> **${activePlatforms}** active platforms  •  **${totalTracked}** total tracked accounts`
    ));

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent('**Select a platform to configure:**'));

    // ── Platform selector ──
    const platformSelect = new StringSelectMenuBuilder()
        .setCustomId('social_platform_select')
        .setPlaceholder('📱 Choose a platform')
        .addOptions(Object.entries(PLATFORM_INFO).map(([key, info]) => ({
            label: info.name,
            description: key === 'youtube' ? 'Video uploads & live streams' : key === 'twitch' ? 'Live stream alerts' : key === 'tiktok' ? 'New video alerts' : `${info.name} post alerts`,
            value: key,
            emoji: info.emoji
        })));

    container.addActionRowComponents(new ActionRowBuilder().addComponents(platformSelect));

    // ── Utility buttons ──
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('social_test_all').setLabel('Test All').setStyle(ButtonStyle.Secondary).setEmoji('🧪'),
        new ButtonBuilder().setCustomId('social_help').setLabel('Guide').setStyle(ButtonStyle.Secondary).setEmoji('<:Lightbulbalt:1521227880703463675>'),
        new ButtonBuilder().setCustomId('social_refresh').setLabel('Refresh').setStyle(ButtonStyle.Secondary).setEmoji('<:History:1521227863079256278>')
    ));

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        '-# <:Infotriangle:1521227710381428926> Some platforms require API keys • Use `/apikeys` to configure  •  Polls every 5 minutes'
    ));

    return container;
}

// ─── YouTube-specific panel (professional, with live-stream support) ───

function buildYouTubePanel(guildConfig) {
    const ytConfig = guildConfig.youtube || {};
    ensureYouTubeExtras(ytConfig);
    const container = new ContainerBuilder().setAccentColor(0xFF0000);

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            '# <:YoutubeLive:1521228137541927022> YouTube Notifications\n' +
            '-# Get notified when YouTubers upload videos or go live'
        )
    );
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    // ── ANSI status block ──
    const channels = ytConfig.channels || [];
    let ansi = '```ansi\n\u001b[1;37m  YouTube Notification Settings\n';
    ansi += '  ─────────────────────────────────\n';
    ansi += `\u001b[1;36m  Status:         ${ytConfig.enabled ? '\u001b[1;32mEnabled' : '\u001b[1;31mDisabled'}\n`;
    ansi += `\u001b[1;36m  Channels:       \u001b[1;33m${channels.length}/25 tracked\n`;
    ansi += `\u001b[1;36m  Live Alerts:    ${ytConfig.liveEnabled ? '\u001b[1;32mEnabled' : '\u001b[1;31mDisabled'}\n`;
    ansi += `\u001b[1;36m  Check Interval: \u001b[1;37mEvery 5 minutes\n`;
    ansi += '```';
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(ansi));

    // ── Rich settings display ──
    const statusEmoji = ytConfig.enabled ? '<:Toggleon:1521227758011809964>' : '<:Toggleoff:1521227763816595559>';
    const channelText = ytConfig.notifyChannel ? `<#${ytConfig.notifyChannel}>` : '`Not Set`';
    const roleText = ytConfig.pingRole ? formatPingRole(ytConfig.pingRole) : '`None`';
    const liveText = ytConfig.liveEnabled ? '<:Toggleon:1521227758011809964> Enabled' : '<:Toggleoff:1521227763816595559> Disabled';

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `${statusEmoji} **Status:** ${ytConfig.enabled ? 'Enabled' : 'Disabled'}\n` +
        `<:Bullhorn:1521227936575914016> **Channel:** ${channelText}\n` +
        `<:Notificationon:1521227730304106680> **Ping Role:** ${roleText}\n` +
        `<:YoutubeLive:1521228137541927022> **Live Alerts:** ${liveText}`
    ));

    // ── Tracked channels list ──
    if (channels.length > 0) {
        let chList = `\n**<:Document:1521227875016114266> Tracked YouTube Channels** (${channels.length}/25)\n`;
        channels.slice(0, 15).forEach((ch, i) => {
            chList += `> \`${i + 1}.\` [${ch}](https://youtube.com/${ch.startsWith('@') ? ch : `@${ch}`})\n`;
        });
        if (channels.length > 15) chList += `> -# +${channels.length - 15} more\n`;
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(chList));
    } else {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            '\n<:Cancel:1521227723916181644> **No YouTube channels tracked**\n-# Click **Add Channel** to start tracking'
        ));
    }

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    // ── Row 1: Core controls ──
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('social_toggle_youtube')
            .setLabel(ytConfig.enabled ? 'Disable' : 'Enable')
            .setStyle(ytConfig.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
            .setEmoji(ytConfig.enabled ? '<:Toggleoff:1521227763816595559>' : '<:Toggleon:1521227758011809964>'),
        new ButtonBuilder()
            .setCustomId('social_add_youtube')
            .setLabel('Add Channel')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('<:Add:1521227828199293152>'),
        new ButtonBuilder()
            .setCustomId('social_remove_youtube')
            .setLabel('Remove Channel')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('<:Trash:1521227750420254820>')
            .setDisabled(channels.length === 0)
    ));

    // ── Row 2: Settings ──
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('social_channel_youtube')
            .setLabel('Set Channel')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('<:Bullhorn:1521227936575914016>'),
        new ButtonBuilder()
            .setCustomId('social_role_youtube')
            .setLabel('Ping Role')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('<:Notificationon:1521227730304106680>'),
        new ButtonBuilder()
            .setCustomId('social_message_youtube')
            .setLabel('Video Message')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('<:Editalt:1521227921673556019>')
    ));

    // ── Row 3: Live & test ──
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('social_ytlive_toggle')
            .setLabel(ytConfig.liveEnabled ? 'Disable Live Alerts' : 'Enable Live Alerts')
            .setStyle(ytConfig.liveEnabled ? ButtonStyle.Secondary : ButtonStyle.Success)
            .setEmoji('<:YoutubeLive:1521228137541927022>'),
        new ButtonBuilder()
            .setCustomId('social_ytlive_message')
            .setLabel('Live Message')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('<:Editalt:1521227921673556019>'),
        new ButtonBuilder()
            .setCustomId('social_preview_youtube')
            .setLabel('Preview')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('<:Eye:1521227940480815156>'),
        new ButtonBuilder()
            .setCustomId('social_test_youtube')
            .setLabel('Send Test')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('<:Cursor:1521228147071127732>')
    ));

    // ── Row 4: Back ──
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('social_back')
            .setLabel('Back to Hub')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('<:Caretleft:1521227977495543838>')
    ));

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        '-# <:Infotriangle:1521227710381428926> Variables: `{channel}` `{title}` `{url}` `{videoId}` • Checks every 5 minutes'
    ));

    return container;
}

// ─── Generic platform panel (Twitch, Instagram, etc.) ───

function buildPlatformPanel(guildConfig, platform) {
    const info = PLATFORM_INFO[platform];
    const pConfig = guildConfig[platform] || {};
    const container = new ContainerBuilder().setAccentColor(parseInt(info.color.replace('#', ''), 16));

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`# ${info.emoji} ${info.name} Notifications\n-# Configure ${info.name} notification settings`)
    );
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    const accountsList = getAccountList(pConfig, platform);

    // ── ANSI Settings ──
    let ansi = '```ansi\n\u001b[1;37m  Current Settings\n';
    ansi += '  ────────────────────────────\n';
    ansi += `\u001b[1;36m  Status:      ${pConfig.enabled ? '\u001b[1;32mEnabled' : '\u001b[1;31mDisabled'}\n`;
    ansi += `\u001b[1;36m  ${info.itemLabel}:  \u001b[1;33m${accountsList.length}/25 configured\n`;
    ansi += '```';
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(ansi));

    const statusEmoji = pConfig.enabled ? '<:Toggleon:1521227758011809964>' : '<:Toggleoff:1521227763816595559>';
    const channelText = pConfig.notifyChannel ? `<#${pConfig.notifyChannel}>` : '`Not Set`';
    const roleText = pConfig.pingRole ? formatPingRole(pConfig.pingRole) : '`None`';

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `${statusEmoji} **Status:** ${pConfig.enabled ? 'Enabled' : 'Disabled'}\n` +
        `<:Bullhorn:1521227936575914016> **Channel:** ${channelText}\n` +
        `<:Notificationon:1521227730304106680> **Ping Role:** ${roleText}`
    ));

    // ── Tracked list ──
    if (accountsList.length > 0) {
        const listText = accountsList.slice(0, 15).map((a, i) => `> \`${i + 1}.\` ${a}`).join('\n');
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `\n**<:Document:1521227875016114266> Tracked ${info.itemLabel}** (${accountsList.length}/25)\n${listText}${accountsList.length > 15 ? `\n> -# +${accountsList.length - 15} more...` : ''}`
        ));
    } else {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `\n<:Cancel:1521227723916181644> **No ${info.itemLabel.toLowerCase()} tracked**\n-# Click **Add** to start tracking`
        ));
    }

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    // ── Row 1: Core ──
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`social_toggle_${platform}`)
            .setLabel(pConfig.enabled ? 'Disable' : 'Enable')
            .setStyle(pConfig.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
            .setEmoji(pConfig.enabled ? '<:Toggleoff:1521227763816595559>' : '<:Toggleon:1521227758011809964>'),
        new ButtonBuilder()
            .setCustomId(`social_add_${platform}`)
            .setLabel(`Add ${info.itemLabel.slice(0, -1)}`)
            .setStyle(ButtonStyle.Primary)
            .setEmoji('<:Add:1521227828199293152>'),
        new ButtonBuilder()
            .setCustomId(`social_remove_${platform}`)
            .setLabel('Remove')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('<:Trash:1521227750420254820>')
            .setDisabled(accountsList.length === 0)
    ));

    // ── Row 2: Settings ──
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`social_channel_${platform}`)
            .setLabel('Set Channel')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('<:Bullhorn:1521227936575914016>'),
        new ButtonBuilder()
            .setCustomId(`social_role_${platform}`)
            .setLabel('Ping Role')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('<:Notificationon:1521227730304106680>'),
        new ButtonBuilder()
            .setCustomId(`social_message_${platform}`)
            .setLabel('Custom Message')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('<:Editalt:1521227921673556019>')
    ));

    // ── Row 3: Preview, Test & Back ──
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`social_preview_${platform}`)
            .setLabel('Preview')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('<:Eye:1521227940480815156>'),
        new ButtonBuilder()
            .setCustomId(`social_test_${platform}`)
            .setLabel('Send Test')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('<:Cursor:1521228147071127732>'),
        new ButtonBuilder()
            .setCustomId('social_back')
            .setLabel('Back to Hub')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('<:Caretleft:1521227977495543838>')
    ));

    return container;
}

// ─── Help text ───────────────────────────────────────────

const HELP_TEXT = `# 📡 Social Media Notifications — Guide

## Quick Setup
\`\`\`
1. Select a Platform      →  Choose from the dropdown
2. Add Account / Channel  →  Enter handle or username
3. Set Notification Channel →  Pick where alerts go
4. (Optional) Set Ping Role →  Role to mention
5. Enable the Platform    →  Toggle notifications on
\`\`\`

## Supported Platforms
| Platform | Content | API Key |
|----------|---------|---------|
| 🔴 YouTube | Videos & Livestreams | No (RSS) |
| 🟣 Twitch | Live Streams | Yes |
| 📸 Instagram | Posts & Stories | Yes |
| 📘 Facebook | Page Updates | Yes |
| 🐦 Twitter/X | Tweets | Yes |
| 🎼 TikTok | Videos | No |

## Message Variables
\`{channel}\` \`{title}\` \`{url}\` \`{videoId}\` — YouTube
\`{streamer}\` \`{title}\` \`{game}\` \`{viewers}\` \`{url}\` — Twitch
\`{account}\` \`{url}\` — Instagram / Twitter / TikTok
\`{page}\` \`{url}\` — Facebook

## Limits
- **25** accounts per platform per server
- **5 min** poll interval
- API keys via \`/apikeys\`

-# Need help? Join our support server`;

// ═══════════════════════════════════════════════════════════
// Interaction handler
// ═══════════════════════════════════════════════════════════

async function handleInteraction(interaction) {
    if (!interaction.isButton() && !interaction.isStringSelectMenu() && !interaction.isModalSubmit() && !interaction.isChannelSelectMenu() && !interaction.isRoleSelectMenu()) return false;

    const id = interaction.customId;
    if (!id.startsWith('social_')) return false;

    // Check if config session has expired
    if (await checkAndExpire(interaction, 'config')) return true;

    const config = loadConfig();
    const guildId = interaction.guild.id;
    if (!config[guildId]) config[guildId] = getDefaultGuildConfig();
    const gc = config[guildId];

    // ── Navigation ──────────────────────────────────────
    if (id === 'social_platform_select') {
        const platform = interaction.values[0];
        const panel = platform === 'youtube' ? buildYouTubePanel(gc) : buildPlatformPanel(gc, platform);
        await interaction.update({ components: [panel], flags: MessageFlags.IsComponentsV2 });
        return true;
    }

    if (id === 'social_back' || id === 'social_refresh') {
        const panel = buildMainPanel(gc);
        await interaction.update({ components: [panel], flags: MessageFlags.IsComponentsV2 });
        return true;
    }

    if (id === 'social_help') {
        await interaction.reply({ content: HELP_TEXT, flags: MessageFlags.Ephemeral });
        return true;
    }

    if (id === 'social_test_all') {
        let tested = 0;
        if ((gc.youtube?.enabled || gc.enabled) && gc.youtube?.notifyChannel) {
            const channel = interaction.guild.channels.cache.get(gc.youtube.notifyChannel);
            if (channel) {
                await channel.send('🔔 **[Test]** This is a test notification for YouTube alerts!').catch(() => {});
                tested++;
            }
        }
        await interaction.reply({ content: `<:Cursor:1521228147071127732> Sent test notifications to ${tested} configured channels. (Note: Only YouTube is currently automated).`, flags: MessageFlags.Ephemeral });
        return true;
    }

    // ── YouTube-specific: Live toggle ───────────────────
    if (id === 'social_ytlive_toggle') {
        ensureYouTubeExtras(gc.youtube);
        gc.youtube.liveEnabled = !gc.youtube.liveEnabled;
        saveConfig(config);
        await interaction.update({ components: [buildYouTubePanel(gc)], flags: MessageFlags.IsComponentsV2 });
        return true;
    }

    // ── YouTube-specific: Live message modal ────────────
    if (id === 'social_ytlive_message') {
        ensureYouTubeExtras(gc.youtube);
        const modal = new ModalBuilder().setCustomId('social_ytlive_message_modal').setTitle('Livestream Message');
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('live_message')
                .setLabel('Notification message for livestreams')
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder('{channel} is LIVE! {title}\n{url}')
                .setValue(gc.youtube.liveMessage || '')
                .setRequired(true)
                .setMaxLength(1000)
        ));
        await interaction.showModal(modal);
        return true;
    }

    if (id === 'social_ytlive_message_modal' && interaction.isModalSubmit()) {
        gc.youtube.liveMessage = interaction.fields.getTextInputValue('live_message');
        saveConfig(config);
        await interaction.reply({ content: '<:Checkedbox:1521227734943269077> Livestream notification message saved!', flags: MessageFlags.Ephemeral });
        try { await interaction.message.edit({ components: [buildYouTubePanel(gc)], flags: MessageFlags.IsComponentsV2 }); } catch {}
        return true;
    }

    // ── Generic platform actions (regex-matched) ────────
    const platformMatch = id.match(/^social_(toggle|add|remove|channel|role|message|test|preview)_(youtube|twitch|instagram|facebook|twitter|tiktok)$/);
    if (platformMatch) {
        const [, action, platform] = platformMatch;
        const info = PLATFORM_INFO[platform];
        const pConfig = gc[platform];
        const isYouTube = platform === 'youtube';

        const rebuildPanel = () => isYouTube ? buildYouTubePanel(gc) : buildPlatformPanel(gc, platform);

        // ── Toggle ──
        if (action === 'toggle') {
            pConfig.enabled = !pConfig.enabled;
            saveConfig(config);
            await interaction.update({ components: [rebuildPanel()], flags: MessageFlags.IsComponentsV2 });
            return true;
        }

        // ── Add account ──
        if (action === 'add') {
            const modal = new ModalBuilder()
                .setCustomId(`social_add_modal_${platform}`)
                .setTitle(`Add ${info.name} ${info.itemLabel.slice(0, -1)}`);
            modal.addComponents(new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('account_name')
                    .setLabel(isYouTube ? 'YouTube Channel (@handle or Channel ID)' : `${info.name} Username`)
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder(info.placeholder)
                    .setRequired(true)
            ));
            await interaction.showModal(modal);
            return true;
        }

        // ── Remove ──
        if (action === 'remove') {
            const accounts = getAccountList(pConfig, platform);
            if (!accounts.length) {
                await interaction.reply({ content: '<:Cancel:1521227723916181644> Nothing to remove!', flags: MessageFlags.Ephemeral });
                return true;
            }
            const options = accounts.slice(0, 25).map((a, i) => ({
                label: a.length > 50 ? a.substring(0, 47) + '...' : a,
                value: String(i),
                emoji: info.emoji
            }));
            const select = new StringSelectMenuBuilder()
                .setCustomId(`social_remove_select_${platform}`)
                .setPlaceholder(`Select ${info.itemLabel.slice(0, -1).toLowerCase()} to remove`)
                .addOptions(options);
            await interaction.reply({ content: `**Select a ${info.itemLabel.slice(0, -1).toLowerCase()} to remove:**`, components: [new ActionRowBuilder().addComponents(select)], flags: MessageFlags.Ephemeral });
            return true;
        }

        // ── Set channel ──
        if (action === 'channel') {
            const channelSelect = new ChannelSelectMenuBuilder()
                .setCustomId(`social_channel_select_${platform}`)
                .setPlaceholder('Select notification channel')
                .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);
            await interaction.reply({ content: '**Select the channel for notifications:**', components: [new ActionRowBuilder().addComponents(channelSelect)], flags: MessageFlags.Ephemeral });
            return true;
        }

        // ── Set role ──
        if (action === 'role') {
            const modal = new ModalBuilder()
                .setCustomId(`social_role_modal_${platform}`)
                .setTitle('Set Ping Role');
            modal.addComponents(new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('role_id')
                    .setLabel('Role ID, role mention, or @everyone')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('123456789012345678 · @everyone · @here')
                    .setRequired(false)
                    .setValue(pConfig.pingRole || '')
            ));
            await interaction.showModal(modal);
            return true;
        }

        // ── Custom message ──
        if (action === 'message') {
            const modal = new ModalBuilder()
                .setCustomId(`social_message_modal_${platform}`)
                .setTitle(`${info.name} Notification Message`);
            modal.addComponents(new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('custom_message')
                    .setLabel(isYouTube ? 'Message for new video uploads' : 'Custom notification message')
                    .setStyle(TextInputStyle.Paragraph)
                    .setPlaceholder('Use {channel}, {title}, {url}, {streamer}, {game}, etc.')
                    .setValue(pConfig.message || '')
                    .setRequired(true)
                    .setMaxLength(1000)
            ));
            await interaction.showModal(modal);
            return true;
        }

        // ── Preview (ephemeral, no channel required, never pings) ──
        if (action === 'preview') {
            const pv = {
                channel: 'Example Channel', title: 'This is a Preview Notification!', url: 'https://youtube.com',
                videoId: 'dQw4w9WgXcQ', streamer: 'ExampleStreamer', game: 'Just Chatting',
                account: 'example_account', page: 'Example Page', viewers: '1,234'
            };
            let msg = (pConfig.message || `${info.emoji} New notification from ${info.name}!`);
            for (const [k, v] of Object.entries(pv)) msg = msg.replace(new RegExp(`\\{${k}\\}`, 'g'), v);

            const pingMention = formatPingRole(pConfig.pingRole);
            const ping = pingMention ? `${pingMention} ` : '';
            const header = '<:Eye:1521227940480815156> **Preview** — this is how your notification will look (only you can see this):\n\n';

            try {
                if (isYouTube) {
                    const embed = new EmbedBuilder()
                        .setColor(0xFF0000)
                        .setAuthor({ name: 'Example Channel', iconURL: 'https://i.imgur.com/3pGrCPv.png' })
                        .setTitle('🎬 Preview Video Notification')
                        .setURL('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
                        .setImage('https://img.youtube.com/vi/dQw4w9WgXcQ/maxresdefault.jpg')
                        .setFooter({ text: 'YouTube • Preview' });
                    await interaction.reply({ content: `${header}${ping}${msg}`, embeds: [embed], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
                } else {
                    await interaction.reply({ content: `${header}${ping}${msg}`, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
                }
            } catch (error) {
                await interaction.reply({ content: `<:Cancel:1521227723916181644> Failed to build preview: ${error.message}`, flags: MessageFlags.Ephemeral });
            }
            return true;
        }

        // ── Test notification ──
        if (action === 'test') {
            if (!pConfig.notifyChannel) {
                await interaction.reply({ content: '<:Cancel:1521227723916181644> Set a notification channel first!', flags: MessageFlags.Ephemeral });
                return true;
            }
            const channel = interaction.guild.channels.cache.get(pConfig.notifyChannel);
            if (!channel) {
                await interaction.reply({ content: '<:Cancel:1521227723916181644> Notification channel not found! It may have been deleted.', flags: MessageFlags.Ephemeral });
                return true;
            }

            const testVars = {
                channel: 'Test Channel', title: 'This is a Test Notification!', url: 'https://example.com',
                videoId: 'dQw4w9WgXcQ', streamer: 'TestStreamer', game: 'Just Chatting',
                account: 'test_account', page: 'Test Page', viewers: '1,234'
            };
            let testMsg = (pConfig.message || `${info.emoji} Test notification from ${info.name}!`);
            for (const [k, v] of Object.entries(testVars)) testMsg = testMsg.replace(new RegExp(`\\{${k}\\}`, 'g'), v);

            const pingMention = formatPingRole(pConfig.pingRole);
            const pingRole = pingMention ? `${pingMention} ` : '';
            const allowedMentions = { parse: [] };
            if (pConfig.pingRole) {
                const lc = String(pConfig.pingRole).toLowerCase();
                if (lc === 'everyone' || lc === '@everyone' || lc === 'here' || lc === '@here') {
                    allowedMentions.parse.push('everyone');
                } else {
                    const m = String(pConfig.pingRole).match(/(\d{17,20})/);
                    if (m) allowedMentions.roles = [m[1]];
                }
            }

            try {
                if (isYouTube) {
                    const embed = new EmbedBuilder()
                        .setColor(0xFF0000)
                        .setAuthor({ name: 'Test Channel', iconURL: 'https://i.imgur.com/3pGrCPv.png' })
                        .setTitle('🎬 This is a Test Video Notification!')
                        .setURL('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
                        .setImage('https://img.youtube.com/vi/dQw4w9WgXcQ/maxresdefault.jpg')
                        .setTimestamp()
                        .setFooter({ text: 'YouTube • Test Notification' });
                    await channel.send({ content: `${pingRole}${testMsg}\n\n-# 🧪 This is a test notification`, embeds: [embed], allowedMentions });
                } else {
                    await channel.send({ content: `${pingRole}${testMsg}\n\n-# 🧪 This is a test notification`, allowedMentions });
                }
                await interaction.reply({ content: `<:Checkedbox:1521227734943269077> Test notification sent to <#${channel.id}>!`, flags: MessageFlags.Ephemeral });
            } catch (error) {
                await interaction.reply({ content: `<:Cancel:1521227723916181644> Failed to send test: ${error.message}`, flags: MessageFlags.Ephemeral });
            }
            return true;
        }
    }

    // ── Modal: Add account submit ───────────────────────
    const addModalMatch = id.match(/^social_add_modal_(\w+)$/);
    if (addModalMatch && interaction.isModalSubmit()) {
        const platform = addModalMatch[1];
        const info = PLATFORM_INFO[platform];
        const pConfig = gc[platform];
        const accountName = interaction.fields.getTextInputValue('account_name').trim();
        const accounts = ensureArray(pConfig, platform);
        const isYouTube = platform === 'youtube';

        if (accounts.includes(accountName)) {
            await interaction.reply({ content: '<:Cancel:1521227723916181644> This account is already being tracked!', flags: MessageFlags.Ephemeral });
            return true;
        }
        if (accounts.length >= 25) {
            await interaction.reply({ content: '<:Cancel:1521227723916181644> Maximum 25 per platform!', flags: MessageFlags.Ephemeral });
            return true;
        }

        let resolveMsg = '';
        if (isYouTube) {
            try {
                const { resolveYouTubeChannelId } = require('../../utils/socialNotifyPoller');
                const channelId = await resolveYouTubeChannelId(accountName);
                resolveMsg = channelId
                    ? `\n-# Resolved to channel ID: \`${channelId}\``
                    : '\n-# ⚠️ Could not verify channel — will retry on next poll';
            } catch {
                resolveMsg = '\n-# ⚠️ Could not verify channel — will retry on next poll';
            }
        }

        accounts.push(accountName);
        saveConfig(config);

        await interaction.reply({ content: `<:Checkedbox:1521227734943269077> Added **${accountName}** to ${info.name} tracking!${resolveMsg}`, flags: MessageFlags.Ephemeral });
        try {
            const panel = isYouTube ? buildYouTubePanel(gc) : buildPlatformPanel(gc, platform);
            await interaction.message.edit({ components: [panel], flags: MessageFlags.IsComponentsV2 });
        } catch {}
        return true;
    }

    // ── Select: Remove account ──────────────────────────
    const removeSelectMatch = id.match(/^social_remove_select_(\w+)$/);
    if (removeSelectMatch && interaction.isStringSelectMenu()) {
        const platform = removeSelectMatch[1];
        const accounts = getAccountList(gc[platform], platform);
        const index = parseInt(interaction.values[0]);
        const removed = accounts.splice(index, 1)[0];
        saveConfig(config);
        await interaction.update({ content: `<:Checkedbox:1521227734943269077> Removed **${removed}** from tracking!`, components: [] });
        return true;
    }

    // ── Select: Channel ─────────────────────────────────
    const channelSelectMatch = id.match(/^social_channel_select_(\w+)$/);
    if (channelSelectMatch && interaction.isChannelSelectMenu()) {
        const platform = channelSelectMatch[1];
        gc[platform].notifyChannel = interaction.values[0];
        saveConfig(config);
        await interaction.update({ content: `<:Checkedbox:1521227734943269077> Notification channel set to <#${interaction.values[0]}>!`, components: [] });
        return true;
    }

    // ── Modal: Role ─────────────────────────────────────
    const roleModalMatch = id.match(/^social_role_modal_(\w+)$/);
    if (roleModalMatch && interaction.isModalSubmit()) {
        const platform = roleModalMatch[1];
        const raw = interaction.fields.getTextInputValue('role_id').trim();

        // Normalise the input. Accepts:
        //   "@everyone" / "everyone"  → stored as "everyone"
        //   "@here" / "here"          → stored as "here"
        //   "<@&123…>" / "123…"       → stored as the bare role ID
        //   ""                         → null (disabled)
        let stored = null;
        let displayRole = '';
        if (raw) {
            const lc = raw.toLowerCase();
            if (lc === '@everyone' || lc === 'everyone') {
                stored = 'everyone';
                displayRole = '@everyone';
            } else if (lc === '@here' || lc === 'here') {
                stored = 'here';
                displayRole = '@here';
            } else {
                const m = raw.match(/^<@&(\d{17,20})>$/) || raw.match(/^(\d{17,20})$/);
                if (m) {
                    stored = m[1];
                    displayRole = `<@&${m[1]}>`;
                } else {
                    await interaction.reply({
                        content: '<:Cancel:1521227723916181644> Invalid role. Use a role ID, role mention, `@everyone`, or `@here`.',
                        flags: MessageFlags.Ephemeral
                    });
                    return true;
                }
            }
        }

        gc[platform].pingRole = stored;
        saveConfig(config);
        await interaction.reply({
            content: stored
                ? `<:Checkedbox:1521227734943269077> Ping target set to ${displayRole}.`
                : '<:Checkedbox:1521227734943269077> Ping role disabled.',
            flags: MessageFlags.Ephemeral
        });
        try {
            const panel = platform === 'youtube' ? buildYouTubePanel(gc) : buildPlatformPanel(gc, platform);
            await interaction.message.edit({ components: [panel], flags: MessageFlags.IsComponentsV2 });
        } catch {}
        return true;
    }

    // ── Modal: Custom message ───────────────────────────
    const messageModalMatch = id.match(/^social_message_modal_(\w+)$/);
    if (messageModalMatch && interaction.isModalSubmit()) {
        const platform = messageModalMatch[1];
        gc[platform].message = interaction.fields.getTextInputValue('custom_message');
        saveConfig(config);
        await interaction.reply({ content: '<:Checkedbox:1521227734943269077> Custom notification message saved!', flags: MessageFlags.Ephemeral });
        try {
            const panel = platform === 'youtube' ? buildYouTubePanel(gc) : buildPlatformPanel(gc, platform);
            await interaction.message.edit({ components: [panel], flags: MessageFlags.IsComponentsV2 });
        } catch {}
        return true;
    }

    return false;
}

// ═══════════════════════════════════════════════════════════
// Module export
// ═══════════════════════════════════════════════════════════

module.exports = {
    category: 'automation',
    data: new SlashCommandBuilder()
        .setName('social-notify')
        .setDescription('Configure social media notifications (YouTube, Twitch, Instagram & more)')
        .setDefaultMemberPermissions(0x20),

    async execute(interaction) {
        const config = loadConfig();
        const guildId = interaction.guild.id;
        if (!config[guildId]) { config[guildId] = getDefaultGuildConfig(); saveConfig(config); }
        await interaction.reply({ components: [buildMainPanel(config[guildId])], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    },

    async executePrefix(message) {
        if (!message.member.permissions.has('ManageGuild')) {
            return message.reply('<:Cancel:1521227723916181644> You need **Manage Server** permission to configure social notifications.');
        }
        const config = loadConfig();
        const guildId = message.guild.id;
        if (!config[guildId]) { config[guildId] = getDefaultGuildConfig(); saveConfig(config); }
        await message.reply({ components: [buildMainPanel(config[guildId])], flags: MessageFlags.IsComponentsV2 });
    },

    handleInteraction,
    loadConfig,
    saveConfig,
    getDefaultGuildConfig,
    PLATFORM_INFO,
    buildMainPanel,
    buildYouTubePanel,
    buildPlatformPanel,
};
