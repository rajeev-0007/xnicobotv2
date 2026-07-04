const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ContainerBuilder,
    SectionBuilder,
    TextDisplayBuilder,
    ThumbnailBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelSelectMenuBuilder,
    ChannelType,
    MessageFlags,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} = require('discord.js');

const jsonStore = require('../../utils/jsonStore');
const log = require('../../utils/logger-styled');

const STORE_KEY = 'suggestions';
const CV2 = MessageFlags.IsComponentsV2;

// ─── Custom emojis ─────────────────────────────────────────────────────────────
const E = {
    bulb: '<:Lightbulbalt:1521227880703463675>',
    check: '<:Checkedbox:1521227734943269077>',
    uncheck: '<:Uncheckbox:1473038543768109076>',
    edit: '<:Edit:1521227886634205298>',
    cancel: '<:Cancel:1521227723916181644>',
    chat: '<:Hashtag:1521227771957870604>',
    user: '<:User:1521227714227343380>',
    clock: '<:Clock:1521228110408847623>',
    sandwatch: '<:Lightning:1521227915537285150>',
    fire: '<:Fire:1521227907647668374>',
    comment: '<:Commentblock:1521227898101432331>',
    info: '<:Inforect:1521228008285929532>',
    envelope: '<:Envelope:1521228013910626426>',
    settings: '<:Settings:1521227767780343879>',
    trash: '<:Trash:1521227750420254820>',
    dislike: '<:Dislike:1521228158471508008>',
    star: '<:Star:1521227981685526568>',
    refresh: '<:Refresh:1521227946441052420>',
    channel: '<:Hashtag:1521227771957870604>',
};

// ─── In-memory cooldown store (per-user, per-guild) ────────────────────────────
const cooldownMap = new Map(); // key: `${guildId}_${userId}` → timestamp
const COOLDOWN_MS = 60_000;    // 60 seconds between submissions

function checkCooldown(guildId, userId) {
    const key = `${guildId}_${userId}`;
    const last = cooldownMap.get(key) ?? 0;
    const remaining = COOLDOWN_MS - (Date.now() - last);
    return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

function setCooldown(guildId, userId) {
    cooldownMap.set(`${guildId}_${userId}`, Date.now());
}

// ─── In-memory pending-confirmation store (5 min TTL) ─────────────────────────
const pendingMap = new Map();

function setPending(tempId, data) {
    pendingMap.set(tempId, { ...data, expiresAt: Date.now() + 5 * 60_000 });
    setTimeout(() => pendingMap.delete(tempId), 5 * 60_000);
}

function getPending(tempId) {
    const entry = pendingMap.get(tempId);
    if (!entry || Date.now() > entry.expiresAt) {
        pendingMap.delete(tempId);
        return null;
    }
    return entry;
}

function makeTempId(guildId, userId) {
    return `${guildId}_${userId}_${Date.now()}`;
}

// ─── Storage helpers ──────────────────────────────────────────────────────────

function loadStore() {
    if (!jsonStore.has(STORE_KEY)) jsonStore.write(STORE_KEY, {});
    const data = jsonStore.read(STORE_KEY);
    return Array.isArray(data) ? {} : data;
}

function saveStore(data) {
    jsonStore.write(STORE_KEY, data);
}

function getGuildData(guildId) {
    const store = loadStore();
    if (!store[guildId]) {
        store[guildId] = {
            channelId: null,
            logsChannelId: null,
            voteThreshold: 10,
            threadSlowmode: 0,
            nextId: 1,
            suggestions: {},
        };
        saveStore(store);
    }
    const g = store[guildId];
    if (!('logsChannelId' in g)) g.logsChannelId = null;
    if (!('voteThreshold' in g)) g.voteThreshold = 10;
    if (!('threadSlowmode' in g)) g.threadSlowmode = 0;
    if (!('nextId' in g)) g.nextId = 1;
    if (!g.suggestions) g.suggestions = {};
    return { store, guildData: g };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function discordTimestamp(date, format = 'R') {
    return `<t:${Math.floor(new Date(date).getTime() / 1000)}:${format}>`;
}

function formatSugId(n) {
    return `#${String(n).padStart(4, '0')}`;
}

// Visual vote progress bar (15 chars wide)
function makeBar(upCount, downCount, width = 15) {
    const total = upCount + downCount;
    if (total === 0) return '░'.repeat(width);
    const filled = Math.round((upCount / total) * width);
    return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function approvalText(upCount, downCount) {
    const total = upCount + downCount;
    if (total === 0) return 'No votes yet';
    const pct = Math.round((upCount / total) * 100);
    return `${makeBar(upCount, downCount)} **${pct}%** approval`;
}

// ─── Card builders ────────────────────────────────────────────────────────────

// Confirmation card shown privately before posting
function buildConfirmCard(tempId, text) {
    const charCount = text.length;
    const preview = text.length > 400 ? text.slice(0, 400) + '…' : text;
    return new ContainerBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `## ${E.comment} Suggestion Preview\n` +
                `-# Review your idea before it goes public`
            )
        )
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `> ${preview.replace(/\n/g, '\n> ')}`
            )
        )
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `-# ${charCount}/1500 characters  •  Expires in 5 minutes\n` +
                `${E.check} **Submit** — post it to the suggestion channel\n` +
                `${E.edit} **Edit** — revise the text before submitting\n` +
                `${E.cancel} **Cancel** — discard this suggestion`
            )
        )
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addActionRowComponents(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`sug_pre_submit_${tempId}`)
                    .setLabel('Submit Suggestion')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji(E.check),
                new ButtonBuilder()
                    .setCustomId(`sug_pre_edit_${tempId}`)
                    .setLabel('Edit')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji(E.edit),
                new ButtonBuilder()
                    .setCustomId(`sug_pre_cancel_${tempId}`)
                    .setLabel('Cancel')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji(E.cancel)
            )
        );
}

