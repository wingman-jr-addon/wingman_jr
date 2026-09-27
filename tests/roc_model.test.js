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
        trustedToNeutralPercentage: ROC_trustedToNeutralPercentage,
        neutralToUntrustedPercentage: ROC_neutralToUntrustedPercentage
    };
`, context);

const api = context.rocTestApi;
assert.strictEqual(api.values.length, 1151, 'expected the add-on-thinned ROC table');

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
    [0.004, 0.9452376365661621, 169, 29346],
    [0.015, 0.8363367915153503, 635, 33981],
    [0.100, 0.34986743330955505, 4237, 39596]
];
for (const [maximumFpr, threshold, fp, tp] of policies) {
    const entry = api.byFpr(maximumFpr);
    assert.strictEqual(entry.threshold, threshold);
    assert.strictEqual(entry.fp, fp);
    assert.strictEqual(entry.tp, tp);
}

assert.strictEqual(api.trusted, api.byFpr(0.004));
assert.strictEqual(api.neutral, api.byFpr(0.015));
assert.strictEqual(api.untrusted, api.byFpr(0.10));
assert.strictEqual(api.trustedToNeutralPercentage, 0.04);
assert.strictEqual(api.neutralToUntrustedPercentage, 0.18);

assert.ok(Number.isFinite(api.confidence(0.5)));
console.log('ROC model tests passed');
