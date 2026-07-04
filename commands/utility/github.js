const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, SectionBuilder, ThumbnailBuilder, MessageFlags } = require('discord.js');
const { buildErrorResponse, COLORS } = require('../../utils/responseBuilder');
const axios = require('axios');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('github')
        .setDescription('Search GitHub users or repositories')
        .addStringOption(option =>
            option.setName('type')
                .setDescription('Search type')
                .setRequired(true)
                .addChoices(
                    { name: 'User', value: 'user' },
                    { name: 'Repository', value: 'repo' }
                ))
        .addStringOption(option =>
            option.setName('query')
                .setDescription('Username or owner/repo')
                .setRequired(true)),
    
    aliases: ['gh'],

    async execute(interaction) {
        const type = interaction.options.getString('type');
        const query = interaction.options.getString('query');
        const container = await fetchGitHub(type, query);
        await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    },

    async executePrefix(message, args) {
        if (!args.length) {
            let content = `# 🐙 GitHub Search\n\n`;
            content += `### Usage\n`;
            content += `> \`github user <username>\` - Get user info\n`;
            content += `> \`github repo <owner/repo>\` - Get repository info\n\n`;
            content += `### Examples\n`;
            content += `> \`github user discord\`\n`;
            content += `> \`github repo discord/discord-api-docs\``;

            const container = new ContainerBuilder()
                .setAccentColor(COLORS.INFO)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

            return await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const type = args[0].toLowerCase();
        const query = args.slice(1).join(' ');

        if (!query) {
            const container = buildErrorResponse('Missing Query', 'Please provide a username or repository name.');
            return await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (type !== 'user' && type !== 'repo') {
            const container = buildErrorResponse('Invalid Type', 'Use `user` or `repo` as the search type.');
            return await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const container = await fetchGitHub(type, query);
        await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
};

async function fetchGitHub(type, query) {
    try {
        if (type === 'user') {
            const response = await axios.get(`https://api.github.com/users/${encodeURIComponent(query)}`, {
                headers: { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'DiscordBot' },
                timeout: 10000
            });
            const user = response.data;

            let content = `# 🐙 ${user.login}\n\n`;
            content += `**Name:** ${user.name || 'N/A'}\n`;
            content += `**Bio:** ${user.bio || 'No bio'}\n\n`;
            content += `### Statistics\n`;
            content += `> <:Folderopen:1521227986966417642> **Repos:** ${user.public_repos}\n`;
            content += `> <:Userplus:1521227719621218477> **Followers:** ${user.followers}\n`;
            content += `> <:User:1521227714227343380> **Following:** ${user.following}\n\n`;
            content += `### Info\n`;
            content += `> 🏢 **Company:** ${user.company || 'N/A'}\n`;
            content += `> <:Pin:1521227932625014916> **Location:** ${user.location || 'N/A'}\n`;
            content += `> <:Bookopen:1521227911137595605> **Joined:** ${new Date(user.created_at).toLocaleDateString()}\n\n`;
            content += `**[View Profile](${user.html_url})**`;

            const section = new SectionBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
                .setThumbnailAccessory(new ThumbnailBuilder({ media: { url: user.avatar_url } }));

            return new ContainerBuilder()
                .addSectionComponents(section);

        } else {
            const response = await axios.get(`https://api.github.com/repos/${encodeURIComponent(query).replace('%2F', '/')}`, {
                headers: { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'DiscordBot' },
                timeout: 10000
            });
            const repo = response.data;

            let content = `# 🐙 ${repo.full_name}\n\n`;
            content += `**Description:** ${repo.description || 'No description'}\n\n`;
            content += `### Statistics\n`;
            content += `> <:Star:1521227981685526568> **Stars:** ${repo.stargazers_count.toLocaleString()}\n`;
            content += `> 🍴 **Forks:** ${repo.forks_count.toLocaleString()}\n`;
            content += `> <:Edit:1521227886634205298> **Issues:** ${repo.open_issues_count}\n\n`;
            content += `### Info\n`;
            content += `> 💻 **Language:** ${repo.language || 'N/A'}\n`;
            content += `> 📜 **License:** ${repo.license?.name || 'No license'}\n`;
            content += `> <:Bookopen:1521227911137595605> **Created:** ${new Date(repo.created_at).toLocaleDateString()}\n`;
            content += `> <:History:1521227863079256278> **Updated:** ${new Date(repo.updated_at).toLocaleDateString()}\n\n`;
            content += `**[View Repository](${repo.html_url})**`;

            return new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
        }
    } catch (error) {
        if (error.response?.status === 403) {
            return buildErrorResponse('Rate Limited', 'GitHub API rate limit reached. Please try again later.');
        }
        if (error.response?.status === 404) {
            return buildErrorResponse('Not Found', `Could not find the requested ${type === 'user' ? 'user' : 'repository'} on GitHub.`);
        }
        return buildErrorResponse('Error', 'Failed to fetch data from GitHub. Please try again later.');
    }
}
