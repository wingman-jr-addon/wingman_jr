const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const context = {};
vm.createContext(context);

const source = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
const start = source.indexOf("const BK_SETUP_COMPLETED_KEY");
const end = source.indexOf('async function bkOpenSetupForNewUser', start);
assert.ok(start >= 0 && end > start);
vm.runInContext(source.slice(start, end) + `
    this.shouldOpenSetup = bkShouldOpenSetup;
`, context);

assert.strictEqual(context.shouldOpenSetup({}), true, 'new users should see setup');
assert.strictEqual(
    context.shouldOpenSetup({ is_silent_mode_enabled: false }),
    false,
    'an explicitly disabled silent mode still counts as configured'
);
assert.strictEqual(
    context.shouldOpenSetup({ is_on_off_shown: false }),
    false,
    'an explicitly hidden on/off control still counts as configured'
);
assert.strictEqual(
    context.shouldOpenSetup({ setup_wizard_completed: true }),
    false,
    'skipping or completing setup prevents it from reopening'
);

const openedUrls = [];
const developmentContext = {
    browser: {
        storage: {
            local: {
                get: async () => ({
                    setup_wizard_completed: true,
                    is_silent_mode_enabled: true
                })
            }
        },
        runtime: {
            getURL: path => `extension://${path}`
        },
        tabs: {
            create: async ({ url }) => openedUrls.push(url)
        }
    }
};
vm.createContext(developmentContext);
const openSetupEnd = source.indexOf('async function bkOnUpdate', end);
vm.runInContext(source.slice(start, openSetupEnd) + `
    this.openSetup = bkOpenSetupForNewUser;
`, developmentContext);

(async () => {
    await developmentContext.openSetup(false);
    assert.deepStrictEqual(openedUrls, [], 'normal installs keep the saved-setting guard');

    await developmentContext.openSetup(true);
    assert.deepStrictEqual(
        openedUrls,
        ['extension://setup.html'],
        'temporary development installs force the wizard open'
    );

    console.log('setup wizard tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
