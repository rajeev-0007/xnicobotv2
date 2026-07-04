const THEME = {
    COLORS: {
        PRIMARY: '#bcf1e4',
        SUCCESS: '#57F287',
        WARNING: '#FEE75C',
        DANGER: '#ED4245',
        INFO: '#bcf1e4',
        DARK: '#2C2F33',
        BLURPLE: '#bcf1e4',
        EMBED: 0xCAD7E6
    },

    EMOJIS: {
        SUCCESS: '<:Checkedbox:1521227734943269077>',
        ERROR: '<:Cancel:1521227723916181644>',
        WARNING: '<:Infotriangle:1521227710381428926>',
        INFO: '<:Inforect:1521228008285929532>',
        LOADING: '<a:Loading:1521227993995940032>',
        ONLINE: '<:online:1521228065752088576>',
        OFFLINE: '<:offline:1521228263177977897>',
        DND: '<:dnd:1521228070701502486>',
        IDLE: '<:idle:1521228053936603257>',
        TOGGLE_ON: '<:Toggleon:1521227758011809964>',
        TOGGLE_OFF: '<:Toggleoff:1521227763816595559>',

        SHIELD: '<:Shield:1521227694677692467>',
        SETTINGS: '<:Settings:1521227767780343879>',
        FOLDER: '<:Folder:1521228095225331765>',
        MUSIC: '<:Music:1521228141543165982>',
        PLAY: '<:Play:1521228333700878416>',
        QUEUE: '<:Bookopen:1521227911137595605>',
        VOLUME: '<:Volumeup:1521228004502536272>',
        LOOP: '<:Refresh:1521227946441052420>',

        MODERATE: '<:banhammer:1521227777083314529>',
        BAN: '<:Shield:1521227694677692467>',
        ADMIN: '<:Shield:1521227694677692467>',
        MESSAGES: '<:Hashtag:1521227771957870604>',

        LINK: '<:Attach:1521228039135170722>',
        MAIL: '<:Envelope:1521228013910626426>',
        PIN: '<:Pin:1521227932625014916>',
        VOICE: '<:wvoice:1386229066104836126>',
        
        GIVEAWAY: '<:Money:1521228266957045900>',
        GAMES: '<:Gamepad:1521228035213230090>',
        DISCORD: '<:xnico:1521228240440660180>',
        UP: '<:Lightning:1521227915537285150>',
        SHINE: '<:Fire:1521227907647668374>',
        BOTS: '<:bots:1521227848101396610>',
        WAR: '<:Caretright:1521227704953864202>',
        
        YOUTUBE: '<:YoutubeLive:1521228137541927022>',
        SPOTIFY: '<:spotify:1521228327761744043>',
        SOUNDCLOUD: '<:soundCloud:1521228420468445375>',
        APPLE_MUSIC: '<:applemusic:1521228425962983484>',
        
        LIGHTNING: '<:Lightningalt:1521227851796447472>',
        ANNOUNCE: '<:Bullhorn:1521227936575914016>',
        
        ARROW_RIGHT: '<:Caretright:1521227704953864202>',
        ARROW_LEFT: '◂',
        DOT: '•',
        BULLET: '◦',
        CHECK: '✓',
        CROSS: '✗',
        STAR: '★',
        EMPTY_STAR: '☆'
    },

    BRANDING: {
        FOOTER: '<:xnico:1486755083390550036> [xNico </>](https://discord.gg/Zs35X7Umak) Development',
        FOOTER_ICON: null,
        NAME: 'Nico Bot',
        AUTHOR: 'Rajeev </>'
    },

    PANELS: {
        HEADER_STYLE: 'modern',
        USE_SEPARATORS: true,
        SEPARATOR_SIZE: 'Small'
    }
};

function formatStatus(enabled) {
    return enabled ? `<:Toggleon:1521227758011809964> Enabled` : `<:Toggleoff:1521227763816595559> Disabled`;
}

function formatCheck(enabled) {
    return enabled ? '<:Toggleon:1521227758011809964>' : '<:Toggleoff:1521227763816595559>';
}

function formatBulletList(items, emoji = THEME.EMOJIS.ARROW_RIGHT) {
    return items.map(item => `${emoji} ${item}`).join('\n');
}

function createHeader(title, emoji = '') {
    return `# ${emoji ? emoji + ' ' : ''}${title}`;
}

function createSubHeader(title, emoji = '') {
    return `## ${emoji ? emoji + ' ' : ''}${title}`;
}

function createSection(title, content, emoji = '') {
    return `### ${emoji ? emoji + ' ' : ''}${title}\n${content}`;
}

function createFooterText() {
    return `-# ${THEME.BRANDING.FOOTER}`;
}

function createStatusBadge(enabled, activeText = 'ACTIVE', inactiveText = 'INACTIVE') {
    if (enabled) {
        return `${THEME.EMOJIS.TOGGLE_ON} **${activeText}**`;
    }
    return `${THEME.EMOJIS.TOGGLE_OFF} **${inactiveText}**`;
}

function createProgressBar(current, max, length = 10, filledChar = '█', emptyChar = '░') {
    const filled = Math.round((current / max) * length);
    const empty = length - filled;
    return filledChar.repeat(filled) + emptyChar.repeat(empty);
}

function createProtectionRow(name, enabled, limit = null) {
    const status = formatCheck(enabled);
    const limitText = limit !== null ? ` \`${limit}\`` : '';
    return `${status} **${name}**${limitText}`;
}

function createInfoRow(label, value, emoji = '') {
    return `${emoji ? emoji + ' ' : ''}**${label}:** ${value}`;
}

function createEmbedFooter(customText = null) {
    return {
        text: customText ? `${customText} • ${THEME.BRANDING.FOOTER}` : THEME.BRANDING.FOOTER
    };
}

module.exports = {
    THEME,
    formatStatus,
    formatCheck,
    formatBulletList,
    createHeader,
    createSubHeader,
    createSection,
    createFooterText,
    createStatusBadge,
    createProgressBar,
    createProtectionRow,
    createInfoRow,
    createEmbedFooter
};