// The main public suggestion card with vote buttons
function buildSuggestionCard({ authorUsername, authorId, authorAvatarURL, text, upvotes, downvotes, createdAt, guildId, messageId, suggestionId }) {
    const upCount = upvotes.length;
    const downCount = downvotes.length;
    const idLabel = suggestionId ? `${formatSugId(suggestionId)}  •  ` : '';

    return new ContainerBuilder()
        .addSectionComponents(
            new SectionBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `## ${E.bulb} New Suggestion\n` +
                        `-# ${idLabel}Pending Review`
                    )
                )
                .setThumbnailAccessory(new ThumbnailBuilder().setURL(authorAvatarURL))
        )
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`> ${text.replace(/\n/g, '\n> ')}`)
        )
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `${E.user} **Author:** ${authorUsername}\n` +
                `${E.clock} **Submitted:** ${discordTimestamp(createdAt, 'R')}  (${discordTimestamp(createdAt, 'D')})\n` +
                `-# User ID: ${authorId}`
            )
        )
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `<:transfer:1521228019824590948> **Community Vote**\n` +
                `${approvalText(upCount, downCount)}\n` +
                `-# 👍 ${upCount} upvote${upCount !== 1 ? 's' : ''}  ·  👎 ${downCount} downvote${downCount !== 1 ? 's' : ''}`
            )
        )
        .addActionRowComponents(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`sug_up_${guildId}_${messageId}`)
                    .setLabel(`Upvote · ${upCount}`)
                    .setEmoji('<:Like:1521228164104454175>')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`sug_down_${guildId}_${messageId}`)
                    .setLabel(`Downvote · ${downCount}`)
                    .setEmoji('<:Dislike:1521228158471508008>')
                    .setStyle(ButtonStyle.Secondary)
            )
        );
}

// Card shown after a moderator approves / denies / considers
function buildStatusCard({ authorUsername, authorId, authorAvatarURL, text, status, moderatorTag, upvotes, downvotes, createdAt, suggestionId }) {
    const upCount = upvotes.length;
    const downCount = downvotes.length;
    const idLabel = suggestionId ? `${formatSugId(suggestionId)}  •  ` : '';

    const STATUS = {
        approved: { emoji: E.check, label: 'Approved', accent: 0x57F287 },
        denied: { emoji: E.cancel, label: 'Denied', accent: 0xED4245 },
        considered: { emoji: E.info, label: 'Under Consideration', accent: 0xFEE75C },
    };
    const s = STATUS[status] ?? { emoji: E.sandwatch, label: 'Pending', accent: 0x5865F2 };

    return new ContainerBuilder()
        .setAccentColor(s.accent)
        .addSectionComponents(
            new SectionBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `## ${s.emoji} ${s.label}\n` +
                        `-# ${idLabel}Reviewed by ${moderatorTag}`
                    )
                )
                .setThumbnailAccessory(new ThumbnailBuilder().setURL(authorAvatarURL))
        )
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`> ${text.replace(/\n/g, '\n> ')}`)
        )
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `${E.user} **Author:** ${authorUsername}\n` +
                `${E.clock} **Submitted:** ${discordTimestamp(createdAt, 'D')}\n` +
                `-# User ID: ${authorId}`
            )
        )
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `<:transfer:1521228019824590948> **Final Votes**\n` +
                `${approvalText(upCount, downCount)}\n` +
                `-# 👍 ${upCount}  ·  👎 ${downCount}  ·  Voting closed`
            )
        );
}

// Trending entry sent to logs channel
function buildLogEntry({ authorUsername, authorId, authorAvatarURL, text, upvotes, downvotes, threshold, createdAt, suggestionId }) {
    const upCount = upvotes.length;
    const downCount = downvotes.length;
    const idLabel = suggestionId ? `${formatSugId(suggestionId)}  •  ` : '';

    return new ContainerBuilder()
        .setAccentColor(0xFEE75C)
        .addSectionComponents(
            new SectionBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `## ${E.fire} Trending Suggestion\n` +
                        `-# ${idLabel}Reached vote threshold of ${threshold}`
                    )
                )
                .setThumbnailAccessory(new ThumbnailBuilder().setURL(authorAvatarURL))
        )
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`> ${text.replace(/\n/g, '\n> ')}`)
        )
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `${E.user} **Author:** ${authorUsername}\n` +
                `-# User ID: ${authorId}  •  Submitted: ${discordTimestamp(createdAt, 'D')}`
            )
        )
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `<:transfer:1521228019824590948> **${upCount}** upvotes  ·  **${downCount}** downvotes\n` +
                `${makeBar(upCount, downCount)} **${upCount > 0 ? Math.round((upCount / (upCount + downCount)) * 100) : 0}%** approval`
            )
        );
}

