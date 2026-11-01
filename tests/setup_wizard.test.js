const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const context = {};
vm.createContext(context);

const source = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
const setupPage = fs.readFileSync(path.join(__dirname, '..', 'ui', 'setup.html'), 'utf8');
const setupScript = fs.readFileSync(path.join(__dirname, '..', 'ui', 'setup.js'), 'utf8');
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
    'completing setup prevents it from reopening'
);

const hiddenTabsStep = setupPage.indexOf('data-step="browser"');
const personaStep = setupPage.indexOf('data-step="goal"');
assert.ok(hiddenTabsStep >= 0 && hiddenTabsStep < personaStep,
    'the hidden-tabs decision gates the rest of setup');
assert.match(setupPage, /choose <strong>Keep Tabs Hidden<\/strong>[\s\S]*Done — continue/,
    'the opening gate gives one concise Firefox instruction before continuing');
for (const persona of ['everyday', 'boundaries', 'caregiver']) {
    assert.match(setupPage, new RegExp(`name="setup-goal" value="${persona}"`),
        `${persona} has a first-class setup path`);
}
assert.match(setupPage, /id="enable-audit" type="checkbox" checked/,
    'protected setup paths recommend Audit by default');
assert.match(setupPage, /id="audit-private-warning"[\s\S]*They can be used to bypass Audit/,
    'the Audit step explains the private-window bypass risk');
assert.match(setupPage, /rel="icon"[\s\S]*wingman_icon_32\.png/,
    'the launched setup page uses the Wingman favicon');
assert.match(setupScript, /goal === 'everyday'/,
    'the everyday path keeps convenient on\/off controls available');
assert.match(setupScript, /:\s*\['browser', 'goal'\]/,
    'the everyday path skips advanced protection choices and the summary');
assert.match(setupScript, /setupCurrentStep === 'goal' && !setupNeedsProtection\(\)/,
    'the everyday path finishes directly from the starting-point screen');
assert.match(setupScript, /type:\s*'audit\.enableSettingsLock'/,
    'protected setup paths create a real settings password');
assert.match(setupScript, /type:\s*'audit\.setTracking'/,
    'Audit remains a separate setting even when recommended with protection');

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
        ['extension://ui/setup.html'],
        'temporary development installs force the wizard open'
    );

    console.log('setup wizard tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
