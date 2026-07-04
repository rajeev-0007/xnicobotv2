const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');

const pickupLines = [
    "Are you a magician? Because whenever I look at you, everyone else disappears!",
    "Do you have a map? I keep getting lost in your eyes.",
    "Is your name Google? Because you have everything I've been searching for.",
    "Are you a parking ticket? Because you've got FINE written all over you.",
    "Do you believe in love at first sight, or should I walk by again?",
    "Are you a camera? Because every time I look at you, I smile!",
    "If you were a vegetable, you'd be a cute-cumber!",
    "Are you Wi-Fi? Because I'm feeling a connection!",
    "Do you have a Band-Aid? Because I just scraped my knee falling for you.",
    "Is your name Chapstick? Because you're da balm!",
    "Are you a time traveler? Because I see you in my future!",
    "Do you have a pencil? Because I want to erase your past and write our future.",
    "Are you a banana? Because I find you a-peeling!",
    "If beauty were time, you'd be an eternity.",
    "Are you a loan? Because you have my interest!",
    "Do you like Star Wars? Because Yoda one for me!",
    "Are you French? Because Eiffel for you!",
    "Is your dad a boxer? Because you're a knockout!",
    "Are you a 45-degree angle? Because you're acute-y!",
    "Do you have a sunburn, or are you always this hot?"
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('pickupline')
        .setDescription('Get a cheesy pickup line')
        .addUserOption(opt =>
            opt.setName('user')
                .setDescription('Send the pickup line to someone')
                .setRequired(false)),

    prefix: 'pickup-line',
    description: 'Get a cheesy pickup line - use wisely!',
    usage: 'pickup-line [@user]',
    category: 'fun',
    aliases: ['pickup', 'flirt'],

    async execute(interaction) {
        const target = interaction.options.getUser('user');
        const line = pickupLines[Math.floor(Math.random() * pickupLines.length)];
        
        let content = `# 😏 Pickup Line\n\n`;
        if (target) {
            content += `**${interaction.user.username}** says to **${target.username}**:\n\n`;
        }
        content += `*"${line}"*\n\n-# Use wisely! 💘`;
        
        const container = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(content)
            );
        
        await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    },

    async executePrefix(message, args) {
        const target = message.mentions.users.first();
        const line = pickupLines[Math.floor(Math.random() * pickupLines.length)];
        
        let content = `# 😏 Pickup Line\n\n`;
        if (target) {
            content += `**${message.author.username}** says to **${target.username}**:\n\n`;
        }
        content += `*"${line}"*\n\n-# Use wisely! 💘`;
        
        const container = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(content)
            );
        
        await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
};
