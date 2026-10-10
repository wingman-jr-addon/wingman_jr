const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const processorSource = fs.readFileSync(path.join(root, 'processor.js'), 'utf8');
const backgroundSource = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const optionsSource = fs.readFileSync(path.join(root, 'options.js'), 'utf8');
const optionsHtml = fs.readFileSync(path.join(root, 'options.html'), 'utf8');

assert.match(optionsHtml, /id="tboost_enabled" checked/,
    'TBOOST must be a default-on option');
assert.match(optionsHtml, /at least four image scans stay queued for five seconds/,
    'the option must describe the sustained backlog requirement');
assert.match(optionsSource, /rawResult\.tboost_enabled !== false/,
    'a missing saved preference must keep TBOOST enabled');
assert.match(backgroundSource, /tboostEnabled: BK_isTboostEnabled/,
    'the background must broadcast TBOOST settings to processors');
assert.match(processorSource, /const triggerThreshold = ROC_untrustedRoc\.threshold/,
    'the four-up pre-scan must use the untrusted threshold');
assert.match(processorSource, /TBOOST: ACTIVE/);
assert.match(processorSource, /TBOOST: PASS/);
assert.match(processorSource, /TBOOST: RESCAN/);

const compareStart = backgroundSource.indexOf('function bkApproxEq');
const compareEnd = backgroundSource.indexOf('function bkHandleCrashDetectionResult', compareStart);
const crashScoreContext = {};
vm.createContext(crashScoreContext);
vm.runInContext(backgroundSource.slice(compareStart, compareEnd) + `
    this.isValidScore = bkIsValidSqrxScore;
    this.compareScores = bkCompareSqrxScores;
`, crashScoreContext);
const healthScore = [new Float32Array([0.2]), new Float32Array([0.1, 0.2, 0.3, 0.4])];
const savedHealthScore = { ...healthScore };
assert.strictEqual(crashScoreContext.isValidScore(healthScore), true);
assert.strictEqual(crashScoreContext.isValidScore(savedHealthScore), true,
    'the shallow-copied expected health score remains valid');
assert.strictEqual(crashScoreContext.compareScores(savedHealthScore, healthScore), true);
assert.strictEqual(crashScoreContext.compareScores(savedHealthScore, undefined), false,
    'a missing score must not throw in crash detection');

const compositeStart = processorSource.indexOf('function procCreateCompositeCanvas');
const compositeEnd = processorSource.indexOf('async function procPredict', compositeStart);
const compositeDraws = [];
const composite2dContext = {
    imageSmoothingEnabled: false,
    fillStyle: '',
    fillRect() {},
    drawImage(...args) { compositeDraws.push(args); }
};
const compositeContext = {
    document: {
        createElement(type) {
            assert.strictEqual(type, 'canvas');
            return {
                width: 0,
                height: 0,
                getContext() { return composite2dContext; }
            };
        }
    }
};
vm.createContext(compositeContext);
vm.runInContext(`const PROC_IMAGE_SIZE = 224;\n` +
    processorSource.slice(compositeStart, compositeEnd) + `
    this.createCompositeCanvas = procCreateCompositeCanvas;
    this.drawCompositeTile = procDrawCompositeTile;
`, compositeContext);
const compositeCanvas = compositeContext.createCompositeCanvas();
for(let index = 0; index < 4; index++) {
    compositeContext.drawCompositeTile(compositeCanvas, { width: 200, height: 100 }, index);
}
assert.strictEqual(compositeDraws.length, 4);
assert.ok(Math.abs(compositeDraws[0][6] - 28) < 0.001,
    'a landscape image is vertically centered in its tile');
assert.strictEqual(compositeDraws[1][5], 112, 'the second image starts in the right tile');
assert.ok(Math.abs(compositeDraws[2][6] - 140) < 0.001,
    'the third image starts in the lower-left tile');

const backlogStart = processorSource.indexOf('const PROC_TBOOST_BATCH_SIZE');
const backlogEnd = processorSource.indexOf('async function procLoadTboostCandidate', backlogStart);
const backlogContext = {
    console,
    WJR_DEBUG: false,
    performance: { now() { return 0; } }
};
vm.createContext(backlogContext);
vm.runInContext(`
    let PROC_processingQueue = [];
` + processorSource.slice(backlogStart, backlogEnd) + `
    this.setQueueLength = length => {
        PROC_processingQueue = Array.from({ length }, (_, index) => ({ requestId: index }));
    };
    this.setTboostEnabled = enabled => { PROC_isTboostEnabled = enabled; };
    this.getBacklogSince = () => PROC_tboostBacklogSince;
    this.isReady = procIsTboostBacklogReady;
    this.canBatch = procCanTboostEntries;
`, backlogContext);

