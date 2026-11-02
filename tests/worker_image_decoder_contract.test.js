const assert = require('assert');
const fs = require('fs');

const worker = fs.readFileSync('decoder_worker.js', 'utf8');
const processor = fs.readFileSync('processor.js', 'utf8');

assert.match(worker, /new ImageDecoder\(/);
assert.match(worker, /new OffscreenCanvas\(/);
assert.match(worker, /getImageData\(/);
assert.match(worker, /frame\?\.close\(\)/);
assert.match(worker, /decoder\?\.close\(\)/);
assert.match(worker, /self\.postMessage\(result, \[result\.pixels\]\)/);
assert.doesNotMatch(worker, /postMessage\([^\n]*frame/);

assert.match(processor, /new Worker\(browser\.runtime\.getURL\('decoder_worker\.js'\)\)/);
assert.match(processor, /buffers\[0\]\.slice\(0\)/);
assert.match(processor, /legacy-sync-worker-fallback/);
assert.match(processor, /legacy-sync-animated-webp/);
assert.match(processor, /procPredictPreparedPixels/);
assert.match(processor, /allowWorkerDecode: false/);
assert.match(processor, /entry\.allowWorkerDecode !== false/);

console.log('worker image decoder contract tests passed');
