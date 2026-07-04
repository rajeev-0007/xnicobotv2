const { ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const { buildErrorResponse } = require('../../utils/responseBuilder');

const languages = {
    'en': 'English', 'es': 'Spanish', 'fr': 'French', 'de': 'German',
    'it': 'Italian', 'pt': 'Portuguese', 'ru': 'Russian', 'ja': 'Japanese',
    'ko': 'Korean', 'zh': 'Chinese', 'ar': 'Arabic', 'hi': 'Hindi',
    'tr': 'Turkish', 'nl': 'Dutch', 'pl': 'Polish', 'sv': 'Swedish',
    'bn': 'Bengali', 'ta': 'Tamil', 'te': 'Telugu', 'mr': 'Marathi',
    'gu': 'Gujarati', 'ur': 'Urdu', 'pa': 'Punjabi', 'th': 'Thai',
    'vi': 'Vietnamese', 'id': 'Indonesian', 'uk': 'Ukrainian', 'el': 'Greek'
};

async function translate(text, targetLang) {
    const yandexKey = process.env.YANDEX_API_KEY;

    // Primary: Yandex Translate API
    if (yandexKey) {
        try {
            const res = await fetch(`https://translate.yandex.net/api/v1.5/tr.json/translate?key=${yandexKey}&text=${encodeURIComponent(text)}&lang=${targetLang}`);
            const data = await res.json();
            if (data.code === 200 && data.text?.length) {
                const detectedFrom = data.detected?.lang || data.lang?.split('-')[0] || 'auto';
                return { translated: data.text.join(''), from: detectedFrom, provider: 'Yandex' };
            }
        } catch {}
    }

    // Fallback: Google Translate (free, no key needed)
    const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`);
    const data = await res.json();
    const translated = data[0].map(item => item[0]).join('');
    return { translated, from: data[2] || 'auto', provider: 'Google' };
}

module.exports = {
    prefix: 'translate',
    description: 'Translate text to another language',
    usage: 'translate <language> <text>',
    category: 'utility',
    aliases: ['tr'],

    async executePrefix(message, args) {
        if (args.length < 2) {
            let content = `# <:Bookopen:1521227911137595605> Translate\n\n`;
            content += `**Usage:** \`-translate <lang> <text>\`\n**Example:** \`-translate ja Hello world\`\n\n`;
            content += `### Languages\n`;
            content += `${Object.entries(languages).map(([c, n]) => `\`${c}\` ${n}`).join(' · ')}`;
            return message.reply({ components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(content))], flags: MessageFlags.IsComponentsV2 });
        }

        const targetLang = args[0].toLowerCase();
        const text = args.slice(1).join(' ');

        if (!languages[targetLang]) {
            return message.reply({ components: [buildErrorResponse('Invalid Language', `Use one of: ${Object.keys(languages).join(', ')}`)], flags: MessageFlags.IsComponentsV2 });
        }

        try {
            const { translated, from, provider } = await translate(text, targetLang);

            let content = `# <:Bookopen:1521227911137595605> Translation\n\n`;
            content += `**From:** ${languages[from] || from} → **To:** ${languages[targetLang]}\n\n`;
            content += `### Original\n> ${text}\n\n`;
            content += `### Translation\n> ${translated}`;
            content += `\n\n-# Powered by ${provider} Translate`;

            await message.reply({ components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(content))], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('Translate error:', error);
            await message.reply({ components: [buildErrorResponse('Translation Error', 'Could not translate the text. Please try again later.')], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
