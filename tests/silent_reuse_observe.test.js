const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

let thumbnailEncodeCount = 0;
const fakeContext = {
    imageSmoothingEnabled: false,
    imageSmoothingQuality: '',
    fillStyle: '',
    fillRect() {},
    drawImage() {}
};
const fakeDocument = {
    createElement(type) {
        assert.strictEqual(type, 'canvas');
        return {
            width: 0,
            height: 0,
            getContext() { return fakeContext; },
            toDataURL() {
                thumbnailEncodeCount++;
                return 'data:image/jpeg;base64,profile-test';
            }
        };
    }
};

const context = vm.createContext({
    URL,
    Date,
    Map,
    console,
    document: fakeDocument,
    WJR_DEBUG: false
});
const source = fs.readFileSync('silent_reuse.js', 'utf8');
vm.runInContext(source + `
this.silentReuseObserveTestApi = {
    observe: SMR_observeSafeImage,
    maxImages: SMR_MAX_IMAGES_PER_SCOPE
};`, context);

const img = { width: 100, height: 100 };
const score = [[0.01], [1, 0, 0, 0]];
let lastResult = null;
for(let index = 0; index < context.silentReuseObserveTestApi.maxImages + 1; index++) {
    lastResult = context.silentReuseObserveTestApi.observe(
        img,
        score,
        0.5,
        {
            scopeKey: 'profile-test-scope',
            sourceUrl: `https://images.example/${index}.jpg`,
            requestId: String(index)
        }
    );
}

assert.strictEqual(lastResult.outcome, 'admitted');
assert.strictEqual(lastResult.evictedCount, 1);
assert.strictEqual(lastResult.scopeSize, context.silentReuseObserveTestApi.maxImages);
assert.strictEqual(thumbnailEncodeCount, context.silentReuseObserveTestApi.maxImages + 1);

console.log('silent reuse observation tests passed');
