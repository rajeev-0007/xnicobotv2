const { 
    SlashCommandBuilder, 
    ContainerBuilder, 
    TextDisplayBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    SeparatorBuilder, 
    SeparatorSpacingSize, 
    MessageFlags,
    StringSelectMenuBuilder
} = require('discord.js');
const { buildErrorResponse } = require('../../utils/responseBuilder');
const { models } = require('../../utils/database');
const { formatTime } = require('../../utils/helpers');

const jsonStore = require('../../utils/jsonStore');

function loadSpotifyLinks() {
    if (!jsonStore.has('spotify-links')) {
        jsonStore.write('spotify-links', {});
        return {};
    }
    return jsonStore.read('spotify-links');
}

function saveSpotifyLinks(data) {
    jsonStore.write('spotify-links', data);
}

const ITEMS_PER_PAGE = 8;

function buildMainPanel(userId, favorites, spotifyLinks) {
    const userLinks = spotifyLinks[userId] || { playlists: [] };
    const favCount = favorites?.length || 0;
    const playlistCount = userLinks.playlists?.length || 0;

    let content = `# <:Music:1521228141543165982> My Music Library\n\n`;
    content += `### <:Heart:1521228100652765247> Favorites\n`;
    content += `> **${favCount}** liked songs saved\n\n`;
    content += `### <:spotify:1521228327761744043> Spotify Playlists\n`;
    content += `> **${playlistCount}** playlists linked\n\n`;
    content += `-# Manage your music library from one place`;

    return content;
}

function createMainButtons() {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('mymusic_favorites')
                .setLabel('View Favorites')
                .setEmoji('<:Heart:1521228100652765247>')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('mymusic_spotify')
                .setLabel('Spotify Playlists')
                .setEmoji('<:spotify:1521228327761744043>')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('mymusic_add_spotify')
                .setLabel('Link Playlist')
                .setEmoji('<:Attach:1521228039135170722>')
                .setStyle(ButtonStyle.Secondary)
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('mymusic_play_favorites')
                .setLabel('Play Favorites')
                .setEmoji('<:Play:1521228333700878416>')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('mymusic_shuffle_favorites')
                .setLabel('Shuffle Favorites')
                .setEmoji('<:Shuffle:1521228321403437228>')
                .setStyle(ButtonStyle.Primary)
        )
    ];
}

function buildFavoritesPanel(favorites, page = 1) {
    const totalPages = Math.max(1, Math.ceil((favorites?.length || 0) / ITEMS_PER_PAGE));
    const validPage = Math.min(Math.max(1, page), totalPages);
    const start = (validPage - 1) * ITEMS_PER_PAGE;
    const pageSongs = (favorites || []).slice(start, start + ITEMS_PER_PAGE);

    let content = `# <:Heart:1521228100652765247> My Favorite Songs\n\n`;
    
    if (!favorites || favorites.length === 0) {
        content += `You haven't liked any songs yet!\n\n`;
        content += `-# Use the <:Heart:1521228100652765247> button on the music panel or \`/like\` to save songs`;
    } else {
        content += `-# ${favorites.length} songs saved\n\n`;
        pageSongs.forEach((song, i) => {
            const title = (song.title || 'Unknown').substring(0, 35) + ((song.title || '').length > 35 ? '...' : '');
            const duration = song.duration ? formatTime(song.duration) : '??:??';
            content += `**${start + i + 1}.** ${title}\n`;
            content += `-# by ${(song.author || 'Unknown').substring(0, 25)} • ${duration}\n\n`;
        });
        content += `-# Page ${validPage}/${totalPages}`;
    }

    return { content, page: validPage, totalPages };
}

