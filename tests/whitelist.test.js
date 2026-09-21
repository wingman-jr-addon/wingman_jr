const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const changeListeners = [];
const storedData = {};
const context = {
    URL,
    console,
    browser: {
        storage: {
            local: {
                get: async key => Object.prototype.hasOwnProperty.call(storedData, key)
                    ? { [key]: storedData[key] }
                    : {},
                set: async values => Object.assign(storedData, values)
            },
            onChanged: {
                addListener: listener => changeListeners.push(listener)
            }
        }
    }
};
vm.createContext(context);

const source = fs.readFileSync(path.join(__dirname, '..', 'whitelist.js'), 'utf8');
vm.runInContext(source + `
    this.whitelistTestApi = {
        isWhitelisted: whtIsWhitelisted,
        isBlacklisted: whtIsBlacklisted,
        getRequestPolicy: whtGetRequestPolicy,
        getTopLevelPageUrl: whtGetTopLevelPageUrl,
        getTopLevelPageHostname: whtGetTopLevelPageHostname,
        getSiteFilteringState: whtGetSiteFilteringState,
        setSiteFilteringEnabled: whtSetSiteFilteringEnabled,
        setDisabledSiteHosts: whtSetDisabledSiteHosts,
        setRules: whtSetUserRules,
        getDomainScopes: whtGetDomainScopes,
        addDomainRule: whtAddDomainRule
    };
`, context);

const api = context.whitelistTestApi;

assert.strictEqual(api.isWhitelisted('https://www.google.com/recaptcha/api/image'), true);
assert.strictEqual(api.isWhitelisted('https://www.gstatic.com/recaptcha/releases/image.png'), true);
assert.strictEqual(api.isWhitelisted('https://www.google.com/unrelated/image.jpg'), false);
assert.deepStrictEqual(
    JSON.parse(JSON.stringify(api.getDomainScopes('https://cdn1.google.com/image.jpg'))),
    { host: 'cdn1.google.com', parentDomain: 'google.com' }
);
assert.deepStrictEqual(
    JSON.parse(JSON.stringify(api.getDomainScopes('https://example.co.uk/image.jpg'))),
    { host: 'example.co.uk', parentDomain: null }
);
assert.strictEqual(api.getDomainScopes('data:image/png;base64,abc'), null);

assert.strictEqual(api.getTopLevelPageHostname({
    type: 'image',
    url: 'https://cdn.example/image.jpg',
    documentUrl: 'https://frame.example/page',
    frameAncestors: [
        { url: 'https://frame.example/page' },
        { url: 'https://TOP.example/home' }
    ]
}), 'top.example');
assert.strictEqual(api.getTopLevelPageHostname({
    type: 'image',
    documentUrl: 'https://page.example/home',
    frameAncestors: []
}), 'page.example');
assert.strictEqual(api.getTopLevelPageHostname({
    type: 'main_frame',
    url: 'https://direct.example/photo.jpg'
}), 'direct.example');
assert.strictEqual(api.getTopLevelPageHostname({
    type: 'image',
    originUrl: 'https://origin.example/home'
}), 'origin.example');
assert.strictEqual(api.getTopLevelPageHostname({
    type: 'image',
    frameAncestors: [{ url: 'not a URL' }],
    documentUrl: 'https://frame.example/page'
}), null);

const throwingDetails = { type: 'image' };
Object.defineProperty(throwingDetails, 'frameAncestors', {
    get() { throw new Error('native traversal failure'); }
});
assert.doesNotThrow(() => api.getTopLevelPageHostname(throwingDetails));
assert.strictEqual(api.getTopLevelPageHostname(throwingDetails), null);

const throwingAncestor = {};
Object.defineProperty(throwingAncestor, 'url', {
    get() { throw new Error('native ancestor URL failure'); }
});
assert.doesNotThrow(() => api.getTopLevelPageHostname({
    type: 'image',
    frameAncestors: [throwingAncestor]
}));
assert.strictEqual(api.getTopLevelPageHostname({
    type: 'image',
    frameAncestors: [throwingAncestor]
}), null);

const revokedAncestors = Proxy.revocable([], {});
revokedAncestors.revoke();
assert.doesNotThrow(() => api.getTopLevelPageHostname({
    type: 'image',
    frameAncestors: revokedAncestors.proxy
}));
assert.strictEqual(api.getTopLevelPageHostname({
    type: 'image',
    frameAncestors: revokedAncestors.proxy
}), null);

const throwingType = {};
Object.defineProperty(throwingType, 'type', {
    get() { throw new Error('native request type failure'); }
});
assert.doesNotThrow(() => api.getTopLevelPageHostname(throwingType));
assert.strictEqual(api.getTopLevelPageHostname(throwingType), null);

api.setRules({
    whitelist: {
        domains: [
            '# Safe image sources',
            'safe.example.com',
            '*.wildcard.example',
            'https://prefix.example/safe/'
        ],
        regex: ['^https://images\\.example/allowed/']
    },
    blacklist: {
        domains: ['blocked.example.com'],
        regex: ['/unsafe-[0-9]+\\.jpg$/i']
    }
});

