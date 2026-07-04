/**
 * /vcstatus — Set or clear the Voice Channel Status line.
 *
 * Two modes:
 *   - Permanent: bot re-applies the status when Discord clears it (VC empties)
 *   - Temporary: one-time, Discord clears it naturally
 *
 * When run via prefix without --perm/--temp flag, shows interactive
 * buttons so the user can choose the mode professionally.
 */

'use strict';

const {
    SlashCommandBuilder, MessageFlags, PermissionFlagsBits, ChannelType,
    ContainerBuilder, TextDisplayBuilder, ActionRowBuilder, ButtonBuilder,
    ButtonStyle, SeparatorBuilder, SeparatorSpacingSize
} = require('discord.js');
const {
    buildErrorResponse, buildSuccessResponse, buildInvalidUsage
} = require('../../utils/responseBuilder');
const jsonStore = require('../../utils/jsonStore');
const { buildSafeListText } = require('../../utils/componentHelpers');

const MAX_STATUS_LENGTH = 500;
const STORE_NAME = 'vcstatus-persist';

const SET_VOICE_CHANNEL_STATUS_BIT =
    PermissionFlagsBits.SetVoiceChannelStatus ?? (1n << 48n);

function hasPermission(member) {
    if (!member?.permissions) return false;
    if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
    try { if (member.permissions.has(SET_VOICE_CHANNEL_STATUS_BIT)) return true; } catch {}
    return member.permissions.has(PermissionFlagsBits.ManageChannels);
}

function isVoiceLike(channel) {
    return channel && (
        channel.type === ChannelType.GuildVoice ||
        channel.type === ChannelType.GuildStageVoice
    );
}

// ── Persistence ──────────────────────────────────────────────────────────

function loadPersist() {
    return jsonStore.peek(STORE_NAME) || {};
}

function savePersistEntry(channelId, entry) {
    const data = jsonStore.read(STORE_NAME) || {};
    if (entry === null) delete data[channelId];
    else data[channelId] = entry;
    jsonStore.write(STORE_NAME, data);
}

async function applyStatus(client, channelId, status) {
    await client.rest.put(`/channels/${channelId}/voice-status`, {
        body: { status: status === null ? null : String(status).slice(0, MAX_STATUS_LENGTH) }
    });
}

async function reapplyPersistentStatus(client, channelId) {
    const persist = loadPersist();
    const entry = persist[channelId];
    if (!entry?.status) return;
    try {
        await applyStatus(client, channelId, entry.status);
    } catch {
        savePersistEntry(channelId, null);
    }
}

// ── Apply + save ─────────────────────────────────────────────────────────

async function doApply(client, channel, statusText, permanent, member) {
    const clearing = !statusText || statusText === '' || /^clear$/i.test(statusText.trim());

    await applyStatus(client, channel.id, clearing ? null : statusText);

    if (clearing) {
        savePersistEntry(channel.id, null);
    } else if (permanent) {
        savePersistEntry(channel.id, { status: statusText.slice(0, MAX_STATUS_LENGTH), setBy: member.id, guildId: member.guild.id });
    } else {
        savePersistEntry(channel.id, null);
    }

    return clearing;
}

function buildResultContainer(clearing, statusText, channel, permanent, username) {
    const container = buildSuccessResponse(
        clearing ? 'Status Cleared' : 'Status Updated',
        clearing
            ? `Cleared the status of **${channel.name}**.`
            : `Updated the status of **${channel.name}**.`,
        {
            'Channel': `<#${channel.id}>`,
            'Status': clearing ? 'None' : statusText.slice(0, 80),
            'Mode': clearing ? 'Cleared' : (permanent ? '<:Lock:1521227892770734120> Permanent' : '<:Clock:1521228110408847623> Temporary'),
            'Set By': username
        }
    );
    container.setAccentColor(clearing ? 0xCAD7E6 : (permanent ? 0x57F287 : 0xFEE75C));
    return container;
}

// ── Interactive mode selector (prefix) ───────────────────────────────────

