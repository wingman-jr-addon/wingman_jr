const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
const lifecycleStart = source.indexOf('let BK_processorStartupState');
const lifecycleEnd = source.indexOf('const BK_revealAllowlist', lifecycleStart);
assert.ok(lifecycleStart >= 0 && lifecycleEnd > lifecycleStart);
const watchdogStart = source.indexOf('async function bkCrashDetectionWatchdog');
const watchdogEnd = source.indexOf('function bkApproxEq', watchdogStart);
assert.ok(watchdogStart >= 0 && watchdogEnd > watchdogStart);

const events = [];
let modelStartCount = 0;
let savedSettings = {};
const context = {
    console,
    bkShouldOpenSetup: () => true,
    bkLoadBackendSettings: async () => {
        modelStartCount++;
        events.push('start-model');
    },
    browser: {
        runtime: {
            getURL: value => `extension://${value}`,
            sendMessage: async message => events.push(`message:${message.state}`)
        },
        storage: {
            local: {
                get: async () => savedSettings,
                set: async changes => {
                    savedSettings = { ...savedSettings, ...changes };
                    events.push('save-confirmation');
                }
            }
        },
        tabs: {
            create: async options => {
                events.push(`create:${options.url}`);
                return { id: 77 };
            },
            hide: async tabId => {
                events.push(`hide:${tabId}`);
                return [tabId];
            },
            show: async tabId => events.push(`show:${tabId}`),
            remove: async tabId => events.push(`remove:${tabId}`)
        }
    }
};

vm.createContext(context);
vm.runInContext(`
    const BK_SETUP_HIDDEN_TABS_CONFIRMED_KEY = 'setup_hidden_tabs_confirmed';
    const BK_SETUP_SETTING_KEYS = [];
    ${source.slice(lifecycleStart, lifecycleEnd)}
    this.prepareBootstrap = bkPrepareSetupProcessorBootstrap;
    this.showPromptAgain = bkShowHiddenTabsPromptAgain;
    this.confirmAndStart = bkConfirmHiddenTabsAndStartProcessors;
    this.shouldDefer = bkShouldDeferProcessorStartup;
    this.getStartupState = () => BK_processorStartupState;
`, context);

(async () => {
    assert.strictEqual(context.shouldDefer({}), true,
        'fresh setup defers processor startup');
    assert.strictEqual(context.shouldDefer({ setup_hidden_tabs_confirmed: true }), false,
        'a persisted hidden-tabs confirmation permits normal startup');

    await context.prepareBootstrap();
    assert.strictEqual(modelStartCount, 0,
        'preparing the Firefox prompt does not start the model');
    assert.strictEqual(context.getStartupState(), 'awaiting-hidden-tabs');
    assert.ok(events.includes('create:extension://processor_bootstrap.html'));
    assert.ok(events.includes('hide:77'));

    await context.showPromptAgain();
    assert.strictEqual(modelStartCount, 0,
        'showing the Firefox message again does not start the model');
    assert.strictEqual(events.filter(event => event === 'hide:77').length, 2,
        'retrying the message re-hides the bootstrap tab');
    assert.ok(events.indexOf('show:77') < events.lastIndexOf('hide:77'),
        'retrying shows the bootstrap tab before hiding it again');

    const startup = await context.confirmAndStart();
    assert.strictEqual(savedSettings.setup_hidden_tabs_confirmed, true);
    assert.strictEqual(modelStartCount, 1,
        'confirming hidden tabs starts the model exactly once');
    assert.strictEqual(startup.state, 'loading');
    assert.ok(events.indexOf('remove:77') < events.indexOf('start-model'),
        'the lightweight bootstrap closes before model startup');

    await context.confirmAndStart();
    assert.strictEqual(modelStartCount, 1,
        'repeated confirmation does not start another processor');

    let reloadCount = 0;
    const watchdogContext = {
        console: { log() {}, warn() {}, error() {} },
        bkGetNextProcessor: () => null,
        browser: {
            idle: { queryState: async () => 'active' },
            runtime: { reload: () => { reloadCount++; } }
        }
    };
    vm.createContext(watchdogContext);
    vm.runInContext(`
        let BK_setupProcessorStartDeferred = true;
        let CRASH_DETECTION_COUNT = 0;
        let CRASH_NO_PROCESSOR_COUNT = 2;
        const CRASH_NO_PROCESSOR_RESTART_THRESHOLD = 3;
        const CRASH_IDLE_SECONDS = 180;
        const CRASH_DETECTION_IMAGE = null;
        ${source.slice(watchdogStart, watchdogEnd)}
        this.runWatchdog = bkCrashDetectionWatchdog;
        this.getMissingProcessorCount = () => CRASH_NO_PROCESSOR_COUNT;
        this.releaseSetupWait = () => { BK_setupProcessorStartDeferred = false; };
    `, watchdogContext);

    await watchdogContext.runWatchdog();
    assert.strictEqual(watchdogContext.getMissingProcessorCount(), 0,
        'intentional setup waiting clears missing-processor strikes');
    assert.strictEqual(reloadCount, 0,
        'the crash watchdog does not reload during setup waiting');

    watchdogContext.releaseSetupWait();
    await watchdogContext.runWatchdog();
    await watchdogContext.runWatchdog();
    await watchdogContext.runWatchdog();
    assert.strictEqual(reloadCount, 1,
        'normal missing-processor crash recovery resumes after setup waiting');

    console.log('setup processor deferral tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
