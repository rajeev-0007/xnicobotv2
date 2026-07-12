'use strict';

const { SlashCommandBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { createContainer, addTextDisplay } = require('../../utils/componentHelpers');
const animeManager = require('../../utils/animeManager');
const { EMOJIS: AE } = require('../../utils/animeEmojis');

const ITEMS_PER_PAGE = 5;

async function handleAchievements(reply, user) {
    const animeData = animeManager.loadAnimeData();
    const playerData = animeManager.getPlayerData(animeData, user.id);
    
    // Perform a background check just in case they unlocked something without triggering it
    const newAchievements = animeManager.checkNewAchievements(playerData);
    if (newAchievements.length > 0) {
        animeManager.saveAnimeData();
    }

    const unlocked = animeManager.getUnlockedAchievements(playerData);
    const allAchievements = animeManager.ACHIEVEMENTS;
    const totalPages = Math.ceil(allAchievements.length / ITEMS_PER_PAGE) || 1;
    let currentPage = 1;

    const generatePage = (page) => {
        const start = (page - 1) * ITEMS_PER_PAGE;
        const end = start + ITEMS_PER_PAGE;
        const pageItems = allAchievements.slice(start, end);

        const lines = pageItems.map(ach => {
            const isUnlocked = unlocked.some(a => a.id === ach.id);
            const icon = isUnlocked ? ach.emoji : AE.lock;
            const status = isUnlocked ? '**(Unlocked)**' : '*(Locked)*';
            return `### ${icon} ${ach.name} ${status}\n> ${ach.desc}\n> ${AE.money} Reward: **${ach.reward}** coins`;
        });

        const container = createContainer(0xF1C40F);
        addTextDisplay(container, [
            `## ${AE.trophy} Anime Achievements`,
            `> You have unlocked **${unlocked.length}/${allAchievements.length}** achievements.`,
            '',
            lines.join('\n\n'),
            '',
            `-# Page ${page} of ${totalPages}`,
        ].join('\n'));

        return container;
    };

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ach_prev').setLabel('Previous').setStyle(ButtonStyle.Secondary).setDisabled(currentPage === 1),
        new ButtonBuilder().setCustomId('ach_next').setLabel('Next').setStyle(ButtonStyle.Secondary).setDisabled(currentPage === totalPages)
    );

    const message = await reply({ components: [generatePage(currentPage), row], flags: MessageFlags.IsComponentsV2, fetchReply: true });

    if (totalPages > 1) {
        const filter = i => ['ach_prev', 'ach_next'].includes(i.customId) && i.user.id === user.id;
        const collector = message.createMessageComponentCollector({ filter, time: 60000 });

        collector.on('collect', async i => {
            if (i.customId === 'ach_prev') currentPage--;
            else if (i.customId === 'ach_next') currentPage++;

            row.components[0].setDisabled(currentPage === 1);
            row.components[1].setDisabled(currentPage === totalPages);

            await i.update({ components: [generatePage(currentPage), row] });
        });

        collector.on('end', () => {
            row.components.forEach(c => c.setDisabled(true));
            message.edit({ components: [generatePage(currentPage), row] }).catch(() => {});
        });
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('aachievements')
        .setDescription('View your anime achievements'),
    prefix: 'aachievements',
    description: 'View your unlocked and locked anime achievements.',
    usage: 'aachievements',
    aliases: ['achievements', 'aach'],
    category: 'anime',

    async executePrefix(message) {
        return handleAchievements(message.reply.bind(message), message.author);
    },

    async execute(interaction) {
        return handleAchievements(interaction.reply.bind(interaction), interaction.user);
    },
};
