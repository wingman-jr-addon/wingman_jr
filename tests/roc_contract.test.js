const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'roc.js'), 'utf8');
const classicValues = JSON.parse(fs.readFileSync(path.join(root, 'sqrxr_112_roc.json'), 'utf8'));
const context = {
    console: { log() {} },
    browser: { runtime: { getURL: value => value } },
    fetch: async value => ({
        ok: value === 'sqrxr_112_roc.json',
        status: value === 'sqrxr_112_roc.json' ? 200 : 404,
        json: async () => classicValues
    })
};
vm.runInNewContext(source, context, { filename: 'roc.js' });

function findByFpr(values, desiredFpr) {
    let bestMatch = values[0];
    for (let index = values.length - 1; index >= 0; index--) {
        if (values[index].fpr < desiredFpr) {
            bestMatch = values[index];
            break;
        }
    }
    return bestMatch;
}

(async () => {
    assert.strictEqual(context.ROC_trustedToNeutralPercentage, 0.04);
    assert.strictEqual(context.ROC_neutralToUntrustedPercentage, 0.18);
    assert.ok(context.ROC_trustedRoc, 'trusted ROC policy point must be defined');
    assert.ok(context.ROC_neutralRoc, 'neutral ROC policy point must be defined');
    assert.ok(context.ROC_untrustedRoc, 'untrusted ROC policy point must be defined');

    const n017NeutralThreshold = context.ROC_neutralRoc.threshold;
    const selectedClassic = await context.rocSelectModel('sqrxr_112');
    assert.strictEqual(selectedClassic, 'sqrxr_112');
    assert.strictEqual(context.ROC_trustedRoc.threshold, findByFpr(classicValues, 0.004).threshold);
    assert.strictEqual(context.ROC_neutralRoc.threshold, findByFpr(classicValues, 0.015).threshold);
    assert.strictEqual(context.ROC_untrustedRoc.threshold, findByFpr(classicValues, 0.10).threshold);
    assert.notStrictEqual(context.ROC_neutralRoc.threshold, n017NeutralThreshold);

    const selectedDefault = await context.rocSelectModel('not-a-model');
    assert.strictEqual(selectedDefault, 'n017', 'unknown model selections must fall back to N017');
    assert.strictEqual(context.ROC_neutralRoc.threshold, n017NeutralThreshold);

    console.log('ROC runtime contract tests passed for N017 and SQRXR 112');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
