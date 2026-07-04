const {
    ChannelType,
    PermissionFlagsBits,
    MessageFlags,
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    SlashCommandBuilder,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder
} = require('discord.js');
const {
    DEFAULT_MAX_MINUTES,
    RECORDING_MODES,
    formatRecordingStatus,
    getRecording,
    recordingAudioPayload,
    recordingSummaryPayload,
    startRecording,
    stopRecording,
} = require('../../utils/recordings');
const {
    parsePositiveInt,
    requireGuild,
    requireUserPermission,
} = require('../../utils/moderationChecks');

const MAX_RECORDING_MINUTES = 180;

module.exports = {
    name: 'record',
    prefix: 'record',
    description: 'Record a voice channel',
    usage: 'record <start|stop|status> [options]',
    category: 'voice',
    aliases: ['rec', 'voicerecord', 'vrec'],
    permissions: ['ManageGuild'],
    data: new SlashCommandBuilder()
        .setName('record')
        .setDescription('Record a voice channel')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand((subcommand) =>
            subcommand
                .setName('start')
                .setDescription('Start recording your current voice channel')
                .addChannelOption((option) =>
                    option
                        .setName('channel')
                        .setDescription('Voice channel to record. Defaults to your current channel.')
                        .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
                )
                .addIntegerOption((option) =>
                    option
                        .setName('minutes')
                        .setDescription('Auto-stop after this many minutes.')
                        .setMinValue(1)
                        .setMaxValue(MAX_RECORDING_MINUTES)
                )
                .addStringOption((option) =>
                    option
                        .setName('mode')
                        .setDescription('Choose one mixed file or separate speaker tracks.')
                        .addChoices(
                            { name: 'Global mix', value: RECORDING_MODES.GLOBAL },
                            { name: 'Separate tracks', value: RECORDING_MODES.SEPARATE }
                        )
                )
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName('stop')
                .setDescription('Stop the active recording and upload tracks')
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName('status')
                .setDescription('Show the active recording status')
        ),

    async executePrefix(message, args) {
        await runRecord(message, message.client, (args[0] || 'status').toLowerCase(), true);
    },

    async execute(interaction) {
        await runRecord(interaction, interaction.client, interaction.options.getSubcommand(), false);
    }
};

async function runRecord(target, client, subcommand, isPrefix) {
    const guild = target.guild || target.message?.guild;
    const user = target.user || target.author;

    // Permission checks
    const blocked = requireGuild(target)
        || requireUserPermission(target, PermissionFlagsBits.ManageGuild, 'Manage Server');

    if (blocked) {
        const container = new ContainerBuilder()
            .setAccentColor(0xED4245)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `# Permission Required\n\n` +
                `${blocked}`
            ))
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `-# You need **Manage Server** permission to use voice recording.`
            ));

        if (isPrefix) {
            return target.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
        return target.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    }

    if (['start', 'join', 'begin'].includes(subcommand)) {
        return startRecordCommand(target, client, isPrefix);
    }

    if (['stop', 'leave', 'end'].includes(subcommand)) {
        return stopRecordCommand(target, isPrefix);
    }

    if (['status', 'info'].includes(subcommand)) {
        return showRecordingStatus(target, isPrefix);
    }

    // Invalid subcommand
    const container = new ContainerBuilder()
        .setAccentColor(0xFEE75C)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `# Invalid Subcommand\n\n` +
            `Please use one of the available recording commands.`
        ))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `### Available Commands\n` +
            `• \`/record start\` or \`-record start\` — Start recording voice channel\n` +
            `• \`/record stop\` or \`-record stop\` — Stop recording and upload files\n` +
            `• \`/record status\` or \`-record status\` — View current recording status`
        ));

    if (isPrefix) {
        return target.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
    return target.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
}

