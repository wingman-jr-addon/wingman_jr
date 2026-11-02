const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('processor.js', 'utf8');
const start = source.indexOf('function procConcatBufferViews');
const end = source.indexOf('function procIsAnimatedWebp');
assert.ok(start >= 0 && end > start, 'response-buffer helpers must remain discoverable');

const context = vm.createContext({ Uint8Array, ArrayBuffer });
vm.runInContext(source.slice(start, end) + `
this.responseBufferTestApi = {
    originalBytes: procGetOriginalResponseBytes
};`, context);

const single = Uint8Array.from([1, 2, 3]).buffer;
assert.strictEqual(
    context.responseBufferTestApi.originalBytes([single]),
    single,
    'a single response chunk should be returned without copying'
);

const first = Uint8Array.from([1, 2]).buffer;
const second = Uint8Array.from([3, 4]).buffer;
const combined = context.responseBufferTestApi.originalBytes([first, second]);
assert.deepStrictEqual(Array.from(new Uint8Array(combined)), [1, 2, 3, 4]);
assert.notStrictEqual(combined, first);
assert.notStrictEqual(combined, second);

console.log('response buffer reuse tests passed');
