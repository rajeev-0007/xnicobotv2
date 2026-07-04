const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');

const roasts = [
    "You're like a software update. Whenever I see you, I think 'Not now.'",
    "I'd agree with you, but then we'd both be wrong.",
    "You bring everyone so much joy... when you leave the room.",
    "I'm jealous of people who haven't met you.",
    "You're proof that evolution can go in reverse.",
    "If I had a dollar for every smart thing you say, I'd be broke.",
    "You're not stupid; you just have bad luck thinking.",
    "Somewhere out there is a tree tirelessly producing oxygen for you. You owe it an apology.",
    "I'd explain it to you, but I left my English-to-Dingbat dictionary at home.",
    "You're the reason the gene pool needs a lifeguard.",
    "Light travels faster than sound, which is why you seemed bright until you spoke.",
    "You're like a cloud. When you disappear, it's a beautiful day.",
    "Your secrets are always safe with me. I never even listen when you tell me them.",
    "I'd challenge you to a battle of wits, but I see you're unarmed.",
    "If ignorance is bliss, you must be the happiest person alive.",
    "You're the human equivalent of a participation award.",
    "I would ask how old you are, but I know you can't count that high.",
    "You're not completely useless. You can always serve as a bad example.",
    "I'm not insulting you, I'm describing you."
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('roast')
        .setDescription('Roast someone (or yourself) with a funny insult')
        .addUserOption(opt =>
            opt.setName('user')
                .setDescription('User to roast')
                .setRequired(false)),

    prefix: 'roast',
    description: 'Roast someone with a funny insult - just for fun!',
    usage: 'roast [@user]',
    category: 'fun',
    aliases: ['burn', 'insult'],

    async execute(interaction) {
        const target = interaction.options.getUser('user') || interaction.user;
        const roast = roasts[Math.floor(Math.random() * roasts.length)];
        
        const container = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `# <:Fire:1521227907647668374> Roasted!\n\n` +
                    `**${target.username}**, ${roast}\n\n` +
                    `-# Just for fun! Don't take it seriously 😄`
                )
            );
        
        await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    },

    async executePrefix(message, args) {
        const target = message.mentions.users.first() || message.author;
        const roast = roasts[Math.floor(Math.random() * roasts.length)];
        
        const container = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `# <:Fire:1521227907647668374> Roasted!\n\n` +
                    `**${target.username}**, ${roast}\n\n` +
                    `-# Just for fun! Don't take it seriously 😄`
                )
            );
        
        await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
};
