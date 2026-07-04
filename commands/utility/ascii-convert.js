const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ascii-convert')
        .setDescription('Convert text to/from ASCII codes')
        .addStringOption(o => o.setName('text').setDescription('Text to convert').setRequired(true))
        .addStringOption(o => o.setName('mode').setDescription('Conversion mode').addChoices({ name: 'Text to ASCII', value: 'encode' }, { name: 'ASCII to Text', value: 'decode' })),

    async execute(interaction) {
        const text = interaction.options.getString('text');
        const mode = interaction.options.getString('mode') || 'encode';
        let result = mode === 'encode' ? text.split('').map(c => c.charCodeAt(0)).join(' ') : text.split(' ').map(a => String.fromCharCode(parseInt(a))).join('');
        await interaction.reply({ content: `**Result:**\n${result}` });
    },

    async executePrefix(message, args) {
        if (args.length === 0) {
            return message.reply(require('../../utils/utilityUI').errReply('Missing Text', 'Please provide text to convert.', { hint: 'Usage: `ascii-convert <text> [encode/decode]`' }));
        }
        
        let mode = 'encode';
        let text = args.join(' ');
        
        const lastArg = args[args.length - 1].toLowerCase();
        if (['encode', 'decode'].includes(lastArg)) {
            mode = lastArg;
            text = args.slice(0, -1).join(' ');
        }
        
        if (!text) {
            return message.reply(require('../../utils/utilityUI').errReply('Missing Text', 'Please provide text to convert.'));
        }
        
        try {
            let result;
            
            if (mode === 'encode') {
                result = text.split('').map(char => char.charCodeAt(0)).join(' ');
            } else {
                const asciiArray = text.split(' ').filter(a => a && !isNaN(a));
                result = asciiArray.map(ascii => {
                    const num = parseInt(ascii);
                    return (num >= 0 && num <= 127) ? String.fromCharCode(num) : '';
                }).join('');
                
                if (!result) {
                    return message.reply(require('../../utils/utilityUI').errReply('Invalid Format', 'Use space-separated ASCII codes (0-127).'));
                }
            }
            
            if (result.length > 3900) {
                return message.reply(require('../../utils/utilityUI').errReply('Too Long', 'Result is too long to display (max 3900 characters).'));
            }
            
            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`# 🔤 ASCII ${mode === 'encode' ? 'Encoder' : 'Decoder'}\n\n**Input:**\n${text.length > 200 ? text.substring(0, 200) + '...' : text}\n\n**Output:**\n${result.length > 200 ? result.substring(0, 200) + '...' : result}`)
                );
            
            message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            message.reply(require('../../utils/utilityUI').errReply('Error', error.message));
        }
    }
};
