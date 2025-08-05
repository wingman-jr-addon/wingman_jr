window.onload=function()
{
    let testButton = document.getElementById('testButton');
    testButton.addEventListener('click', async function() {
        const [tab] = await browser.tabs.query({active: true, currentWindow: true});
        if (tab) {
            browser.tabs.sendMessage(tab.id, {kind: "tint"});
        }
    });

    let rad = document.getElementById('popupForm').zone;
    for (var i = 0; i < rad.length; i++) {
        rad[i].addEventListener('change', function(e) {
            browser.runtime.sendMessage({ type: 'setZone', zone: e.target.id });
            browser.runtime.sendMessage({ type: 'setZoneAutomatic', isZoneAutomatic: false });
            window.close();
        });
    }
    let sending = browser.runtime.sendMessage({type:'getZone'});
    sending.then(
        function(message)
        {
            console.log('Restoring zone visual state to '+message.zone);
            document.getElementById(message.zone).checked = true;
        },
        function(error)
        {
            console.log('Error getting zone: '+error);
        }
    )
    let autoBox = document.getElementById('popupForm').zoneAuto;
    autoBox.addEventListener('change', function(e) {
        browser.runtime.sendMessage({ type: 'setZoneAutomatic', isZoneAutomatic: e.target.checked });
        window.close();
    });
    let automatic = browser.runtime.sendMessage({type:'getZoneAutomatic'});
    automatic.then(
        function(message)
        {
            console.log('Restoring zone visual state for automatic to '+message.isZoneAutomatic);
            document.getElementById('isZoneAutomatic').checked = message.isZoneAutomatic;
        },
        function(error)
        {
            console.log('Error getting zone automatic: '+error);
        }
    );
    let checkOnOff = document.getElementById('isOnOff');
    checkOnOff.addEventListener('change', function(e) {
        console.log('Setting on/off to '+e.target.checked);
        browser.runtime.sendMessage({ type: 'setOnOff', onOff: e.target.checked ? 'on' : 'off' });
        window.close();
    })
    let sendingOnOff = browser.runtime.sendMessage({type:'getOnOff'});
    sendingOnOff.then(
        function(message)
        {
            console.log('Restoring on/off state to '+message.onOff);
            document.getElementById('isOnOff').checked = message.onOff=='on';
        },
        function(error)
        {
            console.log('Error getting onOff: '+error);
        }
    )
    let sendingOnOffShown = browser.runtime.sendMessage({type:'getOnOffSwitchShown'});
    sendingOnOffShown.then(
        function(message)
        {
            console.log('Restoring on/off shown state to '+message.isOnOffSwitchShown);
            document.getElementById('isOnOffSection').className = message.isOnOffSwitchShown ? 'switch_visible' : 'switch_hidden';
        },
        function(error)
        {
            console.log('Error getting onOffShown: '+error);
        }
    )
}