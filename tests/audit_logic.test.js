const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const context = vm.createContext({
    console,
    Date,
    Math,
    Number,
    Object,
    Map,
    Set,
    Promise,
    ArrayBuffer,
    DataView,
    Uint8Array,
    TextEncoder,
    crypto: require('crypto').webcrypto,
    btoa: value => Buffer.from(value, 'binary').toString('base64'),
    atob: value => Buffer.from(value, 'base64').toString('binary'),
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval
});

const source = fs.readFileSync('audit.js', 'utf8');
vm.runInContext(source + `
    this.auditLogicTestApi = {
        pack: auditPackScoreRecords,
        decode: auditDecodeScoreChunk,
        relativeLogit: auditRelativeLogit,
        buildIntervals: auditBuildIntervals,
        hashEvent: auditHashEvent,
        verifyEventChain: auditVerifyEventChain,
        initialize: auditInitialize,
        handleMessage: auditHandleMessage,
        prepareInitializationTest(mockBrowser) {
            globalThis.browser = mockBrowser;
            auditOpenDatabase = async () => ({});
            auditGetMetaValues = async () => ({ scoreCount: 0, thumbnailCount: 0, auditCount: 0 });
            auditUpdateModeIndicators = () => {};
            auditAppendEvent = async () => {};
            auditStartHeartbeat = () => {};
            auditCheckPrivateCoverage = async () => {
                await mockBrowser.privateAccessReady;
                AUDIT_settings.privateAccessAllowed = mockBrowser.privateAccessAllowed;
            };
            auditStartPrivateMonitoring = () => {};
            auditRefreshPrivateWindows = async () => {};
        },
        prepareProtectionTest(mockBrowser) {
            globalThis.browser = mockBrowser;
            AUDIT_initializationPromise = Promise.resolve();
            AUDIT_settings = auditNormalizeSettings({ mode: 'off' });
            AUDIT_settingsUnlocked = false;
            AUDIT_writeQueue = Promise.resolve();
            auditGetMetaValues = async () => ({ scoreCount: 0, thumbnailCount: 0, auditCount: 0 });
            auditAppendEvent = async () => {};
        },
        prepareTrackingTest(mockBrowser) {
            globalThis.browser = mockBrowser;
            AUDIT_initializationPromise = Promise.resolve();
            AUDIT_settings = auditNormalizeSettings({ mode: 'off', privateAccessAllowed: false });
            AUDIT_settingsUnlocked = false;
            AUDIT_writeQueue = Promise.resolve();
            AUDIT_pendingScores = [];
            auditGetMetaValues = async () => ({ scoreCount: 0, thumbnailCount: 0, auditCount: 0 });
            auditFlushPending = async () => {};
            auditUpdateModeIndicators = () => {};
            auditStartPrivateMonitoring = () => {};
            auditStartHeartbeat = () => {};
            auditRefreshPrivateWindows = async () => {};
            auditAppendEventNow = async () => {};
            auditAppendEvent = async () => {};
        }
    };
`, context);

const api = context.auditLogicTestApi;
const records = [
    {
        timestamp: 1_700_000_000_000,
        hostname: 'example.com',
        score: 0.25,
        threshold: 0.5,
        result: 'pass',
        private: false,
        rating: 'safe'
    },
    {
        timestamp: 1_700_000_001_000,
        hostname: 'private.example',
        score: 0.9,
        threshold: 0.7,
        result: 'block',
        private: true,
        effectiveZone: 'untrusted',
        rating: 'x'
    }
];
const chunk = api.pack(records, 42);
assert.strictEqual(chunk.data.byteLength, 24);
assert.strictEqual(chunk.startSeq, 42);
assert.strictEqual(chunk.endSeq, 43);
assert.deepStrictEqual(Array.from(chunk.domains), ['example.com', 'private.example']);

const decoded = [];
api.decode(chunk, value => decoded.push(value));
assert.strictEqual(decoded.length, 2);
assert.strictEqual(decoded[0].hostname, 'example.com');
assert.strictEqual(decoded[0].result, 'pass');
assert.strictEqual(decoded[0].rating, 'safe');
assert.strictEqual(decoded[0].effectiveZone, null, 'old records without zone bits remain readable');
assert.strictEqual(decoded[1].hostname, 'private.example');
assert.strictEqual(decoded[1].result, 'block');
assert.strictEqual(decoded[1].private, true);
assert.strictEqual(decoded[1].effectiveZone, 'untrusted');
assert.strictEqual(decoded[1].rating, 'x');
assert.ok(Math.abs(decoded[1].score - 0.9) < 0.0001);
assert.ok(api.relativeLogit(0.8, 0.5) > 0);
assert.ok(api.relativeLogit(0.2, 0.5) < 0);

const intervals = api.buildIntervals([
    { timestamp: 50, type: 'private-session-started' },
    { timestamp: 150, type: 'private-session-ended' },
    { timestamp: 180, type: 'private-session-started' }
], 100, 200, new Set(['private-session-started']), new Set(['private-session-ended']));
assert.deepStrictEqual(JSON.parse(JSON.stringify(intervals)), [
    { start: 100, end: 150 },
    { start: 180, end: 200 }
]);

