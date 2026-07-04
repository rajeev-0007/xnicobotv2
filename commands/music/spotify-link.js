'use strict';

const {
    SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, ActionRowBuilder,
    ButtonBuilder, ButtonStyle, SeparatorBuilder, SeparatorSpacingSize,
    MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder } = require('discord.js');

const jsonStore = require('../../utils/jsonStore');
const { musicError, replyMusic } = require('../../utils/musicResponse');
const { checkAndExpire } = require('../../utils/panelExpiration');
const { formatTime } = require('../../utils/musicHelpers');

const COLOR_SPOTIFY = 0x1DB954;
const CV2     = MessageFlags.IsComponentsV2;
const CV2_EPH = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;

const MAX_PLAYLISTS = 25;

/* ── Storage ──────────────────────────────────────────────────────── */

function loadLinks() {
    try { return jsonStore.has('spotify-links') ? (jsonStore.read('spotify-links') || {}) : {}; }
    catch { return {}; }
}
function saveLinks(data) { jsonStore.write('spotify-links', data); }

function loadFavorites() {
    try { return jsonStore.has('favorite_songs') ? (jsonStore.read('favorite_songs') || []) : []; }
    catch { return []; }
}

/* ── Profile panels ───────────────────────────────────────────────── */

function buildProfilePanel(userId, links, favorites) {
    const profile = links[userId];
    const userFavs = favorites.filter(f => f.user_id === userId);
    const container = new ContainerBuilder().setAccentColor(COLOR_SPOTIFY);

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        '# <:spotify:1521228327761744043> Spotify Profile\n' +
        '-# Link your Spotify account and manage your playlists.'
    ));
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

    if (profile) {
        let body = `<:Checkedbox:1521227734943269077> **Linked Account**\n`;
        body += `> **Username:** \`${profile.username}\`\n`;
        if (profile.profileUrl) body += `> **Profile:** [Open on Spotify](${profile.profileUrl})\n`;
        if (profile.linkedAt)   body += `> **Linked:** <t:${Math.floor(new Date(profile.linkedAt).getTime() / 1000)}:R>\n`;

        if (profile.playlists?.length) {
            body += `\n**<:Music:1521228141543165982> Saved Playlists** · ${profile.playlists.length}\n`;
            profile.playlists.slice(0, 10).forEach((pl, i) => {
                body += `> \`${i + 1}.\` [${pl.name}](${pl.url})\n`;
            });
            if (profile.playlists.length > 10) body += `> -# +${profile.playlists.length - 10} more\n`;
        }
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
    } else {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            '<:Cancel:1521227723916181644> **No account linked.**\n-# Tap **Link Account** to connect your Spotify profile.'
        ));
    }

    if (userFavs.length) {
        let favText = `\n**<:Heart:1521228100652765247> Favorite Songs** · ${userFavs.length}\n`;
        userFavs.slice(0, 8).forEach((song, i) => {
            const dur = song.duration ? `\`${formatTime(song.duration)}\`` : '';
            favText += `> \`${i + 1}.\` **${song.title}** by ${song.author} ${dur}\n`;
        });
        if (userFavs.length > 8) favText += `> -# +${userFavs.length - 8} more\n`;
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(favText));
    }

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('spotlink_link').setLabel(profile ? 'Update Account' : 'Link Account')
            .setStyle(ButtonStyle.Success).setEmoji('<:spotify:1521228327761744043>'),
        new ButtonBuilder().setCustomId('spotlink_playlist').setLabel('Add Playlist')
            .setStyle(ButtonStyle.Primary).setEmoji('<:Music:1521228141543165982>').setDisabled(!profile),
        new ButtonBuilder().setCustomId('spotlink_remove_playlist').setLabel('Remove Playlist')
            .setStyle(ButtonStyle.Secondary).setEmoji('<:Trash:1521227750420254820>')
            .setDisabled(!profile?.playlists?.length),
    );
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('spotlink_unlink').setLabel('Unlink Account')
            .setStyle(ButtonStyle.Danger).setEmoji('<:Cancel:1521227723916181644>').setDisabled(!profile),
        new ButtonBuilder().setCustomId('spotlink_view').setLabel('View Favorites')
            .setStyle(ButtonStyle.Secondary).setEmoji('<:Heart:1521228100652765247>').setDisabled(userFavs.length === 0),
    );

    container.addActionRowComponents(row1, row2);
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        '-# Use `/like` while music plays to save tracks to your favorites.'
    ));
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    return container;
}

