const ui = require('../../utils/socialUI');

const jsonStore = require('../../utils/jsonStore');
const { resolveUser } = require('../../utils/resolveUser');

module.exports = {
    prefix: 'rep',
    description: 'Give reputation to another user',
    usage: 'rep <@user>',
    category: 'social',
    aliases: ['reputation', '+rep'],

    async executePrefix(message, args) {
        const gid = message.guild?.id;
        const user = await resolveUser(message, args);
        if (!user) {
            return message.reply(ui.payload(ui.usage(gid, 'Reputation', 'rep @user', {
                emoji: ui.E.star,
                intro: 'Give a reputation point to another user. You can give one every 24 hours.',
                examples: ['rep @TrustedUser'],
            })));
        }

        if (user.id === message.author.id) {
            return message.reply(ui.payload(ui.err(gid, 'Self-Rep', 'You cannot give yourself reputation!')));
        }

        let config = {};
        if (jsonStore.has('reputation')) config = jsonStore.read('reputation');

        let cooldowns = {};
        if (jsonStore.has('rep_cooldown')) cooldowns = jsonStore.read('rep_cooldown');

        const lastGiven = cooldowns[message.author.id];
        const cooldownTime = 24 * 60 * 60 * 1000;

        if (lastGiven && Date.now() - lastGiven < cooldownTime) {
            const timeLeft = cooldownTime - (Date.now() - lastGiven);
            const hoursLeft = Math.floor(timeLeft / (60 * 60 * 1000));
            const minutesLeft = Math.floor((timeLeft % (60 * 60 * 1000)) / (60 * 1000));
            return message.reply(ui.payload(ui.warn(gid, 'Cooldown Active', `You can give reputation again in **${hoursLeft}h ${minutesLeft}m**.`)));
        }

        config[user.id] = (config[user.id] || 0) + 1;
        cooldowns[message.author.id] = Date.now();

        jsonStore.write('reputation', config);
        jsonStore.write('rep_cooldown', cooldowns);

        return message.reply(ui.payload(ui.ok(gid, 'Reputation Given', `You gave **${user.username}** a reputation point!`, {
            'Their Total Rep': `${ui.E.star} ${config[user.id]}`,
        }, { emoji: ui.E.star })));
    }
};
