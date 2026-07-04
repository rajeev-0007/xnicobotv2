const { ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');

module.exports = {
    data: null,

    async executePrefix(message, args) {
        const jsonString = args.join(' ');
        
        if (!jsonString) {
            return message.reply(require('../../utils/utilityUI').errReply('Missing JSON', 'Please provide a JSON string to format.'));
        }
        
        try {
            const parsed = JSON.parse(jsonString);
            const formatted = JSON.stringify(parsed, null, 2);
            
            if (formatted.length > 3900) {
                return message.reply(require('../../utils/utilityUI').errReply('Too Long', 'Formatted JSON is too long to display (max 3900 characters).'));
            }
            
            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`# <:Star:1521227981685526568> Formatted JSON\n\n\`\`\`json\n${formatted}\n\`\`\``)
                );
            
            message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`# <:Cancel:1521227723916181644> Invalid JSON\n\n**Error:** ${error.message}\n\n**Tip:** Make sure your JSON is properly formatted with quotes around keys and values.`)
                );
            
            message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
