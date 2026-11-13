const SETUP_COMPLETED_KEY = 'setup_wizard_completed';
const SETUP_STEPS = ['browser', 'goal', 'protection', 'summary'];
const SETUP_IS_RERUN = new URLSearchParams(window.location.search).get('rerun') === '1';
let setupCurrentStep = 'browser';
let setupPrivateAccessAllowed = false;
let setupAdvanceWhenProcessorReady = false;
let setupSettingsLockEnabled = false;
let setupRerunCloseNotified = false;

async function setupNotifyRerunClosed() {
    if (!SETUP_IS_RERUN || setupRerunCloseNotified) {
        return;
    }
    setupRerunCloseNotified = true;
    await browser.runtime.sendMessage({ type: 'setup.rerunClosed' });
}

function setupUpdateProcessorStartupState(state) {
    const startupState = state === 'ready'
        ? 'ready'
        : (state === 'awaiting-hidden-tabs' ? 'awaiting-hidden-tabs' : 'loading');
    const button = document.getElementById('hidden-tabs-confirmed');
    const labels = {
        'awaiting-hidden-tabs': ['I chose Keep Tabs Hidden', 'Start protection'],
        loading: ['Loading protection…', 'Firefox may pause briefly'],
        ready: ['Continue setup', 'Protection is ready']
    };
    button.dataset.startupState = startupState;
    button.disabled = startupState === 'loading';
    document.getElementById('show-hidden-tabs-prompt').hidden = startupState !== 'awaiting-hidden-tabs';
    document.getElementById('hidden-tabs-confirmed-label').textContent = labels[startupState][0];
    document.getElementById('processor-startup-message').textContent = labels[startupState][1];
}

function setupHandleProcessorStartupState(state) {
    setupUpdateProcessorStartupState(state);
    if (state === 'ready'
        && setupAdvanceWhenProcessorReady
        && setupCurrentStep === 'browser') {
        setupAdvanceWhenProcessorReady = false;
        setupShowStep('goal');
    }
}

async function setupRefreshProcessorStartupState() {
    try {
        const startup = await browser.runtime.sendMessage({
            type: 'setup.getProcessorStartupState'
        });
        setupHandleProcessorStartupState(startup?.state);
    } catch (error) {
        console.warn('SETUP: Unable to check processor startup state', error);
    }
}

async function setupRefreshProtectionState() {
    try {
        const state = await browser.runtime.sendMessage({ type: 'audit.getState' });
        setupSettingsLockEnabled = state?.settingsLockEnabled === true;
        if (setupCurrentStep === 'protection') {
            setupUpdateProtectionCopy();
            setupUpdatePasswordState();
        } else if (setupCurrentStep === 'summary') {
            setupRenderSummary();
        }
    } catch (error) {
        console.warn('SETUP: Unable to check settings protection state', error);
    }
}

function setupSelectedValue(name) {
    return document.querySelector(`input[name="${name}"]:checked`).value;
}

function setupNeedsProtection() {
    return setupSelectedValue('setup-goal') !== 'everyday';
}

function setupShouldRemoveProtection() {
    return setupSettingsLockEnabled && !setupNeedsProtection();
}

function updateSelectedChoices() {
    document.querySelectorAll('.choice').forEach(choice => {
        const input = choice.querySelector('input');
        choice.classList.toggle('is-selected', input.checked);
    });
    setupUpdateNavigation();
}

function setupVisibleSteps() {
    return setupNeedsProtection()
        ? SETUP_STEPS
        : ['browser', 'goal', 'summary'];
}

function setupUpdateNavigation() {
    const visibleSteps = setupVisibleSteps().filter(value => value !== 'browser');
    const stepIndex = visibleSteps.indexOf(setupCurrentStep);
    document.getElementById('step-count').textContent = setupCurrentStep === 'browser'
        ? 'Before we begin'
        : `Step ${stepIndex + 1} of ${visibleSteps.length}`;
    document.getElementById('wizard-next').textContent = setupCurrentStep === 'summary'
        ? 'Finish setup'
        : 'Continue';
}

