const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let now = 100000;
let nextTimerId = 1;
const timers = new Map();
const storedData = {};
const statusStates = [];
let registerCount = 0;
let unregisterCount = 0;

const context = {
    console,
    WJR_DEBUG: false,
    Date: { now: () => now },
    setTimeout: (callback, delay) => {
        const id = nextTimerId++;
        timers.set(id, { callback, delay });
        return id;
    },
    clearTimeout: id => timers.delete(id),
    bkRegisterAllCallbacks: () => { registerCount++; },
    bkUnregisterAllCallbacks: () => { unregisterCount++; },
    statusSetMasterFilteringState: (mode, pauseUntil) => {
        statusStates.push({ mode, pauseUntil });
    },
    browser: {
        storage: {
            local: {
                get: async key => Object.prototype.hasOwnProperty.call(storedData, key)
                    ? { [key]: storedData[key] }
                    : {},
                set: async values => Object.assign(storedData, values),
                remove: async key => { delete storedData[key]; }
            }
        }
    }
};
vm.createContext(context);

const backgroundSource = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
const smartPauseStart = backgroundSource.indexOf('const BK_MASTER_PAUSE_STORAGE_KEY');
const smartPauseEnd = backgroundSource.indexOf('let BK_videoScanMode', smartPauseStart);
assert.ok(smartPauseStart >= 0 && smartPauseEnd > smartPauseStart);
vm.runInContext(backgroundSource.slice(smartPauseStart, smartPauseEnd) + `
    this.smartPauseBackgroundTestApi = {
        getState: bkGetMasterFilteringState,
        startPause: bkStartMasterPause,
        resume: bkResumeMasterFiltering,
        turnOff: bkSetMasterFilteringOff,
        restore: bkRestoreMasterFilteringState
    };
`, context);

const api = context.smartPauseBackgroundTestApi;

(async () => {
    let state = await api.startPause(1);
    assert.strictEqual(state.mode, 'paused');
    assert.strictEqual(state.pauseUntil, now + 1 * 60 * 1000);
    assert.strictEqual(storedData.master_smart_pause.durationMs, 1 * 60 * 1000);
    assert.ok(timers.size > 0);

    const pauseTimer = Array.from(timers.values())[0];
    now = state.pauseUntil;
    pauseTimer.callback();
    await new Promise(resolve => setImmediate(resolve));
    state = api.getState();
    assert.strictEqual(state.mode, 'on');
    assert.strictEqual(storedData.master_smart_pause, undefined);
    assert.ok(registerCount > 0);

    state = await api.turnOff();
    assert.strictEqual(state.mode, 'off');
    assert.ok(unregisterCount > 0);

    storedData.master_smart_pause = {
        until: now + 15 * 60 * 1000,
        durationMs: 15 * 60 * 1000
    };
    await api.restore();
    assert.strictEqual(api.getState().mode, 'paused');

    now += 16 * 60 * 1000;
    await api.restore();
    assert.strictEqual(api.getState().mode, 'on');
    assert.ok(statusStates.length > 0);

    console.log('smart pause background tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
