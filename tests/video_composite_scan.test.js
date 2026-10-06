const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const optionsHtml = fs.readFileSync(path.join(root, 'options.html'), 'utf8');
const optionsSource = fs.readFileSync(path.join(root, 'options.js'), 'utf8');
const backgroundSource = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const videoSource = fs.readFileSync(path.join(root, 'background_video.js'), 'utf8');
const processorSource = fs.readFileSync(path.join(root, 'processor.js'), 'utf8');

assert.match(optionsHtml, /id="video_blocking_mode_quick"[^>]*value="quick"[^>]*checked/,
    'Quick Scan must be checked by default');
assert.doesNotMatch(optionsHtml, /video_blocking_mode_turbo/,
    'TurboScan must not remain as a distinct mode');
assert.match(optionsHtml, /All video scans combine up to four frames/,
    'the options UI must explain the shared combined-frame behavior');
assert.match(optionsSource, /coercedResult = 'quick'/,
    'missing saved settings must restore to Quick Scan');
assert.match(optionsSource, /result === 'enabled' \|\| result === 'quick' \|\| result === 'disabled'/,
    'saved TurboScan and invalid settings must migrate safely in the options UI');
assert.match(backgroundSource, /let BK_videoScanMode = 'quick'/,
    'background startup must default to Quick Scan');

const normalizeStart = backgroundSource.indexOf('function bkNormalizeVideoScanMode');
const normalizeEnd = backgroundSource.indexOf('function bkSetVideoScanMode', normalizeStart);
const normalizeContext = {};
vm.createContext(normalizeContext);
vm.runInContext(backgroundSource.slice(normalizeStart, normalizeEnd) + `
    this.normalizeVideoScanMode = bkNormalizeVideoScanMode;
`, normalizeContext);
assert.strictEqual(normalizeContext.normalizeVideoScanMode('quick'), 'quick');
assert.strictEqual(normalizeContext.normalizeVideoScanMode('enabled'), 'enabled');
assert.strictEqual(normalizeContext.normalizeVideoScanMode('turbo'), 'quick',
    'saved TurboScan settings must migrate to Quick Scan');
assert.strictEqual(normalizeContext.normalizeVideoScanMode('invalid'), 'quick');

const quickStart = videoSource.indexOf('function vidGetScanMaxSteps');
const quickEnd = videoSource.indexOf('async function vidPrerequestListener', quickStart);
const quickContext = { BK_videoScanMode: 'quick' };
vm.createContext(quickContext);
vm.runInContext(`
    const VID_COMPOSITE_SCAN_MAX_FRAMES = 4;
` + videoSource.slice(quickStart, quickEnd) + `
    this.getScanMaxSteps = vidGetScanMaxSteps;
    this.shouldQuickScanBlock = vidShouldQuickScanBlock;
    this.shouldQuickScanPass = vidShouldQuickScanPass;
`, quickContext);
assert.strictEqual(quickContext.getScanMaxSteps(20, 0), 4,
    'Quick Scan must load no more than four frames');
assert.strictEqual(quickContext.getScanMaxSteps(20, 1), 0,
    'Quick Scan must stop after its single combined inference');
assert.strictEqual(quickContext.shouldQuickScanBlock({ blockCount: 1 }), true);
assert.strictEqual(quickContext.shouldQuickScanPass(1), true);
quickContext.BK_videoScanMode = 'enabled';
assert.strictEqual(quickContext.getScanMaxSteps(20, 0), 20,
    'Enabled mode must continue loading frames for repeated composite scans');
assert.strictEqual(quickContext.shouldQuickScanBlock({ blockCount: 1 }), false);
assert.strictEqual(quickContext.shouldQuickScanPass(1), false);