async function showOtherProfile(ctx, user) {
    const links = loadLinks();
    const favorites = loadFavorites();
    const profile = links[user.id];
    const userFavs = favorites.filter(f => f.user_id === user.id);

    const container = new ContainerBuilder().setAccentColor(COLOR_SPOTIFY);
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `# <:spotify:1521228327761744043> ${user.username}'s Spotify Profile`
    ));
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

    if (profile) {
        let text = `**Username:** \`${profile.username}\`\n`;
        if (profile.profileUrl) text += `**Profile:** [Open on Spotify](${profile.profileUrl})\n`;
        if (profile.playlists?.length) {
            text += `\n**<:Music:1521228141543165982> Playlists** · ${profile.playlists.length}\n`;
            profile.playlists.slice(0, 10).forEach((pl, i) => {
                text += `> \`${i + 1}.\` [${pl.name}](${pl.url})\n`;
            });
        }
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
    } else {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `<:Cancel:1521227723916181644> ${user.username} has not linked their Spotify account.`
        ));
    }

    if (userFavs.length) {
        let favText = `\n**<:Heart:1521228100652765247> Favorite Songs** · ${userFavs.length}\n`;
        userFavs.slice(0, 5).forEach((song, i) => {
            favText += `> \`${i + 1}.\` **${song.title}** by ${song.author}\n`;
        });
        if (userFavs.length > 5) favText += `> -# +${userFavs.length - 5} more\n`;
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(favText));
    }

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

    const isSlash = typeof ctx.isRepliable === 'function';
    return ctx.reply({ components: [container], flags: isSlash ? CV2_EPH : CV2 });
}

/* ── Handlers ─────────────────────────────────────────────────────── */

