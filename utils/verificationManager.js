
const jsonStore = require('./jsonStore');

function loadConfig() {
    if (!jsonStore.has('verification')) {
        jsonStore.write('verification', {});
        return {};
    }
    return jsonStore.read('verification');
}

function saveConfig(config) {
    jsonStore.write('verification', config);
}

function generateCaptcha(preferredType = 'random') {
    const captchaTypes = [
        'math',
        'text',
        'emoji',
        'button'
    ];
    
    let type = preferredType;
    if (preferredType === 'random' || !captchaTypes.includes(preferredType)) {
        type = captchaTypes[Math.floor(Math.random() * captchaTypes.length)];
    }
    
    if (type === 'math') {
        const num1 = Math.floor(Math.random() * 20) + 1;
        const num2 = Math.floor(Math.random() * 20) + 1;
        const operations = [
            { symbol: '+', operation: (a, b) => a + b },
            { symbol: '-', operation: (a, b) => a - b },
            { symbol: '×', operation: (a, b) => a * b }
        ];
        const op = operations[Math.floor(Math.random() * operations.length)];
        
        return {
            question: `What is ${num1} ${op.symbol} ${num2}?`,
            answer: op.operation(num1, num2).toString(),
            type: 'math'
        };
    } else if (type === 'text') {
        const words = [
            'DISCORD', 'VERIFY', 'SECURITY', 'MEMBER', 'SERVER',
            'WELCOME', 'ACCESS', 'HUMAN', 'CONFIRM', 'ACTIVE'
        ];
        const word = words[Math.floor(Math.random() * words.length)];
        const scrambled = word.split('').sort(() => Math.random() - 0.5).join('');
        
        return {
            question: `Unscramble this word: ${scrambled}`,
            answer: word,
            type: 'text'
        };
    } else if (type === 'emoji') {
        const emojiSets = [
            { emojis: '🍎🍌🍊🍇🍓', fruit: 'apple', emoji: '🍎' },
            { emojis: '🐶🐱🐭🐹🐰', animal: 'dog', emoji: '🐶' },
            { emojis: '🚗🚕🚙🚌🚎', vehicle: 'car', emoji: '🚗' },
            { emojis: '⚽🏀🏈⚾🎾', sport: 'soccer', emoji: '⚽' },
            { emojis: '<:Heart:1521228100652765247>💙💚💛🧡', color: 'red', emoji: '<:Heart:1521228100652765247>' }
        ];
        
        const set = emojiSets[Math.floor(Math.random() * emojiSets.length)];
        const key = Object.keys(set).find(k => k !== 'emojis' && k !== 'emoji');
        
        return {
            question: `Type the name of this emoji: ${set.emoji}`,
            answer: set[key],
            type: 'emoji'
        };
    } else {
        const words = [
            'VERIFY', 'SECURE', 'ACCESS', 'MEMBER', 'HUMAN',
            'ROBOT', 'SHIELD', 'SAFETY', 'TRUST', 'GUARD'
        ];
        const word = words[Math.floor(Math.random() * words.length)];
        
        const availableLetters = word.split('');
        const distractorLetters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
            .filter(l => !word.includes(l))
            .sort(() => Math.random() - 0.5)
            .slice(0, Math.max(0, 15 - word.length));
        
        const allLetters = [...availableLetters, ...distractorLetters]
            .sort(() => Math.random() - 0.5);
        
        return {
            question: `Click the letters in order to spell: ${word}`,
            answer: word,
            type: 'button',
            letters: allLetters,
            targetWord: word
        };
    }
}

const activeCaptchas = new Map();

function createCaptchaSession(userId, guildId, captchaType = 'random') {
    const captcha = generateCaptcha(captchaType);
    const sessionId = `${guildId}-${userId}-${Date.now()}`;
    
    activeCaptchas.set(sessionId, {
        userId: userId,
        guildId: guildId,
        captcha: captcha,
        attempts: 0,
        createdAt: Date.now()
    });
    
    setTimeout(() => {
        activeCaptchas.delete(sessionId);
    }, 5 * 60 * 1000);
    
    return { 
        sessionId, 
        question: captcha.question, 
        captchaType: captcha.type,
        letters: captcha.letters,
        targetWord: captcha.targetWord
    };
}

function verifyCaptcha(sessionId, answer) {
    const session = activeCaptchas.get(sessionId);
    
    if (!session) {
        return { success: false, error: 'Session expired or invalid' };
    }
    
    session.attempts++;
    
    const userAnswer = answer.trim().toLowerCase();
    const correctAnswer = session.captcha.answer.toLowerCase();
    
    if (userAnswer === correctAnswer) {
        activeCaptchas.delete(sessionId);
        return { success: true, userId: session.userId, guildId: session.guildId };
    } else {
        const attemptsLeft = 3 - session.attempts;
        
        if (session.attempts >= 3) {
            activeCaptchas.delete(sessionId);
            return { success: false, error: 'Too many attempts. Please try again.' };
        }
        
        return { 
            success: false, 
            error: `Incorrect answer. ${attemptsLeft} attempt(s) remaining.`,
            attemptsLeft: attemptsLeft
        };
    }
}

function getVerificationConfig(guildId) {
    const config = loadConfig();
    return config[guildId] || null;
}

function setVerificationConfig(guildId, data) {
    const config = loadConfig();
    config[guildId] = data;
    saveConfig(config);
}

function deleteVerificationConfig(guildId) {
    const config = loadConfig();
    delete config[guildId];
    saveConfig(config);
}

function updateButtonCaptchaAnswer(sessionId, letter) {
    const session = activeCaptchas.get(sessionId);
    if (!session) {
        return { success: false, error: 'Session expired or invalid' };
    }
    
    if (!session.userAnswer) {
        session.userAnswer = '';
    }
    
    session.userAnswer += letter;
    return { success: true, currentAnswer: session.userAnswer };
}

function clearButtonCaptchaAnswer(sessionId) {
    const session = activeCaptchas.get(sessionId);
    if (!session) {
        return { success: false, error: 'Session expired or invalid' };
    }
    
    session.userAnswer = '';
    return { success: true };
}

function getButtonCaptchaSession(sessionId) {
    return activeCaptchas.get(sessionId);
}

module.exports = {
    generateCaptcha,
    createCaptchaSession,
    verifyCaptcha,
    getVerificationConfig,
    setVerificationConfig,
    deleteVerificationConfig,
    updateButtonCaptchaAnswer,
    clearButtonCaptchaAnswer,
    getButtonCaptchaSession,
    activeCaptchas
};