backlogContext.setQueueLength(3);
assert.strictEqual(backlogContext.isReady(1000), false);
assert.strictEqual(backlogContext.getBacklogSince(), null);
assert.strictEqual(backlogContext.canBatch([
    { requestId: 'image-1' },
    { requestId: 'image-2' },
    { requestId: 'image-3' },
    { requestId: 'image-4' }
]), true);
assert.strictEqual(backlogContext.canBatch([
    { requestId: 'image-1' },
    { requestId: 'crash-detection-1' },
    { requestId: 'image-3' },
    { requestId: 'image-4' }
]), false, 'processor health checks must never be satisfied by a composite prediction');

backlogContext.setQueueLength(4);
assert.strictEqual(backlogContext.isReady(1000), false, 'four queued images only arm the clock');
assert.strictEqual(backlogContext.getBacklogSince(), 1000);
assert.strictEqual(backlogContext.isReady(5999), false, 'TBOOST must not start before five seconds');
assert.strictEqual(backlogContext.isReady(6000), true, 'TBOOST starts after a continuous five seconds');

backlogContext.setQueueLength(3);
assert.strictEqual(backlogContext.isReady(6001), false);
assert.strictEqual(backlogContext.getBacklogSince(), null, 'dropping below four resets the clock');
backlogContext.setQueueLength(4);
assert.strictEqual(backlogContext.isReady(7000), false, 'a new backlog starts a new clock');
backlogContext.setTboostEnabled(false);
assert.strictEqual(backlogContext.isReady(12000), false, 'the saved option can disable TBOOST');
assert.strictEqual(backlogContext.getBacklogSince(), null);

const batchStart = processorSource.indexOf('async function procPerformTboostBatch');
const batchEnd = processorSource.indexOf('function procPostFilteringResult', batchStart);
let predictionScore = 0.1;
let individualRescans = 0;
let drawCount = 0;
let thresholdObserved = null;
const batchContext = {
    console,
    performance: { now() { return 10000; } },
    ROC_untrustedRoc: { threshold: 0.25 },
    PROC_tboostStats: {
        compositeScans: 0,
        sourceImages: 0,
        rescannedImages: 0,
        netModelCallsSaved: 0
    },
    async procLoadTboostCandidate(entry) {
        return {
            entry,
            blob: { async arrayBuffer() { return Buffer.from(entry.requestId); } },
            img: { width: 100, height: 100 },
            url: 'blob:' + entry.requestId,
            eligible: true
        };
    },
    procReleaseTboostCandidates() {},
    procCreateCompositeCanvas() { return {}; },
    procDrawCompositeTile() { drawCount++; },
    async procPredict() { return [[predictionScore], [1, 0, 0, 0]]; },
    procGetPrimaryScore(score) { return score[0][0]; },
    procIsSafe(score, threshold) {
        thresholdObserved = threshold;
        return score[0][0] < threshold;
    },
    async procClassifyTboostCandidate(candidate) {
        individualRescans++;
        return { requestId: candidate.entry.requestId, result: 'individual', threshold: candidate.entry.threshold };
    },
    procCreateFilteringResult(entry) {
        return { type: 'scan', requestId: entry.requestId, imageBytes: null, result: null };
    },
    async procPerformFiltering() {
        throw new Error('fallback should not be used for eligible candidates');
    }
};
vm.createContext(batchContext);
vm.runInContext(processorSource.slice(batchStart, batchEnd) + `
    this.performTboostBatch = procPerformTboostBatch;
`, batchContext);

const entries = Array.from({ length: 4 }, (_, index) => ({
    requestId: 'image-' + index,
    threshold: 0.1 + index / 10
}));

(async () => {
    const passResults = await batchContext.performTboostBatch(entries);
    assert.strictEqual(thresholdObserved, 0.25, 'four-up uses the untrusted threshold');
    assert.strictEqual(drawCount, 4, 'all four images are tiled into the pre-scan');
    assert.strictEqual(individualRescans, 0, 'a passing pre-scan avoids individual predictions');
    assert.strictEqual(JSON.stringify(passResults.map(result => result.result)),
        JSON.stringify(['pass', 'pass', 'pass', 'pass']));
    assert.strictEqual(batchContext.PROC_tboostStats.netModelCallsSaved, 3);

    predictionScore = 0.3;
    const rescanResults = await batchContext.performTboostBatch(entries);
    assert.strictEqual(individualRescans, 4, 'a triggering pre-scan rescans every image');
    assert.strictEqual(JSON.stringify(rescanResults.map(result => result.threshold)),
        JSON.stringify(entries.map(entry => entry.threshold)),
        'individual rescans retain each request\'s original zone threshold');
    assert.strictEqual(batchContext.PROC_tboostStats.netModelCallsSaved, 2,
        'a triggering four-up costs one model call relative to four ordinary scans');

    console.log('TBOOST backlog tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
