const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const optionsHtml = fs.readFileSync(path.join(root, 'options.html'), 'utf8');
const optionsSource = fs.readFileSync(path.join(root, 'options.js'), 'utf8');
const backgroundSource = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const tabStartupSource = fs.readFileSync(path.join(root, 'processor_tabstartup.js'), 'utf8');

assert.match(optionsHtml, /id="model_selection_n017"[^>]*value="n017"[^>]*checked/,
    'Latest N017 must be checked by default');
assert.match(optionsHtml, /Latest \(N017\)/);
assert.match(optionsHtml, /Classic \(SQRXR 112\)/);
assert.match(optionsSource, /model_selection: modelSelection/,
    'the selected model must be persisted');
assert.match(optionsSource, /rawResult\.model_selection === 'sqrxr_112' \? 'sqrxr_112' : 'n017'/,
    'missing and invalid saved values must restore to N017');
assert.match(backgroundSource, /const BK_DEFAULT_MODEL_SELECTION = 'n017'/,
    'background startup must default to N017');
assert.match(backgroundSource, /model=\$\{encodeURIComponent\(BK_modelSelection\)\}/,
    'tab processors must receive the selected model');
assert.match(tabStartupSource, /searchParams\.get\('model'\)/,
    'tab processors must pass the model choice into startup');

console.log('model selection contract tests passed');
