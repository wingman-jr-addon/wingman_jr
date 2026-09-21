const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const changeListeners = [];
const storedData = {
    site_filtering_disabled_hosts: ['Legacy.Example']
};
const context = {
    URL,
    console,
    browser: {
        storage: {
            local: {
                get: async keys => {
                    const requestedKeys = Array.isArray(keys) ? keys : [keys];
                    const result = {};
                    for (const key of requestedKeys) {
                        if (Object.prototype.hasOwnProperty.call(storedData, key)) {
                            result[key] = storedData[key];
                        }
                    }
                    return result;
                },
                set: async values => Object.assign(storedData, values)
            },
            onChanged: {
                addListener: listener => changeListeners.push(listener)
            }
        }
    }
};
vm.createContext(context);

const source = fs.readFileSync(path.join(__dirname, '..', 'site_preferences.js'), 'utf8');
vm.runInContext(source + `
    this.siteTestApi = {
        getTopLevelPageUrl: siteGetTopLevelPageUrl,
        getPreference: siteGetPreference,
        getPreferenceForUrl: siteGetPreferenceForUrl,
        setModeForUrl: siteSetModeForUrl,
        resetForUrl: siteResetForUrl,
        setCachedSettings: siteSetCachedSettings,
        normalizeSettings: siteNormalizeSettings
    };
`, context);

const api = context.siteTestApi;

assert.strictEqual(api.getPreference({
    type: 'image',
    documentUrl: 'https://frame.example/page',
    frameAncestors: [
        { url: 'https://frame.example/page' },
        { url: 'https://TOP.example/home' }
    ]
}).hostname, 'top.example');
assert.strictEqual(api.getPreference({
    type: 'image',
    documentUrl: 'https://page.example/home',
    frameAncestors: []
}).hostname, 'page.example');
assert.strictEqual(api.getPreference({
    type: 'main_frame',
    url: 'https://direct.example/photo.jpg'
}).hostname, 'direct.example');
assert.strictEqual(api.getPreference({
    type: 'image',
    originUrl: 'https://origin.example/home'
}).hostname, 'origin.example');
assert.strictEqual(api.getPreference({
    type: 'image',
    frameAncestors: [{ url: 'not a URL' }],
    documentUrl: 'https://frame.example/page'
}).supported, false);
assert.strictEqual(api.getPreferenceForUrl('about:config').supported, false);

const throwingDetails = { type: 'image' };
Object.defineProperty(throwingDetails, 'frameAncestors', {
    get() { throw new Error('native traversal failure'); }
});
assert.doesNotThrow(() => api.getPreference(throwingDetails));
assert.strictEqual(api.getPreference(throwingDetails).supported, false);

const throwingAncestor = {};
Object.defineProperty(throwingAncestor, 'url', {
    get() { throw new Error('native ancestor URL failure'); }
});
assert.doesNotThrow(() => api.getPreference({
    type: 'image',
    frameAncestors: [throwingAncestor]
}));

const revokedAncestors = Proxy.revocable([], {});
revokedAncestors.revoke();
assert.doesNotThrow(() => api.getPreference({
    type: 'image',
    frameAncestors: revokedAncestors.proxy
}));

const throwingType = {};
Object.defineProperty(throwingType, 'type', {
    get() { throw new Error('native request type failure'); }
});
assert.doesNotThrow(() => api.getPreference(throwingType));

assert.deepStrictEqual(
    JSON.parse(JSON.stringify(api.normalizeSettings({
        'News.Example': 'trusted',
        'off.example': 'off',
        'invalid.example': 'invalid'
    }))),
    {
        'news.example': 'trusted',
        'off.example': 'off'
    }
);

(async () => {
    await new Promise(resolve => setImmediate(resolve));
    assert.deepStrictEqual(
        JSON.parse(JSON.stringify(storedData.site_filtering_settings)),
        { 'legacy.example': 'off' }
    );
    assert.strictEqual(api.getPreferenceForUrl('https://legacy.example').enabled, false);

    await api.setModeForUrl('https://News.Example/path', 'trusted');
    assert.deepStrictEqual(
        storedData.site_filtering_settings['news.example'],
        'trusted'
    );

    await api.setModeForUrl('https://news.example/path', 'off');
    assert.deepStrictEqual(
        JSON.parse(JSON.stringify(api.getPreferenceForUrl('https://news.example/path'))),
        {
            supported: true,
            hostname: 'news.example',
            enabled: false,
            mode: 'off',
            isOverride: true
        }
    );

    await api.setModeForUrl('https://news.example/path', 'trusted');
    assert.strictEqual(api.getPreferenceForUrl('https://news.example/path').mode, 'trusted');

    await api.resetForUrl('https://news.example/path');
    assert.strictEqual(api.getPreferenceForUrl('https://news.example/path').isOverride, false);
    console.log('site preference tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