// Thread starter message
function buildThreadWelcome(suggestionId) {
    const idPart = suggestionId ? ` for Suggestion ${formatSugId(suggestionId)}` : '';
    return new ContainerBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `${E.chat} **Discussion Thread${idPart}**\n` +
                `Share your thoughts on this suggestion. Keep it constructive and respectful!\n` +
                `-# Use 👍/👎 buttons on the suggestion card to cast your vote.`
            )
        );
}

// Setup configuration panel
function buildSetupPanel(guildId) {
    const { guildData } = getGuildData(guildId);
    const ch = guildData.channelId ? `<#${guildData.channelId}>` : '`Not configured`';
    const logs = guildData.logsChannelId ? `<#${guildData.logsChannelId}>` : '`Not configured`';
    const threshold = guildData.voteThreshold ?? 10;
    const slowmode = guildData.threadSlowmode ?? 0;
    const totalSuggestions = Object.keys(guildData.suggestions || {}).length;
    const pending = Object.values(guildData.suggestions || {}).filter(s => s.status === 'pending').length;

    return new ContainerBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `## ${E.settings} Suggestion System\n` +
                `-# Configure the suggestion system for this server`
            )
        )
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `${E.channel} **Suggestion Channel:** ${ch}\n` +
                `${E.envelope} **Logs Channel:** ${logs}\n` +
                `${E.sandwatch} **Vote Threshold:** ${threshold} upvotes\n` +
                `${E.clock} **Thread Slowmode:** ${slowmode === 0 ? 'Off' : slowmode + 's'}`
            )
        )
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `${E.comment} **Total Suggestions:** ${totalSuggestions}  •  **Pending:** ${pending}\n` +
                `-# Members submit via \`/suggestion suggest\` or by typing in the suggestion channel`
            )
        )
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addActionRowComponents(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('sug_setup_channel').setLabel('Set Channel').setStyle(ButtonStyle.Primary).setEmoji('<:Bullhorn:1521227936575914016>'),
                new ButtonBuilder().setCustomId('sug_setup_logs').setLabel('Set Logs').setStyle(ButtonStyle.Secondary).setEmoji('<:Document:1521227875016114266>'),
                new ButtonBuilder().setCustomId('sug_setup_threshold').setLabel('Vote Threshold').setStyle(ButtonStyle.Secondary).setEmoji('<:Lightning:1521227915537285150>'),
                new ButtonBuilder().setCustomId('sug_setup_slowmode').setLabel('Thread Slowmode').setStyle(ButtonStyle.Secondary).setEmoji(E.clock)
            )
        )
        .addActionRowComponents(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('sug_setup_remove').setLabel('Remove Setup').setStyle(ButtonStyle.Danger).setEmoji(E.cancel)
            )
        );
}

// "Submitted" state card replacing the confirmation
function buildSubmittedCard(text, channelId) {
    const preview = text.length > 200 ? text.slice(0, 200) + '…' : text;
    return new ContainerBuilder()
        .setAccentColor(0x57F287)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `## ${E.check} Suggestion Submitted!\n\n` +
                `> ${preview}\n\n` +
                `Your suggestion is now live in <#${channelId}>. Community members can vote on it!\n` +
                `-# This message will disappear shortly.`
            )
        );
}

function buildCancelledCard() {
    return new ContainerBuilder()
        .setAccentColor(0xED4245)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `## ${E.cancel} Suggestion Cancelled\n` +
                `Your suggestion was discarded and not posted.\n` +
                `-# This message will disappear shortly.`
            )
        );
}

// DM card sent to author when their suggestion is reviewed
function buildDmCard({ text, status, moderatorTag, upvotes, downvotes, guildName, suggestionId }) {
    const upCount = upvotes.length;
    const downCount = downvotes.length;
    const idLabel = suggestionId ? `${formatSugId(suggestionId)}  •  ` : '';
    const STATUS = {
        approved: { emoji: E.check, label: 'Approved', accent: 0x57F287, msg: 'Great news! Your suggestion was **approved**.' },
        denied: { emoji: E.cancel, label: 'Denied', accent: 0xED4245, msg: 'Your suggestion was **denied** by the moderation team.' },
        considered: { emoji: E.info, label: 'Under Consideration', accent: 0xFEE75C, msg: 'Your suggestion is **under consideration** by the team.' },
    };
    const s = STATUS[status] ?? { emoji: E.sandwatch, label: 'Updated', accent: 0x5865F2, msg: 'Your suggestion status has been updated.' };

    return new ContainerBuilder()
        .setAccentColor(s.accent)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `## ${s.emoji} Suggestion ${s.label}\n` +
                `-# ${idLabel}${guildName}`
            )
        )
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `${s.msg}\n\n` +
                `**Your Suggestion:**\n> ${text.length > 200 ? text.slice(0, 200) + '…' : text}`
            )
        )
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `<:transfer:1521228019824590948> **${upCount}** upvote${upCount !== 1 ? 's' : ''}  ·  **${downCount}** downvote${downCount !== 1 ? 's' : ''}\n` +
                `-# Reviewed by ${moderatorTag}`
            )
        );
}

