const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');

const activities = {
    youtube: { id: '880218394199220334', name: '🎥 YouTube Together' },
    poker: { id: '755827207812677713', name: '🃏 Poker Night' },
    chess: { id: '832012774040141894', name: '♟️ Chess in the Park' },
    checkers: { id: '832013003968348200', name: '<:dnd:1521228070701502486> Checkers in the Park' },
    betrayal: { id: '773336526917861400', name: '🗡️ Betrayal.io' },
    fishing: { id: '814288819477020702', name: '🎣 Fishington.io' },
    letter: { id: '879863686565621790', name: '✍️ Letter League' },
    words: { id: '879863976006127627', name: '<:Edit:1521227886634205298> Word Snacks' },
    doodle: { id: '878067389634314250', name: '<:Caretright:1521227704953864202> Doodle Crew' },
    spellcast: { id: '852509694341283871', name: '🪄 SpellCast' },
    awkword: { id: '879863881349087252', name: '<:Bookopen:1521227911137595605> Awkword' },
    puttparty: { id: '945737671223947305', name: '⛳ Putt Party' },
    sketchheads: { id: '902271654783242291', name: '🖌️ Sketch Heads' },
    blazing: { id: '832025144389533716', name: '🏎️ Blazing 8s' },
    land: { id: '903769130790969345', name: '🎲 Land-io' },
    bobble: { id: '947957217959759964', name: '⚽ Bobble League' }
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('activities')
        .setDescription('Start a Discord activity in a voice channel')
        .addStringOption(o => o.setName('activity').setDescription('Activity to start').setRequired(true).addChoices(
            { name: 'YouTube Together', value: 'youtube' },
            { name: 'Poker Night', value: 'poker' },
            { name: 'Chess', value: 'chess' },
            { name: 'Checkers', value: 'checkers' },
            { name: 'Betrayal.io', value: 'betrayal' },
            { name: 'Fishington.io', value: 'fishing' },
            { name: 'Letter League', value: 'letter' },
            { name: 'Word Snacks', value: 'words' },
            { name: 'Doodle Crew', value: 'doodle' },
            { name: 'SpellCast', value: 'spellcast' },
            { name: 'Awkword', value: 'awkword' },
            { name: 'Putt Party', value: 'puttparty' },
            { name: 'Sketch Heads', value: 'sketchheads' },
            { name: 'Blazing 8s', value: 'blazing' },
            { name: 'Land-io', value: 'land' },
            { name: 'Bobble League', value: 'bobble' }
        )),

    async execute(interaction) {
        const activityName = interaction.options.getString('activity');
        const channel = interaction.member.voice.channel;
        if (!channel) return interaction.reply({ content: 'You must be in a voice channel!', flags: MessageFlags.Ephemeral });

        const activity = activities[activityName];
        const invite = await channel.createInvite({ targetApplication: activity.id, targetType: 2, maxAge: 3600 });
        await interaction.reply({ content: `Started **${activity.name}**! Join here: ${invite.url}` });
    },

    async executePrefix(message, args) {
        const activityName = args[0]?.toLowerCase();
        const channel = message.member.voice.channel;

        if (!channel) {
            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`# <:Gamepad:1521228035213230090> Discord Activities\n\n**Usage:** \`activities <name>\`\n\n**Available Activities:**\n🎥 \`youtube\` - YouTube Together\n🃏 \`poker\` - Poker Night\n♟️ \`chess\` - Chess in the Park\n<:dnd:1521228070701502486> \`checkers\` - Checkers in the Park\n🗡️ \`betrayal\` - Betrayal.io\n🎣 \`fishing\` - Fishington.io\n✍️ \`letter\` - Letter League\n<:Edit:1521227886634205298> \`words\` - Word Snacks\n<:Caretright:1521227704953864202> \`doodle\` - Doodle Crew\n🪄 \`spellcast\` - SpellCast\n<:Bookopen:1521227911137595605> \`awkword\` - Awkword\n⛳ \`puttparty\` - Putt Party\n🖌️ \`sketchheads\` - Sketch Heads\n🏎️ \`blazing\` - Blazing 8s\n🎲 \`land\` - Land-io\n⚽ \`bobble\` - Bobble League\n\n**Note:** You must be in a voice channel!\n\n**Example:** \`activities youtube\``)
                );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (!activityName || !activities[activityName]) {
            return message.reply(require('../../utils/utilityUI').errReply('Invalid Activity', 'Use `activities` to see the list.'));
        }

        try {
            const activity = activities[activityName];
            const invite = await channel.createInvite({
                targetApplication: activity.id,
                targetType: 2,
                maxAge: 3600
            });

            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`# <:Gamepad:1521228035213230090> Activity Started!\n\n**Activity:** ${activity.name}\n**Channel:** ${channel.name}\n\n**Click to join:** ${invite.url}\n\n*Invite expires in 1 hour*`)
                );

            message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            message.reply(require('../../utils/utilityUI').errReply('Failed', 'Failed to start activity. Make sure the bot has proper permissions.'));
        }
    }
};
