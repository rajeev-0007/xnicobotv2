const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const ui = require('../../utils/gamesUI');

const questions = [
    { option1: "Have the ability to fly", option2: "Have the ability to become invisible" },
    { option1: "Live in space", option2: "Live under the ocean" },
    { option1: "Always be 10 minutes late", option2: "Always be 20 minutes early" },
    { option1: "Have unlimited money", option2: "Have unlimited time" },
    { option1: "Read minds", option2: "See the future" },
    { option1: "Never use social media again", option2: "Never watch movies/TV again" },
    { option1: "Be able to speak all languages", option2: "Be able to talk to animals" },
    { option1: "Have a rewind button", option2: "Have a pause button for your life" },
    { option1: "Be famous", option2: "Be the best friend of someone famous" },
    { option1: "Live without music", option2: "Live without movies" },
    { option1: "Travel to the past", option2: "Travel to the future" },
    { option1: "Have super strength", option2: "Have super speed" },
    { option1: "Be stuck on a broken ski lift", option2: "Be stuck in a broken elevator" },
    { option1: "Have a personal chef", option2: "Have a personal chauffeur" },
    { option1: "Always have to say everything on your mind", option2: "Never speak again" },
    { option1: "Find true love", option2: "Win the lottery" },
    { option1: "Be without internet for a month", option2: "Be without your phone for a month" },
    { option1: "Have a third arm", option2: "Have a third leg" },
    { option1: "Control fire", option2: "Control water" },
    { option1: "Live in a world with zombies", option2: "Live in a world with aliens" }
];

const activePolls = new Map();

// Cleanup stale polls every 10 minutes
setInterval(() => {
    const now = Date.now();
    for (const [id, poll] of activePolls) {
        if (now - poll.createdAt > 30 * 60 * 1000) activePolls.delete(id);
    }
}, 10 * 60 * 1000);

function buildWyrContainer(question, votes = null) {
    const vote1 = votes ? votes.option1.size : 0;
    const vote2 = votes ? votes.option2.size : 0;
    const total = vote1 + vote2;

    let content = `# 🤔 Would You Rather?\n\n`;
    content += `1️⃣ **Option 1:** ${question.option1}\n`;
    content += `2️⃣ **Option 2:** ${question.option2}\n\n`;

    if (total > 0) {
        const pct1 = Math.round((vote1 / total) * 100);
        const pct2 = Math.round((vote2 / total) * 100);
        content += `**Results** (${total} vote${total !== 1 ? 's' : ''})\n`;
        content += `> 1️⃣ ${'█'.repeat(Math.round(pct1 / 5))}${'░'.repeat(20 - Math.round(pct1 / 5))} ${pct1}% (${vote1})\n`;
        content += `> 2️⃣ ${'█'.repeat(Math.round(pct2 / 5))}${'░'.repeat(20 - Math.round(pct2 / 5))} ${pct2}% (${vote2})`;
    } else {
        content += `*Click a button to vote!*`;
    }

    return content;
}

async function sendWouldYouRather(context, isInteraction) {
    const question = questions[Math.floor(Math.random() * questions.length)];
    const pollId = `wyr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    activePolls.set(pollId, {
        question,
        option1: new Set(),
        option2: new Set(),
        createdAt: Date.now()
    });

    const content = buildWyrContainer(question);
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${pollId}_1`).setLabel('Option 1').setEmoji('1️⃣').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`${pollId}_2`).setLabel('Option 2').setEmoji('2️⃣').setStyle(ButtonStyle.Primary)
    );

    const container = new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
        .addActionRowComponents(row);

    if (isInteraction) {
        await context.reply(ui.payload(ui.applyStyle(container, context.guild?.id)));
    } else {
        await context.reply(ui.payload(ui.applyStyle(container, context.guild?.id)));
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('wouldyourather')
        .setDescription('Play Would You Rather'),

    prefix: 'wouldyourather',
    description: 'Play Would You Rather - vote on fun dilemmas!',
    usage: 'wouldyourather',
    category: 'games',
    aliases: ['wyr'],

    async execute(interaction) {
        await sendWouldYouRather(interaction, true);
    },

    async executePrefix(message) {
        await sendWouldYouRather(message, false);
    },

    async handleButton(interaction) {
        const customId = interaction.customId;
        if (!customId.startsWith('wyr_')) return false;

        const lastUnderscore = customId.lastIndexOf('_');
        const pollId = customId.slice(0, lastUnderscore);
        const choice = customId.slice(lastUnderscore + 1);
        const poll = activePolls.get(pollId);

        if (!poll) {
            await interaction.reply({
                ...ui.payload(ui.err(interaction.guild?.id, 'Poll Expired', 'This poll has expired. Start a new one with `-wouldyourather`!')),
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
            });
            return true;
        }

        const userId = interaction.user.id;

        // Remove previous vote if switching
        poll.option1.delete(userId);
        poll.option2.delete(userId);

        // Add new vote
        if (choice === '1') poll.option1.add(userId);
        else poll.option2.add(userId);

        const content = buildWyrContainer(poll.question, poll);
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`${pollId}_1`).setLabel('Option 1').setEmoji('1️⃣').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`${pollId}_2`).setLabel('Option 2').setEmoji('2️⃣').setStyle(ButtonStyle.Primary)
        );

        const container = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
            .addActionRowComponents(row);

        try {
            await interaction.update(ui.payload(ui.applyStyle(container, interaction.guild?.id)));
        } catch (e) {
            if (e.code !== 10008 && e.code !== 40060) console.error('WouldYouRather update error:', e);
        }
        return true;
    }
};
