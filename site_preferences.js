const SITE_SETTINGS_STORAGE_KEY = 'site_filtering_settings';
const SITE_LEGACY_DISABLED_HOSTS_KEY = 'site_filtering_disabled_hosts';
const SITE_MODES = Object.freeze(['off', 'adaptive', 'trusted', 'neutral', 'untrusted']);
const SITE_ADAPTIVE_MINIMUMS = Object.freeze(['trusted', 'neutral', 'untrusted']);
const SITE_DEFAULT_ADAPTIVE_MINIMUM = 'trusted';

let SITE_settings = {};

function siteHostnameFromUrl(value) {
    if (typeof value !== 'string' || !value) {
        return null;
    }
    try {
        const parsed = new URL(value);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return null;
        }
        const hostname = parsed.hostname.toLowerCase().replace(/^\.+|\.+$/g, '');
        return hostname || null;
    } catch (error) {
        return null;
    }
}

function siteNormalizeStoredHostname(value) {
    if (typeof value !== 'string') {
        return null;
    }
    return siteHostnameFromUrl('http://' + value.trim());
}

function siteNormalizeMode(value) {
    return SITE_MODES.includes(value) ? value : null;
}

function siteNormalizeAdaptiveMinimum(value) {
    return SITE_ADAPTIVE_MINIMUMS.includes(value)
        ? value
        : SITE_DEFAULT_ADAPTIVE_MINIMUM;
}

function siteNormalizePreference(rawPreference) {
    let mode = siteNormalizeMode(rawPreference);
    let adaptiveMinimum = SITE_DEFAULT_ADAPTIVE_MINIMUM;
    if (!mode && rawPreference && typeof rawPreference === 'object') {
        mode = rawPreference.enabled === false
            ? 'off'
            : siteNormalizeMode(rawPreference.mode);
        adaptiveMinimum = siteNormalizeAdaptiveMinimum(rawPreference.adaptiveMinimum);
    }
    if (!mode) {
        return null;
    }
    return mode === 'adaptive'
        ? { mode: mode, adaptiveMinimum: adaptiveMinimum }
        : mode;
}

function siteNormalizeSettings(settings) {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
        return {};
    }
    const normalized = {};
    for (const [rawHostname, rawPreference] of Object.entries(settings)) {
        const hostname = siteNormalizeStoredHostname(rawHostname);
        if (!hostname) {
            continue;
        }
        const preference = siteNormalizePreference(rawPreference);
        if (preference) {
            normalized[hostname] = preference;
        }
    }
    return normalized;
}

function siteMigrateDisabledHosts(hosts) {
    const migrated = {};
    if (!Array.isArray(hosts)) {
        return migrated;
    }
    for (const value of hosts) {
        const hostname = siteNormalizeStoredHostname(value);
        if (hostname) {
            migrated[hostname] = 'off';
        }
    }
    return migrated;
}

function siteSetCachedSettings(settings) {
    SITE_settings = siteNormalizeSettings(settings);
}

function siteGetTopLevelPageUrl(details) {
    if (!details || (typeof details !== 'object' && typeof details !== 'function')) {
        return null;
    }
    try {
        if (details.type === 'main_frame') {
            return siteHostnameFromUrl(details.url) ? details.url : null;
        }
    } catch (error) {
        return null;
    }

    let frameAncestors;
    try {
        frameAncestors = details.frameAncestors;
    } catch (error) {
        return null;
    }
    if (frameAncestors !== undefined && frameAncestors !== null) {
        try {
            if (!Array.isArray(frameAncestors)) {
                return null;
            }
            if (frameAncestors.length > 0) {
                const topLevelUrl = frameAncestors[frameAncestors.length - 1].url;
                return siteHostnameFromUrl(topLevelUrl) ? topLevelUrl : null;
            }
        } catch (error) {
            return null;
        }
    }

    for (const propertyName of ['documentUrl', 'originUrl']) {
        try {
            const candidate = details[propertyName];
            if (siteHostnameFromUrl(candidate)) {
                return candidate;
            }
        } catch (error) {
            return null;
        }
    }
    return null;
}