function createFavoritesButtons(page, totalPages, hasFavorites) {
    const rows = [];
    
    if (hasFavorites) {
        rows.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`mymusic_fav_prev_${page}`)
                .setEmoji('<:Caretleft:1521227977495543838>')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page === 1),
            new ButtonBuilder()
                .setCustomId('mymusic_play_favorites')
                .setLabel('Play All')
                .setEmoji('<:Play:1521228333700878416>')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('mymusic_shuffle_favorites')
                .setLabel('Shuffle')
                .setEmoji('<:Shuffle:1521228321403437228>')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId(`mymusic_fav_next_${page}`)
                .setEmoji('<:Caretright:1521227704953864202>')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page === totalPages)
        ));

        rows.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('mymusic_remove_favorite')
                .setLabel('Remove Song')
                .setEmoji('<:Trash:1521227750420254820>')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('mymusic_clear_favorites')
                .setLabel('Clear All')
                .setEmoji('<:Infotriangle:1521227710381428926>')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('mymusic_back')
                .setLabel('Back')
                .setEmoji('<:Caretleft:1521227977495543838>')
                .setStyle(ButtonStyle.Secondary)
        ));
    } else {
        rows.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('mymusic_back')
                .setLabel('Back')
                .setEmoji('<:Caretleft:1521227977495543838>')
                .setStyle(ButtonStyle.Secondary)
        ));
    }

    return rows;
}

function buildSpotifyPanel(userId, spotifyLinks) {
    const userLinks = spotifyLinks[userId] || { playlists: [] };
    const playlists = userLinks.playlists || [];

    let content = `# <:spotify:1521228327761744043> My Spotify Playlists\n\n`;
    
    if (playlists.length === 0) {
        content += `No playlists linked yet!\n\n`;
        content += `### How to link a playlist:\n`;
        content += `1. Open Spotify and go to your playlist\n`;
        content += `2. Click **Share** → **Copy link to playlist**\n`;
        content += `3. Click **Link Playlist** below and paste the URL\n\n`;
        content += `-# You can link up to 10 Spotify playlists`;
    } else {
        content += `-# ${playlists.length}/10 playlists linked\n\n`;
        playlists.forEach((pl, i) => {
            const name = (pl.name || 'Unnamed Playlist').substring(0, 35);
            content += `**${i + 1}.** ${name}\n`;
            content += `-# Added <t:${Math.floor(pl.addedAt / 1000)}:R>\n\n`;
        });
    }

    return content;
}

