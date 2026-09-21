const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const context = {
    console,
    Date: { now: () => 100000 },
    window: {},
    setInterval: () => 1,
    clearInterval: () => {}
};
vm.createContext(context);

const source = fs.readFileSync(path.join(__dirname, '..', 'popup.js'), 'utf8');
vm.runInContext(source + `
    this.smartPauseTestApi = {
        formatRemaining: popFormatPauseRemaining,
        setState: popSetMasterFilteringState,
        getState: () => POP_masterFilteringState
    };
`, context);

const api = context.smartPauseTestApi;

assert.strictEqual(api.formatRemaining(100000 + (4 * 60 + 18) * 1000), '4m18s');
assert.strictEqual(api.formatRemaining(100000 + 18 * 1000), '18s');

api.setState({
    mode: 'paused',
    pauseUntil: 400000,
    pauseDurationMs: 300000
});
assert.deepStrictEqual(
    JSON.parse(JSON.stringify(api.getState())),
    { mode: 'paused', pauseUntil: 400000, pauseDurationMs: 300000 }
);

api.setState({ mode: 'paused', pauseUntil: null, pauseDurationMs: null });
assert.strictEqual(api.getState().mode, 'off');

api.setState({ onOff: 'on' });
assert.strictEqual(api.getState().mode, 'on');

console.log('smart pause tests passed');
