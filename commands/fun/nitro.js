
const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');

function fakeCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let code = '';
    for (let i = 0; i < 16; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

async function runNitro(context, isInteraction) {
    const loadingSteps = [
        '<:Search:1521228231263387738> Scanning Discord servers...',
        '<:Bookmark:1521227835526742066> Finding unused codes...',
        '<:Key:1521228000467878111> Bypassing security...',
        '<:Star:1521227981685526568> Generating Nitro code...',
        '<:Money:1521228266957045900> Code generated!'
    ];

    const msg = isInteraction
        ? await context.editReply(loadingSteps[0])
        : await context.reply(loadingSteps[0]);

    for (let i = 1; i < loadingSteps.length; i++) {
        await new Promise(resolve => setTimeout(resolve, 1500));
        if (isInteraction) {
            await context.editReply(loadingSteps[i]);
        } else {
            await msg.edit(loadingSteps[i]);
        }
    }

    await new Promise(resolve => setTimeout(resolve, 1000));

    const container = new ContainerBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder()
                .setContent(`# <:Present:1521228115655917659> Discord Nitro Code\n\n**Code:** \`discord.gift/${fakeCode()}\`\n\n*Just kidding! This is a fake code.*\n*Real Nitro codes can only be purchased or gifted legitimately.*\n\n**Want real Nitro?** Use \`/vote\` to support us!`)
        );

    if (isInteraction) {
        await context.editReply({ content: null, components: [container], flags: MessageFlags.IsComponentsV2 });
    } else {
        await msg.edit({ content: null, components: [container], flags: MessageFlags.IsComponentsV2 });
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('nitro')
        .setDescription('Generate a fake Nitro code (just for fun!)'),

    prefix: 'nitro',
    description: 'Generate a fake Nitro code (just for fun!)',
    usage: 'nitro',
    category: 'fun',
    aliases: ['fakenitro'],

    async execute(interaction) {
        await interaction.deferReply();
        await runNitro(interaction, true);
    },

    async executePrefix(message) {
        await runNitro(message, false);
    }
};
