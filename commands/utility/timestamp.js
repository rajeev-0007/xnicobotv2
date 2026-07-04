const { ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const { buildErrorResponse, COLORS } = require('../../utils/responseBuilder');

module.exports = {
    prefix: 'timestamp',
    description: 'Generate Discord timestamp formats',
    usage: 'timestamp [date/time or "now"]',
    category: 'utility',
    aliases: ['ts'],

    async executePrefix(message, args) {
        const timeInput = args.join(' ') || 'now';
        let timestamp;
        
        try {
            if (timeInput.toLowerCase() === 'now') {
                timestamp = Math.floor(Date.now() / 1000);
            } else {
                const date = new Date(timeInput);
                if (isNaN(date.getTime())) {
                    const container = buildErrorResponse(
                        'Invalid Date',
                        'Please use a valid date format.',
                        '**Examples:**\n> `timestamp now`\n> `timestamp 2024-12-25`\n> `timestamp 2024-12-25 15:30`'
                    );
                    return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
                }
                timestamp = Math.floor(date.getTime() / 1000);
            }
            
            const formats = [
                { name: 'Short Time', format: 't' },
                { name: 'Long Time', format: 'T' },
                { name: 'Short Date', format: 'd' },
                { name: 'Long Date', format: 'D' },
                { name: 'Short Date/Time', format: 'f' },
                { name: 'Long Date/Time', format: 'F' },
                { name: 'Relative', format: 'R' }
            ];
            
            let content = `# <:Alarm:1521227869047750689> Discord Timestamps\n\n`;
            content += `**Unix:** \`${timestamp}\`\n\n`;
            content += `### Formats\n`;
            formats.forEach(f => {
                content += `> **${f.name}:** <t:${timestamp}:${f.format}>\n`;
                content += `> \`<t:${timestamp}:${f.format}>\`\n\n`;
            });
            
            const container = new ContainerBuilder()
                .setAccentColor(COLORS.INFO)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
            
            message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            const container = buildErrorResponse('Error', 'Failed to generate timestamps.', error.message);
            message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
