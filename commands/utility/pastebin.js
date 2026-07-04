module.exports = {
    name: 'pastebin',
    description: 'Create a pastebin link from text',
    async executePrefix(message, args) {
        const text = args.join(' ');
        if (!text) {
            return message.reply(require('../../utils/utilityUI').errReply('Missing Text', 'Please provide text to create a pastebin.'));
        }

        try {
            await message.reply(`<:Checkedbox:1521227734943269077> Here's a mockup pastebin feature. In production, integrate with pastebin.com API.\n\`\`\`${text.substring(0, 1900)}\`\`\``);
        } catch (error) {
            await message.reply(require('../../utils/utilityUI').errReply('Failed', 'Failed to create pastebin.'));
        }
    }
};