async function showRecordingStatus(target, isPrefix) {
    const guild = target.guild || target.message?.guild;
    const user = target.user || target.author;
    const session = getRecording(guild.id);

    const container = new ContainerBuilder()
        .setAccentColor(session ? 0x57F287 : 0x99AAB5)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            session
                ? `# 🎙️ Recording In Progress\n\n` +
                `A voice recording session is currently active in this server.`
                : `# Voice Recording Status\n\n` +
                `No recording is currently running in this server.`
        ));

    if (session) {
        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `### Session Details\n` +
            `**Voice Channel:** <#${session.channelId}>\n` +
            `**Recording Mode:** ${session.mode === RECORDING_MODES.GLOBAL ? 'Global Mix' : 'Separate Tracks'}\n` +
            `**Started By:** <@${session.actorId}>\n` +
            `**Started:** <t:${Math.floor(session.startedAt.getTime() / 1000)}:R>\n` +
            `**Auto-Stop:** ${session.maxMinutes} minute(s)\n` +
            `**Active Tracks:** ${session.participants.size} speaker(s)`
        ));

        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

        const stopButton = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`record_stop_${guild.id}_${user.id}`)
                .setLabel('Stop Recording')
                .setEmoji('⏹️')
                .setStyle(ButtonStyle.Danger)
        );

        container.addActionRowComponents(stopButton);
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `-# Use \`/record stop\` or click the button above to stop and save the recording.`
        ));
    } else {
        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `### How to Start Recording\n` +
            `• Join a voice channel\n` +
            `• Use \`/record start\` or \`-record start\`\n` +
            `• Choose between global mix or separate tracks\n` +
            `• Set auto-stop duration (default: 60 minutes)\n\n` +
            `-# Recordings are automatically deleted after 24 hours.`
        ));
    }

    if (isPrefix) {
        return target.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
    return target.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
}

async function startRecordCommand(target, client, isPrefix) {
    const guild = target.guild || target.message?.guild;
    const user = target.user || target.author;
    const voiceChannel = getVoiceChannelOption(target, isPrefix);
    const maxMinutes = getMinutesOption(target, isPrefix);
    const mode = getModeOption(target, isPrefix);

    const result = await startRecording({
        actor: user,
        client,
        guild,
        maxMinutes,
        mode,
        textChannel: target.channel || target.message?.channel,
        voiceChannel,
    });

    const container = new ContainerBuilder()
        .setAccentColor(result.ok ? 0x57F287 : 0xED4245)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            result.ok
                ? `# 🎙️ Recording Started\n\n` +
                `Voice recording has been initiated successfully.`
                : `# Recording Failed\n\n` +
                `Unable to start voice recording.`
        ));

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

    if (result.ok) {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `### Configuration\n` +
            `**Voice Channel:** ${voiceChannel}\n` +
            `**Mode:** ${mode === RECORDING_MODES.GLOBAL ? 'Global Mix (everyone in one file)' : 'Separate Tracks (each speaker gets their own file)'}\n` +
            `**Auto-Stop:** ${maxMinutes} minute(s)\n` +
            `**Status:** Recording all voice activity\n\n` +
            `### Next Steps\n` +
            `• Speak in the voice channel to be recorded\n` +
            `• Use \`/record stop\` when finished\n` +
            `• Recording will auto-stop after ${maxMinutes} minute(s)\n` +
            `• Files will be uploaded when you stop`
        ));
    } else {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `**Error:** ${result.message}\n\n` +
            `### Common Issues\n` +
            `• Make sure you're in a voice channel\n` +
            `• Check if a recording is already running (\`/record status\`)\n` +
            `• Verify the bot has proper voice permissions\n` +
            `• Ensure the voice channel is accessible`
        ));
    }

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `-# Recordings are automatically deleted after 24 hours.`
    ));

    if (isPrefix) {
        return target.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
    return target.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
}

async function stopRecordCommand(target, isPrefix) {
    const guild = target.guild || target.message?.guild;
    const user = target.user || target.author;

    // Defer if interaction
    if (!isPrefix && !target.deferred && !target.replied) {
        await target.deferReply().catch(() => null);
    }

    const result = await stopRecording(guild.id, { reason: 'manual stop' });

    if (!result.ok) {
        const container = new ContainerBuilder()
            .setAccentColor(0xFEE75C)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `# No Recording Found\n\n` +
                `${result.message}`
            ))
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `-# Use \`/record status\` to check if a recording is active.`
            ));

        if (isPrefix) {
            return target.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (target.deferred) {
            return target.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
        return target.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    }

    return sendRecordingResult(target, result, user, isPrefix);
}

function getVoiceChannelOption(target, isPrefix) {
    if (!isPrefix) {
        return target.options?.getChannel('channel')
            || target.member?.voice?.channel
            || null;
    }

    // Prefix command parsing
    const member = target.member;
    const args = target.content?.split(' ').slice(1) || [];
    const explicit = args
        .slice(1)
        .map((arg) => resolveVoiceChannel(target, arg))
        .find(Boolean);

    return explicit || member?.voice?.channel || null;
}

function getMinutesOption(target, isPrefix) {
    if (!isPrefix) {
        return target.options?.getInteger('minutes') || DEFAULT_MAX_MINUTES;
    }

    const args = target.content?.split(' ').slice(1) || [];
    const raw = args.slice(1).find((arg) => /^\d+$/.test(arg));
    return parsePositiveInt(raw, DEFAULT_MAX_MINUTES, 1, MAX_RECORDING_MINUTES);
}

