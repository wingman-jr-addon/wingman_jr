const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const n017DataPath = 'models/n017_graph_model/roc.js';
const classicDataPath = 'models/sqrxr_112_graphopt/roc.json';
const n017Source = fs.readFileSync(path.join(root, n017DataPath), 'utf8');
const source = fs.readFileSync(path.join(root, 'roc.js'), 'utf8');
const classicValues = JSON.parse(fs.readFileSync(path.join(root, classicDataPath), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const processorHtml = fs.readFileSync(path.join(root, 'processor.html'), 'utf8');
const backgroundScripts = manifest.background.scripts;
const processorScripts = Array.from(processorHtml.matchAll(/<script src="([^"]+)"/g), match => match[1]);
for (const scripts of [backgroundScripts, processorScripts]) {
    assert.ok(scripts.includes(n017DataPath), 'N017 ROC data must be loaded at startup');
    assert.ok(scripts.indexOf(n017DataPath) < scripts.indexOf('roc.js'),
        'N017 ROC data must load before the shared helpers');
}
let classicFetchCount = 0;
const context = {
    console: { log() {} },
    browser: { runtime: { getURL: value => value } },
    fetch: async value => {
        classicFetchCount++;
        return {
            ok: value === classicDataPath,
            status: value === classicDataPath ? 200 : 404,
            json: async () => classicValues
        };
    }
};
vm.createContext(context);
vm.runInContext(n017Source, context, { filename: n017DataPath });
vm.runInContext(source, context, { filename: 'roc.js' });

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
    assert.strictEqual(classicFetchCount, 0, 'Classic data must stay lazy-loaded');

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

    await context.rocSelectModel('sqrxr_112');
    assert.strictEqual(classicFetchCount, 1, 'Classic data must be cached after the first load');

    console.log('ROC runtime contract tests passed for N017 and SQRXR 112');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