// ─── Core logic ───────────────────────────────────────────────────────────────

async function postSuggestion(guildId, author, text, client) {
    const { store, guildData } = getGuildData(guildId);

    if (!guildData.channelId) {
        return { error: `${E.cancel} No suggestion channel configured. An admin must run \`/suggestion setup\` first.` };
    }

    const channel = await client.channels.fetch(guildData.channelId).catch(() => null);
    if (!channel) {
        return { error: `${E.cancel} The configured suggestion channel no longer exists. Ask an admin to run \`/suggestion setup\` again.` };
    }

    const avatarURL = author.displayAvatarURL?.({ size: 128 }) ?? author.defaultAvatarURL;
    const createdAt = new Date().toISOString();
    const suggestionId = guildData.nextId ?? 1;
    guildData.nextId = suggestionId + 1;

    const cardData = {
        authorUsername: author.username ?? author.tag,
        authorId: author.id,
        authorAvatarURL: avatarURL,
        text,
        upvotes: [],
        downvotes: [],
        createdAt,
        guildId,
        messageId: 'TEMP',
        suggestionId,
    };

    const msg = await channel.send({ components: [buildSuggestionCard(cardData)], flags: CV2 });
    cardData.messageId = msg.id;
    await msg.edit({ components: [buildSuggestionCard(cardData)], flags: CV2 });

    // Discussion thread
    if (channel.permissionsFor(client.user)?.has(PermissionFlagsBits.CreatePublicThreads)) {
        const thread = await msg.startThread({
            name: `Suggestion ${formatSugId(suggestionId)} — Discussion`,
            autoArchiveDuration: 1440,
            reason: `Suggestion ${formatSugId(suggestionId)} submitted`,
            rateLimitPerUser: guildData.threadSlowmode ?? 0,
        }).catch(() => null);
        if (thread) {
            await thread.send({ components: [buildThreadWelcome(suggestionId)], flags: CV2 }).catch(() => null);
        }
    }

    guildData.suggestions[msg.id] = {
        authorId: author.id,
        authorUsername: author.username ?? author.tag,
        authorAvatarURL: avatarURL,
        text,
        status: 'pending',
        upvotes: [],
        downvotes: [],
        logged: false,
        createdAt,
        suggestionId,
    };
    store[guildId] = guildData;
    saveStore(store);

    // Apply submission cooldown
    setCooldown(guildId, author.id);

    return { success: true, channelId: guildData.channelId, suggestionId };
}

async function castVote(guildId, messageId, userId, isUpvote, client) {
    const { store, guildData } = getGuildData(guildId);
    const suggestion = guildData.suggestions?.[messageId];

    if (!suggestion) return { error: 'Suggestion not found — it may have been deleted.' };
    if (suggestion.status !== 'pending') return { alreadyModerated: true };

    // Prevent author from voting on their own suggestion
    if (suggestion.authorId === userId) {
        return { ownSuggestion: true };
    }

    if (suggestion.upvotes.includes(userId) || suggestion.downvotes.includes(userId)) {
        return { alreadyVoted: true };
    }

    if (isUpvote) suggestion.upvotes.push(userId);
    else suggestion.downvotes.push(userId);

    store[guildId] = guildData;
    saveStore(store);

    const cardData = {
        authorUsername: suggestion.authorUsername,
        authorId: suggestion.authorId,
        authorAvatarURL: suggestion.authorAvatarURL,
        text: suggestion.text,
        upvotes: suggestion.upvotes,
        downvotes: suggestion.downvotes,
        createdAt: suggestion.createdAt,
        guildId,
        messageId,
        suggestionId: suggestion.suggestionId,
    };

    // Log to logs channel if threshold crossed
    if (
        isUpvote &&
        !suggestion.logged &&
        guildData.logsChannelId &&
        guildData.voteThreshold &&
        suggestion.upvotes.length >= guildData.voteThreshold
    ) {
        suggestion.logged = true;
        store[guildId] = guildData;
        saveStore(store);

        const logsChannel = await client.channels.fetch(guildData.logsChannelId).catch(() => null);
        if (logsChannel) {
            await logsChannel.send({
                components: [buildLogEntry({ ...cardData, threshold: guildData.voteThreshold })],
                flags: CV2,
            }).catch(err => log.error('Suggestion log entry failed:', err));
        }
    }

    return { container: buildSuggestionCard(cardData) };
}

async function moderateSuggestion(guildId, messageId, moderatorTag, status, client) {
    const { store, guildData } = getGuildData(guildId);
    const suggestion = guildData.suggestions?.[messageId];

    if (!suggestion) return { error: `No suggestion found with message ID \`${messageId}\`.` };

    suggestion.status = status;
    store[guildId] = guildData;
    saveStore(store);

    const cardData = {
        authorUsername: suggestion.authorUsername,
        authorId: suggestion.authorId,
        authorAvatarURL: suggestion.authorAvatarURL,
        text: suggestion.text,
        status,
        moderatorTag,
        upvotes: suggestion.upvotes,
        downvotes: suggestion.downvotes,
        createdAt: suggestion.createdAt,
        suggestionId: suggestion.suggestionId,
    };

    if (!guildData.channelId) return { error: 'No suggestion channel configured.' };
    const channel = await client.channels.fetch(guildData.channelId).catch(() => null);
    if (!channel) return { error: 'Suggestion channel not found.' };

    const msg = await channel.messages.fetch(messageId).catch(() => null);
    if (!msg) return { error: 'Suggestion message not found — it may have been deleted.' };

    await msg.edit({ components: [buildStatusCard(cardData)], flags: CV2 });

    // DM the suggestion author
    try {
        const guild = await client.guilds.fetch(guildId).catch(() => null);
        const guildName = guild?.name ?? 'the server';
        const authorUser = await client.users.fetch(suggestion.authorId).catch(() => null);
        if (authorUser) {
            await authorUser.send({
                components: [buildDmCard({ ...cardData, guildName })],
                flags: CV2,
            }).catch(() => null); // DMs may be closed — silently ignore
        }
    } catch (_) { }

    return { success: true };
}

