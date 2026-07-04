const { ContainerBuilder, TextDisplayBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');

module.exports = {
    name: 'mention',
    prefix: 'mention',
    description: 'Send a message with @everyone or @here text (no ping)',
    category: 'admin',
    usage: 'mention <everyone|here> <message>',
    aliases: ['everyone-mention', 'here-mention'],
    permissions: ['MentionEveryone'],

    async executePrefix(message, args) {
        if (!message.guild) return message.reply(require('../../utils/adminUI').errReply('Not In A Server', 'This command can only be used in a server.')).catch(() => {});
        if (!message.member.permissions.has(PermissionFlagsBits.MentionEveryone)) {
            return message.reply(require('../../utils/adminUI').errReply('Missing Permission', 'You need the **Mention Everyone** permission.'));
        }

        // Detect which alias was used
        const invoked = message.content.trim().split(/ +/)[0].toLowerCase();
        let mentionType;

        if (invoked.endsWith('everyone-mention')) {
            mentionType = 'everyone';
        } else if (invoked.endsWith('here-mention')) {
            mentionType = 'here';
        } else {
            mentionType = args[0]?.toLowerCase();
            if (!['everyone', 'here'].includes(mentionType)) {
                return message.reply(require('../../utils/adminUI').errReply('Invalid Usage', 'Usage: `-mention <everyone|here> <message>`', { hint: 'Examples: `-mention everyone Server update!` or `-everyone-mention Server update!`' }));
            }
            args.shift();
        }

        if (!args.length) {
            return message.reply(require('../../utils/adminUI').errReply('Missing Message', 'Please provide a message.'));
        }

        const content = args.join(' ');
        const tag = mentionType === 'everyone' ? '@everyone' : '@here';

        const container = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`${tag}\n\n${content}`)
            );

        message.channel.send({
            components: [container],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [] }
        });
        message.delete().catch(() => {});
    }
};
