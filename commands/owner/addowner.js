const { isOwner } = require('../../utils/helpers');
const { ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const { buildErrorResponse, buildSuccessResponse, COLORS } = require('../../utils/responseBuilder');
const fs = require('fs');
const path = require('path');
const jsonStore = require('../../utils/jsonStore');
const { resolveUser } = require('../../utils/resolveUser');

module.exports = {
    prefix: 'addowner',
    description: 'Add a user as bot co-owner',
    usage: 'addowner <@user>',
    category: 'owner',
    aliases: [],
    ownerOnly: true,
    
    async executePrefix(message, args) {
        if (!isOwner(message.author.id)) {
            const container = buildErrorResponse('Owner Only', 'This command is restricted to the bot owner.');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const user = await resolveUser(message, args);
        if (!user) {
            let content = `# <:Crown:1521227739988889764> Add Co-Owner\n\n`;
            content += `**Usage:** \`addowner @user\`\n\n`;
            content += `### Description\n`;
            content += `> Grants a user co-owner permissions for the bot.\n\n`;
            content += `**Example:** \`addowner @TrustedUser\``;

            const container = new ContainerBuilder()
                .setAccentColor(COLORS.INFO)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const ownersPath = path.join(__dirname, '..', '..', 'datas', 'owners.json');
        let owners = [];
        
        if (jsonStore.has('owners')) {
            owners = jsonStore.read('owners');
        }

        if (owners.includes(user.id)) {
            const container = buildErrorResponse('Already Co-Owner', `**${user.username}** is already a co-owner.`);
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        owners.push(user.id);
        jsonStore.write('owners', owners);
        
        const container = buildSuccessResponse(
            'Co-Owner Added',
            `Successfully added **${user.username}** as a co-owner.`,
            `**Total Co-Owners:** ${owners.length}\n**ID:** ${user.id}`
        );

        message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
};
