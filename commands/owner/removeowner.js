const { isOwner } = require('../../utils/helpers');
const fs = require('fs');
const path = require('path');
const jsonStore = require('../../utils/jsonStore');
const { resolveUser } = require('../../utils/resolveUser');

module.exports = {
    name: 'removeowner',
    prefix: 'removeowner',
    aliases: ['delowner', 'removeco'],
    description: 'Remove a co-owner from the bot',
    usage: 'removeowner <@user>',
    category: 'owner',
    ownerOnly: true,

    async executePrefix(message, args) {
        if (!isOwner(message.author.id)) {
            return message.reply(require('../../utils/ownerUI').ownerOnly());
        }

        const user = await resolveUser(message, args);
        if (!user) {
            return message.reply(require('../../utils/ownerUI').errReply('Missing User', 'Please mention a user to remove as co-owner.'));
        }

        const ownersPath = path.join(__dirname, '..', '..', 'datas', 'owners.json');
        
        if (!jsonStore.has('owners')) {
            return message.reply(require('../../utils/ownerUI').errReply('No Co-Owners', 'No co-owners found.'));
        }

        let owners = jsonStore.read('owners');

        if (!owners.includes(user.id)) {
            return message.reply(require('../../utils/ownerUI').errReply('Not A Co-Owner', 'This user is not a co-owner.'));
        }

        owners = owners.filter(id => id !== user.id);
        jsonStore.write('owners', owners);
        
        message.reply(`<:Checkedbox:1521227734943269077> Successfully removed **${user.username}** from co-owners!`);
    }
};
