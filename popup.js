let POP_activeTab = null;
let POP_isMasterFilteringEnabled = true;
let POP_isSiteFilteringSupported = false;
let POP_isSiteFilteringEnabled = true;

function popUpdateFilteringUi() {
    const siteToggle = document.getElementById('isSiteOnOff');
    const status = document.getElementById('filteringStatus');
    siteToggle.checked = POP_isSiteFilteringEnabled;
    siteToggle.disabled = !POP_isMasterFilteringEnabled || !POP_isSiteFilteringSupported;

    if (!POP_isMasterFilteringEnabled) {
        status.textContent = 'Paused everywhere';
    } else if (POP_isSiteFilteringSupported && !POP_isSiteFilteringEnabled) {
        status.textContent = 'Paused here';
    } else {
        status.textContent = 'Active';
    }
}

function popShowReloadButton() {
    if (POP_activeTab && Number.isInteger(POP_activeTab.id)) {
        document.getElementById('reloadFilteringPage').hidden = false;
    }
}

window.onload = async function() {
    let rad = document.getElementById('popupForm').zone;
    for (var i = 0; i < rad.length; i++) {
        rad[i].addEventListener('change', function(e) {
            browser.runtime.sendMessage({ type: 'setZone', zone: e.target.id });
            browser.runtime.sendMessage({ type: 'setZoneAutomatic', isZoneAutomatic: false });
            window.close();
        });
    }
    browser.runtime.sendMessage({type:'getZone'}).then(
        function(message) {
            console.log('Restoring zone visual state to '+message.zone);
            document.getElementById(message.zone).checked = true;
        },
        function(error) {
            console.log('Error getting zone: '+error);
        }
    );

    let autoBox = document.getElementById('popupForm').zoneAuto;
    autoBox.addEventListener('change', function(e) {
        browser.runtime.sendMessage({ type: 'setZoneAutomatic', isZoneAutomatic: e.target.checked });
        window.close();
    });
    browser.runtime.sendMessage({type:'getZoneAutomatic'}).then(
        function(message) {
            console.log('Restoring zone visual state for automatic to '+message.isZoneAutomatic);
            document.getElementById('isZoneAutomatic').checked = message.isZoneAutomatic;
        },
        function(error) {
            console.log('Error getting zone automatic: '+error);
        }
    );

    const masterToggle = document.getElementById('isOnOff');
    masterToggle.addEventListener('change', async function(e) {
        POP_isMasterFilteringEnabled = e.target.checked;
        popUpdateFilteringUi();
        try {
            await browser.runtime.sendMessage({
                type: 'setOnOff',
                onOff: POP_isMasterFilteringEnabled ? 'on' : 'off'
            });
            popShowReloadButton();
        } catch (error) {
            console.log('Error setting global filtering: '+error);
        }
    });

    const siteToggle = document.getElementById('isSiteOnOff');
    siteToggle.addEventListener('change', async function(e) {
        if (!POP_activeTab || !POP_isSiteFilteringSupported) {
            return;
        }
        try {
            const state = await browser.runtime.sendMessage({
                type: 'setSiteFilteringEnabled',
                url: POP_activeTab.url,
                enabled: e.target.checked
            });
            POP_isSiteFilteringSupported = !!state.supported;
            POP_isSiteFilteringEnabled = !!state.enabled;
            popUpdateFilteringUi();
            popShowReloadButton();
        } catch (error) {
            console.log('Error setting site filtering: '+error);
            e.target.checked = POP_isSiteFilteringEnabled;
        }
    });

    document.getElementById('reloadFilteringPage').addEventListener('click', async function() {
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
        masterToggle.checked = POP_isMasterFilteringEnabled;
    } catch (error) {
        console.log('Error getting global filtering: '+error);
    }

    if (POP_activeTab && typeof POP_activeTab.url === 'string') {
        try {
            const state = await browser.runtime.sendMessage({
                type: 'getSiteFilteringState',
                url: POP_activeTab.url
            });
            POP_isSiteFilteringSupported = !!state.supported;
            POP_isSiteFilteringEnabled = !!state.enabled;
            document.getElementById('siteFilteringHostname').textContent = state.supported
                ? state.hostname
                : 'Unavailable on this page.';
        } catch (error) {
            console.log('Error getting site filtering: '+error);
            document.getElementById('siteFilteringHostname').textContent = 'Unavailable on this page.';
        }
    } else {
        document.getElementById('siteFilteringHostname').textContent = 'Unavailable on this page.';
    }
    popUpdateFilteringUi();

    browser.runtime.sendMessage({type:'getOnOffSwitchShown'}).then(
        function(message) {
            console.log('Restoring filtering controls visibility to '+message.isOnOffSwitchShown);
            document.querySelector('.filtering-control').classList.toggle(
                'filtering-hidden',
                !message.isOnOffSwitchShown
            );
        },
        function(error) {
            console.log('Error getting filtering controls visibility: '+error);
        }
    );
};
