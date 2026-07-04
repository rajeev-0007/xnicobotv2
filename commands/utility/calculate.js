const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const { buildErrorResponse, COLORS } = require('../../utils/responseBuilder');

function safeCalculate(expression) {
    const sanitized = expression.replace(/[^0-9+\-*/(). ]/g, '');
    
    if (sanitized !== expression) {
        return { error: 'Invalid characters in expression! Only numbers and operators (+, -, *, /, parentheses) allowed.' };
    }

    try {
        const result = Function(`'use strict'; return (${sanitized})`)();
        if (!isFinite(result)) {
            return { error: 'Result is not a finite number (division by zero?).' };
        }
        return { result, expression };
    } catch (error) {
        return { error: 'Invalid math expression!' };
    }
}

function buildCalculatorContainer(expression, result) {
    let content = `# 🧮 Calculator\n\n`;
    content += `### Expression\n`;
    content += `\`\`\`${expression}\`\`\`\n`;
    content += `### Result\n`;
    content += `\`\`\`${result}\`\`\``;

    return new ContainerBuilder()
        .setAccentColor(COLORS.SUCCESS)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('calculate')
        .setDescription('Calculate a mathematical expression')
        .addStringOption(o => o.setName('expression').setDescription('Math expression to evaluate').setRequired(true)),
    prefix: 'calculate',
    description: 'Calculate a mathematical expression',
    usage: 'calculate <expression>',
    category: 'utility',
    aliases: ['calculator', 'calc', 'math'],

    async execute(interaction) {
        const expression = interaction.options.getString('expression');
        const calc = safeCalculate(expression);
        
        if (calc.error) {
            const container = buildErrorResponse('Calculation Error', calc.error);
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const container = buildCalculatorContainer(calc.expression, calc.result);
        await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    },

    async executePrefix(message, args) {
        const expression = args.join(' ');

        if (!expression) {
            const container = buildErrorResponse(
                'No Expression',
                'Please provide a math expression.',
                '**Examples:**\n> `calc 2 + 2`\n> `calc (10 * 5) / 2`'
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const calc = safeCalculate(expression);
        
        if (calc.error) {
            const container = buildErrorResponse('Calculation Error', calc.error);
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const container = buildCalculatorContainer(calc.expression, calc.result);
        await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
};
