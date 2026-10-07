const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const {
    audPageClampBlur,
    audPageClusterBlocks,
    audPageDefaultBlurForRating,
    audPageRatingForBlock
} = require('../audit_page.js');

assert.strictEqual(audPageClampBlur(undefined), 5);
assert.strictEqual(audPageClampBlur(-1), 0);
assert.strictEqual(audPageClampBlur(10.4), 10);
assert.strictEqual(audPageClampBlur(4.74), 4.5);
assert.strictEqual(audPageClampBlur(4.76), 5);
assert.strictEqual(audPageDefaultBlurForRating('safe'), 0);
assert.strictEqual(audPageDefaultBlurForRating('q'), 4);
assert.strictEqual(audPageDefaultBlurForRating('r'), 6);
assert.strictEqual(audPageDefaultBlurForRating('x'), 10);
assert.strictEqual(audPageDefaultBlurForRating(null), 5);
assert.strictEqual(audPageRatingForBlock({ rating: 'r', score: 0.1 }), 'r');
assert.strictEqual(audPageRatingForBlock({ score: 0.2 }), null);
assert.strictEqual(audPageRatingForBlock({ score: 0.9 }), null);

const processorSource = fs.readFileSync('processor.js', 'utf8');
const ratingStart = processorSource.indexOf('function procGetAuditRating');
const ratingEnd = processorSource.indexOf('async function procCommonCreateSvg', ratingStart);
const ratingContext = {};
vm.createContext(ratingContext);
vm.runInContext(processorSource.slice(ratingStart, ratingEnd) + `
    this.getAuditRating = procGetAuditRating;
`, ratingContext);
assert.strictEqual(ratingContext.getAuditRating([[0.2], [0.7, 0.1, 0.1, 0.1]]), 'safe');
assert.strictEqual(ratingContext.getAuditRating([[0.8], [0.1, 0.6, 0.2, 0.1]]), 'q');
assert.strictEqual(ratingContext.getAuditRating([[0.8], [0.1, 0.2, 0.6, 0.1]]), 'r');
assert.strictEqual(ratingContext.getAuditRating([[0.8], [0.1, 0.2, 0.1, 0.6]]), 'x');

const start = 0;
const end = 1000;
const left = 100;
const width = 1000;
const blocks = [
    { timestamp: 100, id: 'a' },
    { timestamp: 110, id: 'b' },
    { timestamp: 123, id: 'c' },
    { timestamp: 300, id: 'd' }
];

const clusters = audPageClusterBlocks(blocks, start, end, left, width, 24);
assert.strictEqual(clusters.length, 2);
assert.deepStrictEqual(clusters[0].blocks.map(block => block.id), ['a', 'b', 'c']);
assert.deepStrictEqual(clusters[1].blocks.map(block => block.id), ['d']);
assert.strictEqual(clusters[0].x, 211);

const chained = audPageClusterBlocks([
    { timestamp: 100, id: 'a' },
    { timestamp: 120, id: 'b' },
    { timestamp: 140, id: 'c' }
], start, end, left, width, 24);
assert.strictEqual(chained.length, 2, 'clusters stay anchored instead of chaining across a long time span');

const timeBounded = audPageClusterBlocks([
    { timestamp: 0, id: 'a' },
    { timestamp: 5 * 60 * 60 * 1000, id: 'b' }
], 0, 7 * 24 * 60 * 60 * 1000, 0, 100, 24);
assert.strictEqual(timeBounded.length, 2, 'a visually dense week still separates blocks over four hours apart');

console.log('audit page clustering tests passed');
