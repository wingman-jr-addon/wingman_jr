async function wizardSetInitialSelection() {
    const statusElement = document.getElementById('wizard_status');
    const response = await browser.runtime.sendMessage({ type: 'getBackendWizardCompatibility' });
    if(response && response.isInProcWebglSupported) {
        statusElement.textContent = 'Browser compatibility check (InProcWebGL): Supported';
        document.getElementById('backend_selection_inprocwebgl').checked = true;
    } else {
        statusElement.textContent = 'Browser compatibility check (InProcWebGL): Not supported';
        document.getElementById('backend_selection_webgl').checked = true;
    }
}

async function wizardSaveSelection() {
    const selection = document.querySelector('input[name="backend_selection"]:checked').value;
    const result = await browser.runtime.sendMessage({ type: 'setBackendSelectionFromWizard', value: selection });
    if(result.wasFallback) {
        document.getElementById('wizard_message').textContent = 'Hidden tabs permission was not granted. In-browser mode (InProcWebGL) was selected instead.';
    } else {
        document.getElementById('wizard_message').textContent = 'Saved backend selection: ' + result.selectedBackend;
    }
    setTimeout(() => window.close(), 250);
}

document.addEventListener('DOMContentLoaded', () => {
    wizardSetInitialSelection();
    document.getElementById('save_backend_selection').onclick = wizardSaveSelection;
    document.getElementById('cancel_backend_selection').onclick = () => window.close();
});