async function showModeSelector(message, channel, statusText) {
    const container = new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `# <:Volumeup:1521228004502536272> Voice Status Setup\n\n` +
            `**Channel:** <#${channel.id}>\n` +
            `**Status:** \`${statusText.slice(0, 80)}\`\n\n` +
            `Choose how this status should behave:`
        ))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `<:Lock:1521227892770734120> **Permanent** — Stays even when the VC is empty. Bot re-applies it automatically.\n\n` +
            `<:Clock:1521228110408847623> **Temporary** — Clears automatically when all users leave the VC.`
        ))
        .addActionRowComponents(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`vcstatus_perm_${channel.id}`)
                    .setLabel('Permanent')
                    .setEmoji('<:Lock:1521227892770734120>')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`vcstatus_temp_${channel.id}`)
                    .setLabel('Temporary')
                    .setEmoji('<:Clock:1521228110408847623>')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId(`vcstatus_cancel_${channel.id}`)
                    .setLabel('Cancel')
                    .setEmoji('<:Cancel:1521227723916181644>')
                    .setStyle(ButtonStyle.Secondary)
            )
        );

    const msg = await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });

    // Collect button response
    const filter = i => i.user.id === message.author.id && i.customId.startsWith('vcstatus_');
    const collected = await msg.awaitMessageComponent({ filter, time: 30000 }).catch(() => null);

    if (!collected) {
        const expired = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `<:Clock:1521228110408847623> **Timed Out** — Voice status setup cancelled.`
            ));
        return msg.edit({ components: [expired], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
    }

    const action = collected.customId.split('_')[1]; // perm, temp, or cancel

    if (action === 'cancel') {
        const cancelled = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `<:Cancel:1521227723916181644> **Cancelled** — No changes made.`
            ));
        return collected.update({ components: [cancelled], flags: MessageFlags.IsComponentsV2 });
    }

    const permanent = action === 'perm';

    try {
        const clearing = await doApply(message.client, channel, statusText, permanent, message.member);
        const result = buildResultContainer(clearing, statusText, channel, permanent, message.author.username);
        await collected.update({ components: [result], flags: MessageFlags.IsComponentsV2 });
    } catch (err) {
        const reason = err?.rawError?.message || err?.message || 'Unknown error';
        const errContainer = buildErrorResponse('Failed', `Could not update voice status: ${reason}`);
        await collected.update({ components: [errContainer], flags: MessageFlags.IsComponentsV2 });
    }
}

// ── Command module ───────────────────────────────────────────────────────