async function handleButton(interaction, links) {
    const userId = interaction.user.id;
    const id = interaction.customId;

    if (id === 'spotlink_link') {
        const current = links[userId];
        const modal = new ModalBuilder()
            .setCustomId('spotlink_modal_link')
            .setTitle('Link Spotify Account')
            .addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('spotify_username').setLabel('Spotify Username')
                        .setStyle(TextInputStyle.Short).setPlaceholder('your_spotify_username')
                        .setValue(current?.username || '').setRequired(true)
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('spotify_url').setLabel('Profile URL (optional)')
                        .setStyle(TextInputStyle.Short).setPlaceholder('https://open.spotify.com/user/your_id')
                        .setValue(current?.profileUrl || '').setRequired(false)
                ),
            );
        await interaction.showModal(modal);
        return true;
    }

    if (id === 'spotlink_playlist') {
        const modal = new ModalBuilder()
            .setCustomId('spotlink_modal_playlist')
            .setTitle('Add Spotify Playlist')
            .addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('playlist_name').setLabel('Playlist Name')
                        .setStyle(TextInputStyle.Short).setPlaceholder('My Favorites').setRequired(true)
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('playlist_url').setLabel('Playlist URL')
                        .setStyle(TextInputStyle.Short).setPlaceholder('https://open.spotify.com/playlist/...').setRequired(true)
                ),
            );
        await interaction.showModal(modal);
        return true;
    }

    if (id === 'spotlink_remove_playlist') {
        if (!links[userId]?.playlists?.length) {
            await interaction.reply({ components: [musicError('No Playlists', 'You have no saved playlists to remove.')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            return true;
        }
        const options = links[userId].playlists.slice(0, 25).map((pl, i) => ({
            label: pl.name.length > 50 ? pl.name.slice(0, 47) + '…' : pl.name,
            value: String(i),
            emoji: { id: '1521228141543165982' } }));
        const select = new StringSelectMenuBuilder()
            .setCustomId('spotlink_remove_select')
            .setPlaceholder('Select a playlist to remove')
            .addOptions(options);
        await interaction.reply({
            content: '**Pick a playlist to remove:**',
            components: [new ActionRowBuilder().addComponents(select)],
            flags: MessageFlags.Ephemeral });
        return true;
    }

    if (id === 'spotlink_unlink') {
        delete links[userId];
        saveLinks(links);
        await interaction.reply({ content: '<:Checkedbox:1521227734943269077> Spotify account unlinked.', flags: MessageFlags.Ephemeral });
        try {
            const container = buildProfilePanel(userId, links, loadFavorites());
            await interaction.message.edit({ components: [container], flags: CV2 });
        } catch {}
        return true;
    }

    if (id === 'spotlink_view') {
        const favorites = loadFavorites();
        const userFavs = favorites.filter(f => f.user_id === userId);
        if (!userFavs.length) {
            await interaction.reply({ components: [musicError('No Favorites', 'You have no favorite tracks yet.', 'Use the ❤ button while a song is playing to save it.')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            return true;
        }
        let body = `# <:Heart:1521228100652765247> Your Favorite Songs\n\n`;
        userFavs.slice(0, 20).forEach((song, i) => {
            const dur = song.duration ? ` \`${formatTime(song.duration)}\`` : '';
            body += `\`${i + 1}.\` **${song.title}** by ${song.author}${dur}\n`;
            if (song.url) body += `> [Listen](${song.url})\n`;
        });
        if (userFavs.length > 20) body += `\n-# +${userFavs.length - 20} more`;

        const container = new ContainerBuilder()
            .setAccentColor(COLOR_SPOTIFY)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(body))
;
        await interaction.reply({ components: [container], flags: CV2_EPH });
        return true;
    }

    return false;
}

async function handleSelect(interaction, links) {
    if (interaction.customId !== 'spotlink_remove_select') return false;
    const userId = interaction.user.id;
    const index = parseInt(interaction.values[0], 10);
    if (!links[userId]?.playlists?.[index]) {
        await interaction.update({ components: [musicError('Playlist Not Found', 'That playlist no longer exists.')], flags: MessageFlags.IsComponentsV2 });
        return true;
    }
    const removed = links[userId].playlists.splice(index, 1)[0];
    saveLinks(links);
    await interaction.update({ content: `<:Checkedbox:1521227734943269077> Removed **${removed.name}**.`, components: [] });
    return true;
}

async function handleModal(interaction, links) {
    const userId = interaction.user.id;
    const id = interaction.customId;

    if (id === 'spotlink_modal_link') {
        const username = interaction.fields.getTextInputValue('spotify_username').trim();
        const urlRaw   = interaction.fields.getTextInputValue('spotify_url').trim();

        if (!links[userId]) links[userId] = {};
        links[userId].username = username;
        links[userId].linkedAt = new Date().toISOString();

        if (urlRaw) {
            const looksLikeUrl = /spotify\.com|spotify:/i.test(urlRaw);
            links[userId].profileUrl = looksLikeUrl
                ? urlRaw
                : `https://open.spotify.com/user/${encodeURIComponent(urlRaw)}`;
        } else {
            delete links[userId].profileUrl;
        }
        if (!links[userId].playlists) links[userId].playlists = [];
        saveLinks(links);

        await interaction.reply({ content: `<:Checkedbox:1521227734943269077> Linked as **${username}**.`, flags: MessageFlags.Ephemeral });
        try {
            const container = buildProfilePanel(userId, links, loadFavorites());
            await interaction.message.edit({ components: [container], flags: CV2 });
        } catch {}
        return true;
    }

    if (id === 'spotlink_modal_playlist') {
        const name = interaction.fields.getTextInputValue('playlist_name').trim();
        const url  = interaction.fields.getTextInputValue('playlist_url').trim();

        if (!links[userId]) {
            await interaction.reply({ components: [musicError('Not Linked', 'Link your Spotify account first.', 'Use the Link Account button to get started.')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            return true;
        }
        if (!/spotify\.com\/playlist\/|spotify:playlist:/i.test(url)) {
            await interaction.reply({ components: [musicError('Invalid URL', 'That does not look like a Spotify playlist URL.', 'Example: `https://open.spotify.com/playlist/...`')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            return true;
        }
        if (!links[userId].playlists) links[userId].playlists = [];
        if (links[userId].playlists.length >= MAX_PLAYLISTS) {
            await interaction.reply({ content: `<:Cancel:1521227723916181644> Maximum **${MAX_PLAYLISTS}** playlists.`, flags: MessageFlags.Ephemeral });
            return true;
        }
        if (links[userId].playlists.some(p => p.url === url)) {
            await interaction.reply({ components: [musicError('Already Linked', 'That playlist is already linked to your account.')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            return true;
        }

        links[userId].playlists.push({ name, url, addedAt: new Date().toISOString() });
        saveLinks(links);

        await interaction.reply({ content: `<:Checkedbox:1521227734943269077> Added **${name}**.`, flags: MessageFlags.Ephemeral });
        try {
            const container = buildProfilePanel(userId, links, loadFavorites());
            await interaction.message.edit({ components: [container], flags: CV2 });
        } catch {}
        return true;
    }

    return false;
}

/* ── Command export ───────────────────────────────────────────────── */

module.exports = {
    data: new SlashCommandBuilder()
        .setName('spotify-link')
        .setDescription('Link your Spotify profile and manage playlists')
        .addUserOption(o => o.setName('user').setDescription("View another user's profile").setRequired(false)),

    prefix: 'spotify-link',
    description: 'Link your Spotify profile and manage playlists',
    usage: 'spotify-link [@user]',
    category: 'music',
    aliases: ['spotifylink', 'sl'],

    async execute(interaction) {
        const viewUser = interaction.options.getUser('user');
        if (viewUser && viewUser.id !== interaction.user.id) {
            return showOtherProfile(interaction, viewUser);
        }
        const container = buildProfilePanel(interaction.user.id, loadLinks(), loadFavorites());
        return interaction.reply({ components: [container], flags: CV2_EPH });
    },

    async executePrefix(message) {
        const viewUser = message.mentions.users.first();
        if (viewUser && viewUser.id !== message.author.id) {
            return showOtherProfile(message, viewUser);
        }
        const container = buildProfilePanel(message.author.id, loadLinks(), loadFavorites());
        return message.reply({ components: [container], flags: CV2 });
    },

    async handleInteraction(interaction) {
        const id = interaction.customId;
        if (!id || !id.startsWith('spotlink_')) return false;

        if (await checkAndExpire(interaction, 'config')) return true;

        const links = loadLinks();

        try {
            if (interaction.isButton?.())            return await handleButton(interaction, links);
            if (interaction.isStringSelectMenu?.())  return await handleSelect(interaction, links);
            if (interaction.isModalSubmit?.())       return await handleModal(interaction, links);
        } catch (err) {
            try {
                if (interaction.isRepliable?.() && !interaction.replied && !interaction.deferred) {
                    await interaction.reply({
                        components: [musicError('Spotify Action Failed', 'Something went wrong.', err.message || 'Unknown error')],
                        flags: CV2_EPH });
                }
            } catch {}
        }
        return false;
    } };
