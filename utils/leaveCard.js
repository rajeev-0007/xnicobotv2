'use strict';

/**
 * leaveCard.js — clean 1024×420 farewell card.
 *
 * Shares the WelcomeCard renderer for a consistent look, but tinted
 * leave-red with a "GOODBYE" headline, a grey status dot, and a light
 * grayscale on the avatar to reinforce the "leaving" mood.
 */

const { DESIGN } = require('./canvasDesign');
const WelcomeCard = require('./welcomeCard');

class LeaveCard extends WelcomeCard {
    constructor() {
        super();
        this.accentColor = DESIGN.colors.leave || '#ed4245';
        this._headline = 'GOODBYE';
        this._statusColor = '#6b7280';
    }

    async generate(user, guild, memberCount, customMessage = null) {
        return this._render(user, guild, memberCount, customMessage,
            'GOODBYE', this.accentColor, '#6b7280', /* greyscale */ true);
    }

    _defaultMessage(memberCount) {
        return `We now have ${Number(memberCount || 0).toLocaleString()} members`;
    }
}

module.exports = LeaveCard;
