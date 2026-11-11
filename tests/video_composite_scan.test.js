const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const optionsHtml = fs.readFileSync(path.join(root, 'ui', 'options.html'), 'utf8');
const optionsSource = fs.readFileSync(path.join(root, 'ui', 'options.js'), 'utf8');
const backgroundSource = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const videoSource = fs.readFileSync(path.join(root, 'background_video.js'), 'utf8');
const processorSource = fs.readFileSync(path.join(root, 'processor.js'), 'utf8');

const videoLoadStart = processorSource.indexOf('const VIDEO_LOAD_TIMEOUT_MS');
const videoLoadEnd = processorSource.indexOf('function procGetMp4Parsed', videoLoadStart);
const pendingTimeouts = [];
let clearedTimeoutCount = 0;
const videoLoadContext = {
    console,
    WJR_DEBUG: false,
    setTimeout(callback) {
        pendingTimeouts.push(callback);
        return pendingTimeouts.length;
    },
    clearTimeout() { clearedTimeoutCount++; }
};
vm.createContext(videoLoadContext);
vm.runInContext(processorSource.slice(videoLoadStart, videoLoadEnd) + `
    this.videoLoadedFirstFrame = procVideoLoadedFirstFrame;
    this.videoLoadedData = procVideoLoadedData;
`, videoLoadContext);

function createEventVideo() {
    const listeners = new Map();
    return {
        error: null,
        videoWidth: 640,
        videoHeight: 360,
        width: 0,
        height: 0,
        currentTime: 0,
        addEventListener(type, callback) {
            if(!listeners.has(type)) {
                listeners.set(type, new Set());
            }
            listeners.get(type).add(callback);
        },
        removeEventListener(type, callback) {
            listeners.get(type)?.delete(callback);
        },
        dispatch(type) {
            for(const callback of [...(listeners.get(type) || [])]) {
                callback();
            }
        },
        listenerCount(type) {
            return listeners.get(type)?.size || 0;
        }
    };
}

assert.match(optionsHtml, /id="video_blocking_mode_quick"[^>]*value="quick"[^>]*checked/,
    'Quick Scan must be checked by default');
assert.doesNotMatch(optionsHtml, /video_blocking_mode_turbo/,
    'TurboScan must not remain as a distinct mode');
assert.match(optionsHtml, /opening video frame is scanned at full image size/,
    'the options UI must explain the full-size opening-frame scan');
assert.match(optionsHtml, /Later scans combine up to four frames/,
    'the options UI must explain the later combined-frame behavior');
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
    const VID_OPENING_FRAME_MAX_ATTEMPTS = 2;
` + videoSource.slice(quickStart, quickEnd) + `
    this.getScanMaxSteps = vidGetScanMaxSteps;
    this.shouldOpeningFrameBlock = vidShouldOpeningFrameBlock;
    this.shouldScanOpeningFrame = vidShouldScanOpeningFrame;
    this.isOpeningFrameGateComplete = vidIsOpeningFrameGateComplete;
    this.shouldQuickScanBlock = vidShouldQuickScanBlock;
    this.shouldQuickScanPass = vidShouldQuickScanPass;
