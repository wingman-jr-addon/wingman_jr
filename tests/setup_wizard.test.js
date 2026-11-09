const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const context = {};
vm.createContext(context);

const source = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
const setupPage = fs.readFileSync(path.join(__dirname, '..', 'ui', 'setup.html'), 'utf8');
const setupScript = fs.readFileSync(path.join(__dirname, '..', 'ui', 'setup.js'), 'utf8');
const bootstrapPage = fs.readFileSync(path.join(__dirname, '..', 'processor_bootstrap.html'), 'utf8');
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
assert.match(setupPage, /uses one hidden tab[\s\S]*choose <strong>Keep Tabs Hidden<\/strong>[\s\S]*Choosing <strong>Disable Extension<\/strong> stops protection/i,
    'the opening disclosure explains the hidden tab and Firefox choices plainly');
assert.match(setupPage, /<button[^>]*id="hidden-tabs-confirmed"[^>]*data-startup-state="awaiting-hidden-tabs"[^>]*>[\s\S]*class="startup-spinner"[\s\S]*I chose Keep Tabs Hidden[\s\S]*Start protection[\s\S]*<\/button>/,
    'the previous hidden-tabs confirmation flow remains intact');
assert.match(setupPage, /id="show-hidden-tabs-prompt"[^>]*>Didn’t choose it\? Show the Firefox message again<\/button>/,
    'the hidden-tabs step lets a confused user restore the Firefox message');
assert.doesNotMatch(bootstrapPage, /tfjs|processor\.js|processor_tabstartup\.js/,
    'the hidden bootstrap tab does not load the model runtime');
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
assert.match(setupScript, /setup\.getProcessorStartupState/,
    'the wizard checks whether the processor has finished loading');
assert.match(setupScript, /setup\.processorStartupStateChanged/,
    'the wizard reacts when the processor becomes ready');
assert.match(setupScript, /type:\s*'setup\.confirmHiddenTabs'/,
    'confirming the Firefox choice explicitly starts the processor');
assert.match(setupScript, /type:\s*'setup\.showHiddenTabsPromptAgain'/,
    'the retry action asks the background to restore the Firefox message');
assert.match(setupScript, /button\.disabled = startupState === 'loading'/,
    'the confirmation button becomes a disabled loading indicator during startup');
assert.match(setupScript, /ready:\s*\['Continue setup', 'Protection is ready'\]/,
    'processor readiness turns the loading indicator into a continue action');
assert.match(setupScript, /state === 'ready'[\s\S]*setupAdvanceWhenProcessorReady[\s\S]*setupShowStep\('goal'\)/,
    'processor readiness advances a user-initiated startup directly to persona selection');
assert.match(source, /bkShouldDeferProcessorStartup[\s\S]*BK_SETUP_HIDDEN_TABS_CONFIRMED_KEY/,
    'fresh installs defer processor startup until hidden tabs are confirmed');
assert.match(source, /processor_bootstrap\.html/,
    'fresh installs use a lightweight hidden tab to trigger the Firefox prompt');
assert.match(source, /setup\.confirmHiddenTabs[\s\S]*bkConfirmHiddenTabsAndStartProcessors/,
    'the setup confirmation starts deferred processors');
assert.match(source, /case 'registration':[\s\S]*bkSetProcessorStartupState\('ready'\)/,
    'processor registration marks the model as ready');

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
