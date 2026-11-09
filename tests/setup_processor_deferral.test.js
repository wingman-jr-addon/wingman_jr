const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
const lifecycleStart = source.indexOf('let BK_processorStartupState');
const lifecycleEnd = source.indexOf('const BK_revealAllowlist', lifecycleStart);
assert.ok(lifecycleStart >= 0 && lifecycleEnd > lifecycleStart);

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

    console.log('setup processor deferral tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
