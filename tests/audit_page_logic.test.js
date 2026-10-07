const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const {
    audPageAggregateRows,
    audPageBinIndex,
    audPageBlockedHeatLevel,
    audPageClampBlur,
    audPageCountLabel,
    audPageDefaultBlurForRating,
    audPageDisplayHeatLevel,
    audPageHeatLevel,
    audPageIntervalOverlapsBin,
    audPageRatingForBlock,
    audPageRelativeLogit,
    audPageWorstRating
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
assert.strictEqual(audPageWorstRating([{ rating: 'q' }, { rating: 'x' }, { rating: 'r' }]), 'x');
assert.strictEqual(audPageWorstRating([{ rating: 'safe' }, { score: 0.9 }]), 'safe');
assert.strictEqual(audPageWorstRating([{ score: 0.9 }]), null);
assert.strictEqual(audPageHeatLevel(Number.NaN), -1);
assert.strictEqual(audPageHeatLevel(-4), 0);
assert.strictEqual(audPageHeatLevel(-1), 1);
assert.strictEqual(audPageHeatLevel(0), 2);
assert.strictEqual(audPageHeatLevel(2), 3);
assert.strictEqual(audPageHeatLevel(4), 4);
assert.ok(audPageRelativeLogit(0.8, 0.5) > 0);
assert.ok(audPageRelativeLogit(0.2, 0.5) < 0);
assert.strictEqual(audPageRelativeLogit(undefined, 0.5), null);
assert.strictEqual(audPageBlockedHeatLevel([{ rating: 'safe', score: 0.51, threshold: 0.5 }]), 2);
assert.strictEqual(audPageBlockedHeatLevel([{ rating: 'q', score: 0.6, threshold: 0.5 }]), 2);
assert.strictEqual(audPageBlockedHeatLevel([{ rating: 'r', score: 0.6, threshold: 0.5 }]), 3);
assert.strictEqual(audPageBlockedHeatLevel([{ rating: 'x', score: 0.6, threshold: 0.5 }]), 4);
assert.ok(audPageBlockedHeatLevel([{ score: 0.99, threshold: 0.5 }]) >= 3);
const xBlock = { rating: 'x', score: 0.99, threshold: 0.5 };
const qBlock = { rating: 'q', score: 0.6, threshold: 0.5 };
assert.strictEqual(audPageDisplayHeatLevel({ heat: -4, count: 1000 }, []), 0);
assert.ok(audPageDisplayHeatLevel({ heat: -4, count: 1000 }, [xBlock]) <= 1,
    'one severe block among many checks stays visually restrained');
assert.ok(audPageDisplayHeatLevel({ heat: -4, count: 2 }, [xBlock]) >= 2,
    'a high blocked share remains visible even with a small sample');
assert.ok(audPageDisplayHeatLevel({ heat: 4, count: 2 }, [xBlock, xBlock]) <= 2,
    'a tiny severe sample is tempered even when its unsmoothed hourly mean is high');
assert.ok(audPageDisplayHeatLevel({ heat: -4, count: 1000 }, Array(40).fill(qBlock)) >= 2,
    'sustained blocking reaches a warm level even when the category is Q');
assert.ok(audPageDisplayHeatLevel({ heat: -4, count: 1200 }, Array(100).fill(xBlock)) >= 3,
    'a large severe cluster remains prominent');

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

const week = 7 * 24 * 60 * 60 * 1000;
assert.strictEqual(audPageBinIndex(0, 0, week), 0);
assert.strictEqual(audPageBinIndex(60 * 60 * 1000, 0, week), 1);
assert.strictEqual(audPageBinIndex(week - 1, 0, week), 167);
assert.strictEqual(audPageBinIndex(-1, 0, week), -1);
assert.strictEqual(audPageBinIndex(week, 0, week), -1);
assert.strictEqual(audPageBinIndex(5, 10, 10), -1);
assert.strictEqual(audPageIntervalOverlapsBin({ start: 100, end: 200 }, 150, 250), true);
assert.strictEqual(audPageIntervalOverlapsBin({ start: 100, end: 150 }, 150, 250), false);
assert.strictEqual(audPageIntervalOverlapsBin({ start: 250, end: 300 }, 150, 250), false);
assert.strictEqual(audPageCountLabel(0), '');
assert.strictEqual(audPageCountLabel(9), '9');
assert.strictEqual(audPageCountLabel(100), '99+');

const aggregate = audPageAggregateRows([
    {
        hostname: 'one.example',
        count: 3,
        blocked: 1,
        privateCount: 1,
        bins: [{ index: 0, count: 2, heat: -2, privateCount: 1 }],
        blocks: [{ timestamp: 1, rating: 'q' }]
    },
    {
        hostname: 'two.example',
        count: 4,
        blocked: 2,
        privateCount: 0,
        bins: [{ index: 0, count: 1, heat: 4, privateCount: 0 }],
        blocks: [{ timestamp: 2, rating: 'r' }, { timestamp: 3, rating: 'x' }]
    }
], 168);
assert.strictEqual(aggregate.count, 7);
assert.strictEqual(aggregate.blocked, 3);
assert.strictEqual(aggregate.privateCount, 1);
assert.strictEqual(aggregate.bins.length, 1);
assert.strictEqual(aggregate.bins[0].heat, 0);
assert.deepStrictEqual(aggregate.blocks.map(block => block.hostname), ['one.example', 'two.example', 'two.example']);

console.log('audit page grid tests passed');
