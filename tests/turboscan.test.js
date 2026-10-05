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

assert.match(optionsHtml, /id="video_blocking_mode_turbo"[^>]*value="turbo"[^>]*checked/,
    'TurboScan must be checked by default');
assert.match(optionsHtml, /TurboScan combines up to four early frames/,
    'the options UI must explain the combined-frame behavior');
assert.match(optionsSource, /coercedResult = 'turbo'/,
    'missing saved settings must restore to TurboScan');
assert.match(backgroundSource, /let BK_videoScanMode = 'turbo'/,
    'background startup must default to TurboScan');

const normalizeStart = backgroundSource.indexOf('function bkNormalizeVideoScanMode');
const normalizeEnd = backgroundSource.indexOf('function bkSetVideoScanMode', normalizeStart);
const normalizeContext = {};
vm.createContext(normalizeContext);
vm.runInContext(backgroundSource.slice(normalizeStart, normalizeEnd) + `
    this.normalizeVideoScanMode = bkNormalizeVideoScanMode;
`, normalizeContext);
assert.strictEqual(normalizeContext.normalizeVideoScanMode('turbo'), 'turbo');
assert.strictEqual(normalizeContext.normalizeVideoScanMode('quick'), 'quick');
assert.strictEqual(normalizeContext.normalizeVideoScanMode('invalid'), 'turbo');

const limitedStart = videoSource.indexOf('function vidGetLimitedScanMaxSteps');
const limitedEnd = videoSource.indexOf('async function vidPrerequestListener', limitedStart);
const limitedContext = { BK_videoScanMode: 'turbo' };
vm.createContext(limitedContext);
vm.runInContext(`
    const VID_QUICK_SCAN_MAX_FRAMES = 3;
    const VID_TURBO_SCAN_MAX_FRAMES = 4;
` + videoSource.slice(limitedStart, limitedEnd) + `
    this.getLimitedScanMaxSteps = vidGetLimitedScanMaxSteps;
    this.shouldLimitedScanBlock = vidShouldLimitedScanBlock;
    this.shouldLimitedScanPass = vidShouldLimitedScanPass;
`, limitedContext);
assert.strictEqual(limitedContext.getLimitedScanMaxSteps(20, 0), 4,
    'TurboScan must load no more than four frames');
assert.strictEqual(limitedContext.getLimitedScanMaxSteps(20, 1), 0,
    'TurboScan must stop after its single combined inference');
assert.strictEqual(limitedContext.shouldLimitedScanBlock({ blockCount: 1 }), true);
assert.strictEqual(limitedContext.shouldLimitedScanPass(1), true);

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
    vidGetLimitedScanMaxSteps() { return 4; },
    async vidPerformVideoScan() {
        return {
            scanCount: 1,
            blockCount: 0,
            error: undefined,
            frames: [{ time: 3.5, status: 'pass' }]
        };
    },
    vidShouldLimitedScanBlock() { return false; },
    vidShouldLimitedScanPass() { return true; },
    vidGetLimitedScanLabel() { return 'TurboScan'; },
    vidConcatBuffersToUint8Array() { throw new Error('not expected'); },
    vidDetectType() { throw new Error('not expected'); },
    VID_PLACEHOLDER_MP4: new Uint8Array(),
    VID_PLACEHOLDER_WEBM: new Uint8Array()
};
vm.createContext(defaultListenerContext);
vm.runInContext(videoSource.slice(defaultListenerStart, defaultListenerEnd) + `
    this.defaultListener = vidDefaultListener;
`, defaultListenerContext);

const processorStart = processorSource.indexOf('const PROC_TURBO_SCAN_MAX_FRAMES');
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
        'a passing TurboScan must disconnect the response filter once');
    assert.strictEqual(filterCalls.close, 0,
        'onstop must not close a response filter that TurboScan already disconnected');
    assert.deepStrictEqual(completedStatuses, ['pass'],
        'a passing TurboScan must complete status exactly once');

    const turboResult = await processorContext.getVideoScanStatus(
        'chain', 'request', 'media', 'https://example.test/video.mp4', 'video/mp4',
        [], 0.5, 0.5, 1, 20, 3, 'turbo'
    );
    assert.strictEqual(predictionCount, 1, 'TurboScan must perform exactly one ML inference');
    assert.strictEqual(drawCalls.length, 4, 'TurboScan must compose four frames');
    assert.strictEqual(turboResult.scanCount, 1, 'the combined image counts as one scan');
    assert.strictEqual(turboResult.sourceFrameCount, 4);
    assert.strictEqual(turboResult.frames.length, 4);

    predictionCount = 0;
    const enabledResult = await processorContext.getVideoScanStatus(
        'chain', 'request-2', 'media', 'https://example.test/video.mp4', 'video/mp4',
        [], 0.5, 0.5, 1, 4, 3, 'enabled'
    );
    assert.strictEqual(predictionCount, 4, 'full scanning must retain one inference per frame');
    assert.strictEqual(enabledResult.scanCount, 4);

    console.log('TurboScan tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
