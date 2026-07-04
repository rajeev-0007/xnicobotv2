const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, SectionBuilder, ThumbnailBuilder, MessageFlags } = require('discord.js');
const { COLORS } = require('../../utils/responseBuilder');

const compliments = [
    "You're an awesome friend!",
    "You light up the room!",
    "You have a great sense of humor!",
    "You're incredibly talented!",
    "You're a great listener!",
    "You're so thoughtful!",
    "You have the best laugh!",
    "You're super creative!",
    "You make everyone around you happier!",
    "You're one of a kind!",
    "You have impeccable manners!",
    "You're a ray of sunshine!",
    "You inspire others!",
    "You're incredibly brave!",
    "You have excellent taste!",
    "You're absolutely brilliant!",
    "You're so genuine!",
    "You have a heart of gold!",
    "You're amazingly clever!",
    "You're stronger than you think!",
    "You have the best ideas!",
    "You're so caring and kind!",
    "You make everything better!",
    "You're absolutely wonderful!",
    "The world is better with you in it!"
];

function buildCompliment(target) {
    const compliment = compliments[Math.floor(Math.random() * compliments.length)];

    let content = `# 💖 Compliment\n\n`;
    content += `**${target.username}**, ${compliment}\n\n`;
    content += `*Keep being awesome!* <:Star:1521227981685526568>`;

    const section = new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
        .setThumbnailAccessory(new ThumbnailBuilder({ media: { url: target.displayAvatarURL({ size: 256 }) } }));

    return new ContainerBuilder()
        .addSectionComponents(section);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('compliment')
        .setDescription('Give someone a compliment')
        .addUserOption(opt => opt.setName('user').setDescription('User to compliment')),

    prefix: 'compliment',
    description: 'Give someone a compliment',
    usage: 'compliment [@user]',
    category: 'fun',
    aliases: ['flatter'],

    async execute(interaction) {
        const target = interaction.options.getUser('user') || interaction.user;
        const container = buildCompliment(target);
        await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    },

    async executePrefix(message, args) {
        const target = message.mentions.users.first() || message.author;
        const container = buildCompliment(target);
        await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
};
