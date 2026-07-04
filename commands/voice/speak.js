const { ContainerBuilder, TextDisplayBuilder, MessageFlags, SeparatorBuilder, SeparatorSpacingSize } = require('discord.js');
const { buildErrorResponse, buildSuccessResponse } = require('../../utils/responseBuilder');
const log = require('../../utils/logger-styled');

const jsonStore = require('../../utils/jsonStore');
const LANG_MAP = {
    'en':       { tts: 'en', label: 'English' },
    'english':  { tts: 'en', label: 'English' },
    'hi':       { tts: 'hi', label: 'Hindi' },
    'hindi':    { tts: 'hi', label: 'Hindi' },
    'hinglish': { tts: 'hi', label: 'Hinglish' },
    'hi-en':    { tts: 'hi', label: 'Hinglish' },
    'hien':     { tts: 'hi', label: 'Hinglish' },
    'bn':       { tts: 'bn', label: 'Bengali' },
    'bengali':  { tts: 'bn', label: 'Bengali' },
    'ta':       { tts: 'ta', label: 'Tamil' },
    'tamil':    { tts: 'ta', label: 'Tamil' },
    'te':       { tts: 'te', label: 'Telugu' },
    'telugu':   { tts: 'te', label: 'Telugu' },
    'mr':       { tts: 'mr', label: 'Marathi' },
    'marathi':  { tts: 'mr', label: 'Marathi' },
    'gu':       { tts: 'gu', label: 'Gujarati' },
    'gujarati': { tts: 'gu', label: 'Gujarati' },
    'kn':       { tts: 'kn', label: 'Kannada' },
    'kannada':  { tts: 'kn', label: 'Kannada' },
    'ml':       { tts: 'ml', label: 'Malayalam' },
    'pa':       { tts: 'pa', label: 'Punjabi' },
    'punjabi':  { tts: 'pa', label: 'Punjabi' },
    'ur':       { tts: 'ur', label: 'Urdu' },
    'urdu':     { tts: 'ur', label: 'Urdu' },
    'es':       { tts: 'es', label: 'Spanish' },
    'fr':       { tts: 'fr', label: 'French' },
    'de':       { tts: 'de', label: 'German' },
    'ja':       { tts: 'ja', label: 'Japanese' },
    'ar':       { tts: 'ar', label: 'Arabic' },
    'ru':       { tts: 'ru', label: 'Russian' },
    'pt':       { tts: 'pt', label: 'Portuguese' },
    'ko':       { tts: 'ko', label: 'Korean' },
    'zh':       { tts: 'zh-CN', label: 'Chinese' },
    'tr':       { tts: 'tr', label: 'Turkish' },
    'id':       { tts: 'id', label: 'Indonesian' },
    'th':       { tts: 'th', label: 'Thai' },
    'vi':       { tts: 'vi', label: 'Vietnamese' },
    'nl':       { tts: 'nl', label: 'Dutch' },
    'it':       { tts: 'it', label: 'Italian' },
    'pl':       { tts: 'pl', label: 'Polish' },
    'sv':       { tts: 'sv', label: 'Swedish' },
    'fil':      { tts: 'fil', label: 'Filipino' } };

function readGuildSpeakConfig(guildId) {
    try {
        if (!jsonStore.has('guilds')) return { lang: 'hi', gender: 'female' };
        const guilds = jsonStore.read('guilds');
        const guild = guilds.find(g => g.guild_id === guildId);
        return {
            lang: guild?.speak?.default_lang || 'hi',
            gender: guild?.speak?.voice_gender || 'female'
        };
    } catch {
        return { lang: 'hi', gender: 'female' };
    }
}

/**
 * Try to play a TTS URL through Lavalink with multiple search strategies
 */
async function playTTS(player, ttsUrl, user) {
    // Strategy 1: Direct URL query
    try {
        const res = await player.search({ query: ttsUrl }, user);
        if (res.tracks?.length) {
            const track = res.tracks[0];
            track.isSpeakCmd = true;
            await player.queue.add(track);
            if (!player.playing && !player.paused) await player.play();
            return true;
        }
    } catch (e) {
        log.warn(`[speak] strategy 1 failed: ${e.message}`);
    }

    // Strategy 2: With explicit http source
    try {
        const res = await player.search({ query: ttsUrl, source: 'http' }, user);
        if (res.tracks?.length) {
            const track = res.tracks[0];
            track.isSpeakCmd = true;
            await player.queue.add(track);
            if (!player.playing && !player.paused) await player.play();
            return true;
        }
    } catch (e) {
        log.warn(`[speak] strategy 2 failed: ${e.message}`);
    }

    return false;
}

