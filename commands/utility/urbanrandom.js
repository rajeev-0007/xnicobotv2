'use strict';

/**
 * urbanrandom.js — prefix-only.
 * Pull a random definition from Urban Dictionary.
 */

const { ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const axios = require('axios');

async function getRandomDefinition() {
    try {
        const response = await axios.get('https://api.urbandictionary.com/v0/random', { timeout: 10_000 });
        return response.data?.list?.[0] || null;
    } catch {
        return null;
    }
}

function buildUrbanContainer(data) {
    let content =
        `# <:Bookopen:1521227911137595605> ${data.word}\n\n` +
        `${String(data.definition || '').substring(0, 1500)}\n\n` +
        `👍 **${data.thumbs_up}** | 👎 **${data.thumbs_down}**`;

    if (data.example) {
        content += `\n\n**Example:**\n*${String(data.example).substring(0, 500)}*`;
    }
    if (data.author) {
        content += `\n\n*By ${data.author}*`;
    }

    return new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
}

module.exports = {
    name: 'urbanrandom',
    prefix: 'urbanrandom',
    aliases: ['urbrand', 'urbandictrandom'],
    description: 'Get a random Urban Dictionary definition',
    usage: 'urbanrandom',
    category: 'utility',

    async executePrefix(message) {
        const data = await getRandomDefinition();
        if (!data) {
            return message.reply(require('../../utils/utilityUI').errReply('Failed', 'Failed to fetch a random definition.'));
        }
        await message.reply({ components: [buildUrbanContainer(data)], flags: MessageFlags.IsComponentsV2 });
    }
};
