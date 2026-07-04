'use strict';

const {
    SlashCommandBuilder, PermissionFlagsBits, MessageFlags,
    ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
} = require('discord.js');

const PAGE_SIZE = 10;
const ID_PREFIX = 'gsb';

// Populate the soundboard cache across all guilds (cache is not auto-filled).
async function fetchAllSounds(client) {
    const guilds = [...client.guilds.cache.values()];
    await Promise.all(guilds.map(async (guild) => {
        try {
            if (guild.soundboardSounds && (!guild.soundboardSounds.cache || guild.soundboardSounds.cache.size === 0)) {
                await guild.soundboardSounds.fetch();
            }
        } catch { /* missing intent or no sounds */ }
    }));
}

function flattenSounds(client, search) {
    const sounds = [];
    for (const guild of client.guilds.cache.values()) {
        if (!guild.soundboardSounds?.cache) continue;
        for (const sound of guild.soundboardSounds.cache.values()) {
            if (search && !sound.name.toLowerCase().includes(search.toLowerCase())) continue;
            sounds.push({
                id: sound.soundId,
                name: sound.name,
                guildId: guild.id,
                guildName: guild.name,
                volume: sound.volume || 1,
                userId: sound.userId,
                available: true,
            });
        }
    }
    sounds.sort((a, b) => a.name.localeCompare(b.name));
    return sounds;
}

function buildPanel(state) {
    const { items, page, totalPages, search, guildsCount } = state;
    const start = page * PAGE_SIZE;
    const slice = items.slice(start, start + PAGE_SIZE);

    const container = new ContainerBuilder().setAccentColor(0x5865F2);

    // Header
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `# <:Music:1521228141543165982> Global Soundboard\n` +
        `-# **${items.length}** sounds across **${guildsCount}** servers` +
        (search ? ` · Filter: \`${search}\`` : '') +
        ` · Page **${page + 1}/${totalPages}**`
    ));

    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

    // Sound list
    if (slice.length === 0) {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`*No sounds found.*`));
    } else {
        const lines = slice.map((s, i) => {
            const idx = String(start + i + 1).padStart(2, '0');
            return `\`${idx}\` <:Volumeup:1521228004502536272> **${s.name}** — *${s.guildName}*\n> \`${s.id}\` · Vol: ${Math.round(s.volume * 100)}%`;
        });
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n\n')));
    }

    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

    // Navigation
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${ID_PREFIX}_prev`).setLabel('Prev').setStyle(ButtonStyle.Primary).setEmoji('<:Caretleft:1521227977495543838>').setDisabled(page === 0),
        new ButtonBuilder().setCustomId(`${ID_PREFIX}_indicator`).setLabel(`${page + 1} / ${totalPages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId(`${ID_PREFIX}_next`).setLabel('Next').setStyle(ButtonStyle.Primary).setEmoji('<:Caretright:1521227704953864202>').setDisabled(page >= totalPages - 1),
    ));

    // Steal select
    if (slice.length > 0) {
        const select = new StringSelectMenuBuilder()
            .setCustomId(`${ID_PREFIX}_steal`)
            .setPlaceholder('Pick sounds to clone to this server')
            .setMinValues(1)
            .setMaxValues(Math.min(slice.length, 5))
            .addOptions(slice.map((s, i) => ({
                label: s.name.slice(0, 100),
                description: `From ${s.guildName}`.slice(0, 100),
                value: String(start + i),
            })));
        container.addActionRowComponents(new ActionRowBuilder().addComponents(select));
    }

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `-# Select sounds from the dropdown to clone them to this server`
    ));

    return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('globalsoundboard')
        .setDescription('Browse all soundboard sounds across the bot\'s servers')
        .addStringOption(o => o.setName('search').setDescription('Filter by sound name').setRequired(false)),
    prefix: 'globalsoundboard',
    description: 'Browse and steal soundboard sounds from all servers the bot is in',
    usage: 'globalsoundboard [search]',
    aliases: ['gsb', 'globalsounds'],
    category: 'utility',

    async execute(interaction) {
        await interaction.deferReply();
        await fetchAllSounds(interaction.client);
        const search = interaction.options.getString('search') || '';
        const items = flattenSounds(interaction.client, search);
        const guildsCount = new Set(items.map(s => s.guildId)).size;
        const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
        const state = { items, page: 0, totalPages, search, guildsCount };

        const payload = buildPanel(state);
        const panelMsg = await interaction.editReply(payload);
        attachCollector(panelMsg, interaction.user.id, interaction.guild, state);
    },

    async executePrefix(message, args) {
        await fetchAllSounds(message.client);
        const search = args.join(' ') || '';
        const items = flattenSounds(message.client, search);
        const guildsCount = new Set(items.map(s => s.guildId)).size;
        const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
        const state = { items, page: 0, totalPages, search, guildsCount };

        const payload = buildPanel(state);
        const panelMsg = await message.reply(payload);
        attachCollector(panelMsg, message.author.id, message.guild, state);
    },
};

