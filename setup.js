const SETUP_COMPLETED_KEY = 'setup_wizard_completed';

function updateSelectedChoices() {
    document.querySelectorAll('.choice').forEach(choice => {
        const input = choice.querySelector('input');
        choice.classList.toggle('is-selected', input.checked);
    });
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
    document.querySelectorAll('button').forEach(button => {
        button.disabled = isBusy;
    });
}

async function finishSetup(applyChoices) {
    const status = document.getElementById('setup-status');
    setSetupBusy(true);
    status.textContent = '';
    status.dataset.state = '';

    try {
        if (applyChoices) {
            const useSilentMode = document.querySelector('input[name="blocked-image"]:checked').value === 'quiet';
            const showOnOffControls = document.querySelector('input[name="on-off-controls"]:checked').value === 'shown';
            await browser.storage.local.set({
                [SETUP_COMPLETED_KEY]: true,
                is_silent_mode_enabled: useSilentMode,
                is_on_off_shown: showOnOffControls
            });
            await browser.runtime.sendMessage({ type: 'setSilentModeEnabled', value: useSilentMode });
            await browser.runtime.sendMessage({ type: 'setOnOffSwitchShown', value: showOnOffControls });
        } else {
            await browser.storage.local.set({ [SETUP_COMPLETED_KEY]: true });
        }
        await closeSetupTab();
    } catch (error) {
        console.error('SETUP: Unable to save quick setup', error);
        status.dataset.state = 'error';
        status.textContent = 'Could not save. Please try again.';
        setSetupBusy(false);
    }
}

document.getElementById('setup-form').addEventListener('submit', event => {
    event.preventDefault();
    finishSetup(true);
});

document.getElementById('skip-setup').addEventListener('click', () => {
    finishSetup(false);
});

document.querySelectorAll('input[type="radio"]').forEach(input => {
    input.addEventListener('change', updateSelectedChoices);
});
