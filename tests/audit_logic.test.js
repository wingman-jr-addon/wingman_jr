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
        verifyEventChain: auditVerifyEventChain
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
assert.strictEqual(decoded[1].hostname, 'private.example');
assert.strictEqual(decoded[1].result, 'block');
assert.strictEqual(decoded[1].private, true);
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
    console.log('audit logic tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
