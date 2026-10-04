const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'roc.js'), 'utf8');
const context = { console: { log() {} } };
vm.runInNewContext(source, context, { filename: 'roc.js' });

assert.strictEqual(context.ROC_trustedToNeutralPercentage, 0.04);
assert.strictEqual(context.ROC_neutralToUntrustedPercentage, 0.18);
assert.ok(context.ROC_trustedRoc, 'trusted ROC policy point must be defined');
assert.ok(context.ROC_neutralRoc, 'neutral ROC policy point must be defined');
assert.ok(context.ROC_untrustedRoc, 'untrusted ROC policy point must be defined');

console.log('ROC runtime contract tests passed');
