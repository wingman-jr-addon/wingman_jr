const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const context = {};
vm.createContext(context);
const source = fs.readFileSync(path.join(__dirname, '..', 'roc.js'), 'utf8');
vm.runInContext(source + `
    this.rocTestApi = {
        values: ROC_VALUES,
        byFpr: rocFindRocEntryByFpr,
        confidence: rocFindConfidence,
        trusted: ROC_trustedRoc,
        neutral: ROC_neutralRoc,
        untrusted: ROC_untrustedRoc,
        neutralToTrustedPercentage: ROC_neutralToTrustedPercentage,
        trustedToNeutralPercentage: ROC_trustedToNeutralPercentage,
        untrustedToNeutralPercentage: ROC_untrustedToNeutralPercentage,
        neutralToUntrustedPercentage: ROC_neutralToUntrustedPercentage
    };
`, context);

const api = context.rocTestApi;
assert.strictEqual(api.values.length, 1152, 'expected the add-on-thinned ROC table plus exact 154 policy row');

for (let index = 1; index < api.values.length; index++) {
    const previous = api.values[index - 1];
    const current = api.values[index];
    assert.ok(current.fpr >= previous.fpr, `FPR must be monotonic at row ${index}`);
    assert.ok(current.tpr >= previous.tpr, `TPR must be monotonic at row ${index}`);
    assert.ok(current.threshold <= previous.threshold, `threshold must descend at row ${index}`);
    assert.strictEqual(current.tp + current.fn, 42372);
    assert.strictEqual(current.fp + current.tn, 42372);
}

const policies = [
    [0.006, 0.9232028722763062, 254, 30821],
    [0.015, 0.8363367915153503, 635, 33981],
    [0.163, 0.1946832686662674, 6906, 40708]
];
for (const [maximumFpr, threshold, fp, tp] of policies) {
    const entry = api.byFpr(maximumFpr);
    assert.strictEqual(entry.threshold, threshold);
    assert.strictEqual(entry.fp, fp);
    assert.strictEqual(entry.tp, tp);
}

assert.strictEqual(api.trusted, api.byFpr(0.006));
assert.strictEqual(api.neutral, api.byFpr(0.015));
assert.strictEqual(api.untrusted, api.byFpr(0.163));
assert.strictEqual(api.neutralToTrustedPercentage, 0.02);
assert.strictEqual(api.trustedToNeutralPercentage, 0.04);
assert.strictEqual(api.untrustedToNeutralPercentage, 0.10);
assert.strictEqual(api.neutralToUntrustedPercentage, 0.15);

assert.ok(Number.isFinite(api.confidence(0.5)));
console.log('ROC model tests passed');
