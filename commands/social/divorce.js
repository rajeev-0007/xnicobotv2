const ui = require('../../utils/socialUI');

const jsonStore = require('../../utils/jsonStore');

function loadMarriages() {
    if (jsonStore.has('marriages')) {
        return jsonStore.read('marriages');
    }
    return {};
}

module.exports = {
    prefix: 'divorce',
    name: 'divorce',
    description: 'Divorce your partner and end the marriage',
    usage: 'divorce',
    category: 'social',
    aliases: ['breakup'],

    async executePrefix(message, args) {
        const gid = message.guild?.id;
        const config = loadMarriages();

        if (!config[message.author.id]) {
            return message.reply(ui.payload(ui.err(gid, 'Not Married', 'You are not currently married to anyone!', 'Use `marry @user` to propose to someone.')));
        }

        const partnerId = config[message.author.id].partner;
        const partner = await message.client.users.fetch(partnerId).catch(() => null);
        delete config[message.author.id];
        delete config[partnerId];

        jsonStore.write('marriages', config);

        return message.reply({
            ...ui.payload(ui.ok(gid, 'Divorce Complete', `${ui.E.broken} Your marriage has ended.`, {
                'Divorced By': `${message.author.username}`,
                'Ex-Partner': partner ? `${partner}` : `<@${partnerId}>`,
            }, { emoji: ui.E.broken })),
            allowedMentions: { parse: [] },
        });
    }
};