// ─── Setup button/select handlers ─────────────────────────────────────────────

async function handleSetupButton(interaction) {
    const { customId } = interaction;
    const guildId = interaction.guildId;

    if (!interaction.member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({
            content: `${E.cancel} You need **Manage Server** permission to configure the suggestion system.`,
            flags: MessageFlags.Ephemeral,
        });
    }

    if (customId === 'sug_setup_channel') {
        return interaction.reply({
            components: [new ActionRowBuilder().addComponents(
                new ChannelSelectMenuBuilder()
                    .setCustomId('sug_select_channel')
                    .setPlaceholder('Select the suggestions channel')
                    .addChannelTypes(ChannelType.GuildText)
                    .setMinValues(1).setMaxValues(1)
            )],
            flags: MessageFlags.Ephemeral,
        });
    }

    if (customId === 'sug_setup_logs') {
        return interaction.reply({
            components: [new ActionRowBuilder().addComponents(
                new ChannelSelectMenuBuilder()
                    .setCustomId('sug_select_logs')
                    .setPlaceholder('Select the logs channel (optional)')
                    .addChannelTypes(ChannelType.GuildText)
                    .setMinValues(1).setMaxValues(1)
            )],
            flags: MessageFlags.Ephemeral,
        });
    }

    if (customId === 'sug_setup_threshold') {
        const options = [5, 10, 15, 20, 25, 30, 50, 100].map(n =>
            new StringSelectMenuOptionBuilder().setLabel(`${n} upvotes`).setValue(String(n))
        );
        return interaction.reply({
            components: [new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId('sug_select_threshold').setPlaceholder('Select vote threshold').addOptions(options)
            )],
            flags: MessageFlags.Ephemeral,
        });
    }

    if (customId === 'sug_setup_slowmode') {
        const opts = [
            { label: 'No slowmode', value: '0' },
            { label: '5 seconds', value: '5' },
            { label: '10 seconds', value: '10' },
            { label: '30 seconds', value: '30' },
            { label: '1 minute', value: '60' },
            { label: '5 minutes', value: '300' },
            { label: '10 minutes', value: '600' },
        ].map(o => new StringSelectMenuOptionBuilder().setLabel(o.label).setValue(o.value));
        return interaction.reply({
            components: [new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId('sug_select_slowmode').setPlaceholder('Select thread slowmode').addOptions(opts)
            )],
            flags: MessageFlags.Ephemeral,
        });
    }

    if (customId === 'sug_setup_remove') {
        const { store, guildData } = getGuildData(guildId);
        guildData.channelId = null;
        guildData.logsChannelId = null;
        store[guildId] = guildData;
        saveStore(store);
        await interaction.reply({ content: `${E.check} Suggestion system configuration removed.`, flags: MessageFlags.Ephemeral });
        try { await interaction.message.edit({ components: [buildSetupPanel(guildId)], flags: CV2 }); } catch (_) { }
        return;
    }
}

async function handleSetupSelect(interaction) {
    const { customId } = interaction;
    const guildId = interaction.guildId;
    const { store, guildData } = getGuildData(guildId);

    if (customId === 'sug_select_channel') {
        const channelId = interaction.values[0];
        guildData.channelId = channelId;
        store[guildId] = guildData;
        saveStore(store);
        await interaction.update({ content: `${E.check} Suggestion channel set to <#${channelId}>.`, components: [] });
        return true;
    }
    if (customId === 'sug_select_logs') {
        const channelId = interaction.values[0];
        guildData.logsChannelId = channelId;
        store[guildId] = guildData;
        saveStore(store);
        await interaction.update({ content: `${E.check} Logs channel set to <#${channelId}>.`, components: [] });
        return true;
    }
    if (customId === 'sug_select_threshold') {
        const threshold = parseInt(interaction.values[0]);
        guildData.voteThreshold = threshold;
        store[guildId] = guildData;
        saveStore(store);
        await interaction.update({ content: `${E.check} Vote threshold set to **${threshold}** upvotes.`, components: [] });
        return true;
    }
    if (customId === 'sug_select_slowmode') {
        const slowmode = parseInt(interaction.values[0]);
        guildData.threadSlowmode = slowmode;
        store[guildId] = guildData;
        saveStore(store);
        const label = slowmode === 0 ? 'disabled' : `${slowmode}s`;
        await interaction.update({ content: `${E.check} Thread slowmode set to **${label}**.`, components: [] });
        return true;
    }
    return false;
}

