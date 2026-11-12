const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const startupSource = fs.readFileSync(path.join(root, 'processor_backgroundstartup.js'), 'utf8');
const backgroundSource = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const optionsSource = fs.readFileSync(path.join(root, 'ui', 'options.js'), 'utf8');
const optionsHtml = fs.readFileSync(path.join(root, 'ui', 'options.html'), 'utf8');

function runProbe(getContext) {
    const context = {
        console: { log() {}, warn() {} },
        document: {
            createElement(elementName) {
                assert.strictEqual(elementName, 'canvas');
                return { getContext };
            }
        }
    };
    vm.runInNewContext(startupSource, context);
    return context.bkCheckInProcWebGLCompatibility();
}

assert.strictEqual(runProbe(() => null).compatible, false,
    'a missing WebGL2 context must be reported as incompatible');
assert.strictEqual(runProbe(() => { throw new Error('WebGL unavailable'); }).compatible, false,
    'a context creation error must be reported as incompatible');

let lostContext = false;
const compatibleResult = runProbe((contextType, attributes) => {
    assert.strictEqual(contextType, 'webgl2');
    assert.strictEqual(attributes.failIfMajorPerformanceCaveat, true);
    return {
        toString: () => '[object WebGL2RenderingContext]',
        getExtension(extensionName) {
            assert.strictEqual(extensionName, 'WEBGL_lose_context');
            return { loseContext() { lostContext = true; } };
        }
    };
});
assert.strictEqual(compatibleResult.compatible, true,
    'a WebGL2 context must be reported as compatible');
assert.strictEqual(lostContext, true, 'the temporary probe context must be released');

assert.match(backgroundSource, /options\.checkInProcWebGLCompatibility/,
    'the background page must expose the compatibility check');
assert.match(optionsHtml, /id="inprocwebgl_compatibility"[^>]*role="status"[^>]*aria-live="polite"/,
    'the compatibility result must be announced as a live status');
assert.match(optionsSource, /getElementById\('advanced'\)\.addEventListener\('toggle'/,
    'opening Advanced must trigger the compatibility check');
assert.match(optionsSource, /Likely compatible/);
assert.match(optionsSource, /Likely incompatible/);

console.log('in-process WebGL compatibility tests passed');
