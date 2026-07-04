const { isOwner } = require('../../utils/helpers');
const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } = require('discord.js');
const fs = require('fs');
const path = require('path');

module.exports = {
    data: null,
    name: 'lavalinkconfig',
    prefix: 'lavalinkconfig',
    aliases: ['llconfig', 'llc'],
    description: 'Manage Lavalink node configuration',
    usage: 'lavalinkconfig <add|remove|list|test|reload>',
    category: 'owner',
    ownerOnly: true,

    async executePrefix(message, args, lavalinkManager) {

        if (!subcommand || subcommand === 'help') {
            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# <:Music:1521228141543165982> Lavalink Configuration Help\n\n` +
                        `**<:Document:1521227875016114266> Commands:**\n` +
                        `\`lavalinkconfig add <id> <host> <port> <password> [secure]\`\n` +
                        `└ Add a new Lavalink node\n\n` +
                        `\`lavalinkconfig remove <id>\`\n` +
                        `└ Remove a Lavalink node\n\n` +
                        `\`lavalinkconfig list\`\n` +
                        `└ List all configured nodes\n\n` +
                        `\`lavalinkconfig test <id>\`\n` +
                        `└ Test connection to a node\n\n` +
                        `\`lavalinkconfig reload\`\n` +
                        `└ Reload Lavalink configuration (restart required)\n\n` +
                        `**<:Edit:1521227886634205298> Examples:**\n` +
                        `\`lavalinkconfig add my-node lavalink.example.com 2333 youshallnotpass true\`\n` +
                        `\`lavalinkconfig remove my-node\`\n` +
                        `\`lavalinkconfig test main-node\``
                    )
                );

            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const configPath = path.join(__dirname, '../../config/lavalink-nodes.json');

        let config = { nodes: [] };
        if (fs.existsSync(configPath)) {
            try {
                config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            } catch (error) {
                console.error('Error loading Lavalink config:', error);
            }
        }

        if (subcommand === 'add') {
            const [, id, host, port, password, secure] = args;

            if (!id || !host || !port || !password) {
                return message.reply(require('../../utils/ownerUI').errReply('Invalid Usage', 'Usage: `lavalinkconfig add <id> <host> <port> <password> [secure]`'));
            }

            const existingIndex = config.nodes.findIndex(n => n.id === id);
            
            const newNode = {
                id,
                host,
                port: parseInt(port),
                authorization: password,
                secure: secure === 'true' || secure === 'yes'
            };

            if (existingIndex !== -1) {
                config.nodes[existingIndex] = newNode;
            } else {
                config.nodes.push(newNode);
            }

            const configDir = path.dirname(configPath);
            if (!fs.existsSync(configDir)) {
                fs.mkdirSync(configDir, { recursive: true });
            }

            fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# <:Checkedbox:1521227734943269077> Lavalink Node Added\n\n` +
                        `**<:Fileuser:1521228225466859792> Node ID:** \`${id}\`\n` +
                        `**<:Bookopen:1521227911137595605> Host:** \`${host}\`\n` +
                        `**🔌 Port:** \`${port}\`\n` +
                        `**<:Lock:1521227892770734120> Secure:** ${newNode.secure ? 'Yes' : 'No'}\n\n` +
                        `<:Inforect:1521228008285929532> **Restart the bot** to apply changes!`
                    )
                );

            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (subcommand === 'remove') {
            const id = args[1];

            if (!id) {
                return message.reply(require('../../utils/ownerUI').errReply('Invalid Usage', 'Usage: `lavalinkconfig remove <id>`'));
            }

            const index = config.nodes.findIndex(n => n.id === id);

            if (index === -1) {
                return message.reply(require('../../utils/ownerUI').errReply('Not Found', `Node with ID \`${id}\` not found.`));
            }

            config.nodes.splice(index, 1);
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

            return message.reply(`<:Checkedbox:1521227734943269077> Successfully removed node \`${id}\`!\n\n<:Inforect:1521228008285929532> **Restart the bot** to apply changes!`);
        }

        if (subcommand === 'list') {
            if (config.nodes.length === 0) {
                return message.reply(require('../../utils/ownerUI').errReply('No Nodes', 'No Lavalink nodes configured in config file.'));
            }

            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# <:Music:1521228141543165982> Configured Lavalink Nodes\n\n` +
                        config.nodes.map((node, i) => 
                            `**${i + 1}. ${node.id}**\n` +
                            `└ Host: \`${node.host}:${node.port}\`\n` +
                            `└ Secure: ${node.secure ? 'Yes' : 'No'}`
                        ).join('\n\n') +
                        `\n\n*Total: ${config.nodes.length} node(s)*`
                    )
                );

            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (subcommand === 'test') {
            const id = args[1];

            if (!id) {
                return message.reply(require('../../utils/ownerUI').errReply('Invalid Usage', 'Usage: `lavalinkconfig test <id>`'));
            }

            if (!lavalinkManager || !lavalinkManager.nodeManager) {
                return message.reply(require('../../utils/ownerUI').errReply('Not Initialized', 'Lavalink manager is not initialized.'));
            }

            const node = lavalinkManager.nodeManager.nodes.get(id);

            if (!node) {
                return message.reply(require('../../utils/ownerUI').errReply('Not Found', `Node \`${id}\` not found in active nodes.`));
            }

            const isConnected = node.connected;
            const stats = node.stats || {};

            let content = `# 🧪 Node Test: ${id}\n\n` +
                `**<:Invoice:1521227903956811836> Status:** ${isConnected ? '<:online:1521228065752088576> Connected' : '<:offline:1521228263177977897> Disconnected'}\n` +
                `**<:Bookopen:1521227911137595605> Host:** \`${node.options?.host || 'Unknown'}:${node.options?.port || 'Unknown'}\`\n` +
                `**<:Lock:1521227892770734120> Secure:** ${node.options?.secure ? 'Yes' : 'No'}\n` +
                `**<:Fileuser:1521228225466859792> Session ID:** \`${node.sessionId || 'N/A'}\`\n` +
                `**<:Timer:1521227971590095070> Ping:** ${node.ping ? `${node.ping}ms` : 'N/A'}\n` +
                `**<:Music:1521228141543165982> Players:** ${stats.playingPlayers !== undefined ? `${stats.playingPlayers}/${stats.players}` : 'N/A'}`;

            if (isConnected && stats.memory) {
                content += `\n**<:Save:1521228186229276734> Memory:** ${(stats.memory.used / 1024 / 1024).toFixed(2)} MB / ${(stats.memory.reservable / 1024 / 1024).toFixed(2)} MB`;
            }

            if (isConnected && stats.cpu) {
                content += `\n**<:Settings:1521227767780343879> CPU:** System: ${(stats.cpu.systemLoad * 100).toFixed(2)}% | Lavalink: ${(stats.cpu.lavalinkLoad * 100).toFixed(2)}%`;
            }

            const container = new ContainerBuilder()
                .setAccentColor(isConnected ? 0x00FF00 : 0xFF0000)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (subcommand === 'reload') {
            return message.reply('<:Inforect:1521228008285929532> To reload Lavalink configuration, you need to **restart the bot**.');
        }

        return message.reply(require('../../utils/ownerUI').errReply('Unknown Subcommand', `Unknown subcommand: \`${subcommand}\``, { hint: 'Use `lavalinkconfig help` to see available commands.' }));
    }
};
