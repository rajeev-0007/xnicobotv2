const { isConnected } = require('./database');
const jsonStore = require('./jsonStore');

function isDatabaseConnected() {
    return isConnected();
}

class JSONDataManager {
    loadLevelingData() {
        return jsonStore.read('leveling') || {};
    }

    saveLevelingData(data) {
        jsonStore.write('leveling', data);
    }

    loadUsersData() {
        try {
            const parsed = jsonStore.read('users');
            if (Array.isArray(parsed)) {
                const obj = {};
                for (const user of parsed) {
                    const id = user.user_id || user.userId;
                    if (id) obj[id] = user;
                }
                return obj;
            }
            return parsed || {};
        } catch (error) {
            return {};
        }
    }

    saveUsersData(data) {
        jsonStore.write('users', data);
    }

    async getUserData(userId) {
        const users = this.loadUsersData();
        if (!users[userId]) {
            users[userId] = {
                userId,
                profile: {
                    customBackground: null,
                    backgroundColor: '#2f3136',
                    progressBarColor: '#bcf1e4'
                },
                social: {
                    bio: null
                }
            };
            this.saveUsersData(users);
        }
        return users[userId];
    }

    async updateUserData(userId, updates) {
        const users = this.loadUsersData();
        if (!users[userId]) {
            users[userId] = {
                userId,
                profile: {},
                social: {}
            };
        }

        for (const [key, value] of Object.entries(updates)) {
            const keys = key.split('.');
            let current = users[userId];
            
            for (let i = 0; i < keys.length - 1; i++) {
                if (!current[keys[i]]) {
                    current[keys[i]] = {};
                }
                current = current[keys[i]];
            }
            
            current[keys[keys.length - 1]] = value;
        }

        this.saveUsersData(users);
        return users[userId];
    }
}

const jsonManager = new JSONDataManager();

module.exports = {
    isMongoConnected: isDatabaseConnected,
    isDatabaseConnected,
    // NOTE: Always delegate to database.js. It reads/writes the `users` store
    // through jsonStore, which transparently falls back to local-file storage
    // when PostgreSQL isn't connected AND flushes `users` immediately (it's a
    // CRITICAL_STORE). Routing through the legacy JSONDataManager instead used
    // an object-keyed shape that database.js (array-shaped) could not read,
    // so customizations silently vanished on the next read / bot restart.
    getUserData: async (userId) => {
        const { getUserData } = require('./database');
        return await getUserData(userId);
    },
    updateUserData: async (userId, updates) => {
        const { updateUserData } = require('./database');
        return await updateUserData(userId, updates);
    }
};
