const SETUP_COMPLETED_KEY = 'setup_wizard_completed';
const SETUP_STEPS = ['browser', 'goal', 'level', 'protection', 'summary'];
let setupCurrentStep = 'browser';
let setupPrivateAccessAllowed = false;

function setupSelectedValue(name) {
    return document.querySelector(`input[name="${name}"]:checked`).value;
}

function setupNeedsProtection() {
    return setupSelectedValue('setup-goal') !== 'everyday';
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
        : ['browser', 'goal'];
}

function setupUpdateNavigation() {
    const everydayFinish = setupCurrentStep === 'goal' && !setupNeedsProtection();
    const visibleSteps = setupVisibleSteps().filter(value => value !== 'browser');
    const stepIndex = visibleSteps.indexOf(setupCurrentStep);
    document.getElementById('step-count').textContent = setupCurrentStep === 'browser'
        ? 'Before we begin'
        : (everydayFinish
            ? 'Quick setup'
            : `Step ${stepIndex + 1} of ${visibleSteps.length}`);
    document.getElementById('wizard-next').textContent = everydayFinish
        || setupCurrentStep === 'summary'
        ? 'Finish setup'
        : 'Continue';
}

function setupRenderSummary() {
    const goal = setupSelectedValue('setup-goal');
    const level = setupSelectedValue('protection-level');
    const auditEnabled = setupNeedsProtection()
        && document.getElementById('enable-audit').checked;
    const goalLabels = {
        everyday: 'Safer everyday browsing',
        boundaries: 'Stronger personal boundaries',
        caregiver: 'Protect someone I care for'
    };
    const rows = [
        ['Starting point', goalLabels[goal]],
        ['Default protection', level === 'automatic' ? 'Adaptive' : 'Strict (Untrusted zone)'],
        ['Blocked images', 'Replace discreetly with safe images'],
        ['On/off controls', goal === 'everyday' ? 'Available' : 'Hidden'],
        ['Settings password', setupNeedsProtection() ? 'Required' : 'Not set'],
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
    document.getElementById('password-guidance').textContent = caregiver
        ? 'Choose a password that the person being protected will not know.'
        : 'Consider asking someone you trust to choose or hold this password.';
}

function setupUpdatePasswordState() {
    if (!setupNeedsProtection()) {
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
        document.getElementById('settings-password').focus();
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
    const auditEnabled = protectedSetup
        && document.getElementById('enable-audit').checked;
    setSetupBusy(true);
    status.textContent = 'Saving your setup…';
    status.dataset.state = '';

    try {
        await browser.runtime.sendMessage({
            type: 'settings.update',
            changes: {
                is_silent_mode_enabled: true,
                is_on_off_shown: goal === 'everyday',
                default_zone: setupSelectedValue('protection-level')
            }
        });
        if (auditEnabled) {
            await browser.runtime.sendMessage({
                type: 'audit.setTracking',
                enabled: true
            });
        }
        if (protectedSetup) {
            const password = document.getElementById('settings-password').value;
            await browser.runtime.sendMessage({
                type: 'audit.enableSettingsLock',
                password,
                confirmPassword: document.getElementById('settings-password-confirm').value
            });
        }
        await browser.storage.local.set({ [SETUP_COMPLETED_KEY]: true });
        await closeSetupTab();
    } catch (error) {
        console.error('SETUP: Unable to save quick setup', error);
        status.dataset.state = 'error';
        status.textContent = error?.message || 'Could not save. Please try again.';
        setSetupBusy(false);
    }
}

document.getElementById('hidden-tabs-confirmed').addEventListener('click', () => {
    setupShowStep('goal');
});

document.getElementById('wizard-next').addEventListener('click', async () => {
    if (setupCurrentStep === 'protection' && !setupUpdatePasswordState()) {
        document.getElementById('settings-password').focus();
        return;
    }
    if (setupCurrentStep === 'summary'
        || (setupCurrentStep === 'goal' && !setupNeedsProtection())) {
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

document.getElementById('setup-form').addEventListener('submit', event => {
    event.preventDefault();
});
