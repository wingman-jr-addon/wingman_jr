async function optSaveOptions() {
    let isOnOffShown = document.querySelector('input[name="on_off_shown"]:checked').value == "on_off_shown_yes";
    await browser.storage.local.set({
        is_on_off_shown: isOnOffShown
    });
    browser.runtime.sendMessage({ type: 'setOnOffSwitchShown', value: isOnOffShown });

    let videoBlockingMode = document.querySelector('input[name="video_blocking_mode"]:checked').value;
    await browser.storage.local.set({
        video_blocking_mode: videoBlockingMode
    });
    browser.runtime.sendMessage({ type: 'setVideoBlockingMode', value: videoBlockingMode });

    let isSilentModeEnabled = document.querySelector('input[name="is_silent_mode_enabled"]:checked').value == "is_silent_mode_enabled_yes";
    await browser.storage.local.set({
        is_silent_mode_enabled: isSilentModeEnabled
    });
    browser.runtime.sendMessage({ type: 'setSilentModeEnabled', value: isSilentModeEnabled });

    let defaultZone = document.querySelector('input[name="default_zone"]:checked').value;
    await browser.storage.local.set({
        default_zone: defaultZone
    });

    let backendSelection = document.querySelector('input[name="backend_selection"]:checked').value;
    await browser.storage.local.set({
        backend_selection: backendSelection
    });
    browser.runtime.sendMessage({ type: 'setBackendSelection', value: backendSelection });
}

function optRestoreOptions() {
    console.log('OPTION: Restoring saved options');

    function setCurrentShowOnOffSwitchChoice(rawResult) {
        let result = rawResult.is_on_off_shown;
        console.log('OPTION: Setting visibility of on/off switch to ' + result);
        if (result) {
            document.getElementById('on_off_shown_yes').checked = true;
        } else {
            document.getElementById('on_off_shown_no').checked = true;
        }
        browser.runtime.sendMessage({ type: 'setOnOffSwitchShown', value: result });
    }

    function setCurrentVideoBlockingChoice(rawResult) {
        let result = rawResult.video_blocking_mode;
        let isVideoBlockingDisabled = rawResult.is_video_blocking_disabled;
        let coercedResult = result;
        if (!coercedResult) {
            if (isVideoBlockingDisabled === true) {
                coercedResult = 'disabled';
            } else if (isVideoBlockingDisabled === false) {
                coercedResult = 'enabled';
            } else {
                coercedResult = 'quick';
            }
        }
        console.log('OPTION: Setting video blocking mode to ' + coercedResult);
        document.getElementById('video_blocking_mode_' + coercedResult).checked = true;
        browser.runtime.sendMessage({ type: 'setVideoBlockingMode', value: coercedResult });
    }

    function setCurrentSilentModeEnabledChoice(rawResult) {
        let result = rawResult.is_silent_mode_enabled;
        console.log('OPTION: Setting silent mode enabled switch to ' + result);
        if (result) {
            document.getElementById('is_silent_mode_enabled_yes').checked = true;
        } else {
            document.getElementById('is_silent_mode_enabled_no').checked = true;
        }
        browser.runtime.sendMessage({ type: 'setSilentModeEnabled', value: result });
    }

    function setDefaultZoneSwitchChoice(rawResult) {
        let result = rawResult.default_zone;
        let coercedResult = result || 'automatic';
        console.log('OPTION: Setting default zone to ' + coercedResult);
        document.getElementById('default_zone_' + coercedResult).checked = true;
    }

    function setCurrentBackendSelectionSwitchChoice(rawResult) {
        let result = rawResult.backend_selection;
        console.log('OPTION: Setting backend to ' + result);
        let coercedResult = result || 'webgl';
        document.getElementById('backend_selection_' + coercedResult).checked = true;
        browser.runtime.sendMessage({ type: 'setBackendSelection', value: coercedResult });
    }

    function onError(error) {
        console.log(`Error restoring: ${error}`);
    }

    let gettingOnOffShown = browser.storage.local.get('is_on_off_shown');
    gettingOnOffShown.then(setCurrentShowOnOffSwitchChoice, onError);

    let gettingVideoBlocking = browser.storage.local.get(['video_blocking_mode', 'is_video_blocking_disabled']);
    gettingVideoBlocking.then(setCurrentVideoBlockingChoice, onError);

    let gettingSilentModeEnabled = browser.storage.local.get('is_silent_mode_enabled');
    gettingSilentModeEnabled.then(setCurrentSilentModeEnabledChoice, onError);

    let gettingDefaultZone = browser.storage.local.get('default_zone');
    gettingDefaultZone.then(setDefaultZoneSwitchChoice, onError);

    let gettingBackendSelection = browser.storage.local.get('backend_selection');
    gettingBackendSelection.then(setCurrentBackendSelectionSwitchChoice, onError);
}

document.addEventListener("DOMContentLoaded", optRestoreOptions);
var radiosOnOff = document.forms[0].elements["on_off_shown"];
for (var i = 0, max = radiosOnOff.length; i < max; i++) {
    radiosOnOff[i].onclick = function () {
        optSaveOptions();
    }
}
var radiosVideoBlockingMode = document.forms[0].elements["video_blocking_mode"];
for (var i = 0, max = radiosVideoBlockingMode.length; i < max; i++) {
    radiosVideoBlockingMode[i].onclick = function () {
        optSaveOptions();
    }
}
var radiosSilentModeEnabled = document.forms[0].elements["is_silent_mode_enabled"];
for (var i = 0, max = radiosSilentModeEnabled.length; i < max; i++) {
    radiosSilentModeEnabled[i].onclick = function () {
        optSaveOptions();
    }
}

var radiosDefaultZone = document.forms[0].elements["default_zone"];
for (var i = 0, max = radiosDefaultZone.length; i < max; i++) {
    radiosDefaultZone[i].onclick = function () {
        optSaveOptions();
    }
}


var radiosBackendSelection = document.forms[0].elements["backend_selection"];
for (var i = 0, max = radiosBackendSelection.length; i < max; i++) {
    radiosBackendSelection[i].onclick = function () {
        optSaveOptions();
    }
}