function setupRenderSummary() {
    const goal = setupSelectedValue('setup-goal');
    const adaptiveMinimum = goal === 'everyday' ? 'Trusted' : 'Neutral';
    const auditEnabled = setupNeedsProtection()
        && document.getElementById('enable-audit').checked;
    const goalLabels = {
        everyday: 'Safer everyday browsing',
        boundaries: 'Stronger personal boundaries',
        caregiver: 'Protect someone I care for'
    };
    const rows = [
        ['Starting point', goalLabels[goal]],
        ['Default site zone', `Adaptive (${adaptiveMinimum} minimum)`],
        ['Blocked images', 'Replace discreetly with safe images'],
        ['On/off controls', goal === 'everyday' ? 'Available' : 'Hidden'],
        ['Settings password', setupShouldRemoveProtection()
            ? 'Remove existing'
            : (setupSettingsLockEnabled
                ? 'Keep existing'
                : (setupNeedsProtection() ? 'Required' : 'Not set'))],
        ['Local audit history', auditEnabled ? 'On' : 'Off']
    ];
    const summary = document.getElementById('setup-summary');
    summary.replaceChildren(...rows.map(([label, value]) => {
        const row = document.createElement('div');
        row.className = 'summary-row';
        const labelElement = document.createElement('span');
        const valueElement = document.createElement('span');
        labelElement.textContent = label;
        valueElement.textContent = value;
        row.append(labelElement, valueElement);
        return row;
    }));
    document.getElementById('summary-privacy').hidden = !auditEnabled
        || setupPrivateAccessAllowed;
    document.getElementById('summary-remove-protection').hidden = !setupShouldRemoveProtection();
}

function setupUpdateAuditCoverageWarning() {
    const auditEnabled = document.getElementById('enable-audit').checked;
    document.getElementById('audit-private-warning').hidden = !auditEnabled
        || setupPrivateAccessAllowed;
}

async function setupRefreshPrivateCoverage() {
    try {
        const state = await browser.runtime.sendMessage({ type: 'audit.checkPrivateCoverage' });
        setupPrivateAccessAllowed = state.privateAccessAllowed === true;
    } catch (error) {
        console.warn('SETUP: Unable to check private-window access', error);
        setupPrivateAccessAllowed = false;
    }
    setupUpdateAuditCoverageWarning();
}

function setupUpdateProtectionCopy() {
    const caregiver = setupSelectedValue('setup-goal') === 'caregiver';
    document.getElementById('protection-heading').textContent = caregiver
        ? 'Protect the settings'
        : 'Add some helpful friction';
    document.getElementById('protection-intro').textContent = caregiver
        ? 'A password keeps filtering controls, site exceptions, and other settings in the caregiver’s hands.'
        : 'A password makes changing or disabling protection a deliberate decision.';
    document.getElementById('password-heading').textContent = setupSettingsLockEnabled
        ? 'Keep the existing settings password'
        : 'Create a settings password';
    document.getElementById('password-guidance').textContent = setupSettingsLockEnabled
        ? 'Settings protection is already enabled, so this preset will keep the current password.'
        : (caregiver
            ? 'Choose a password that the person being protected will not know.'
            : 'Consider asking someone you trust to choose or hold this password.');
    document.getElementById('password-grid').hidden = setupSettingsLockEnabled;
}

function setupUpdatePasswordState() {
    if (!setupNeedsProtection()) {
        return true;
    }
    if (setupSettingsLockEnabled) {
        const status = document.getElementById('password-status');
        status.textContent = 'Your current settings password will not change.';
        status.dataset.state = 'saved';
        return true;
    }
    const password = document.getElementById('settings-password').value;
    const confirmation = document.getElementById('settings-password-confirm').value;
    const status = document.getElementById('password-status');
    let message = 'Use at least eight characters.';
    let state = '';
    let valid = false;
    if (password || confirmation) {
        if (password.length < 8) {
            message = 'Use at least eight characters.';
            state = 'error';
        } else if (!confirmation) {
            message = 'Enter the password again to confirm it.';
        } else if (password !== confirmation) {
            message = 'Passwords do not match.';
            state = 'error';
        } else {
            message = 'Passwords match.';
            state = 'saved';
            valid = true;
        }
    }
    status.textContent = message;
    status.dataset.state = state;
    return valid;
}

function setupShowStep(step) {
    setupCurrentStep = step;
    document.querySelectorAll('[data-step]').forEach(section => {
        section.hidden = section.dataset.step !== step;
    });
    const footer = document.getElementById('wizard-footer');
    footer.hidden = step === 'browser';
    document.getElementById('wizard-back').hidden = step === 'goal';
    setupUpdateNavigation();
    document.getElementById('setup-status').textContent = '';
    document.getElementById('setup-status').dataset.state = '';
    if (step === 'protection') {
        setupUpdateProtectionCopy();
        setupUpdatePasswordState();
        setupUpdateAuditCoverageWarning();
        setupRefreshPrivateCoverage();
        if (!setupSettingsLockEnabled) {
            document.getElementById('settings-password').focus();
        }
    }
    if (step === 'summary') {
        setupRenderSummary();
    }
}

function setupMove(direction) {
    const steps = setupVisibleSteps();
    const currentIndex = steps.indexOf(setupCurrentStep);
    setupShowStep(steps[currentIndex + direction]);
}

async function closeSetupTab() {
    const currentTab = await browser.tabs.getCurrent();
    if (currentTab && currentTab.id !== undefined) {
        await browser.tabs.remove(currentTab.id);
        return;
    }
    window.close();
}