const futureWindowIntervals = api.buildIntervals([
    { timestamp: 180, type: 'private-session-started' }
], 100, 300, new Set(['private-session-started']), new Set(['private-session-ended']), 220);
assert.deepStrictEqual(JSON.parse(JSON.stringify(futureWindowIntervals)), [
    { start: 180, end: 220 }
]);
const entirelyFutureIntervals = api.buildIntervals([
    { timestamp: 180, type: 'private-session-started' }
], 300, 400, new Set(['private-session-started']), new Set(['private-session-ended']), 220);
assert.deepStrictEqual(JSON.parse(JSON.stringify(entirelyFutureIntervals)), []);

(async () => {
    const first = {
        timestamp: 100,
        type: 'mode-changed',
        details: { from: 'off', to: 'audit' },
        previousHash: ''
    };
    first.hash = await api.hashEvent(first.previousHash, first);
    const second = {
        timestamp: 200,
        type: 'private-coverage-enabled',
        details: { source: 'test' },
        previousHash: first.hash
    };
    second.hash = await api.hashEvent(second.previousHash, second);
    const valid = await api.verifyEventChain([first, second], false);
    assert.strictEqual(valid.valid, true);
    second.details.source = 'changed';
    const invalid = await api.verifyEventChain([first, second], false);
    assert.strictEqual(invalid.valid, false);

    let releasePrivateAccessCheck;
    const privateAccessReady = new Promise(resolve => {
        releasePrivateAccessCheck = resolve;
    });
    api.prepareInitializationTest({
        privateAccessReady,
        privateAccessAllowed: true,
        storage: {
            local: {
                get: async () => ({
                    audit_settings: {
                        mode: 'accountability',
                        privateAccessAllowed: false
                    }
                }),
                set: async () => {}
            }
        }
    });
    const initializationPromise = api.initialize();
    let initialStateSettled = false;
    const initialStatePromise = api.handleMessage({ type: 'audit.getState' }).then(state => {
        initialStateSettled = true;
        return state;
    });
    await Promise.resolve();
    await Promise.resolve();
    assert.strictEqual(initialStateSettled, false,
        'state requests wait for the startup private-access check to finish');
    releasePrivateAccessCheck();
    await initializationPromise;
    const initialState = await initialStatePromise;
    assert.strictEqual(initialState.mode, 'audit');
    assert.strictEqual(initialState.settingsLockEnabled, true,
        'legacy accountability mode migrates to the settings lock');
    assert.strictEqual(initialState.settingsUnlocked, false);
    assert.strictEqual(initialState.privateAccessAllowed, true);

    api.prepareTrackingTest({
        extension: {
            isAllowedIncognitoAccess: async () => false
        },
        storage: {
            local: {
                set: async () => {},
                remove: async () => {}
            }
        }
    });
    const regularWindowAuditState = await api.handleMessage({
        type: 'audit.setTracking',
        enabled: true
    });
    assert.strictEqual(regularWindowAuditState.trackingEnabled, true,
        'Audit can run for regular windows without private-window access');
    assert.strictEqual(regularWindowAuditState.privateAccessAllowed, false,
        'Audit reports that private windows are not covered');

    const savedProtectionStates = [];
    api.prepareProtectionTest({
        storage: {
            local: {
                set: async value => savedProtectionStates.push(value),
                remove: async () => {}
            }
        }
    });
    await assert.rejects(
        api.handleMessage({
            type: 'audit.enableSettingsLock',
            password: 'short',
            confirmPassword: 'short'
        }),
        /at least 8 characters/
    );
    await assert.rejects(
        api.handleMessage({
            type: 'audit.enableSettingsLock',
            password: 'correct horse battery staple',
            confirmPassword: 'correct horse battery stapler'
        }),
        /do not match/
    );
    let protectionState = await api.handleMessage({
        type: 'audit.enableSettingsLock',
        password: 'correct horse battery staple',
        confirmPassword: 'correct horse battery staple'
    });
    assert.strictEqual(protectionState.settingsLockEnabled, true);
    assert.strictEqual(protectionState.settingsUnlocked, false,
        'enabling protection immediately locks the settings');
    protectionState = await api.handleMessage({ type: 'audit.lockSettings' });
    assert.strictEqual(protectionState.settingsUnlocked, false);
    await assert.rejects(
        api.handleMessage({ type: 'audit.unlockSettings', password: 'wrong password' }),
        /incorrect/
    );
    await assert.rejects(
        api.handleMessage({ type: 'audit.disableSettingsLock' }),
        /Settings are locked/
    );
    protectionState = await api.handleMessage({
        type: 'audit.unlockSettings',
        password: 'correct horse battery staple'
    });
    assert.strictEqual(protectionState.settingsUnlocked, true);
    protectionState = await api.handleMessage({ type: 'audit.disableSettingsLock' });
    assert.strictEqual(protectionState.settingsLockEnabled, false);
    assert.ok(savedProtectionStates.length >= 2, 'protection changes are persisted');
    console.log('audit logic tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
