/**
 * TTS Engine — Natural Hindi (Devanagari) & Multi-language Text-to-Speech
 * 
 * Priority: Google Cloud TTS → Azure Speech → Google Translate (fallback)
 * 
 * Google Cloud TTS: hi-IN-Neural2 / hi-IN-Wavenet voices (very natural)
 * Azure Speech: hi-IN-SwaraNeural (female) / hi-IN-MadhurNeural (male)
 * Fallback: Google Translate TTS (robotic but no API key needed)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const jsonStore = require('./jsonStore');
const log = require('./logger-styled');
const TTS_CACHE_DIR = path.join(__dirname, '../.tts-cache');

// Max cache size: 200 files, auto-cleanup oldest
const MAX_CACHE_FILES = 200;

// Voice configurations per provider
const GOOGLE_VOICES = {
    'hi': { female: 'hi-IN-Neural2-A', male: 'hi-IN-Neural2-B', wavenetFemale: 'hi-IN-Wavenet-A', wavenetMale: 'hi-IN-Wavenet-D' },
    'en': { female: 'en-US-Neural2-C', male: 'en-US-Neural2-D' },
    'bn': { female: 'bn-IN-Neural2-A', male: 'bn-IN-Neural2-B' },
    'ta': { female: 'ta-IN-Neural2-A', male: 'ta-IN-Neural2-B' },
    'te': { female: 'te-IN-Standard-A', male: 'te-IN-Standard-B' },
    'mr': { female: 'mr-IN-Neural2-A', male: 'mr-IN-Neural2-B' },
    'gu': { female: 'gu-IN-Neural2-A', male: 'gu-IN-Neural2-B' },
    'kn': { female: 'kn-IN-Neural2-A', male: 'kn-IN-Neural2-B' },
    'ml': { female: 'ml-IN-Neural2-A', male: 'ml-IN-Neural2-B' },
    'pa': { female: 'pa-IN-Neural2-A', male: 'pa-IN-Neural2-B' },
    'ur': { female: 'ur-IN-Standard-A', male: 'ur-IN-Standard-B' },
    'es': { female: 'es-ES-Neural2-A', male: 'es-ES-Neural2-B' },
    'fr': { female: 'fr-FR-Neural2-A', male: 'fr-FR-Neural2-B' },
    'de': { female: 'de-DE-Neural2-A', male: 'de-DE-Neural2-B' },
    'ja': { female: 'ja-JP-Neural2-B', male: 'ja-JP-Neural2-C' },
    'ar': { female: 'ar-XA-Neural2-A', male: 'ar-XA-Neural2-B' },
    'ru': { female: 'ru-RU-Neural2-A', male: 'ru-RU-Neural2-B' },
    'pt': { female: 'pt-BR-Neural2-A', male: 'pt-BR-Neural2-B' },
    'ko': { female: 'ko-KR-Neural2-A', male: 'ko-KR-Neural2-B' },
    'zh-CN': { female: 'cmn-CN-Neural2-A', male: 'cmn-CN-Neural2-B' },
    'tr': { female: 'tr-TR-Neural2-A', male: 'tr-TR-Neural2-B' },
    'id': { female: 'id-ID-Neural2-A', male: 'id-ID-Neural2-B' },
    'th': { female: 'th-TH-Neural2-C', male: 'th-TH-Standard-A' },
    'vi': { female: 'vi-VN-Neural2-A', male: 'vi-VN-Neural2-B' },
    'nl': { female: 'nl-NL-Neural2-A', male: 'nl-NL-Neural2-B' },
    'it': { female: 'it-IT-Neural2-A', male: 'it-IT-Neural2-B' },
    'pl': { female: 'pl-PL-Neural2-A', male: 'pl-PL-Neural2-B' },
    'sv': { female: 'sv-SE-Neural2-A', male: 'sv-SE-Neural2-B' },
    'fil': { female: 'fil-PH-Neural2-A', male: 'fil-PH-Neural2-B' },
};

const AZURE_VOICES = {
    'hi': { female: 'hi-IN-SwaraNeural', male: 'hi-IN-MadhurNeural' },
    'en': { female: 'en-US-JennyNeural', male: 'en-US-GuyNeural' },
    'bn': { female: 'bn-IN-TanishaaNeural', male: 'bn-IN-BashkarNeural' },
    'ta': { female: 'ta-IN-PallaviNeural', male: 'ta-IN-ValluvarNeural' },
    'te': { female: 'te-IN-ShrutiNeural', male: 'te-IN-MohanNeural' },
    'mr': { female: 'mr-IN-AarohiNeural', male: 'mr-IN-ManoharNeural' },
    'gu': { female: 'gu-IN-DhwaniNeural', male: 'gu-IN-NiranjanNeural' },
    'kn': { female: 'kn-IN-SapnaNeural', male: 'kn-IN-GaganNeural' },
    'ml': { female: 'ml-IN-SobhanaNeural', male: 'ml-IN-MidhunNeural' },
    'pa': { female: 'pa-IN-OjasNeural', male: 'pa-IN-OjasNeural' },
    'ur': { female: 'ur-IN-GulNeural', male: 'ur-IN-SalmanNeural' },
    'es': { female: 'es-ES-ElviraNeural', male: 'es-ES-AlvaroNeural' },
    'fr': { female: 'fr-FR-DeniseNeural', male: 'fr-FR-HenriNeural' },
    'de': { female: 'de-DE-KatjaNeural', male: 'de-DE-ConradNeural' },
    'ja': { female: 'ja-JP-NanamiNeural', male: 'ja-JP-KeitaNeural' },
    'ar': { female: 'ar-SA-ZariyahNeural', male: 'ar-SA-HamedNeural' },
    'ru': { female: 'ru-RU-SvetlanaNeural', male: 'ru-RU-DmitryNeural' },
    'pt': { female: 'pt-BR-FranciscaNeural', male: 'pt-BR-AntonioNeural' },
    'ko': { female: 'ko-KR-SunHiNeural', male: 'ko-KR-InJoonNeural' },
    'zh-CN': { female: 'zh-CN-XiaoxiaoNeural', male: 'zh-CN-YunxiNeural' },
    'tr': { female: 'tr-TR-EmelNeural', male: 'tr-TR-AhmetNeural' },
    'id': { female: 'id-ID-GadisNeural', male: 'id-ID-ArdiNeural' },
    'th': { female: 'th-TH-PremwadeeNeural', male: 'th-TH-NiwatNeural' },
    'vi': { female: 'vi-VN-HoaiMyNeural', male: 'vi-VN-NamMinhNeural' },
    'nl': { female: 'nl-NL-ColetteNeural', male: 'nl-NL-MaartenNeural' },
    'it': { female: 'it-IT-ElsaNeural', male: 'it-IT-DiegoNeural' },
    'pl': { female: 'pl-PL-AgnieszkaNeural', male: 'pl-PL-MarekNeural' },
    'sv': { female: 'sv-SE-SofieNeural', male: 'sv-SE-MattiasNeural' },
    'fil': { female: 'fil-PH-BlessicaNeural', male: 'fil-PH-AngeloNeural' },
};

// Ensure cache directory exists
function ensureCacheDir() {
    if (!fs.existsSync(TTS_CACHE_DIR)) {
        fs.mkdirSync(TTS_CACHE_DIR, { recursive: true });
    }
}

// Cleanup old cache files if exceeding limit
function cleanupCache() {
    try {
        const files = fs.readdirSync(TTS_CACHE_DIR)
            .map(f => ({ name: f, time: fs.statSync(path.join(TTS_CACHE_DIR, f)).mtimeMs }))
            .sort((a, b) => a.time - b.time);
        
        while (files.length > MAX_CACHE_FILES) {
            const oldest = files.shift();
            fs.unlinkSync(path.join(TTS_CACHE_DIR, oldest.name));
        }
    } catch (e) {}
}

// Load API keys
function loadApiKeys() {
    try {
        if (jsonStore.has('apikeys')) {
            return jsonStore.read('apikeys');
        }
    } catch (e) {}
    return {};
}

// Get cache file path from text + lang + voice
function getCachePath(text, lang, voice) {
    const hash = crypto.createHash('md5').update(`${text}|${lang}|${voice}`).digest('hex');
    return path.join(TTS_CACHE_DIR, `${hash}.mp3`);
}

/**
 * Generate TTS audio using Google Cloud TTS API (Neural2/Wavenet voices)
 * Returns path to the generated MP3 file, or null on failure
 */
