const fs = require('fs');
const path = require('path');
const jsonStore = require('./jsonStore');
const log = require('./logger-styled');

const configDir = path.join(__dirname, '../datas');
const backupDir = path.join(__dirname, '../backups');

const configFiles = [
    'welcomer.json',
    'tickets.json',
    'autoresponder.json',
    'autoreact.json',
    'automod.json'
];

function ensureBackupDir() {
    if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
    }
}

function createBackup(guildId) {
    ensureBackupDir();
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = `${guildId}_${timestamp}`;
    const backupPath = path.join(backupDir, backupName);
    
    fs.mkdirSync(backupPath, { recursive: true });
    
    const backupData = {
        guildId: guildId,
        timestamp: timestamp,
        date: new Date().toISOString(),
        configs: {}
    };
    
    for (const configFile of configFiles) {
        const storeName = configFile.replace('.json', '');
        try {
            const data = jsonStore.read(storeName);
            if (data[guildId]) {
                backupData.configs[configFile] = data[guildId];
                
                const backupFilePath = path.join(backupPath, configFile);
                fs.writeFileSync(backupFilePath, JSON.stringify(data[guildId], null, 2));
            }
        } catch (e) {
            log.error(`Error reading config ${configFile}:`, e.message);
        }
    }
    
    fs.writeFileSync(
        path.join(backupPath, 'backup-info.json'),
        JSON.stringify(backupData, null, 2)
    );
    
    return {
        success: true,
        backupName: backupName,
        timestamp: timestamp,
        configCount: Object.keys(backupData.configs).length
    };
}

function listBackups(guildId) {
    ensureBackupDir();
    
    const backups = [];
    const dirs = fs.readdirSync(backupDir);
    
    for (const dir of dirs) {
        if (dir.startsWith(`${guildId}_`)) {
            const infoPath = path.join(backupDir, dir, 'backup-info.json');
            if (fs.existsSync(infoPath)) {
                try {
                    const info = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
                    backups.push({
                        name: dir,
                        date: info.date,
                        timestamp: info.timestamp,
                        configCount: Object.keys(info.configs || {}).length
                    });
                } catch (e) {
                    log.error(`Error reading backup info ${dir}:`, e.message);
                }
            }
        }
    }
    
    backups.sort((a, b) => new Date(b.date) - new Date(a.date));
    return backups;
}

function loadBackup(guildId, backupName) {
    const validBackups = listBackups(guildId);
    const isValid = validBackups.some(backup => backup.name === backupName);
    
    if (!isValid) {
        return { success: false, error: 'Backup not found or access denied' };
    }
    
    const backupPath = path.join(backupDir, backupName);
    const resolvedPath = path.resolve(backupPath);
    const resolvedBackupDir = path.resolve(backupDir);
    
    if (!resolvedPath.startsWith(resolvedBackupDir + path.sep) && resolvedPath !== resolvedBackupDir) {
        return { success: false, error: 'Invalid backup path' };
    }
    
    if (!fs.existsSync(backupPath)) {
        return { success: false, error: 'Backup not found' };
    }
    
    const infoPath = path.join(backupPath, 'backup-info.json');
    if (!fs.existsSync(infoPath)) {
        return { success: false, error: 'Invalid backup structure' };
    }
    
    let backupInfo;
    try {
        backupInfo = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
    } catch (e) {
        return { success: false, error: 'Corrupt backup info file' };
    }
    
    if (backupInfo.guildId !== guildId) {
        return { success: false, error: 'This backup belongs to a different server' };
    }
    
    let restoredCount = 0;
    
    for (const configFile of configFiles) {
        const backupFilePath = path.join(backupPath, configFile);
        if (fs.existsSync(backupFilePath)) {
            try {
                const storeName = configFile.replace('.json', '');
                const backupData = JSON.parse(fs.readFileSync(backupFilePath, 'utf8'));
                
                let currentConfig = jsonStore.read(storeName);
                
                currentConfig[guildId] = backupData;
                jsonStore.write(storeName, currentConfig);
                
                if (global.updateAutoresponderCache && configFile === 'autoresponder.json') {
                    global.updateAutoresponderCache(guildId, backupData);
                } else if (global.updateAutoreactCache && configFile === 'autoreact.json') {
                    global.updateAutoreactCache(guildId, backupData);
                } else if (global.updateAutomodCache && configFile === 'automod.json') {
                    global.updateAutomodCache(guildId, backupData);
                }
                
                restoredCount++;
            } catch (e) {
                log.error(`Error restoring config ${configFile}:`, e.message);
            }
        }
    }
    
    return {
        success: true,
        backupName: backupName,
        restoredCount: restoredCount
    };
}

function deleteBackup(guildId, backupName) {
    const validBackups = listBackups(guildId);
    const isValid = validBackups.some(backup => backup.name === backupName);
    
    if (!isValid) {
        return { success: false, error: 'Backup not found or access denied' };
    }
    
    const backupPath = path.join(backupDir, backupName);
    const resolvedPath = path.resolve(backupPath);
    const resolvedBackupDir = path.resolve(backupDir);
    
    if (!resolvedPath.startsWith(resolvedBackupDir + path.sep) && resolvedPath !== resolvedBackupDir) {
        return { success: false, error: 'Invalid backup path' };
    }
    
    if (!fs.existsSync(backupPath)) {
        return { success: false, error: 'Backup not found' };
    }
    
    const infoPath = path.join(backupPath, 'backup-info.json');
    if (fs.existsSync(infoPath)) {
        try {
            const backupInfo = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
            if (backupInfo.guildId !== guildId) {
                return { success: false, error: 'This backup belongs to a different server' };
            }
        } catch (e) {
            return { success: false, error: 'Corrupt backup info file' };
        }
    }
    
    fs.rmSync(backupPath, { recursive: true, force: true });
    
    return {
        success: true,
        backupName: backupName
    };
}

module.exports = {
    createBackup,
    listBackups,
    loadBackup,
    deleteBackup
};
