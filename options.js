async function optSaveOptions() {
    let isDnsBlocking = document.querySelector('input[name="dns_blocking"]:checked').value == "dns_blocking_yes";
    await browser.storage.local.set({
    is_dns_blocking: isDnsBlocking
    });
    browser.runtime.sendMessage({ type: 'setDnsBlocking', value: isDnsBlocking });

    let isOnOffShown = document.querySelector('input[name="on_off_shown"]:checked').value == "on_off_shown_yes";
    await browser.storage.local.set({
    is_on_off_shown: isOnOffShown
    });
    browser.runtime.sendMessage({ type: 'setOnOffSwitchShown', value: isOnOffShown });

    let backendSelection = document.querySelector('input[name="backend_selection"]:checked').value;
    await browser.storage.local.set({
    backend_selection: backendSelection
    });
    browser.runtime.sendMessage({ type: 'setBackendSelection', value: backendSelection });
}

function optRestoreOptions() {
    console.log('OPTION: Restoring saved options');

    function setCurrentDnsBlockingChoice(rawResult) {
        let result = rawResult.is_dns_blocking;
        console.log('OPTION: Setting DNS to '+result);
        if(result) {
            document.getElementById('dns_blocking_yes').checked = true;
        } else {
            document.getElementById('dns_blocking_no').checked = true;
        }
        browser.runtime.sendMessage({ type: 'setDnsBlocking', value: result });
    }

    function setCurrentShowOnOffSwitchChoice(rawResult) {
        let result = rawResult.is_on_off_shown;
        console.log('OPTION: Setting visibility of on/off switch to '+result);
        if(result) {
            document.getElementById('on_off_shown_yes').checked = true;
        } else {
            document.getElementById('on_off_shown_no').checked = true;
        }
        browser.runtime.sendMessage({ type: 'setOnOffSwitchShown', value: result });
    }

    function setCurrentBackendSelectionSwitchChoice(rawResult) {
        let result = rawResult.backend_selection;
        console.log('OPTION: Setting backend to '+result);
        let coercedResult = result || 'webgl';
        document.getElementById('backend_selection_'+coercedResult).checked = true;
        browser.runtime.sendMessage({ type: 'setBackendSelection', value: coercedResult });
    }

    function onError(error) {
        console.log(`Error restoring: ${error}`);
    }

    let getting = browser.storage.local.get('is_dns_blocking');
    getting.then(setCurrentDnsBlockingChoice, onError);

    let gettingOnOffShown = browser.storage.local.get('is_on_off_shown');
    gettingOnOffShown.then(setCurrentShowOnOffSwitchChoice, onError);

    let gettingBackendSelection = browser.storage.local.get('backend_selection');
    gettingBackendSelection.then(setCurrentBackendSelectionSwitchChoice, onError);
}

document.addEventListener("DOMContentLoaded", optRestoreOptions);
var radios = document.forms[0].elements["dns_blocking"];
for(var i = 0, max = radios.length; i < max; i++) {
    radios[i].onclick = function() {
        optSaveOptions();
    }
}
var radiosOnOff = document.forms[0].elements["on_off_shown"];
for(var i = 0, max = radiosOnOff.length; i < max; i++) {
    radiosOnOff[i].onclick = function() {
        optSaveOptions();
    }
}

var radiosBackendSelection = document.forms[0].elements["backend_selection"];
for(var i = 0, max = radiosBackendSelection.length; i < max; i++) {
    radiosBackendSelection[i].onclick = function() {
        optSaveOptions();
    }
}