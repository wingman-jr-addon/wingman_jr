const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('silent_mode.js', 'utf8');
const start = source.indexOf('async function smMaterializeReplacementSource');
const end = source.indexOf('async function SM_getReplacementSVG');
assert.ok(start >= 0 && end > start, 'lazy materialization helper must remain discoverable');

const created = [];
const revoked = [];
const loaded = [];
const context = vm.createContext({
    WJR_DEBUG: false,
    console,
    URL: {
        createObjectURL(blob) {
            created.push(blob);
            return 'blob:test-source';
        },
        revokeObjectURL(url) {
            revoked.push(url);
        }
    },
    smLoadImagePromise: async url => {
        loaded.push(url);
        return { width: 100, height: 100 };
    },
    smFormatImage: async () => 'data:image/png;base64,formatted',
    SM_pickBuiltInReplacementSource: () => ({
        src: 'fallback.jpg',
        label: 'fallback.jpg'
    })
});
vm.runInContext(source.slice(start, end) + `
this.materializationTestApi = {
    materialize: smMaterializeReplacementSource,
    withFallback: smMaterializeReplacementWithFallback
};`, context);

(async () => {
    const blob = new Blob([Uint8Array.from([1, 2, 3])], { type: 'image/jpeg' });
    const result = await context.materializationTestApi.materialize(
        { blob, formatting: null },
        { width: 100, height: 100 },
        1
    );
    assert.strictEqual(result, 'data:image/png;base64,formatted');
    assert.deepStrictEqual(created, [blob]);
    assert.deepStrictEqual(loaded, ['blob:test-source']);
    assert.deepStrictEqual(revoked, ['blob:test-source']);

    await context.materializationTestApi.materialize(
        { src: 'builtin.jpg', formatting: null },
        { width: 100, height: 100 },
        1
    );
    assert.deepStrictEqual(loaded, ['blob:test-source', 'builtin.jpg']);
    assert.deepStrictEqual(revoked, ['blob:test-source']);

    context.smLoadImagePromise = async url => {
        loaded.push(url);
        if (url === 'blob:test-source') {
            throw new Error('invalid cached bytes');
        }
        return { width: 100, height: 100 };
    };
    const fallbackResult = await context.materializationTestApi.withFallback(
        { blob, isSamePageReuse: true },
        { width: 100, height: 100 },
        1
    );
    assert.strictEqual(fallbackResult.replacementSource.src, 'fallback.jpg');
    assert.strictEqual(fallbackResult.imageDataUrl, 'data:image/png;base64,formatted');
    assert.deepStrictEqual(revoked, ['blob:test-source', 'blob:test-source']);

    console.log('lazy safe-image materialization tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
