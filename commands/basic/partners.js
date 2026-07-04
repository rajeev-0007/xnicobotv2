'use strict';

const { SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { db } = require('../../utils/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('partners')
        .setDescription('View our partnered servers and bots'),
    prefix: 'partners',
    description: 'View our partnered servers and bots',
    usage: 'partners',
    aliases: ['partnered', 'partnerlist'],
    category: 'basic',

    async execute(interaction) {
        const container = await buildPartnerList();
        return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    },

    async executePrefix(message) {
        const container = await buildPartnerList();
        return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    },
};

async function buildPartnerList() {
    const partners = (await db.get('partners')) || [];

    if (partners.length === 0) {
        const c = new ContainerBuilder().setAccentColor(0xCAD7E6);
        c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `## <:PartnerServer:1521228095225331765> Our Partners\n\n` +
            `> No partners yet.\n\n` +
            `-# Interested in partnering? Contact the bot owner.`
        ));
        return c;
    }

    const lines = partners.map((p, i) => {
        const desc = p.description ? `\n> <:Caretright:1521227704953864202> ${p.description}` : '';
        return `**${i + 1}.** [**${p.name}**](${p.invite})${desc}`;
    });

    const c = new ContainerBuilder().setAccentColor(0x5865F2);
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `## <:PartnerServer:1521228095225331765> Our Partners\n\n` +
        lines.join('\n\n') +
        `\n\n-# ${partners.length} partner${partners.length > 1 ? 's' : ''} <:Caretright:1521227704953864202> Interested in partnering? Contact the bot owner.`
    ));
    return c;
}