`, quickContext);
assert.strictEqual(quickContext.getScanMaxSteps(20, 0), 4,
    'Quick Scan must load no more than four frames');
assert.strictEqual(quickContext.getScanMaxSteps(20, 1), 0,
    'Quick Scan must stop after its single combined inference');
assert.strictEqual(quickContext.shouldQuickScanBlock({ blockCount: 1 }), true);
assert.strictEqual(quickContext.shouldOpeningFrameBlock({ openingFrameStatus: 'block' }), true);
assert.strictEqual(quickContext.shouldOpeningFrameBlock({ openingFrameStatus: 'pass' }), false);
assert.strictEqual(quickContext.shouldScanOpeningFrame(false, 0), true);
assert.strictEqual(quickContext.shouldScanOpeningFrame(false, 2), false,
    'opening-frame technical retries must be capped');
assert.strictEqual(quickContext.isOpeningFrameGateComplete(false, 1), false);
assert.strictEqual(quickContext.isOpeningFrameGateComplete(false, 2), true,
    'later chunks must fall back to normal scanning after two technical failures');
assert.strictEqual(quickContext.shouldQuickScanPass(1, false), false,
    'Quick Scan cannot pass before its opening-frame gate passes');
assert.strictEqual(quickContext.shouldQuickScanPass(1, true), true);
quickContext.BK_videoScanMode = 'enabled';
assert.strictEqual(quickContext.getScanMaxSteps(20, 0), 20,
    'Enabled mode must continue loading frames for repeated composite scans');
assert.strictEqual(quickContext.shouldQuickScanBlock({ blockCount: 1 }), false);
assert.strictEqual(quickContext.shouldQuickScanPass(1, true), false);

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
            openingFrameStatus: 'pass',
            frames: [{ time: 3.5, status: 'pass' }]
        };
    },
    vidShouldOpeningFrameBlock() { return false; },
    vidShouldScanOpeningFrame() { return true; },
    vidIsOpeningFrameGateComplete() { return true; },
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
const predictionInputs = [];
let modelSafe = true;
const videoCleanupCalls = { pause: 0, removeSrc: 0, load: 0, revoke: 0 };
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
        revokeObjectURL() { videoCleanupCalls.revoke++; }
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
                elementType: 'video',
                width: 0,
                height: 0,
                videoWidth: 640,
                videoHeight: 360,
                autoplay: false,
                pause() { videoCleanupCalls.pause++; },
                removeAttribute(name) {
                    if(name === 'src') {
                        videoCleanupCalls.removeSrc++;
                    }
                },
                load() { videoCleanupCalls.load++; }
            };
        }
    },
    procGetVideoUrl() { return 'blob:test-video'; },
    async procVideoLoadedFirstFrame(video) {
        video.width = video.videoWidth;
        video.height = video.videoHeight;
        video.currentTime = 0;
    },
    async procVideoLoadedData(video) {
        video.width = video.videoWidth;
        video.height = video.videoHeight;
    },
    procGetMaxVideoTime() { return 60; },
    procGetBufferedRangesString() { return '[0,60]'; },
    async procPredict(input) {
        predictionCount++;
        predictionInputs.push(input);
        return [[0.9], [0.1]];
    },
    procIsSafe() { return modelSafe; },
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
    const firstFrameVideo = createEventVideo();
    const firstFramePromise = videoLoadContext.videoLoadedFirstFrame(firstFrameVideo, 'blob:first');
    assert.strictEqual(firstFrameVideo.listenerCount('error'), 1);
    assert.strictEqual(firstFrameVideo.listenerCount('loadeddata'), 1);
    firstFrameVideo.dispatch('loadeddata');
    await firstFramePromise;
    assert.strictEqual(firstFrameVideo.listenerCount('error'), 0,
        'successful opening-frame loads must remove their error listener');
    assert.strictEqual(firstFrameVideo.listenerCount('loadeddata'), 0,
        'successful opening-frame loads must remove their loaded-data listener');
    assert.strictEqual(clearedTimeoutCount, 1,
        'successful opening-frame loads must cancel their timeout');

    const firstFrameTimeoutVideo = createEventVideo();
    const firstFrameTimeoutPromise = videoLoadContext.videoLoadedFirstFrame(firstFrameTimeoutVideo, 'blob:first-timeout');
    pendingTimeouts[pendingTimeouts.length - 1]();
    await assert.rejects(firstFrameTimeoutPromise, /Timed out loading opening frame in 5000 ms/);
    assert.strictEqual(firstFrameTimeoutVideo.listenerCount('error'), 0,
        'timed-out opening-frame loads must remove their error listener');
    assert.strictEqual(firstFrameTimeoutVideo.listenerCount('loadeddata'), 0,
        'timed-out opening-frame loads must remove their loaded-data listener');
    assert.strictEqual(clearedTimeoutCount, 2,
        'timed-out opening-frame loads must clear their timer during cleanup');

    const eventVideo = createEventVideo();
    const loadedPromise = videoLoadContext.videoLoadedData(eventVideo, 'blob:test', 1.5);
    assert.strictEqual(eventVideo.listenerCount('error'), 1);
    assert.strictEqual(eventVideo.listenerCount('seeked'), 1);
    eventVideo.dispatch('seeked');
    await loadedPromise;
    assert.strictEqual(eventVideo.listenerCount('error'), 0,
        'successful video loads must remove their error listener');
    assert.strictEqual(eventVideo.listenerCount('seeked'), 0,
        'successful video loads must remove their seek listener');
    assert.strictEqual(clearedTimeoutCount, 3,
        'successful video loads must cancel their timeout');

    const timedOutVideo = createEventVideo();
    const timedOutPromise = videoLoadContext.videoLoadedData(timedOutVideo, 'blob:timeout', 2.5);
    pendingTimeouts[pendingTimeouts.length - 1]();
    await assert.rejects(timedOutPromise, /Timed out in 5000 ms/);
    assert.strictEqual(timedOutVideo.listenerCount('error'), 0,
        'timed-out video loads must remove their error listener');
    assert.strictEqual(timedOutVideo.listenerCount('seeked'), 0,
        'timed-out video loads must remove their seek listener');
    assert.strictEqual(clearedTimeoutCount, 4,
        'timed-out video loads must clear their timer during cleanup');

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
        [], 0.5, true, 0.5, 1, 4, 3
    );
    assert.strictEqual(predictionCount, 2,
        'Quick Scan must perform an opening-frame inference and one combined inference');
    assert.strictEqual(predictionInputs[0].elementType, 'video',
        'the opening frame must be predicted directly as a full-size image');
    assert.strictEqual(quickResult.openingFrameStatus, 'pass');
    assert.strictEqual(drawCalls.length, 4, 'Quick Scan must compose four frames');
    assert.strictEqual(quickResult.scanCount, 1, 'the combined image counts as one scan');
    assert.strictEqual(quickResult.sourceFrameCount, 4);
    assert.strictEqual(quickResult.frames.length, 4);
    assert.deepStrictEqual(videoCleanupCalls,
        { pause: 1, removeSrc: 1, load: 1, revoke: 1 },
        'completed video scans must release the media element before revoking its URL');

    predictionCount = 0;
    predictionInputs.length = 0;
    drawCalls.length = 0;
    const enabledResult = await processorContext.getVideoScanStatus(
        'chain', 'request-2', 'media', 'https://example.test/video.mp4', 'video/mp4',
        [], 0.5, true, 0.5, 1, 9, 3
    );
    assert.strictEqual(predictionCount, 4,
        'Enabled mode must add one opening-frame inference to its combined scans');
    assert.strictEqual(enabledResult.openingFrameStatus, 'pass');
    assert.strictEqual(drawCalls.length, 9, 'Enabled mode must compose every loaded frame');
    assert.strictEqual(enabledResult.scanCount, 3);
    assert.strictEqual(enabledResult.sourceFrameCount, 9);
    assert.strictEqual(enabledResult.frames.length, 9);
    assert.deepStrictEqual(videoCleanupCalls,
        { pause: 2, removeSrc: 2, load: 2, revoke: 2 },
        'every completed video scan must release its media resources exactly once');

    predictionCount = 0;
    predictionInputs.length = 0;
    drawCalls.length = 0;
    modelSafe = false;
    const blockedOpeningResult = await processorContext.getVideoScanStatus(
        'chain', 'request-3', 'media', 'https://example.test/video.mp4', 'video/mp4',
        [], 0.5, true, 0.5, 1, 4, 3
    );
    assert.strictEqual(blockedOpeningResult.openingFrameStatus, 'block');
    assert.strictEqual(blockedOpeningResult.scanCount, 0,
        'an unsafe opening frame must stop before any combined scans');
    assert.strictEqual(predictionCount, 1,
        'an unsafe opening frame must be rejected after its single full-size inference');
    assert.strictEqual(drawCalls.length, 0,
        'an unsafe opening frame must not be added to a composite');
    assert.deepStrictEqual(videoCleanupCalls,
        { pause: 3, removeSrc: 3, load: 3, revoke: 3 },
        'a blocked opening frame must still release its media resources');

    console.log('video composite scan tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
