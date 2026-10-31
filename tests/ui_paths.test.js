const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const uiPages = [
    manifest.options_ui.page,
    manifest.browser_action.default_popup,
    'ui/setup.html',
    'ui/audit.html',
    'ui/silent_collections.html'
];

for (const pagePath of uiPages) {
    assert.match(pagePath, /^ui\//, `${pagePath} must live in the ui directory`);

    const absolutePagePath = path.join(root, pagePath);
    assert.ok(fs.existsSync(absolutePagePath), `${pagePath} must exist`);

    const html = fs.readFileSync(absolutePagePath, 'utf8');
    const localReferencePattern = /(?:src|href)="([^"#]+)"/g;
    for (const match of html.matchAll(localReferencePattern)) {
        const reference = match[1];
        if (/^(?:[a-z]+:|\/\/)/i.test(reference)) {
            continue;
        }

        const referencePath = reference.split(/[?#]/, 1)[0];
        const absoluteReferencePath = path.resolve(path.dirname(absolutePagePath), referencePath);
        assert.ok(
            fs.existsSync(absoluteReferencePath),
            `${pagePath} references missing local file ${reference}`
        );
    }
}

const silentCollectionsSource = fs.readFileSync(
    path.join(root, 'ui', 'silent_collections.js'),
    'utf8'
);
assert.match(
    silentCollectionsSource,
    /dataUrl:\s*browser\.runtime\.getURL\(entry\.file\)/,
    'built-in collection previews must resolve catalog images from the extension root'
);

const silentDataSource = fs.readFileSync(path.join(root, 'silent_data', 'index.js'), 'utf8');
const builtInImagePaths = Array.from(
    silentDataSource.matchAll(/"file":"([^"]+)"/g),
    match => match[1]
);
assert.ok(builtInImagePaths.length > 0, 'the built-in image catalog must not be empty');
for (const imagePath of builtInImagePaths) {
    assert.ok(fs.existsSync(path.join(root, imagePath)), `${imagePath} must exist`);
}

console.log('UI path tests passed');