const defaultListenerStart = videoSource.indexOf('async function vidDefaultListener');
const defaultListenerEnd = videoSource.indexOf('function vidCheckCreateDashGroup', defaultListenerStart);
const filterCalls = { close: 0, disconnect: 0, write: 0 };
const completedStatuses = [];
const mockFilter = {
    write() { filterCalls.write++; },
    close() { filterCalls.close++; },
    disconnect() { filterCalls.disconnect++; }
};
const defaultListenerContext = {
    console,
    Uint8Array,
    WJR_DEBUG: false,
    performance: { now() { return 0; } },
    browser: {
        webRequest: {
            filterResponseData() { return mockFilter; }
        }
    },
    statusStartVideoCheck() {},
    statusCompleteVideoCheck(requestId, status) { completedStatuses.push(status); },
    statusIndicateVideoProgress() {},
    bkGetNextProcessor() { return { port: {} }; },
    vidGetScanMaxSteps() { return 4; },
    async vidPerformVideoScan() {
        return {
            scanCount: 1,
            blockCount: 0,
            error: undefined,
            frames: [{ time: 3.5, status: 'pass' }]
        };
    },
    vidShouldQuickScanBlock() { return false; },
    vidShouldQuickScanPass() { return true; },
    vidConcatBuffersToUint8Array() { throw new Error('not expected'); },
    vidDetectType() { throw new Error('not expected'); },
    VID_PLACEHOLDER_MP4: new Uint8Array(),
    VID_PLACEHOLDER_WEBM: new Uint8Array()
};
vm.createContext(defaultListenerContext);
vm.runInContext(videoSource.slice(defaultListenerStart, defaultListenerEnd) + `
    this.defaultListener = vidDefaultListener;
`, defaultListenerContext);

const processorStart = processorSource.indexOf('const PROC_VIDEO_COMPOSITE_MAX_FRAMES');
const processorEnd = processorSource.indexOf('async function procOnPortMessage', processorStart);
const drawCalls = [];
let predictionCount = 0;
const canvasContext = {
    fillStyle: '',
    imageSmoothingEnabled: false,
    fillRect() {},
    drawImage(...args) { drawCalls.push(args); }
};
const processorContext = {
    console,
    WJR_DEBUG: false,
    URL: {
        revokeObjectURL() {}
    },
    document: {
        createElement(type) {
            if (type === 'canvas') {
                return {
                    width: 0,
                    height: 0,
                    getContext() { return canvasContext; }
                };
            }
            return {
                width: 0,
                height: 0,
                videoWidth: 640,
                videoHeight: 360,
                autoplay: false
            };
        }
    },
    procGetVideoUrl() { return 'blob:test-video'; },
    async procVideoLoadedData(video) {
        video.width = video.videoWidth;
        video.height = video.videoHeight;
    },
    procGetMaxVideoTime() { return 60; },
    procGetBufferedRangesString() { return '[0,60]'; },
    async procPredict() {
        predictionCount++;
        return [[0.9], [0.1]];
    },
    procIsSafe() { return true; },
    procScoreToStr() { return 'safe'; },
    async procCommonLogImg() {},
    async procCommonWarnImg() {}
};
vm.createContext(processorContext);
vm.runInContext(`const PROC_IMAGE_SIZE = 224;\n` +
    processorSource.slice(processorStart, processorEnd) + `
    this.getVideoScanStatus = procGetVideoScanStatus;
`, processorContext);

(async () => {
    await defaultListenerContext.defaultListener(
        { requestId: 'default-request', url: 'https://example.test/video.mp4', type: 'media' },
        'video/mp4', {}, 1024, 0.5
    );
    await mockFilter.onstop();
    assert.strictEqual(filterCalls.disconnect, 1,
        'a passing Quick Scan must disconnect the response filter once');
    assert.strictEqual(filterCalls.close, 0,
        'onstop must not close a response filter that Quick Scan already disconnected');
    assert.deepStrictEqual(completedStatuses, ['pass'],
        'a passing Quick Scan must complete status exactly once');

    const quickResult = await processorContext.getVideoScanStatus(
        'chain', 'request', 'media', 'https://example.test/video.mp4', 'video/mp4',
        [], 0.5, 0.5, 1, 4, 3
    );
    assert.strictEqual(predictionCount, 1, 'Quick Scan must perform exactly one ML inference');
    assert.strictEqual(drawCalls.length, 4, 'Quick Scan must compose four frames');
    assert.strictEqual(quickResult.scanCount, 1, 'the combined image counts as one scan');
    assert.strictEqual(quickResult.sourceFrameCount, 4);
    assert.strictEqual(quickResult.frames.length, 4);

    predictionCount = 0;
    drawCalls.length = 0;
    const enabledResult = await processorContext.getVideoScanStatus(
        'chain', 'request-2', 'media', 'https://example.test/video.mp4', 'video/mp4',
        [], 0.5, 0.5, 1, 9, 3
    );
    assert.strictEqual(predictionCount, 3,
        'Enabled mode must use one inference for each group of up to four frames');
    assert.strictEqual(drawCalls.length, 9, 'Enabled mode must compose every loaded frame');
    assert.strictEqual(enabledResult.scanCount, 3);
    assert.strictEqual(enabledResult.sourceFrameCount, 9);
    assert.strictEqual(enabledResult.frames.length, 9);

    console.log('video composite scan tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
