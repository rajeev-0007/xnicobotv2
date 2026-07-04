'use strict';

/**
 * password.js — prefix-only.
 * Generates a cryptographically-secure random password and DMs it to
 * the caller (auto-deletes from chat after 60s if DMs are blocked).
 */

const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } = require('discord.js');
const crypto = require('crypto');

function generatePassword(length, includeNumbers, includeSymbols, includeUppercase) {
    let charset = 'abcdefghijklmnopqrstuvwxyz';
    if (includeUppercase) charset += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    if (includeNumbers)   charset += '0123456789';
    if (includeSymbols)   charset += '!@#$%^&*()_+-=[]{}|;:,.<>?';

    let password = '';
    for (let i = 0; i < length; i++) {
        password += charset.charAt(crypto.randomInt(0, charset.length));
    }
    return password;
}

function buildPasswordContainer(password, length) {
    const yes = '<:Checkedbox:1521227734943269077>';
    return new ContainerBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`# <:Key:1521228000467878111> Password Generated\n\n\`\`\`${password}\`\`\``)
        )
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `📏 **Length:** ${length} characters\n` +
                `🔢 **Numbers:** ${yes}\n` +
                `🔣 **Symbols:** ${yes}\n` +
                `<:Microphone:1521227746376683590> **Uppercase:** ${yes}\n\n` +
                `*<:Inforect:1521228008285929532> Keep your password safe!*`
            )
        );
}

module.exports = {
    name: 'password',
    prefix: 'password',
    aliases: ['genpass', 'pwgen'],
    description: 'Generate a secure random password',
    usage: 'password [length]',
    category: 'utility',

    async executePrefix(message, args) {
        const length = parseInt(args[0], 10) || 16;
        if (length < 8 || length > 128) {
            return message.reply(require('../../utils/utilityUI').errReply('Invalid Length', 'Password length must be between 8 and 128 characters.'));
        }

        const password  = generatePassword(length, true, true, true);
        const container = buildPasswordContainer(password, length);

        try {
            await message.author.send({ components: [container], flags: MessageFlags.IsComponentsV2 });
            await message.reply('<:Checkedbox:1521227734943269077> Sent your generated password via DM.').catch(() => {});
        } catch {
            const sent = await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            setTimeout(() => { sent.delete().catch(() => {}); }, 60_000);
        }
    }
};