module.exports = {
    name: 'speak',
    prefix: 'speak',
    description: 'Text-to-speech in voice channel',
    usage: 'speak [lang:]<text>',
    category: 'voice',
    aliases: ['tts', 'say'],
    LANG_MAP,

    async executePrefix(message, args) {
        const voiceChannel = message.member.voice.channel;
        if (!voiceChannel) {
            const container = buildErrorResponse('Not in Voice', 'You need to be in a voice channel to use this command.');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const { lang: defaultLang } = readGuildSpeakConfig(message.guild.id);

        let lang = defaultLang;
        let text = args.join(' ');

        if (args[0] && args[0].includes(':')) {
            const colonIdx = args[0].indexOf(':');
            const possibleLang = args[0].substring(0, colonIdx).toLowerCase();
            if (LANG_MAP[possibleLang]) {
                lang = possibleLang;
                text = [args[0].substring(colonIdx + 1), ...args.slice(1)].join(' ');
            }
        }

        if (!text) {
            let content = `# <:Volumeup:1521228004502536272> Speak Command\n\n`;
            content += `-# Google Translate voice active\n\n`;
            content += `**Usage:**\n`;
            content += `> \`-speak <text>\` — Speaks in default language (\`${defaultLang}\`)\n`;
            content += `> \`-speak <lang>:<text>\` — Speaks in specific language\n\n`;
            content += `### <:Bookopen:1521227911137595605> Indian Languages\n`;
            content += `\`hi\` Hindi · \`bn\` Bengali · \`ta\` Tamil · \`te\` Telugu\n`;
            content += `\`mr\` Marathi · \`gu\` Gujarati · \`kn\` Kannada · \`pa\` Punjabi · \`ur\` Urdu · \`ml\` Malayalam\n\n`;
            content += `### <:Document:1521227875016114266> International\n`;
            content += `\`en\` English · \`es\` Spanish · \`fr\` French · \`de\` German\n`;
            content += `\`ja\` Japanese · \`ar\` Arabic · \`ru\` Russian · \`pt\` Portuguese\n`;
            content += `\`ko\` Korean · \`zh\` Chinese · \`tr\` Turkish · \`it\` Italian\n\n`;
            content += `### <:Settings:1521227767780343879> Settings\n`;
            content += `\`-speak-config <lang>\` — Set default language\n`;
            content += `\`-speak-config voice male/female\` — Set voice gender`;

            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
;
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const langEntry = LANG_MAP[lang] || LANG_MAP[defaultLang] || { tts: 'en', label: 'English' };
        const ttsCode = langEntry.tts;
        const langLabel = langEntry.label;

        // Truncate text to 200 chars for TTS URL limits
        const ttsText = text.substring(0, 200);

        try {
            const player = message.client.lavalinkManager.createPlayer({
                guildId: message.guild.id,
                voiceChannelId: voiceChannel.id,
                textChannelId: message.channel.id,
                selfDeaf: true,
                volume: 100
            });

            if (!player.connected) await player.connect();

            let played = false;
            let provider = 'Google Translate';

            // 1. Try Google Translate TTS with client=gtx (multi-language, works with remote Lavalink)
            const googleUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${ttsCode}&client=gtx&q=${encodeURIComponent(ttsText)}`;
            played = await playTTS(player, googleUrl, message.author);

            // 2. Fallback: StreamElements TTS (English only, very reliable with Lavalink)
            if (!played) {
                const seUrl = `https://api.streamelements.com/kappa/v2/speech?voice=Brian&text=${encodeURIComponent(ttsText)}`;
                played = await playTTS(player, seUrl, message.author);
                if (played) provider = 'StreamElements';
            }

            if (!played) {
                const container = buildErrorResponse(
                    'TTS Failed',
                    'Could not play text-to-speech audio.',
                    'The Lavalink server may not support HTTP audio sources. Contact the bot admin.'
                );
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            const container = buildSuccessResponse(
                'Now Speaking',
                `Speaking in **${langLabel}** (\`${lang}\`)`,
                `**Text:** ${text.substring(0, 100)}${text.length > 100 ? '...' : ''}\n-# Provider: ${provider}`
            );
            message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            log.error(`[speak] Failed: ${error.message}`);
            const container = buildErrorResponse('Speak Error', 'Failed to play text-to-speech.', error.message?.substring(0, 200));
            message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
