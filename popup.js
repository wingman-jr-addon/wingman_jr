let POP_activeTab = null;
let POP_isMasterFilteringEnabled = true;
let POP_isOnOffSwitchShown = false;
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

function popUpdateFilteringUi() {
    const status = document.getElementById('filteringStatus');
    const offInput = document.getElementById('site_mode_off');
    const offLabel = document.getElementById('site_mode_off_label');
    const resetButton = document.getElementById('resetSiteMode');
    const modeInputs = document.querySelectorAll('input[name="siteMode"]');
    const canConfigureSite = POP_siteState.supported;

    document.getElementById('isOnOff').checked = POP_isMasterFilteringEnabled;
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

    if (!POP_isMasterFilteringEnabled) {
        status.textContent = 'Paused everywhere';
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
        const previousValue = POP_isMasterFilteringEnabled;
        POP_isMasterFilteringEnabled = event.target.checked;
        popUpdateFilteringUi();
        try {
            await browser.runtime.sendMessage({
                type: 'setOnOff',
                onOff: POP_isMasterFilteringEnabled ? 'on' : 'off'
            });
            popShowReloadButton();
        } catch (error) {
            POP_isMasterFilteringEnabled = previousValue;
            popUpdateFilteringUi();
            console.log('Error setting master filtering: '+error);
        }
    });

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
        POP_isMasterFilteringEnabled = message.onOff === 'on';
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