function siteGetPreferenceForHostname(hostname) {
    const storedPreference = SITE_settings[hostname];
    if (!storedPreference) {
        return {
            enabled: true,
            mode: null,
            adaptiveMinimum: null,
            isOverride: false
        };
    }
    const mode = typeof storedPreference === 'string'
        ? storedPreference
        : storedPreference.mode;
    return {
        enabled: mode !== 'off',
        mode: mode,
        adaptiveMinimum: mode === 'adaptive'
            ? siteNormalizeAdaptiveMinimum(storedPreference.adaptiveMinimum)
            : null,
        isOverride: true
    };
}

function siteGetPreference(details) {
    const hostname = siteHostnameFromUrl(siteGetTopLevelPageUrl(details));
    if (!hostname) {
        return { supported: false, hostname: null, enabled: true, mode: null, adaptiveMinimum: null, isOverride: false };
    }
    return { supported: true, hostname: hostname, ...siteGetPreferenceForHostname(hostname) };
}

function siteGetPreferenceForUrl(pageUrl) {
    const hostname = siteHostnameFromUrl(pageUrl);
    if (!hostname) {
        return { supported: false, hostname: null, enabled: true, mode: null, adaptiveMinimum: null, isOverride: false };
    }
    return { supported: true, hostname: hostname, ...siteGetPreferenceForHostname(hostname) };
}

async function siteReadEditableSettings() {
    const result = await browser.storage.local.get([
        SITE_SETTINGS_STORAGE_KEY,
        SITE_LEGACY_DISABLED_HOSTS_KEY
    ]);
    if (Object.prototype.hasOwnProperty.call(result, SITE_SETTINGS_STORAGE_KEY)) {
        return siteNormalizeSettings(result[SITE_SETTINGS_STORAGE_KEY]);
    }
    return siteMigrateDisabledHosts(result[SITE_LEGACY_DISABLED_HOSTS_KEY]);
}

async function siteSaveSettings(settings) {
    const normalized = siteNormalizeSettings(settings);
    await browser.storage.local.set({ [SITE_SETTINGS_STORAGE_KEY]: normalized });
    siteSetCachedSettings(normalized);
    return normalized;
}

async function siteSetModeForUrl(pageUrl, mode, adaptiveMinimum = SITE_DEFAULT_ADAPTIVE_MINIMUM) {
    const hostname = siteHostnameFromUrl(pageUrl);
    const normalizedMode = siteNormalizeMode(mode);
    if (!hostname || !normalizedMode) {
        return false;
    }
    const settings = await siteReadEditableSettings();
    settings[hostname] = normalizedMode === 'adaptive'
        ? {
            mode: normalizedMode,
            adaptiveMinimum: siteNormalizeAdaptiveMinimum(adaptiveMinimum)
        }
        : normalizedMode;
    await siteSaveSettings(settings);
    return true;
}

async function siteResetForUrl(pageUrl) {
    const hostname = siteHostnameFromUrl(pageUrl);
    if (!hostname) {
        return false;
    }
    const settings = await siteReadEditableSettings();
    delete settings[hostname];
    await siteSaveSettings(settings);
    return true;
}

browser.storage.local.get([SITE_SETTINGS_STORAGE_KEY, SITE_LEGACY_DISABLED_HOSTS_KEY])
    .then(async result => {
        if (Object.prototype.hasOwnProperty.call(result, SITE_SETTINGS_STORAGE_KEY)) {
            siteSetCachedSettings(result[SITE_SETTINGS_STORAGE_KEY]);
            if (typeof bkRefreshActiveBrowserActionZone === 'function') {
                bkRefreshActiveBrowserActionZone();
            }
            return;
        }
        const migrated = siteMigrateDisabledHosts(result[SITE_LEGACY_DISABLED_HOSTS_KEY]);
        siteSetCachedSettings(migrated);
        if (typeof bkRefreshActiveBrowserActionZone === 'function') {
            bkRefreshActiveBrowserActionZone();
        }
        if (Object.keys(migrated).length > 0) {
            await browser.storage.local.set({ [SITE_SETTINGS_STORAGE_KEY]: migrated });
        }
    })
    .catch(error => console.error('SITE FILTER: Unable to load site preferences', error));

browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes[SITE_SETTINGS_STORAGE_KEY]) {
        siteSetCachedSettings(changes[SITE_SETTINGS_STORAGE_KEY].newValue);
        if (typeof bkRefreshActiveBrowserActionZone === 'function') {
            bkRefreshActiveBrowserActionZone();
        }
    }
});
