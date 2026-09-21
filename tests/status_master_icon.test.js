const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const drawingOperations = [];
const canvasContext = {
    clearRect: (...args) => drawingOperations.push(['clearRect', ...args]),
    fillRect: (...args) => drawingOperations.push(['fillRect', ...args]),
    beginPath: () => drawingOperations.push(['beginPath']),
    moveTo: (...args) => drawingOperations.push(['moveTo', ...args]),
    lineTo: (...args) => drawingOperations.push(['lineTo', ...args]),
    arcTo: (...args) => drawingOperations.push(['arcTo', ...args]),
    arc: (...args) => drawingOperations.push(['arc', ...args]),
    closePath: () => drawingOperations.push(['closePath']),
    stroke: () => drawingOperations.push(['stroke']),
    fill: () => drawingOperations.push(['fill']),
    drawImage: (...args) => drawingOperations.push(['drawImage', ...args]),
    fillText: (...args) => drawingOperations.push(['fillText', ...args]),
    getImageData: () => ({ pixels: true })
};

let iconUpdateCount = 0;
const context = vm.createContext({
    console,
    Date,
    Math,
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
            setIcon: () => iconUpdateCount++,
            setTitle: () => {},
            setBadgeText: () => {}
        }
    }
});

const statusSource = fs.readFileSync('status.js', 'utf8');
vm.runInContext(statusSource + `
    this.statusMasterIconTestApi = {
        regenerate: statusRegenerateIcon,
        setMasterState: statusSetMasterFilteringState,
        startImage: statusStartImageCheck,
        completeImage: statusCompleteImageCheck
    };
`, context);

const api = context.statusMasterIconTestApi;
api.regenerate(true);
assert.strictEqual(iconUpdateCount, 1);

api.setMasterState('paused', Date.now() + 5 * 60 * 1000);
assert.strictEqual(iconUpdateCount, 2);
assert.ok(drawingOperations.some(operation => operation[0] === 'arc'));

api.setMasterState('paused', Date.now() + 4 * 60 * 1000);
assert.strictEqual(iconUpdateCount, 2, 'countdown refresh should not rewrite the icon');

api.startImage('late-request');
api.completeImage('late-request', 'pass');
assert.strictEqual(iconUpdateCount, 2, 'late progress should stay hidden while paused');

api.setMasterState('off', null);
assert.strictEqual(iconUpdateCount, 3);

api.setMasterState('on', null);
assert.strictEqual(iconUpdateCount, 4);

console.log('status master icon tests passed');