function setSetupBusy(isBusy) {
    document.querySelectorAll('button, input').forEach(control => {
        control.disabled = isBusy;
    });
}

async function finishSetup() {
    const status = document.getElementById('setup-status');
    const goal = setupSelectedValue('setup-goal');
    const protectedSetup = setupNeedsProtection();
    const removeExistingProtection = setupShouldRemoveProtection();
    const auditEnabled = protectedSetup
        && document.getElementById('enable-audit').checked;
    if (removeExistingProtection
        && !document.getElementById('confirm-remove-protection').checked) {
        status.textContent = 'Confirm that you want to remove the existing settings password.';
        status.dataset.state = 'error';
        document.getElementById('confirm-remove-protection').focus();
        return;
    }
    setSetupBusy(true);
    status.textContent = 'Saving your setup…';
    status.dataset.state = '';

    try {
        await browser.runtime.sendMessage({
            type: 'settings.update',
            changes: {
                is_silent_mode_enabled: true,
                is_on_off_shown: goal === 'everyday',
                default_zone: 'automatic',
                adaptive_minimum_zone: goal === 'everyday' ? 'trusted' : 'neutral'
            }
        });
        if (auditEnabled) {
            await browser.runtime.sendMessage({
                type: 'audit.setTracking',
                enabled: true
            });
        }
        if (protectedSetup && !setupSettingsLockEnabled) {
            const password = document.getElementById('settings-password').value;
            await browser.runtime.sendMessage({
                type: 'audit.enableSettingsLock',
                password,
                confirmPassword: document.getElementById('settings-password-confirm').value
            });
        }
        if (removeExistingProtection) {
            await browser.runtime.sendMessage({ type: 'audit.disableSettingsLock' });
        }
        await browser.storage.local.set({ [SETUP_COMPLETED_KEY]: true });
        await setupNotifyRerunClosed();
        await closeSetupTab();
    } catch (error) {
        console.error('SETUP: Unable to save quick setup', error);
        status.dataset.state = 'error';
        status.textContent = error?.message || 'Could not save. Please try again.';
        setSetupBusy(false);
    }
}

document.getElementById('hidden-tabs-confirmed').addEventListener('click', async () => {
    const button = document.getElementById('hidden-tabs-confirmed');
    if (button.dataset.startupState === 'ready') {
        setupShowStep('goal');
        return;
    }
    if (button.dataset.startupState !== 'awaiting-hidden-tabs') {
        return;
    }

    setupUpdateProcessorStartupState('loading');
    setupAdvanceWhenProcessorReady = true;
    try {
        const startup = await browser.runtime.sendMessage({
            type: 'setup.confirmHiddenTabs'
        });
        setupHandleProcessorStartupState(startup?.state);
    } catch (error) {
        console.error('SETUP: Unable to start protection', error);
        setupAdvanceWhenProcessorReady = false;
        setupUpdateProcessorStartupState('awaiting-hidden-tabs');
        document.getElementById('processor-startup-message').textContent = 'Could not start protection. Try again.';
    }
});

document.getElementById('show-hidden-tabs-prompt').addEventListener('click', async () => {
    const button = document.getElementById('show-hidden-tabs-prompt');
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = 'Showing Firefox message…';
    try {
        await browser.runtime.sendMessage({
            type: 'setup.showHiddenTabsPromptAgain'
        });
        button.textContent = originalText;
    } catch (error) {
        console.error('SETUP: Unable to show the hidden-tabs prompt again', error);
        button.textContent = 'Could not show the message. Try again.';
    } finally {
        button.disabled = false;
    }
});

document.getElementById('wizard-next').addEventListener('click', async () => {
    if (setupCurrentStep === 'protection' && !setupUpdatePasswordState()) {
        document.getElementById('settings-password').focus();
        return;
    }
    if (setupCurrentStep === 'summary') {
        await finishSetup();
        return;
    }
    setupMove(1);
});

document.getElementById('wizard-back').addEventListener('click', () => {
    setupMove(-1);
});

document.querySelectorAll('input[type="radio"]').forEach(input => {
    input.addEventListener('change', updateSelectedChoices);
});

document.querySelectorAll('#settings-password, #settings-password-confirm').forEach(input => {
    input.addEventListener('input', setupUpdatePasswordState);
});

document.getElementById('enable-audit').addEventListener('change', setupUpdateAuditCoverageWarning);

browser.runtime.onMessage.addListener(message => {
    if (message?.type === 'setup.processorStartupStateChanged') {
        setupHandleProcessorStartupState(message.state);
    }
});

document.getElementById('setup-form').addEventListener('submit', event => {
    event.preventDefault();
});
window.addEventListener('pagehide', () => {
    setupNotifyRerunClosed().catch(() => {});
});

if (SETUP_IS_RERUN) {
    setupShowStep('goal');
} else {
    setupRefreshProcessorStartupState();
}
setupRefreshProtectionState();