async function googleCloudTTS(text, ttsCode, gender, apiKey) {
    const axios = require('axios');
    
    const voices = GOOGLE_VOICES[ttsCode] || GOOGLE_VOICES['en'];
    const voiceName = gender === 'male' ? (voices.male || voices.female) : (voices.female || voices.male);
    
    // Determine language code from voice name (e.g. "hi-IN-Neural2-A" → "hi-IN")
    const languageCode = voiceName.split('-').slice(0, 2).join('-');
    
    const cachePath = getCachePath(text, ttsCode, `google-${voiceName}`);
    if (fs.existsSync(cachePath)) return cachePath;
    
    try {
        const response = await axios.post(
            `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
            {
                input: { text },
                voice: {
                    languageCode,
                    name: voiceName,
                    ssmlGender: gender === 'male' ? 'MALE' : 'FEMALE'
                },
                audioConfig: {
                    audioEncoding: 'MP3',
                    speakingRate: 1.0,
                    pitch: 0,
                    effectsProfileId: ['headphone-class-device']
                }
            },
            { timeout: 10000 }
        );
        
        if (response.data && response.data.audioContent) {
            ensureCacheDir();
            const audioBuffer = Buffer.from(response.data.audioContent, 'base64');
            fs.writeFileSync(cachePath, audioBuffer);
            cleanupCache();
            return cachePath;
        }
    } catch (error) {
        log.error('Google Cloud TTS error:', error.response?.data?.error?.message || error.message);
    }
    return null;
}

/**
 * Generate TTS audio using Azure Cognitive Services TTS
 * Returns path to the generated MP3 file, or null on failure
 */
async function azureTTS(text, ttsCode, gender, apiKey, region) {
    const axios = require('axios');
    
    const voices = AZURE_VOICES[ttsCode] || AZURE_VOICES['en'];
    const voiceName = gender === 'male' ? (voices.male || voices.female) : (voices.female || voices.male);
    
    const cachePath = getCachePath(text, ttsCode, `azure-${voiceName}`);
    if (fs.existsSync(cachePath)) return cachePath;
    
    try {
        // Get access token first
        const tokenResponse = await axios.post(
            `https://${region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`,
            null,
            {
                headers: { 'Ocp-Apim-Subscription-Key': apiKey },
                timeout: 5000
            }
        );
        
        const accessToken = tokenResponse.data;
        
        // SSML request body for natural speech
        const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${ttsCode === 'hi' ? 'hi-IN' : 'en-US'}">
    <voice name="${voiceName}">
        <prosody rate="0%" pitch="0%">${escapeXml(text)}</prosody>
    </voice>
</speak>`;
        
        const audioResponse = await axios.post(
            `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`,
            ssml,
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/ssml+xml',
                    'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3',
                    'User-Agent': 'NicoBot'
                },
                responseType: 'arraybuffer',
                timeout: 10000
            }
        );
        
        if (audioResponse.data) {
            ensureCacheDir();
            fs.writeFileSync(cachePath, Buffer.from(audioResponse.data));
            cleanupCache();
            return cachePath;
        }
    } catch (error) {
        log.error('Azure TTS error:', error.response?.data ? Buffer.from(error.response.data).toString() : error.message);
    }
    return null;
}

/**
 * Google Translate TTS fallback (robotic but works without API key)
 * Returns a URL that Lavalink can play directly
 */
function googleTranslateTTSUrl(text, ttsCode) {
    return `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=${ttsCode}&client=gtx`;
}

function escapeXml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/**
 * Main TTS function — tries providers in order: Google Cloud → Azure → Google Translate fallback
 * 
 * Returns: { type: 'file' | 'url', path: string, provider: string, voice: string }
 */
async function synthesize(text, ttsCode, gender = 'female') {
    const apiKeys = loadApiKeys();
    
    // 1. Try Google Cloud TTS (best quality)
    const googleConfig = apiKeys.google_tts;
    if (googleConfig && googleConfig.enabled && googleConfig.apiKey) {
        const filePath = await googleCloudTTS(text, ttsCode, gender, googleConfig.apiKey);
        if (filePath) {
            const voices = GOOGLE_VOICES[ttsCode] || GOOGLE_VOICES['en'];
            const voiceName = gender === 'male' ? voices.male : voices.female;
            return { type: 'file', path: filePath, provider: 'Google Cloud Neural', voice: voiceName };
        }
    }
    
    // 2. Try Azure Speech (excellent quality)
    const azureConfig = apiKeys.azure_tts;
    if (azureConfig && azureConfig.enabled && azureConfig.apiKey && azureConfig.region) {
        const filePath = await azureTTS(text, ttsCode, gender, azureConfig.apiKey, azureConfig.region);
        if (filePath) {
            const voices = AZURE_VOICES[ttsCode] || AZURE_VOICES['en'];
            const voiceName = gender === 'male' ? voices.male : voices.female;
            return { type: 'file', path: filePath, provider: 'Azure Neural', voice: voiceName };
        }
    }
    
    // 3. Fallback to Google Translate TTS (works without API key but robotic)
    const url = googleTranslateTTSUrl(text, ttsCode);
    return { type: 'url', path: url, provider: 'Google Translate', voice: 'Standard' };
}

/**
 * Get list of available voice identifiers for a language
 */
function getAvailableVoices(ttsCode) {
    const result = [];
    const apiKeys = loadApiKeys();
    
    if (apiKeys.google_tts?.enabled && apiKeys.google_tts?.apiKey) {
        const gv = GOOGLE_VOICES[ttsCode];
        if (gv) result.push({ provider: 'Google Cloud', female: gv.female, male: gv.male });
    }
    if (apiKeys.azure_tts?.enabled && apiKeys.azure_tts?.apiKey) {
        const av = AZURE_VOICES[ttsCode];
        if (av) result.push({ provider: 'Azure', female: av.female, male: av.male });
    }
    result.push({ provider: 'Google Translate', female: 'Standard', male: 'Standard' });
    return result;
}

/**
 * Check which TTS providers are configured
 */
function getProviderStatus() {
    const apiKeys = loadApiKeys();
    return {
        googleCloud: !!(apiKeys.google_tts?.enabled && apiKeys.google_tts?.apiKey),
        azure: !!(apiKeys.azure_tts?.enabled && apiKeys.azure_tts?.apiKey && apiKeys.azure_tts?.region),
        googleTranslate: true // Always available
    };
}

module.exports = {
    synthesize,
    getAvailableVoices,
    getProviderStatus,
    googleTranslateTTSUrl,
    GOOGLE_VOICES,
    AZURE_VOICES,
    TTS_CACHE_DIR,
    ensureCacheDir
};
