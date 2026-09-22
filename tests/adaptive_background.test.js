const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const storedData = {
    adaptive_zone_memory: {
        schemaVersion: 99,
        zones: { 'remembered.example': 'trusted' }
    }
};
let storageWriteCount = 0;
let refreshCount = 0;
const context = {
    console,
    WJR_DEBUG: false,
    ROC_trustedRoc: { threshold: 0.8, precision: 1 },
    ROC_neutralRoc: { threshold: 0.5, precision: 1 },
    ROC_untrustedRoc: { threshold: 0.2, precision: 1 },
    ROC_trustedToNeutralPercentage: 0.04,
    ROC_neutralToUntrustedPercentage: 0.18,
    rocCalculatePrecision: roc => roc.precision,
    WHT_REQUEST_POLICY: {
        URL_BLACKLISTED: 'blacklisted',
        URL_WHITELISTED: 'whitelisted'
    },
    whtGetUrlPolicy: () => 'scan',
    siteGetPreference: details => details.preference,
    siteGetPreferenceForUrl: pageUrl => ({
        supported: true,
        hostname: new URL(pageUrl).hostname,
        enabled: true,
        mode: 'adaptive',
        isOverride: true
    }),
    bkRefreshActiveBrowserActionZone: () => { refreshCount++; },
    browser: {
        storage: {
            local: {
                get: async keys => {
                    const result = {};
                    for (const key of Array.isArray(keys) ? keys : [keys]) {
                        if (Object.prototype.hasOwnProperty.call(storedData, key)) {
                            result[key] = storedData[key];
                        }
                    }
                    return result;
                },
                set: async values => {
                    storageWriteCount++;
                    Object.assign(storedData, values);
                },
                remove: async key => { delete storedData[key]; }
            }
        }
    }
};
vm.createContext(context);

const source = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
const start = source.indexOf("const BK_ADAPTIVE_MEMORY_ENABLED_KEY");
const end = source.indexOf('function bkSetStatusForZone', start);
assert.ok(start >= 0 && end > start);
vm.runInContext(source.slice(start, end) + `
    this.adaptiveTestApi = {
        initialize: bkInitializeAdaptiveZones,
        buildPlan: bkBuildRequestPlan,
        getState: bkGetAdaptiveState,
        getSiteState: bkGetSiteFilteringState,
        getAdaptiveDomain: bkGetAdaptiveDomain,
        record: bkRecordAdaptiveScore,
        memory: bkGetAdaptiveMemoryState,
        clear: bkClearAdaptiveMemory,
        waitForPersistence: () => BK_adaptivePersistenceQueue
    };
`, context);

const api = context.adaptiveTestApi;

(async () => {
    await api.initialize();
    assert.strictEqual(api.getState('remembered.example').zone, 'trusted');
    assert.strictEqual(api.getAdaptiveDomain('images.google.com'), 'google.com');
    assert.strictEqual(api.getAdaptiveDomain('www.google.com'), 'google.com');
    assert.strictEqual(api.getAdaptiveDomain('images.example.co.uk'), 'example.co.uk');

    const adaptivePlan = api.buildPlan({
        url: 'https://cdn.example/image.jpg',
        preference: { supported: true, hostname: 'a.example', mode: 'adaptive' }
    });
    assert.deepStrictEqual(
        JSON.parse(JSON.stringify(adaptivePlan.adaptiveContext)),
        { hostname: 'a.example', isPrivate: false }
    );
    assert.strictEqual(adaptivePlan.threshold, 0.5);

    const fixedPlan = api.buildPlan({
        url: 'https://cdn.example/image.jpg',
        preference: { supported: true, hostname: 'fixed.example', mode: 'neutral' }
    });
    assert.strictEqual(fixedPlan.adaptiveContext, null);

    const privatePlan = api.buildPlan({
        url: 'https://cdn.example/image.jpg',
        incognito: true,
        preference: { supported: true, hostname: 'a.example', mode: 'adaptive' }
    });
    assert.strictEqual(privatePlan.adaptiveContext.isPrivate, true);

    const writesBeforeTransition = storageWriteCount;
    for (let i = 0; i < 50; i++) {
        api.record(adaptivePlan.adaptiveContext, 0.9);
    }
    assert.strictEqual(api.getState('a.example').zone, 'neutral');
    assert.strictEqual(api.getState('b.example').zone, 'neutral');
    assert.strictEqual(storageWriteCount, writesBeforeTransition);

    api.record(adaptivePlan.adaptiveContext, 0.9);
    assert.strictEqual(api.getState('a.example').zone, 'untrusted');
    assert.strictEqual(
        api.getSiteState('https://a.example/new-tab').adaptiveZone,
        'untrusted',
        'a new tab on the same domain should reuse its adaptive zone'
    );
    assert.strictEqual(
        api.getSiteState('https://www.a.example/new-tab').adaptiveZone,
        'untrusted',
        'sibling hosts should share their registrable domain adaptive zone'
    );
    assert.strictEqual(api.getState('a.example').predictionBuffer.length, 51,
        'raw score history should survive a zone transition');
    await api.waitForPersistence();
    assert.strictEqual(storedData.adaptive_zone_memory.zones['a.example'], 'untrusted');

    const writesBeforePrivateTransition = storageWriteCount;
    for (let i = 0; i < 51; i++) {
        api.record(privatePlan.adaptiveContext, 0);
    }
    assert.strictEqual(api.getState('a.example', true).zone, 'trusted');
    assert.strictEqual(api.getState('a.example').zone, 'untrusted');
    assert.strictEqual(storageWriteCount, writesBeforePrivateTransition);

    const floodContext = { hostname: 'flood.example', isPrivate: false };
    for (let i = 0; i < 250; i++) {
        api.record(floodContext, 0);
    }
    assert.strictEqual(api.getState('flood.example').predictionBuffer.length, 200);

    assert.strictEqual(api.getSiteState('https://remembered.example').adaptiveZone, 'trusted');
    assert.ok(refreshCount >= 2);

    await api.clear();
    assert.strictEqual(api.memory().rememberedDomainCount, 0);
    assert.strictEqual(api.getState('a.example').zone, 'neutral');
    assert.strictEqual(storedData.adaptive_zone_memory, undefined);

    console.log('adaptive background tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
