const whtTemporaryWhitelist = new Map();
const WHT_TEMPORARY_TTL_MS = 10000;

function whtIsWhitelisted(url) {
    const now = Date.now();
    for (let [key, expiresAt] of whtTemporaryWhitelist.entries()) {
        if (expiresAt <= now) {
            whtTemporaryWhitelist.delete(key);
        }
    }
    return whtWhitelistStems.some(stem => url.startsWith(stem)) || whtTemporaryWhitelist.has(url);
}

function whtAddTemporaryWhitelist(url, ttlMs = WHT_TEMPORARY_TTL_MS) {
    whtTemporaryWhitelist.set(url, Date.now() + ttlMs);
    console.log('REVEAL: Added temporary whitelist entry', { url, ttlMs });
}

const whtWhitelistStems = [
    'https://www.google.com/recaptcha',
    'https://www.gstatic.com/recaptcha'
];
