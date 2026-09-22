let POP_activeTab = null;
let POP_isMasterFilteringEnabled = true;
let POP_isOnOffSwitchShown = false;
let POP_masterFilteringState = {
    mode: 'on',
    pauseUntil: null,
    pauseDurationMs: null
};
let POP_masterCountdownInterval = null;
let POP_siteState = {
    supported: false,
    hostname: null,
    enabled: true,
    mode: 'adaptive',
    defaultMode: 'adaptive',
    effectiveZone: 'neutral',
    isOverride: false
};

function popCapitalize(value) {
    return typeof value === 'string' && value.length
        ? value.charAt(0).toUpperCase() + value.slice(1)
        : '';
}

function popFormatPauseRemaining(pauseUntil) {
    const totalSeconds = Math.max(0, Math.ceil((pauseUntil - Date.now()) / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes === 0) {
        return `${seconds}s`;
    }
    return `${minutes}m${String(seconds).padStart(2, '0')}s`;
}

function popSetMasterFilteringState(state) {
    let mode = ['on', 'off', 'paused'].includes(state?.mode)
        ? state.mode
        : (state?.onOff === 'off' ? 'off' : 'on');
    const pauseUntil = Number(state?.pauseUntil);
    const pauseDurationMs = Number(state?.pauseDurationMs);
    if (mode === 'paused'
        && (!Number.isFinite(pauseUntil)
            || !Number.isFinite(pauseDurationMs)
            || pauseDurationMs <= 0)) {
        mode = 'off';
    }
    POP_masterFilteringState = {
        mode: mode,
        pauseUntil: mode === 'paused' ? pauseUntil : null,
        pauseDurationMs: mode === 'paused' ? pauseDurationMs : null
    };
    POP_isMasterFilteringEnabled = mode === 'on';
}

function popUpdateMasterCountdown() {
    if (POP_masterFilteringState.mode !== 'paused') {
        return;
    }
    if (POP_masterFilteringState.pauseUntil <= Date.now()) {
        browser.runtime.sendMessage({ type: 'getOnOff' }).then(state => {
            popSetMasterFilteringState(state);
            popStartMasterCountdown();
            popUpdateFilteringUi();
        }, error => console.log('Error refreshing Smart Pause: '+error));
        return;
    }
    popUpdateFilteringUi();
}

function popStartMasterCountdown() {
    if (POP_masterCountdownInterval !== null) {
        clearInterval(POP_masterCountdownInterval);
        POP_masterCountdownInterval = null;
    }
    if (POP_masterFilteringState.mode === 'paused') {
        POP_masterCountdownInterval = setInterval(popUpdateMasterCountdown, 1000);
    }
}

function popUpdateFilteringUi() {
    const status = document.getElementById('filteringStatus');
    const offInput = document.getElementById('site_mode_off');
    const offLabel = document.getElementById('site_mode_off_label');
    const resetButton = document.getElementById('resetSiteMode');
    const modeInputs = document.querySelectorAll('input[name="siteMode"]');
    const canConfigureSite = POP_siteState.supported;
    const powerControl = document.getElementById('masterPower');
    const powerInput = document.getElementById('isOnOff');
    const masterDetail = document.getElementById('masterFilteringDetail');

    powerInput.checked = POP_isMasterFilteringEnabled;
    powerControl.dataset.mode = POP_masterFilteringState.mode;
    let powerTooltip = 'Turn filtering off';
    let pauseProgressDegrees = 0;
    if (POP_masterFilteringState.mode === 'paused') {
        powerTooltip = `Filtering resumes in ${popFormatPauseRemaining(POP_masterFilteringState.pauseUntil)}`;
        masterDetail.textContent = 'Filtering is paused temporarily.';
        const remainingMs = Math.max(0, POP_masterFilteringState.pauseUntil - Date.now());
        pauseProgressDegrees = Math.min(
            360,
            360 * remainingMs / POP_masterFilteringState.pauseDurationMs
        );
    } else if (POP_masterFilteringState.mode === 'off') {
        powerTooltip = 'Turn filtering on';
        masterDetail.textContent = 'Filtering is off until resumed.';
    } else {
        masterDetail.textContent = 'Filtering is active everywhere.';
    }
    powerControl.title = powerTooltip;
    powerInput.setAttribute('aria-label', powerTooltip);
    powerControl.style.setProperty('--pause-progress', `${pauseProgressDegrees}deg`);
    for (const button of document.querySelectorAll('[data-pause-minutes]')) {
        const durationMs = Number(button.dataset.pauseMinutes) * 60 * 1000;
        button.setAttribute(
            'aria-pressed',
            POP_masterFilteringState.mode === 'paused'
                && POP_masterFilteringState.pauseDurationMs === durationMs
                ? 'true'
                : 'false'
        );
    }
    document.getElementById('siteFilteringHostname').textContent = POP_siteState.supported
        ? POP_siteState.hostname
        : 'Unavailable on this page';
    document.querySelector('.switch-controls').classList.toggle(
        'filtering-hidden',
        !POP_isOnOffSwitchShown
    );
    offInput.hidden = !POP_isOnOffSwitchShown;
    offLabel.hidden = !POP_isOnOffSwitchShown;
    for (const input of modeInputs) {
        input.checked = POP_siteState.supported && (POP_siteState.enabled
            ? input.value === POP_siteState.mode
            : input.value === 'off');
        input.disabled = !canConfigureSite;
    }

    const adaptiveState = document.getElementById('adaptiveCurrentZone');
    adaptiveState.textContent =
        POP_siteState.supported
            ? popCapitalize(POP_siteState.effectiveZone) + ' now'
            : 'Unavailable';
    adaptiveState.dataset.zone = POP_siteState.supported
        ? POP_siteState.effectiveZone
        : 'off';
    resetButton.hidden = !POP_siteState.isOverride;
    resetButton.disabled = !canConfigureSite;

    const source = document.getElementById('siteModeSource');
    if (!POP_siteState.supported) {
        source.textContent = 'Site-specific zones are unavailable here.';
    } else if (!POP_siteState.enabled) {
        source.textContent = 'Filtering is off. Choose a zone to turn it on.';
    } else if (POP_siteState.isOverride) {
        source.textContent = 'Custom zone.';
    } else {
        source.textContent = `Using default: ${popCapitalize(POP_siteState.defaultMode)}.`;
    }

    if (POP_masterFilteringState.mode === 'paused') {
        status.textContent = 'Paused everywhere';
        status.dataset.zone = 'off';
    } else if (POP_masterFilteringState.mode === 'off') {
        status.textContent = 'Off everywhere';
        status.dataset.zone = 'off';
    } else if (!POP_siteState.supported) {
        status.textContent = 'Active';
        status.dataset.zone = 'off';
    } else if (!POP_siteState.enabled) {
        status.textContent = 'Off for this site';
        status.dataset.zone = 'off';
    } else if (POP_siteState.mode === 'adaptive') {
        status.textContent = `Adaptive · ${popCapitalize(POP_siteState.effectiveZone)}`;
        status.dataset.zone = POP_siteState.effectiveZone;
    } else {
        status.textContent = popCapitalize(POP_siteState.mode);
        status.dataset.zone = POP_siteState.mode;
    }
}

function popShowReloadButton() {
    if (POP_activeTab && Number.isInteger(POP_activeTab.id)) {
        document.getElementById('reloadFilteringPage').hidden = false;
    }
}

async function popSendSiteChange(message) {
    if (!POP_activeTab || !POP_siteState.supported) {
        return;
    }
    POP_siteState = await browser.runtime.sendMessage({
        ...message,
        url: POP_activeTab.url
    });
    popUpdateFilteringUi();
    popShowReloadButton();
}

window.onload = async function() {
    document.getElementById('isOnOff').addEventListener('change', async event => {
        const previousState = { ...POP_masterFilteringState };
        popSetMasterFilteringState({ mode: event.target.checked ? 'on' : 'off' });
        popUpdateFilteringUi();
        try {
            const state = await browser.runtime.sendMessage({
                type: 'setOnOff',
                onOff: event.target.checked ? 'on' : 'off'
            });
            popSetMasterFilteringState(state);
            popStartMasterCountdown();
            popUpdateFilteringUi();
            popShowReloadButton();
        } catch (error) {
            popSetMasterFilteringState(previousState);
            popUpdateFilteringUi();
            console.log('Error setting master filtering: '+error);
        }
    });

    for (const button of document.querySelectorAll('[data-pause-minutes]')) {
        button.addEventListener('click', async event => {
            try {
                const state = await browser.runtime.sendMessage({
                    type: 'setMasterPause',
                    durationMinutes: Number(event.currentTarget.dataset.pauseMinutes)
                });
                popSetMasterFilteringState(state);
                popStartMasterCountdown();
                popUpdateFilteringUi();
                popShowReloadButton();
            } catch (error) {
                console.log('Error setting Smart Pause: '+error);
            }
        });
    }

    for (const input of document.querySelectorAll('input[name="siteMode"]')) {
        input.addEventListener('click', async event => {
            if (event.target.value === 'off' && !POP_isOnOffSwitchShown) {
                popUpdateFilteringUi();
                return;
            }
            try {
                await popSendSiteChange({
                    type: 'setSiteFilteringMode',
                    mode: event.target.value
                });
            } catch (error) {
                popUpdateFilteringUi();
                console.log('Error setting site zone: '+error);
            }
        });
    }

    document.getElementById('resetSiteMode').addEventListener('click', async () => {
        try {
            await popSendSiteChange({ type: 'resetSiteFiltering' });
        } catch (error) {
            console.log('Error resetting site filtering: '+error);
        }
    });

    document.getElementById('reloadFilteringPage').addEventListener('click', async () => {
        if (!POP_activeTab || !Number.isInteger(POP_activeTab.id)) {
            return;
        }
        try {
            await browser.tabs.reload(POP_activeTab.id, { bypassCache: true });
            window.close();
        } catch (error) {
            console.log('Error reloading current page: '+error);
        }
    });

    try {
        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        POP_activeTab = Array.isArray(tabs) && tabs.length ? tabs[0] : null;
    } catch (error) {
        console.log('Error finding active tab: '+error);
    }

    try {
        const message = await browser.runtime.sendMessage({type:'getOnOff'});
        popSetMasterFilteringState(message);
        popStartMasterCountdown();
    } catch (error) {
        console.log('Error getting master filtering: '+error);
    }

    if (POP_activeTab && typeof POP_activeTab.url === 'string') {
        try {
            POP_siteState = await browser.runtime.sendMessage({
                type: 'getSiteFilteringState',
                url: POP_activeTab.url
            });
        } catch (error) {
            console.log('Error getting site filtering: '+error);
        }
    }
    popUpdateFilteringUi();

    browser.runtime.sendMessage({type:'getOnOffSwitchShown'}).then(
        message => {
            POP_isOnOffSwitchShown = message.isOnOffSwitchShown === true;
            popUpdateFilteringUi();
        },
        error => console.log('Error getting filtering controls visibility: '+error)
    );
};
