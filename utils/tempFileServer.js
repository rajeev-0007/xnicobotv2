const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const axios = require('axios');

const CATBOX_URL = 'https://catbox.moe/user/api.php';
const GOFILE_API = 'https://api.gofile.io';
const UPLOAD_TIMEOUT = 120000;

async function uploadToCatbox(filePath, fileName) {
    const form = new FormData();
    form.append('reqtype', 'fileupload');
    form.append('fileToUpload', fs.createReadStream(filePath), fileName);

    const resp = await axios.post(CATBOX_URL, form, {
        headers: form.getHeaders(),
        timeout: UPLOAD_TIMEOUT,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
    });

    const url = resp.data?.trim();
    if (!url || !url.startsWith('https://')) {
        throw new Error('Invalid catbox response: ' + String(resp.data).substring(0, 100));
    }
    return url;
}

async function uploadToGoFile(filePath, fileName) {
    const serverResp = await axios.get(`${GOFILE_API}/servers`, { timeout: 10000 });
    const server = serverResp.data?.data?.servers?.[0]?.name;
    if (!server) throw new Error('No GoFile server available');

    const form = new FormData();
    form.append('file', fs.createReadStream(filePath), fileName);

    const resp = await axios.post(`https://${server}.gofile.io/contents/uploadfile`, form, {
        headers: form.getHeaders(),
        timeout: UPLOAD_TIMEOUT,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
    });

    const downloadPage = resp.data?.data?.downloadPage;
    if (!downloadPage) throw new Error('No GoFile download page returned');
    return downloadPage;
}

async function uploadFile(filePath, fileName) {
    const services = [
        { name: 'Catbox', fn: () => uploadToCatbox(filePath, fileName) },
        { name: 'GoFile', fn: () => uploadToGoFile(filePath, fileName) },
    ];

    let lastErr = null;
    for (const svc of services) {
        try {
            console.log(`[Upload] Uploading to ${svc.name}...`);
            const url = await svc.fn();
            console.log(`[Upload] ${svc.name} success: ${url}`);
            return { url, service: svc.name };
        } catch (err) {
            lastErr = err;
            console.error(`[Upload] ${svc.name} failed:`, err.message?.substring(0, 150));
        }
    }

    throw new Error(`All upload services failed. Last error: ${lastErr?.message || 'Unknown'}`);
}

module.exports = { uploadFile, uploadToCatbox, uploadToGoFile };