function getModeOption(target, isPrefix) {
    if (!isPrefix) {
        return target.options?.getString('mode') || RECORDING_MODES.SEPARATE;
    }

    const args = target.content?.split(' ').slice(1) || [];
    const values = args.slice(1).map((arg) => arg.toLowerCase());
    if (values.some((value) => ['global', 'mix', 'mixed', 'single', 'one'].includes(value))) {
        return RECORDING_MODES.GLOBAL;
    }

    return RECORDING_MODES.SEPARATE;
}

function resolveVoiceChannel(target, input) {
    if (!input) return null;

    const id = input.match(/^<#(\d{17,20})>$/)?.[1] || (/^\d{17,20}$/.test(input) ? input : null);
    if (id) {
        const channel = target.guild.channels.cache.get(id);
        return channel?.isVoiceBased?.() ? channel : null;
    }

    const name = input.replace(/^#/, '').toLowerCase();
    return target.guild.channels.cache.find((channel) =>
        channel.isVoiceBased?.()
        && [ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(channel.type)
        && channel.name.toLowerCase() === name
    ) || null;
}

async function sendRecordingResult(target, result, user, isPrefix) {
    const { omitted, uploadable } = getUploadPlan(result);

    // Create summary container
    const container = new ContainerBuilder()
        .setAccentColor(0x57F287)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `# 🎙️ Recording Stopped\n\n` +
            `Voice recording has been stopped and processed.`
        ));

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

    const sessionInfo = [
        `**Mode:** ${result.session?.mode === RECORDING_MODES.GLOBAL ? 'Global Mix' : 'Separate Tracks'}`,
        `**Reason:** ${result.reason || 'manual stop'}`,
        result.durationMs ? `**Duration:** ${formatDuration(result.durationMs)}` : null,
        `**Tracks Recorded:** ${result.files?.length || 0}`,
    ].filter(Boolean).join('\n');

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(sessionInfo));

    if (result.files?.length > 0) {
        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

        const uploadInfo = [];
        if (uploadable.length > 0) {
            uploadInfo.push(`<:Checkedbox:1521227734943269077> **${uploadable.length}** audio file(s) will be posted below`);
        }
        if (omitted.length > 0) {
            uploadInfo.push(`⚠️ **${omitted.length}** file(s) were too large to upload (over 24MB limit)`);
        }

        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(uploadInfo.join('\n')));

        // Add track list
        if (result.files.length <= 10) {
            container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
            const trackList = result.files.map((file, index) => {
                const skipped = file.invalidPackets ? ` (skipped ${file.invalidPackets} bad packets)` : '';
                const speakers = file.speakerCount ? ` • ${file.speakerCount} speakers` : '';
                return `${index + 1}. **${file.displayName}** — ${formatBytes(file.size)}${speakers}${skipped}`;
            }).join('\n');

            container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `### Recorded Tracks\n${trackList}`
            ));
        }
    } else {
        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `⚠️ **No voice was captured**\n\nSomeone needs to speak in the voice channel after recording starts for audio to be captured.`
        ));
    }

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `-# Recordings are automatically deleted after 24 hours.`
    ));

    // Send summary
    if (isPrefix) {
        await target.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    } else if (target.deferred) {
        await target.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    } else {
        await target.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    // Send audio files if available
    const audioPayload = recordingAudioPayload(result);
    if (audioPayload) {
        const channel = target.channel || target.message?.channel;
        if (channel) {
            await channel.send(audioPayload).catch((error) => {
                console.warn('[Record] Could not send audio files:', error?.message || error);
            });
        }
    }
}

function getUploadPlan(result) {
    const MAX_UPLOAD_BYTES = 24 * 1024 * 1024;
    const MAX_UPLOAD_FILES = 10;
    const uploadable = [];
    const omitted = [];
    let uploadBytes = 0;

    for (const file of result.files || []) {
        const nextBytes = uploadBytes + file.size;
        if (
            uploadable.length < MAX_UPLOAD_FILES
            && file.size <= MAX_UPLOAD_BYTES
            && nextBytes <= MAX_UPLOAD_BYTES
        ) {
            uploadable.push(file);
            uploadBytes = nextBytes;
        } else {
            omitted.push(file);
        }
    }

    return { omitted, uploadable };
}

function formatDuration(ms) {
    const totalSeconds = Math.max(0, Math.round(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
        return `${hours}h ${minutes}m ${seconds}s`;
    }
    return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
