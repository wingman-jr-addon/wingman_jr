const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const badgeUpdates = [];
const canvasContext = {
    clearRect() {},
    fillRect() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    arcTo() {},
    arc() {},
    closePath() {},
    stroke() {},
    fill() {},
    drawImage() {},
    fillText() {},
    getImageData: () => ({ pixels: true })
};

const context = vm.createContext({
    console,
    Date,
    Math,
    Map,
    Object,
    Number,
    String,
    Image: function Image() {},
    document: {
        createElement: () => ({
            width: 0,
            height: 0,
            getContext: () => canvasContext
        })
    },
    browser: {
        browserAction: {
            setIcon() {},
            setTitle() {},
            setBadgeText: details => badgeUpdates.push({ ...details })
        }
    }
});

const statusSource = fs.readFileSync('status.js', 'utf8');
vm.runInContext(statusSource + `
    this.statusBadgeScopeTestApi = {
        startImage: statusStartImageCheck,
        completeImage: statusCompleteImageCheck,
        startVideo: statusStartVideoCheck,
        completeVideo: statusCompleteVideoCheck,
        setScope: statusSetBadgeCountScope,
        refreshTab: statusRefreshTabBadge,
        forgetTab: statusForgetTab
    };
`, context);

const api = context.statusBadgeScopeTestApi;

api.startImage('image-1', 7);
api.completeImage('image-1', 'block');
assert.deepStrictEqual(badgeUpdates.at(-1), { text: '1' },
    'global mode keeps the existing aggregate badge');

api.setScope('tab');
assert.ok(badgeUpdates.some(update => update.text === '' && update.tabId === undefined),
    'per-tab mode clears the global badge');
assert.deepStrictEqual(badgeUpdates.at(-1), { text: '1', tabId: 7 },
    'existing blocks are available when per-tab mode is enabled');

api.startVideo('video-1', 8);
api.completeVideo('video-1', 'block');
assert.deepStrictEqual(badgeUpdates.at(-1), { text: '1', tabId: 8 },
    'video completion uses the tab retained by existing request accounting');

api.completeImage('base64-child', 'block', 8);
assert.deepStrictEqual(badgeUpdates.at(-1), { text: '2', tabId: 8 },
    'base64 results can supply their parent tab directly');

api.completeImage('safe-image', 'pass', 8);
assert.deepStrictEqual(badgeUpdates.at(-1), { text: '2', tabId: 8 },
    'non-blocking results do not change the per-tab count');

api.setScope('global');
assert.deepStrictEqual(badgeUpdates.at(-1), { text: '3' },
    'switching back restores the same aggregate count');
assert.ok(badgeUpdates.some(update => update.text === null && update.tabId === 7));
assert.ok(badgeUpdates.some(update => update.text === null && update.tabId === 8));

api.setScope('tab');
api.forgetTab(8);
api.refreshTab(8);
assert.deepStrictEqual(badgeUpdates.at(-1), { text: null, tabId: 8 },
    'closed tabs discard their scoped count');

const optionsHtml = fs.readFileSync('ui/options.html', 'utf8');
const optionsSource = fs.readFileSync('ui/options.js', 'utf8');
const backgroundSource = fs.readFileSync('background.js', 'utf8');
const videoSource = fs.readFileSync('background_video.js', 'utf8');
const gifSource = fs.readFileSync('background_gif.js', 'utf8');
const processorSource = fs.readFileSync('processor.js', 'utf8');

assert.match(optionsHtml, /id="badge_count_scope_global"[^>]*value="global"[^>]*checked/,
    'the existing global badge behavior remains the default');
assert.match(optionsHtml, /id="badge_count_scope_tab"[^>]*value="tab"/,
    'the options UI exposes per-tab badge counting');
assert.match(optionsSource, /badge_count_scope: badgeCountScope/,
    'the selected scope is persisted with protected settings');
assert.match(backgroundSource, /statusStartImageCheck\(details\.requestId, details\.tabId\)/,
    'ordinary images retain their tab in the existing request accounting');
assert.match(videoSource, /statusStartVideoCheck\(details\.requestId, details\.tabId\)/,
    'video requests retain their tab without changing completion branches');
assert.match(gifSource, /statusStartVideoCheck\(details\.requestId, details\.tabId\)/,
    'GIF requests reuse the video accounting path');
assert.match(processorSource, /tabId: b64Filter\.tabId/,
    'base64 child results retain the parent response tab');

console.log('status badge scope tests passed');
