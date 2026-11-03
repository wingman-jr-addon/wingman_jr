const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('processor.js', 'utf8');
const start = source.indexOf('function procCreateSerialTaskQueue');
const end = source.indexOf('async function procRunGifFrameScan');
assert.ok(start >= 0 && end > start, 'serial GIF queue helper must remain discoverable');

const context = vm.createContext({});
vm.runInContext(source.slice(start, end) + `
this.gifQueueTestApi = { create: procCreateSerialTaskQueue };
`, context);

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

(async () => {
    const controls = [deferred(), deferred(), deferred()];
    const starts = [];
    const queue = context.gifQueueTestApi.create(async value => {
        starts.push(value);
        return controls[value - 1].promise;
    });

    const first = queue.enqueue(1);
    const second = queue.enqueue(2);
    const third = queue.enqueue(3);
    assert.deepStrictEqual(starts, [1]);

    controls[0].resolve('one');
    assert.strictEqual(await first, 'one');
    await Promise.resolve();
    assert.deepStrictEqual(starts, [1, 2]);

    controls[1].reject(new Error('expected test failure'));
    await assert.rejects(second, /expected test failure/);
    await Promise.resolve();
    assert.deepStrictEqual(starts, [1, 2, 3]);

    controls[2].resolve('three');
    assert.strictEqual(await third, 'three');

    assert.match(source, /case 'gif_frame':[\s\S]*PROC_gifFrameScanQueue\.enqueue\(m\)/);
    console.log('GIF scan serialization tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
