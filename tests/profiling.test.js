const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('background.js', 'utf8');
const start = source.indexOf('const BK_PROFILE_IDLE_FLUSH_MS');
const end = source.indexOf('const BK_revealAllowlist');
assert.ok(start >= 0 && end > start, 'profiling helpers must remain discoverable');

const context = vm.createContext({
    WJR_PROFILE: true,
    URL,
    Date,
    Set,
    console,
    setTimeout,
    clearTimeout
});

vm.runInContext(source.slice(start, end) + `
this.profilingTestApi = {
    metricStats: bkProfileMetricStats,
    buildSummary: bkProfileBuildSummary,
    hostname: bkProfileHostname
};`, context);

const records = [
    {
        requestId: 'one',
        pageHost: 'www.amazon.com',
        resourceHost: 'images.example',
        mimeType: 'image/webp',
        result: 'pass',
        byteCount: 1000,
        width: 200,
        height: 300,
        queueDepthAtEnqueue: 1,
        backlogAtEnqueue: 2,
        inFlightAtStart: 1,
        safeReuseOutcome: 'admitted',
        safeReuseEvictions: 0,
        heldResponseMs: 100,
        queueWaitMs: 40,
        decodeEventLoopDelayMs: 5,
        decodeEventLoopMaxDelayMs: 3,
        decodeEventLoopMaxGapMs: 28,
        decodeEventLoopSamples: 4,
        modelInferenceMs: 20
    },
    {
        requestId: 'two',
        pageHost: 'www.amazon.com',
        resourceHost: 'images.example',
        mimeType: 'image/jpeg',
        result: 'block',
        byteCount: 2000,
        width: 400,
        height: 500,
        queueDepthAtEnqueue: 4,
        backlogAtEnqueue: 6,
        inFlightAtStart: 1,
        safeReuseOutcome: 'admitted',
        safeReuseEvictions: 1,
        heldResponseMs: 500,
        queueWaitMs: 300,
        decodeEventLoopDelayMs: 80,
        decodeEventLoopMaxDelayMs: 60,
        decodeEventLoopMaxGapMs: 85,
        decodeEventLoopSamples: 7,
        modelInferenceMs: 50
    }
];

const stats = context.profilingTestApi.metricStats(records, 'heldResponseMs');
assert.deepStrictEqual(
    JSON.parse(JSON.stringify(stats)),
    { avg: 300, p50: 100, p95: 500, max: 500, total: 600 }
);

const summary = context.profilingTestApi.buildSummary(records);
assert.strictEqual(summary.imageCount, 2);
assert.strictEqual(summary.totalBytes, 3000);
assert.strictEqual(summary.maxQueueDepth, 4);
assert.strictEqual(summary.maxBacklog, 6);
assert.strictEqual(summary.maxInFlightAtStart, 1);
assert.strictEqual(summary.resultCounts.pass, 1);
assert.strictEqual(summary.resultCounts.block, 1);
assert.strictEqual(summary.safeReuseOutcomes.admitted, 2);
assert.strictEqual(summary.safeReuseEvictions, 1);
assert.strictEqual(summary.topSlow[0].requestId, 'two');
assert.strictEqual(summary.metrics.decodeEventLoopDelayMs.avg, 43);
assert.strictEqual(summary.metrics.decodeEventLoopMaxGapMs.max, 85);
assert.strictEqual(summary.topSlow[0].decodeEventLoopMaxDelayMs, 60);
assert.strictEqual(summary.topSlow[0].decodeEventLoopSamples, 7);
assert.strictEqual(context.profilingTestApi.hostname('https://example.com/private/path?q=secret'), 'example.com');

console.log('profiling summary tests passed');