// ─── Confirmation button & modal handlers ─────────────────────────────────────

async function handleConfirmButton(interaction, tempId, action) {
    const pending = getPending(tempId);

    if (!pending) {
        return interaction.reply({
            content: `${E.cancel} This confirmation has **expired** (5 min limit). Please submit your suggestion again.`,
            flags: MessageFlags.Ephemeral,
        });
    }
    if (interaction.user.id !== pending.userId) {
        return interaction.reply({
            content: `${E.cancel} Only the person who submitted this suggestion can use these buttons.`,
            flags: MessageFlags.Ephemeral,
        });
    }

    if (action === 'submit') {
        await interaction.deferUpdate();
        const result = await postSuggestion(pending.guildId, interaction.user, pending.text, interaction.client);
        pendingMap.delete(tempId);

        if (result.error) {
            await interaction.message.edit({ components: [buildCancelledCard()], flags: CV2 }).catch(() => null);
            await interaction.followUp({ content: result.error, flags: MessageFlags.Ephemeral }).catch(() => null);
            setTimeout(() => interaction.message.delete().catch(() => null), 6000);
            return;
        }

        await interaction.message.edit({
            components: [buildSubmittedCard(pending.text, result.channelId)],
            flags: CV2,
        }).catch(() => null);
        setTimeout(() => interaction.message.delete().catch(() => null), 8000);
        return;
    }

    if (action === 'cancel') {
        await interaction.deferUpdate();
        pendingMap.delete(tempId);
        await interaction.message.edit({ components: [buildCancelledCard()], flags: CV2 }).catch(() => null);
        setTimeout(() => interaction.message.delete().catch(() => null), 5000);
        return;
    }

    if (action === 'edit') {
        const modal = new ModalBuilder()
            .setCustomId(`sug_edit_modal_${tempId}`)
            .setTitle('Edit Your Suggestion')
            .addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('sug_edit_text')
                        .setLabel('Your Suggestion')
                        .setStyle(TextInputStyle.Paragraph)
                        .setValue(pending.text)
                        .setMaxLength(1500)
                        .setRequired(true)
                        .setPlaceholder('Write your improved suggestion here…')
                )
            );
        await interaction.showModal(modal);
        return;
    }
}

async function handleEditModal(interaction, tempId) {
    const pending = getPending(tempId);
    if (!pending) {
        return interaction.reply({
            content: `${E.cancel} This confirmation has **expired**. Please submit your suggestion again.`,
            flags: MessageFlags.Ephemeral,
        });
    }
    if (interaction.user.id !== pending.userId) {
        return interaction.reply({ content: `${E.cancel} Only the original author can edit this suggestion.`, flags: MessageFlags.Ephemeral });
    }

    const newText = interaction.fields.getTextInputValue('sug_edit_text')?.trim();
    if (!newText) {
        return interaction.reply({ content: `${E.cancel} Suggestion text cannot be empty.`, flags: MessageFlags.Ephemeral });
    }

    pending.text = newText;
    pendingMap.set(tempId, { ...pending, expiresAt: Date.now() + 5 * 60_000 });

    await interaction.deferUpdate().catch(() => null);
    try {
        await interaction.message.edit({ components: [buildConfirmCard(tempId, newText)], flags: CV2 });
    } catch (_) {
        await interaction.followUp({
            content: `${E.check} Text updated! Review the preview and click **Submit Suggestion** when ready.`,
            flags: MessageFlags.Ephemeral,
        }).catch(() => null);
    }
}

// ─── Module export ────────────────────────────────────────────────────────────

