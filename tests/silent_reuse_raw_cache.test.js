const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const context = vm.createContext({
    Blob,
    URL,
    Date,
    Map,
    console,
    WJR_DEBUG: false
});
const source = fs.readFileSync('silent_reuse.js', 'utf8');
vm.runInContext(source + `
this.rawCacheTestApi = {
    observe: SMR_observeSafeImage,
    pick: SMR_pickReplacementSource,
    getScope: SMR_getScope,
    maxImages: SMR_MAX_IMAGES_PER_SCOPE,
    maxSourceBytes: SMR_MAX_SOURCE_BYTES,
    totalBytes: SMR_getTotalBytes
};`, context);

const img = { width: 100, height: 100 };
const score = [[0.01], [1, 0, 0, 0]];
const makeContext = index => ({
    scopeKey: 'raw-cache-test',
    sourceUrl: `https://images.example/${index}.jpg`,
    requestId: String(index)
});

const firstBlob = new Blob([Uint8Array.from([1, 2, 3])], { type: 'image/jpeg' });
const firstResult = context.rawCacheTestApi.observe(
    img,
    score,
    0.5,
    makeContext(0),
    firstBlob
);
assert.strictEqual(firstResult.outcome, 'admitted');
assert.strictEqual(
    context.rawCacheTestApi.getScope('raw-cache-test', false).images[0].blob,
    firstBlob,
    'safe observation should retain the existing raw Blob without materializing a thumbnail'
);

let lastAdmission = null;
for(let index = 1; index <= context.rawCacheTestApi.maxImages; index++) {
    lastAdmission = context.rawCacheTestApi.observe(
        img,
        score,
        0.5,
        makeContext(index),
        new Blob([Uint8Array.from([index & 0xff])], { type: 'image/jpeg' })
    );
}
const scope = context.rawCacheTestApi.getScope('raw-cache-test', false);
assert.strictEqual(scope.images.length, context.rawCacheTestApi.maxImages);
assert.ok(!scope.images.some(candidate => candidate.sourceUrl.endsWith('/0.jpg')));
assert.strictEqual(lastAdmission.evictedCount, 1);

const selected = context.rawCacheTestApi.pick(img, makeContext('target'));
assert.ok(selected.blob instanceof Blob);
assert.strictEqual(selected.src, undefined);
assert.strictEqual(selected.isSamePageReuse, true);

const oversized = new Blob([
    new Uint8Array(context.rawCacheTestApi.maxSourceBytes + 1)
], { type: 'image/jpeg' });
const oversizedResult = context.rawCacheTestApi.observe(
    img,
    score,
    0.5,
    { scopeKey: 'oversized-test', sourceUrl: 'https://images.example/large.jpg' },
    oversized
);
assert.strictEqual(oversizedResult.outcome, 'too-large');
assert.strictEqual(context.rawCacheTestApi.getScope('oversized-test', false), undefined);
assert.ok(context.rawCacheTestApi.totalBytes() <= firstResult.scopeBytes + scope.byteSize);

console.log('raw safe-image cache tests passed');