function attachCollector(panelMessage, ownerId, guild, state) {
    const collector = panelMessage.createMessageComponentCollector({
        filter: (i) => i.user.id === ownerId && i.customId.startsWith(`${ID_PREFIX}_`),
        time: 120_000,
    });

    collector.on('collect', async (i) => {
        if (i.customId === `${ID_PREFIX}_prev`) {
            state.page = Math.max(0, state.page - 1);
            await i.update(buildPanel(state)).catch(() => {});
        } else if (i.customId === `${ID_PREFIX}_next`) {
            state.page = Math.min(state.totalPages - 1, state.page + 1);
            await i.update(buildPanel(state)).catch(() => {});
        } else if (i.customId === `${ID_PREFIX}_steal`) {
            if (!i.member?.permissions?.has(PermissionFlagsBits.ManageGuildExpressions)) {
                await i.reply({ content: '<:Cancel:1521227723916181644> You need **Manage Expressions** permission.', flags: MessageFlags.Ephemeral });
                return;
            }

            const indices = i.values.map(v => parseInt(v, 10)).filter(n => !isNaN(n));
            const picks = indices.map(idx => state.items[idx]).filter(Boolean);
            if (picks.length === 0) { await i.deferUpdate(); return; }

            await i.deferUpdate();
            const ok = [], fail = [];

            for (const sound of picks) {
                try {
                    // Fetch original sound data from source guild
                    const sourceGuild = i.client.guilds.cache.get(sound.guildId);
                    if (!sourceGuild) { fail.push({ name: sound.name, reason: 'Source guild unavailable' }); continue; }

                    const sourceSound = sourceGuild.soundboardSounds.cache.get(sound.id);
                    if (!sourceSound) { fail.push({ name: sound.name, reason: 'Sound no longer exists' }); continue; }

                    // Clone to target guild
                    const url = `https://cdn.discordapp.com/soundboard-sounds/${sound.id}`;
                    const response = await require('axios').get(url, { responseType: 'arraybuffer', timeout: 10000 });
                    const buffer = Buffer.from(response.data);

                    await guild.soundboardSounds.create({
                        name: sound.name,
                        sound: buffer,
                        volume: sound.volume,
                        reason: `Cloned from ${sound.guildName} by ${i.user.username}`,
                    });
                    ok.push(sound.name);
                } catch (err) {
                    fail.push({ name: sound.name, reason: err.message?.slice(0, 50) || 'Failed' });
                }
            }

            const resultContainer = new ContainerBuilder().setAccentColor(ok.length > 0 ? 0x57F287 : 0xED4245);
            let resultText = `# <:Music:1521228141543165982> Soundboard Clone Results\n\n`;
            if (ok.length > 0) resultText += `<:Checkedbox:1521227734943269077> **Added:** ${ok.map(n => `\`${n}\``).join(', ')}\n`;
            if (fail.length > 0) resultText += `<:Cancel:1521227723916181644> **Failed:** ${fail.map(f => `\`${f.name}\` (${f.reason})`).join(', ')}\n`;
            resultText += `\n-# ${ok.length} succeeded, ${fail.length} failed`;
            resultContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent(resultText));

            await panelMessage.edit({ components: [resultContainer], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        } else {
            await i.deferUpdate().catch(() => {});
        }
    });

    collector.on('end', async () => {
        try {
            const expired = new ContainerBuilder().setAccentColor(0x95A5A6);
            expired.addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `# <:Clock:1521228110408847623> Session Expired\n-# Run the command again to browse soundboard sounds.`
            ));
            await panelMessage.edit({ components: [expired], flags: MessageFlags.IsComponentsV2 });
        } catch {}
    });
}