assert.strictEqual(api.isWhitelisted('https://safe.example.com/photo.jpg'), true);
assert.strictEqual(api.isWhitelisted('https://sub.safe.example.com/photo.jpg'), true);
assert.strictEqual(api.isWhitelisted('https://safe.example.com.evil.test/photo.jpg'), false);
assert.strictEqual(api.isWhitelisted('https://sub.wildcard.example/photo.jpg'), true);
assert.strictEqual(api.isWhitelisted('https://prefix.example/safe/photo.jpg'), true);
assert.strictEqual(api.isWhitelisted('https://prefix.example/unsafe/photo.jpg'), false);
assert.strictEqual(api.isWhitelisted('https://safe-image-sources.example/photo.jpg'), false);
assert.strictEqual(api.isWhitelisted('https://images.example/allowed/photo.jpg'), true);
assert.strictEqual(api.isBlacklisted('https://blocked.example.com/video.mp4'), true);
assert.strictEqual(api.isBlacklisted('https://cdn.example/UNSAFE-42.JPG'), true);

api.setDisabledSiteHosts(['top.example']);
assert.strictEqual(api.getRequestPolicy({
    type: 'image',
    url: 'https://blocked.example.com/video.mp4',
    frameAncestors: [{ url: 'https://top.example/page' }]
}), 'site-disabled');
assert.deepStrictEqual(
    JSON.parse(JSON.stringify(api.getSiteFilteringState('https://top.example/page'))),
    { supported: true, hostname: 'top.example', enabled: false }
);
assert.strictEqual(api.getSiteFilteringState('about:config').supported, false);
api.setDisabledSiteHosts([]);
assert.strictEqual(api.getRequestPolicy({
    type: 'image',
    url: 'https://blocked.example.com/video.mp4',
    documentUrl: 'https://page.example/'
}), 'url-blacklisted');
assert.strictEqual(api.getRequestPolicy({
    type: 'image',
    url: 'https://safe.example.com/photo.jpg',
    documentUrl: 'https://page.example/'
}), 'url-whitelisted');
Object.defineProperty(throwingDetails, 'url', {
    value: 'https://blocked.example.com/video.mp4'
});
assert.strictEqual(api.getRequestPolicy(throwingDetails), 'url-blacklisted');
assert.strictEqual(api.isBlacklisted('https://cdn.example/UNSAFE-42.JPG'), true);

api.setRules({
    whitelist: { domains: ['overlap.example'], regex: [] },
    blacklist: { domains: ['overlap.example'], regex: [] }
});
assert.strictEqual(api.isBlacklisted('https://overlap.example/photo.jpg'), true);
assert.strictEqual(api.isWhitelisted('https://overlap.example/photo.jpg'), false);

assert.strictEqual(api.isWhitelisted('https://www.google.com/recaptcha/api/image'), false);
assert.strictEqual(api.isBlacklisted('https://www.google.com/recaptcha/api/image'), false);

api.setRules({
    whitelist: { domains: [], regex: [] },
    blacklist: { domains: ['www.google.com'], regex: [] }
});
assert.strictEqual(api.isBlacklisted('https://www.google.com/recaptcha/api/image'), true);
assert.strictEqual(api.isWhitelisted('https://www.google.com/recaptcha/api/image'), false);

changeListeners[0]({
    url_filter_rules: {
        newValue: {
            whitelist: { domains: ['updated.example'], regex: [] },
            blacklist: { domains: [], regex: ['[invalid'] }
        }
    }
}, 'local');
assert.strictEqual(api.isWhitelisted('https://updated.example/photo.jpg'), true);
assert.strictEqual(api.isBlacklisted('https://updated.example/photo.jpg'), false);

changeListeners[0]({ url_filter_rules: { newValue: undefined } }, 'local');
assert.strictEqual(api.isWhitelisted('https://www.google.com/recaptcha/api/image'), true);

(async () => {
    storedData.url_filter_rules = {
        whitelist: {
            domains: ['# Keep this note'],
            regex: ['^https://safe\\.example/']
        },
        blacklist: {
            domains: ['cdn1.google.com'],
            regex: []
        }
    };

    await api.addDomainRule('whitelist', 'cdn1.google.com');
    await api.addDomainRule('whitelist', 'cdn1.google.com');
    assert.strictEqual(storedData.url_filter_rules.whitelist.domains.join('|'), '# Keep this note|cdn1.google.com');
    assert.strictEqual(storedData.url_filter_rules.whitelist.regex.join('|'), '^https://safe\\.example/');
    assert.strictEqual(storedData.url_filter_rules.blacklist.domains.length, 0);

    await api.addDomainRule('blacklist', 'google.com');
    assert.strictEqual(storedData.url_filter_rules.blacklist.domains.join('|'), 'google.com');

    await api.setSiteFilteringEnabled('https://News.Example/path', false);
    assert.strictEqual(storedData.site_filtering_disabled_hosts.join('|'), 'news.example');
    assert.strictEqual(api.getSiteFilteringState('https://news.example/other').enabled, false);
    await api.setSiteFilteringEnabled('https://news.example/path', true);
    assert.strictEqual(storedData.site_filtering_disabled_hosts.length, 0);
    console.log('whitelist tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
