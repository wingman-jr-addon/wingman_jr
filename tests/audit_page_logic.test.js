const assert = require('assert');
const { audPageClampBlur, audPageClusterBlocks } = require('../audit_page.js');

assert.strictEqual(audPageClampBlur(undefined), 5);
assert.strictEqual(audPageClampBlur(-1), 0);
assert.strictEqual(audPageClampBlur(10.4), 10);
assert.strictEqual(audPageClampBlur(4.74), 4.5);
assert.strictEqual(audPageClampBlur(4.76), 5);

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