function createSpotifyButtons(playlists) {
    const rows = [];
    
    rows.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('mymusic_add_spotify')
            .setLabel('Link Playlist')
            .setEmoji('<:Attach:1521228039135170722>')
            .setStyle(ButtonStyle.Success)
            .setDisabled((playlists?.length || 0) >= 10),
        new ButtonBuilder()
            .setCustomId('mymusic_remove_spotify')
            .setLabel('Remove Playlist')
            .setEmoji('<:Trash:1521227750420254820>')
            .setStyle(ButtonStyle.Danger)
            .setDisabled(!playlists || playlists.length === 0),
        new ButtonBuilder()
            .setCustomId('mymusic_back')
            .setLabel('Back')
            .setEmoji('<:Caretleft:1521227977495543838>')
            .setStyle(ButtonStyle.Secondary)
    ));

    if (playlists && playlists.length > 0) {
        const options = playlists.slice(0, 10).map((pl, i) => ({
            label: (pl.name || 'Unnamed').substring(0, 50),
            description: 'Click to play this playlist',
            value: `spotify_play_${i}`,
            emoji: { id: '1521228327761744043' }
        }));

        rows.push(new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('mymusic_spotify_select')
                .setPlaceholder('Select a playlist to play...')
                .addOptions(options)
        ));
    }

    return rows;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('my-music')
        .setDescription('Manage your music library - favorites and Spotify playlists'),

    prefix: 'my-music',
    aliases: ['mymusic', 'musiclib', 'library'],
    description: 'Manage your music library - favorites and Spotify playlists',
    usage: 'my-music',
    category: 'music',

    async execute(interaction, lavalinkManager) {
        const favorites = await models.FavoriteSong.find({ userId: interaction.user.id });
        const spotifyLinks = loadSpotifyLinks();

        const container = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(buildMainPanel(interaction.user.id, favorites, spotifyLinks))
            );

        container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
        
        const buttons = createMainButtons();
        buttons.forEach(row => container.addActionRowComponents(row));

        await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    },

    async executePrefix(message, args, lavalinkManager) {
        const favorites = await models.FavoriteSong.find({ userId: message.author.id });
        const spotifyLinks = loadSpotifyLinks();

        const container = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(buildMainPanel(message.author.id, favorites, spotifyLinks))
            );

        container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
        
        const buttons = createMainButtons();
        buttons.forEach(row => container.addActionRowComponents(row));

        await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    },

    async handleButton(interaction, lavalinkManager) {
        const customId = interaction.customId;
        if (!customId.startsWith('mymusic_')) return false;

        const userId = interaction.user.id;
        const spotifyLinks = loadSpotifyLinks();

        // Back to main panel
        if (customId === 'mymusic_back') {
            const favorites = await models.FavoriteSong.find({ userId });
            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(buildMainPanel(userId, favorites, spotifyLinks))
                );
            container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
            const buttons = createMainButtons();
            buttons.forEach(row => container.addActionRowComponents(row));
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
            return true;
        }

        // View favorites
        if (customId === 'mymusic_favorites' || customId.startsWith('mymusic_fav_')) {
            const favorites = await models.FavoriteSong.find({ userId });
            let page = 1;
            
            if (customId.includes('_prev_')) {
                page = Math.max(1, parseInt(customId.split('_').pop()) - 1);
            } else if (customId.includes('_next_')) {
                page = parseInt(customId.split('_').pop()) + 1;
            }

            const { content, page: validPage, totalPages } = buildFavoritesPanel(favorites, page);
            const container = new ContainerBuilder()
                .setAccentColor(0xED4245)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
            
            container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
            const buttons = createFavoritesButtons(validPage, totalPages, favorites?.length > 0);
            buttons.forEach(row => container.addActionRowComponents(row));

            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
            return true;
        }

        // View Spotify playlists
        if (customId === 'mymusic_spotify') {
            const userLinks = spotifyLinks[userId] || { playlists: [] };
            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(buildSpotifyPanel(userId, spotifyLinks))
                );
            
            container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
            const buttons = createSpotifyButtons(userLinks.playlists);
            buttons.forEach(row => container.addActionRowComponents(row));

            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
            return true;
        }

        // Add Spotify playlist
        if (customId === 'mymusic_add_spotify') {
            const modal = new ModalBuilder()
                .setCustomId('mymusic_modal_add_spotify')
                .setTitle('Link Spotify Playlist');

            const urlInput = new TextInputBuilder()
                .setCustomId('playlist_url')
                .setLabel('Spotify Playlist URL')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('https://open.spotify.com/playlist/...')
                .setRequired(true);

            const nameInput = new TextInputBuilder()
                .setCustomId('playlist_name')
                .setLabel('Playlist Name (optional)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('My Playlist')
                .setRequired(false)
                .setMaxLength(50);

            modal.addComponents(
                new ActionRowBuilder().addComponents(urlInput),
                new ActionRowBuilder().addComponents(nameInput)
            );

            await interaction.showModal(modal);
            return true;
        }

        // Remove Spotify playlist
        if (customId === 'mymusic_remove_spotify') {
            const userLinks = spotifyLinks[userId] || { playlists: [] };
            if (!userLinks.playlists || userLinks.playlists.length === 0) {
                await interaction.reply({ components: [buildErrorResponse('Error', 'You have no playlists to remove!')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
                return true;
            }

            const options = userLinks.playlists.map((pl, i) => ({
                label: (pl.name || 'Unnamed').substring(0, 50),
                value: `remove_${i}`
            }));

            const row = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('mymusic_remove_spotify_select')
                    .setPlaceholder('Select playlist to remove...')
                    .addOptions(options)
            );

            await interaction.reply({ 
                content: '<:Trash:1521227750420254820> Select a playlist to remove:', 
                components: [row], 
                flags: MessageFlags.Ephemeral 
            });
            return true;
        }

        // Remove favorite song
        if (customId === 'mymusic_remove_favorite') {
            const modal = new ModalBuilder()
                .setCustomId('mymusic_modal_remove_fav')
                .setTitle('Remove Favorite Song');

            const numberInput = new TextInputBuilder()
                .setCustomId('song_number')
                .setLabel('Song Number (from the list)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('1')
                .setRequired(true)
                .setMaxLength(3);

            modal.addComponents(new ActionRowBuilder().addComponents(numberInput));
            await interaction.showModal(modal);
            return true;
        }

        // Clear all favorites
        if (customId === 'mymusic_clear_favorites') {
            const confirmRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('mymusic_confirm_clear')
                    .setEmoji('<:Infotriangle:1521227710381428926>')
                    .setLabel('Yes, Clear All')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId('mymusic_cancel_clear')
                    .setEmoji('<:Cancel:1521227723916181644>')
                    .setLabel('Cancel')
                    .setStyle(ButtonStyle.Secondary)
            );

            await interaction.reply({
                content: '<:Infotriangle:1521227710381428926> **Are you sure you want to clear ALL your favorite songs?**\nThis action cannot be undone!',
                components: [confirmRow],
                flags: MessageFlags.Ephemeral
            });
            return true;
        }

        if (customId === 'mymusic_confirm_clear') {
            await models.FavoriteSong.deleteMany({ userId });
            const clearContainer = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent('# <:Checkedbox:1521227734943269077> Cleared\n\nAll your favorite songs have been cleared!')
                );
            await interaction.update({
                components: [clearContainer],
                flags: MessageFlags.IsComponentsV2
            });
            return true;
        }

        if (customId === 'mymusic_cancel_clear') {
            const cancelContainer = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent('# <:Cancel:1521227723916181644> Cancelled\n\nClear operation cancelled — your favorites are safe.')
                );
            await interaction.update({
                components: [cancelContainer],
                flags: MessageFlags.IsComponentsV2
            });
            return true;
        }

        // Play favorites
        if (customId === 'mymusic_play_favorites' || customId === 'mymusic_shuffle_favorites') {
            if (!interaction.member.voice?.channel) {
                await interaction.reply({ components: [buildErrorResponse('Error', 'You need to be in a voice channel!')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
                return true;
            }

            const favorites = await models.FavoriteSong.find({ userId });
            if (!favorites || favorites.length === 0) {
                await interaction.reply({ components: [buildErrorResponse('Error', 'You have no favorite songs to play!')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
                return true;
            }

            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            if (!lavalinkManager.useable) {
                await interaction.editReply({ components: [buildErrorResponse('Music Unavailable', 'No music servers are connected right now. Please try again in a moment.')], flags: MessageFlags.IsComponentsV2 });
                return true;
            }

            let player = lavalinkManager.getPlayer(interaction.guild.id);
            if (!player) {
                player = await lavalinkManager.createPlayer({
                    guildId: interaction.guild.id,
                    voiceChannelId: interaction.member.voice.channel.id,
                    textChannelId: interaction.channel.id,
                    selfDeaf: true,
                    volume: 100
                });
            }

            if (!player.connected) await player.connect();

            let tracks = [...favorites];
            if (customId === 'mymusic_shuffle_favorites') {
                for (let i = tracks.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [tracks[i], tracks[j]] = [tracks[j], tracks[i]];
                }
            }

            let added = 0;
            const wasPlaying = player.playing || player.paused;

            for (const fav of tracks) {
                try {
                    const result = await Promise.race([
                        player.search({ query: fav.url || `${fav.title} ${fav.author}` }, interaction.user),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('Search timed out')), 15000))
                    ]);
                    if (result.tracks?.length > 0) {
                        player.queue.add(result.tracks[0]);
                        added++;
                    }
                } catch (e) {
                    console.error('Failed to add favorite track:', e);
                }
            }

            if (!wasPlaying && added > 0) await player.play();

            const mode = customId.includes('shuffle') ? 'Shuffle' : 'Queue';
            const favContainer = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`# <:Checkedbox:1521227734943269077> Favorites Loaded\n\nAdded **${added}** favorite songs to ${mode.toLowerCase()}!`)
                );
            await interaction.editReply({
                components: [favContainer],
                flags: MessageFlags.IsComponentsV2
            });
            return true;
        }

        return false;
    },

    async handleSelectMenu(interaction, lavalinkManager) {
        const customId = interaction.customId;
        if (!customId.startsWith('mymusic_')) return false;

        const userId = interaction.user.id;
        const spotifyLinks = loadSpotifyLinks();

        // Play selected Spotify playlist
        if (customId === 'mymusic_spotify_select') {
            const value = interaction.values[0];
            const index = parseInt(value.split('_').pop());
            const userLinks = spotifyLinks[userId] || { playlists: [] };
            const playlist = userLinks.playlists?.[index];

            if (!playlist) {
                await interaction.reply({ components: [buildErrorResponse('Error', 'Playlist not found!')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
                return true;
            }

            if (!interaction.member.voice?.channel) {
                await interaction.reply({ components: [buildErrorResponse('Error', 'You need to be in a voice channel!')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
                return true;
            }

            await interaction.deferReply();

            if (!lavalinkManager.useable) {
                return interaction.editReply({ components: [buildErrorResponse('Music Unavailable', 'No music servers are connected right now. Please try again in a moment.')], flags: MessageFlags.IsComponentsV2 });
            }

            let player = lavalinkManager.getPlayer(interaction.guild.id);
            if (!player) {
                player = await lavalinkManager.createPlayer({
                    guildId: interaction.guild.id,
                    voiceChannelId: interaction.member.voice.channel.id,
                    textChannelId: interaction.channel.id,
                    selfDeaf: true,
                    volume: 100
                });
            }

            if (!player.connected) await player.connect();

            try {
                const result = await Promise.race([
                    player.search({ query: playlist.url }, interaction.user),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Search timed out')), 20000))
                ]);
                
                if (!result || result.loadType === 'empty' || result.loadType === 'error') {
                    return interaction.editReply({ components: [buildErrorResponse('Load Failed', 'Could not load that playlist.')], flags: MessageFlags.IsComponentsV2 });
                }

                const tracks = result.tracks || [];
                if (tracks.length === 0) {
                    return interaction.editReply({ components: [buildErrorResponse('Empty Playlist', 'No tracks found in playlist.')], flags: MessageFlags.IsComponentsV2 });
                }

                const wasPlaying = player.playing || player.paused;
                for (const track of tracks) {
                    player.queue.add(track);
                }
                if (!wasPlaying) await player.play();

                const container = new ContainerBuilder()
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(
                            `# <:spotify:1521228327761744043> Playing Playlist\n\n` +
                            `**${playlist.name}**\n\n` +
                            `<:Checkedbox:1521227734943269077> Added **${tracks.length}** tracks to queue`
                        )
                    );

                await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            } catch (error) {
                console.error('Spotify playlist play error:', error);
                await interaction.editReply({ components: [buildErrorResponse('Play Failed', 'Failed to play playlist.')], flags: MessageFlags.IsComponentsV2 });
            }
            return true;
        }

        // Remove selected Spotify playlist
        if (customId === 'mymusic_remove_spotify_select') {
            const value = interaction.values[0];
            const index = parseInt(value.split('_').pop());
            
            if (!spotifyLinks[userId]) spotifyLinks[userId] = { playlists: [] };
            const removed = spotifyLinks[userId].playlists.splice(index, 1)[0];
            saveSpotifyLinks(spotifyLinks);

            const rmContainer = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`# <:Checkedbox:1521227734943269077> Playlist Removed\n\nRemoved playlist: **${removed?.name || 'Unknown'}**`)
                );
            await interaction.update({
                components: [rmContainer],
                flags: MessageFlags.IsComponentsV2
            });
            return true;
        }

        return false;
    },

    async handleModalSubmit(interaction, lavalinkManager) {
        const customId = interaction.customId;
        if (!customId.startsWith('mymusic_modal_')) return false;

        const userId = interaction.user.id;
        const spotifyLinks = loadSpotifyLinks();

        // Add Spotify playlist
        if (customId === 'mymusic_modal_add_spotify') {
            const url = interaction.fields.getTextInputValue('playlist_url').trim();
            let name = interaction.fields.getTextInputValue('playlist_name')?.trim();

            // Validate Spotify URL
            if (!url.includes('spotify.com/playlist/') && !url.includes('spotify:playlist:')) {
                await interaction.reply({ components: [buildErrorResponse('Error', 'Invalid Spotify playlist URL! Please provide a valid Spotify playlist link.')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
                return true;
            }

            if (!spotifyLinks[userId]) spotifyLinks[userId] = { playlists: [] };
            
            if (spotifyLinks[userId].playlists.length >= 10) {
                await interaction.reply({ components: [buildErrorResponse('Error', 'You can only link up to 10 playlists! Remove one first.')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
                return true;
            }

            // Check for duplicate
            if (spotifyLinks[userId].playlists.some(p => p.url === url)) {
                await interaction.reply({ components: [buildErrorResponse('Error', 'This playlist is already linked!')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
                return true;
            }

            // Try to get playlist name from Lavalink if not provided
            if (!name && lavalinkManager) {
                try {
                    const tempPlayer = lavalinkManager.getPlayer(interaction.guild.id);
                    if (tempPlayer) {
                        const result = await tempPlayer.search({ query: url }, interaction.user);
                        if (result.playlist?.name) {
                            name = result.playlist.name;
                        }
                    }
                } catch (e) {
                    // Ignore errors, use default name
                }
            }

            spotifyLinks[userId].playlists.push({
                url,
                name: name || 'My Playlist',
                addedAt: Date.now()
            });
            saveSpotifyLinks(spotifyLinks);

            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# <:Checkedbox:1521227734943269077> Playlist Linked!\n\n` +
                        `**${name || 'My Playlist'}** has been added to your library.\n\n` +
                        `-# Use the Spotify Playlists menu to play it`
                    )
                );

            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            return true;
        }

        // Remove favorite by number
        if (customId === 'mymusic_modal_remove_fav') {
            const numStr = interaction.fields.getTextInputValue('song_number').trim();
            const num = parseInt(numStr);

            if (isNaN(num) || num < 1) {
                await interaction.reply({ components: [buildErrorResponse('Error', 'Please enter a valid song number!')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
                return true;
            }

            const favorites = await models.FavoriteSong.find({ userId });
            if (!favorites || num > favorites.length) {
                await interaction.reply({
                    components: [buildErrorResponse('Not Found', `Song #${num} not found. You have ${favorites?.length || 0} favorites.`)],
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                });
                return true;
            }

            const toRemove = favorites[num - 1];
            await models.FavoriteSong.deleteOne({ _id: toRemove._id });

            const removeFavContainer = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`# <:Checkedbox:1521227734943269077> Song Removed\n\nRemoved **${toRemove.title}** from your favorites!`)
                );
            await interaction.reply({
                components: [removeFavContainer],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
            });
            return true;
        }

        return false;
    }
};