module.exports = {
    name: 'vcstatus',
    prefix: 'vcstatus',
    description: 'Set or clear the status of a voice channel (permanent or temporary)',
    usage: 'vcstatus <status text|clear> [#channel]',
    category: 'voice',
    aliases: ['voicestatus', 'setstatus', 'vst'],
    permissions: ['SetVoiceChannelStatus'],

    data: new SlashCommandBuilder()
        .setName('vcstatus')
        .setDescription('Set or clear the status of a voice channel')
        .addStringOption(o => o
            .setName('status')
            .setDescription('Status text (or "clear" to remove)')
            .setMaxLength(MAX_STATUS_LENGTH)
            .setRequired(true))
        .addStringOption(o => o
            .setName('mode')
            .setDescription('Permanent stays when VC empties, Temporary clears automatically')
            .addChoices(
                { name: '🔒 Permanent — stays always', value: 'permanent' },
                { name: '⏱️ Temporary — clears when empty', value: 'temporary' }
            )
            .setRequired(false))
        .addChannelOption(o => o
            .setName('channel')
            .setDescription('Voice channel (defaults to your current VC)')
            .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
            .setRequired(false)),

    async execute(interaction) {
        const status = interaction.options.getString('status');
        const mode = interaction.options.getString('mode') || 'permanent';
        const channel = interaction.options.getChannel('channel') || interaction.member?.voice?.channel || null;

        if (!hasPermission(interaction.member)) {
            return interaction.reply({
                components: [buildErrorResponse('Missing Permission', 'You need **Set Voice Channel Status** or **Manage Channels** permission.')],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
            });
        }

        if (!isVoiceLike(channel)) {
            return interaction.reply({
                components: [buildErrorResponse('No Voice Channel', 'Mention a voice channel or join one.')],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
            });
        }

        const permanent = mode === 'permanent';

        try {
            const clearing = await doApply(interaction.client, channel, status, permanent, interaction.member);
            const container = buildResultContainer(clearing, status, channel, permanent, interaction.user.username);
            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (err) {
            const reason = err?.rawError?.message || err?.message || 'Unknown error';
            await interaction.reply({
                components: [buildErrorResponse('Failed', `Could not update voice status: ${reason}`)],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
            });
        }
    },

    async executePrefix(message, args) {
        if (!hasPermission(message.member)) {
            return message.reply({
                components: [buildErrorResponse('Missing Permission', 'You need **Set Voice Channel Status** or **Manage Channels** permission.')],
                flags: MessageFlags.IsComponentsV2
            });
        }

        if (!args.length) {
            // Show active persistent statuses
            const persist = loadPersist();
            const guildEntries = Object.entries(persist).filter(([, e]) => e.guildId === message.guild.id);

            if (guildEntries.length === 0) {
                return message.reply({
                    components: [buildInvalidUsage(
                        'vcstatus',
                        'vcstatus <status|clear> [#channel]',
                        ['vcstatus <:Music:1521228141543165982> Music Session', 'vcstatus <:Volumeup:1521228004502536272> Hangout', 'vcstatus clear #voice-chat']
                    )],
                    flags: MessageFlags.IsComponentsV2
                });
            }

            const lineEntries = guildEntries.map(([chId, entry]) =>
                `> <#${chId}> — \`${entry.status}\` <:Lock:1521227892770734120>`
            );
            const { content: listText } = buildSafeListText({
                header: '# <:Volumeup:1521228004502536272> Active Voice Statuses',
                lines: lineEntries,
                separator: '\n',
                footer: '\n-# <:Lock:1521227892770734120> = Permanent · Use `vcstatus clear #channel` to remove',
                overflowHint: '\n-# +${n} more not shown — clear some channels to see them',
            });

            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(listText));
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        // Check for explicit --perm/--temp flags
        let explicitMode = null;
        const filteredArgs = args.filter(a => {
            if (a === '--perm' || a === '--permanent' || a === '-p') { explicitMode = 'perm'; return false; }
            if (a === '--temp' || a === '--temporary' || a === '-t') { explicitMode = 'temp'; return false; }
            return true;
        });

        // Resolve channel
        const mentioned = message.mentions.channels.first();
        let channel, statusText;

        if (mentioned && isVoiceLike(mentioned)) {
            channel = mentioned;
            statusText = filteredArgs.filter(a => !/^<#\d+>$/.test(a)).join(' ').trim();
        } else {
            channel = message.member?.voice?.channel || null;
            statusText = filteredArgs.join(' ').trim();
        }

        if (!isVoiceLike(channel)) {
            return message.reply({
                components: [buildErrorResponse('No Voice Channel', 'Mention a voice channel or join one.')],
                flags: MessageFlags.IsComponentsV2
            });
        }

        // If clearing, do it immediately (no mode needed)
        if (/^clear$/i.test(statusText.trim())) {
            try {
                await doApply(message.client, channel, null, false, message.member);
                const container = buildResultContainer(true, null, channel, false, message.author.username);
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            } catch (err) {
                const reason = err?.rawError?.message || err?.message || 'Unknown error';
                return message.reply({
                    components: [buildErrorResponse('Failed', `Could not clear status: ${reason}`)],
                    flags: MessageFlags.IsComponentsV2
                });
            }
        }

        // If explicit flag provided, apply directly
        if (explicitMode) {
            const permanent = explicitMode === 'perm';
            try {
                const clearing = await doApply(message.client, channel, statusText, permanent, message.member);
                const container = buildResultContainer(clearing, statusText, channel, permanent, message.author.username);
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            } catch (err) {
                const reason = err?.rawError?.message || err?.message || 'Unknown error';
                return message.reply({
                    components: [buildErrorResponse('Failed', `Could not update status: ${reason}`)],
                    flags: MessageFlags.IsComponentsV2
                });
            }
        }

        // No explicit flag — show interactive mode selector buttons
        return showModeSelector(message, channel, statusText);
    },

    // Exported for voiceStateUpdate handler
    reapplyPersistentStatus,
    applyStatus
};