module.exports = {
    /**
     * Premium-gated feature. `premiumOnly` is read by the
     * command dispatcher in index.js — non-premium users get a
     * polite message instead of execution.
     */
    premiumOnly: true,

    name: 'suggestion',
    prefix: 'suggest',
    aliases: [],
    category: 'automation',
    description: 'Professional suggestion system — numbered IDs, vote bars, threads, moderation, and DM notifications',
    usage: '/suggestion suggest <text>  |  /suggestion setup  |  /suggestion moderate <msgId> <approved|denied|considered>',
    permissions: [],

    data: new SlashCommandBuilder()
        .setName('suggestion')
        .setDescription('Suggestion system')
        .addSubcommand(sub =>
            sub.setName('suggest')
                .setDescription('Submit a suggestion to the server')
                .addStringOption(opt =>
                    opt.setName('text')
                        .setDescription('Your suggestion (up to 1500 characters)')
                        .setRequired(true)
                        .setMaxLength(1500)
                )
        )
        .addSubcommand(sub =>
            sub.setName('setup')
                .setDescription('Open the suggestion system setup panel (Manage Server)')
        )
        .addSubcommand(sub =>
            sub.setName('moderate')
                .setDescription('Approve, deny, or mark a suggestion as under consideration (Manage Messages)')
                .addStringOption(opt =>
                    opt.setName('message_id')
                        .setDescription('The message ID of the suggestion')
                        .setRequired(true)
                )
                .addStringOption(opt =>
                    opt.setName('status')
                        .setDescription('New status')
                        .setRequired(true)
                        .addChoices(
                            { name: '<:Checkedbox:1521227734943269077> Approve', value: 'approved' },
                            { name: '<:Cancel:1521227723916181644> Deny', value: 'denied' },
                            { name: '🤔 Under Consideration', value: 'considered' }
                        )
                )
        ),

    // ── Slash command handler ─────────────────────────────────────────────────
    async execute(interaction) {
        const sub = interaction.options.getSubcommand();

        if (sub === 'suggest') {
            const cd = checkCooldown(interaction.guildId, interaction.user.id);
            if (cd > 0) {
                return interaction.reply({
                    content: `${E.clock} Please wait **${cd}s** before submitting another suggestion.`,
                    flags: MessageFlags.Ephemeral,
                });
            }
            const text = interaction.options.getString('text', true).trim();
            const tempId = makeTempId(interaction.guildId, interaction.user.id);
            setPending(tempId, { guildId: interaction.guildId, userId: interaction.user.id, text });
            return interaction.reply({ components: [buildConfirmCard(tempId, text)], flags: CV2 | MessageFlags.Ephemeral });
        }

        if (sub === 'setup') {
            if (!interaction.member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
                return interaction.reply({ content: `${E.cancel} You need **Manage Server** permission to use this.`, flags: MessageFlags.Ephemeral });
            }
            return interaction.reply({ components: [buildSetupPanel(interaction.guildId)], flags: CV2 | MessageFlags.Ephemeral });
        }

        if (sub === 'moderate') {
            if (!interaction.member?.permissions.has(PermissionFlagsBits.ManageMessages)) {
                return interaction.reply({ content: `${E.cancel} You need **Manage Messages** permission to moderate suggestions.`, flags: MessageFlags.Ephemeral });
            }
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const messageId = interaction.options.getString('message_id', true).trim();
            const status = interaction.options.getString('status', true);
            const result = await moderateSuggestion(interaction.guildId, messageId, interaction.user.username, status, interaction.client);
            if (result.error) return interaction.editReply({ content: `${E.cancel} ${result.error}` });
            const labels = { approved: `Approved ${E.check}`, denied: `Denied ${E.cancel}`, considered: `Under Consideration ${E.info}` };
            return interaction.editReply({ content: `Suggestion **${labels[status]}** — the author has been notified.` });
        }
    },

    // ── Prefix command handler ─────────────────────────────────────────────────
    async executePrefix(message, args) {
        if (!message.guild) return message.reply(`${E.cancel} This command can only be used in a server.`);

        const sub = args[0]?.toLowerCase();

        if (sub === 'setup') {
            if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
                return message.reply(`${E.cancel} You need **Manage Server** permission to run suggestion setup.`);
            }
            return message.reply({ components: [buildSetupPanel(message.guildId)], flags: CV2 });
        }

        if (sub === 'moderate' || sub === 'mod') {
            if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
                return message.reply(`${E.cancel} You need **Manage Messages** permission.`);
            }
            const messageId = args[1]?.trim();
            const status = args[2]?.toLowerCase();
            if (!messageId || !['approved', 'denied', 'considered'].includes(status)) {
                return message.reply(`${E.cancel} Usage: \`suggest moderate <messageId> <approved|denied|considered>\``);
            }
            const result = await moderateSuggestion(message.guildId, messageId, message.author.username, status, message.client);
            if (result.error) return message.reply(`${E.cancel} ${result.error}`);
            const labels = { approved: `Approved ${E.check}`, denied: `Denied ${E.cancel}`, considered: `Under Consideration ${E.info}` };
            return message.reply(`${E.check} Suggestion **${labels[status]}** — the author has been notified.`);
        }

        const cd = checkCooldown(message.guildId, message.author.id);
        if (cd > 0) return message.reply(`${E.clock} Please wait **${cd}s** before submitting another suggestion.`);

        const text = args.join(' ').trim();
        if (!text) {
            return message.reply(
                `${E.cancel} Provide suggestion text after the command.\n` +
                '**Usage:** `suggest <text>` · `suggest setup` · `suggest moderate <id> <approved|denied|considered>`'
            );
        }
        const result = await postSuggestion(message.guildId, message.author, text, message.client);
        if (result.error) return message.reply(result.error);

        if (message.channel.permissionsFor(message.client.user)?.has(PermissionFlagsBits.ManageMessages)) {
            message.delete().catch(() => null);
        }
        const confirm = await message.channel.send(
            `${E.check} ${message.author}, your suggestion ${formatSugId(result.suggestionId)} has been posted to <#${result.channelId}>!`
        ).catch(() => null);
        if (confirm) setTimeout(() => confirm.delete().catch(() => null), 6000);
    },

    // ── Message handler — user typed in the suggestion channel ────────────────
    async handleMessage(message) {
        if (!message.guild || message.author.bot) return false;

        // Lightweight pre-check: skip everything when this guild has no
        // suggestion channel configured. Avoids both unnecessary work AND
        // the side-effect of `getGuildData` seeding an empty record for
        // every guild that ever sends a message.
        const store = loadStore();
        const cfg = store?.[message.guildId];
        if (!cfg?.channelId || message.channel.id !== cfg.channelId) return false;

        // Server premium re-validation — if premium expired, stop the
        // message-listener flow. The user's plain message would still
        // be deleted to honour the channel's "no chatter" contract,
        // but no suggestion gets created.
        const premiumManager = require('../../utils/premiumManager');
        if (!premiumManager.hasPremiumAccess(message.author.id, message.guildId)) {
            try {
                await message.delete();
                log.info(`[auto-delete:suggestion:no-premium] guild=${message.guildId} channel=#${message.channel.name || message.channel.id} user=${message.author.tag}`);
            } catch (err) {
                log.warning(`[auto-delete:suggestion:no-premium] FAILED guild=${message.guildId} channel=#${message.channel.name || message.channel.id} user=${message.author.tag} — ${err?.code || ''} ${err.message}`);
            }
            return true;
        }

        // Now safe to call getGuildData — guild already has the channel set.
        const { guildData } = getGuildData(message.guildId);

        const text = message.content?.trim();
        try {
            await message.delete();
            log.info(`[auto-delete:suggestion:plain-message] guild=${message.guildId} channel=#${message.channel.name || message.channel.id} user=${message.author.tag} content="${(message.content || '').slice(0, 80).replace(/\n/g, ' ')}"`);
        } catch (err) {
            log.warning(`[auto-delete:suggestion:plain-message] FAILED guild=${message.guildId} channel=#${message.channel.name || message.channel.id} user=${message.author.tag} — ${err?.code || ''} ${err.message}`);
        }
        if (!text) return true;

        // Cooldown check
        const cd = checkCooldown(message.guildId, message.author.id);
        if (cd > 0) {
            const notice = await message.channel.send(
                `${E.clock} <@${message.author.id}>, please wait **${cd}s** before submitting another suggestion.`
            ).catch(() => null);
            if (notice) setTimeout(() => notice.delete().catch(() => null), 5000);
            return true;
        }

        const tempId = makeTempId(message.guildId, message.author.id);
        setPending(tempId, { guildId: message.guildId, userId: message.author.id, text });

        const confirmMsg = await message.channel.send({
            components: [
                new ContainerBuilder()
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(
                            `${E.bulb} <@${message.author.id}> — your message was captured! Review and submit your suggestion below.\n` +
                            `-# This preview will auto-expire in 5 minutes.`
                        )
                    ),
                buildConfirmCard(tempId, text),
            ],
            flags: CV2,
        }).catch(() => null);

        if (confirmMsg) {
            setTimeout(() => {
                confirmMsg.delete().catch(() => null);
                pendingMap.delete(tempId);
            }, 5 * 60_000);
        }
        return true;
    },

    // ── Interaction router ────────────────────────────────────────────────────
    async handleInteraction(interaction) {
        // Re-validate premium on every component press — the system is
        // premium-gated at the command level, but stray panel buttons
        // / modals / selects route by customId prefix and need their
        // own check.
        const { requirePremium } = require('../../utils/interactionGuards');
        if (await requirePremium(interaction, { commandName: '/suggestion' })) return true;

        const { customId } = interaction;

        // Pre-submit confirmation buttons
        if (customId?.startsWith('sug_pre_')) {
            const withoutPrefix = customId.slice('sug_pre_'.length);
            const firstUnderscore = withoutPrefix.indexOf('_');
            if (firstUnderscore === -1) return false;
            const action = withoutPrefix.slice(0, firstUnderscore);
            const tempId = withoutPrefix.slice(firstUnderscore + 1);
            await handleConfirmButton(interaction, tempId, action);
            return true;
        }

        // Edit modal submission
        if (customId?.startsWith('sug_edit_modal_')) {
            const tempId = customId.slice('sug_edit_modal_'.length);
            await handleEditModal(interaction, tempId);
            return true;
        }

        // Vote buttons
        if (customId.startsWith('sug_up_') || customId.startsWith('sug_down_')) {
            const parts = customId.split('_');
            if (parts.length < 4) return false;
            const isUpvote = parts[1] === 'up';
            const guildId = parts[2];
            const messageId = parts[3];

            await interaction.deferUpdate();
            const result = await castVote(guildId, messageId, interaction.user.id, isUpvote, interaction.client);

            if (result.ownSuggestion) {
                await interaction.followUp({ content: `${E.cancel} You can't vote on your own suggestion.`, flags: MessageFlags.Ephemeral }).catch(() => null);
                return true;
            }
            if (result.alreadyVoted) {
                await interaction.followUp({ content: `${E.info} You've already voted on this suggestion.`, flags: MessageFlags.Ephemeral }).catch(() => null);
                return true;
            }
            if (result.alreadyModerated) {
                await interaction.followUp({ content: `${E.sandwatch} This suggestion has been reviewed — voting is closed.`, flags: MessageFlags.Ephemeral }).catch(() => null);
                return true;
            }
            if (result.error) {
                await interaction.followUp({ content: `${E.cancel} ${result.error}`, flags: MessageFlags.Ephemeral }).catch(() => null);
                return true;
            }
            await interaction.message.edit({ components: [result.container], flags: CV2 }).catch(err =>
                log.error('Suggestion vote edit failed:', err)
            );
            return true;
        }

        // Setup panel buttons
        if (customId.startsWith('sug_setup_')) {
            await handleSetupButton(interaction);
            return true;
        }

        // Setup select menus
        if (customId.startsWith('sug_select_')) {
            const handled = await handleSetupSelect(interaction);
            return handled;
        }

        return false;
    },
};
