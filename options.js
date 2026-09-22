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
    browser.runtime.sendMessage({ type: 'setDefaultZone' });

    let backendSelection = document.querySelector('input[name="backend_selection"]:checked').value;
    await browser.storage.local.set({
        backend_selection: backendSelection
    });
    browser.runtime.sendMessage({ type: 'setBackendSelection', value: backendSelection });
}

const OPT_DEFAULT_URL_FILTER_RULES = {
    whitelist: {
        domains: [
            '# Allow Google reCAPTCHA to load correctly',
            'https://www.google.com/recaptcha',
            'https://www.gstatic.com/recaptcha'
        ],
        regex: []
    },
    blacklist: {
        domains: [],
        regex: []
    }
};

const OPT_SITE_MODES = ['off', 'adaptive', 'trusted', 'neutral', 'untrusted'];

function optNormalizeSiteSettings(settings) {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
        return {};
    }
    const normalized = {};
    for (const [hostname, preference] of Object.entries(settings)) {
        if (!hostname) {
            continue;
        }
        let mode = OPT_SITE_MODES.includes(preference) ? preference : null;
        if (!mode && preference && typeof preference === 'object') {
            mode = preference.enabled === false
                ? 'off'
                : (OPT_SITE_MODES.includes(preference.mode) ? preference.mode : null);
        }
        if (mode) {
            normalized[hostname.toLowerCase()] = mode;
        }
    }
    return normalized;
}

function optMigrateDisabledSiteHosts(hosts) {
    const settings = {};
    if (Array.isArray(hosts)) {
        for (const hostname of hosts) {
            if (typeof hostname === 'string' && hostname.trim()) {
                settings[hostname.trim().toLowerCase()] = 'off';
            }
        }
    }
    return settings;
}

async function optReadSiteSettings() {
    const result = await browser.storage.local.get([
        'site_filtering_settings',
        'site_filtering_disabled_hosts'
    ]);
    return Object.prototype.hasOwnProperty.call(result, 'site_filtering_settings')
        ? optNormalizeSiteSettings(result.site_filtering_settings)
        : optMigrateDisabledSiteHosts(result.site_filtering_disabled_hosts);
}

function optRenderSiteSettings(settings) {
    const list = document.getElementById('site_filtering_hosts');
    const empty = document.getElementById('site_filtering_empty');
    const normalizedSettings = optNormalizeSiteSettings(settings);
    const hostnames = Object.keys(normalizedSettings).sort();
    list.textContent = '';
    empty.hidden = hostnames.length > 0;

    for (const hostname of hostnames) {
        const mode = normalizedSettings[hostname];
        const item = document.createElement('li');
        const hostText = document.createElement('code');
        const modeSelect = document.createElement('select');
        const removeButton = document.createElement('button');
        hostText.textContent = hostname;
        modeSelect.dataset.hostname = hostname;
        for (const [value, label] of [
            ['off', 'Off'],
            ['adaptive', 'Adaptive'],
            ['trusted', 'Trusted'],
            ['neutral', 'Neutral'],
            ['untrusted', 'Untrusted']
        ]) {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            modeSelect.append(option);
        }
        modeSelect.value = mode;
        removeButton.type = 'button';
        removeButton.textContent = 'Use default';
        removeButton.dataset.hostname = hostname;
        item.append(hostText, modeSelect, removeButton);
        list.append(item);
    }
}

async function optUpdateSiteSetting(hostname, value) {
    const status = document.getElementById('site_filtering_status');
    try {
        const settings = await optReadSiteSettings();
        settings[hostname] = value;
        await browser.storage.local.set({ site_filtering_settings: settings });
        optRenderSiteSettings(settings);
        status.textContent = `Updated ${hostname}.`;
    } catch (error) {
        status.textContent = 'Could not update the site.';
        console.error('Error updating site filtering preference', error);
    }
}

async function optResetSiteSetting(hostname) {
    const status = document.getElementById('site_filtering_status');
    try {
        const settings = await optReadSiteSettings();
        delete settings[hostname];
        await browser.storage.local.set({ site_filtering_settings: settings });
        optRenderSiteSettings(settings);
        status.textContent = `${hostname} now uses the default zone.`;
    } catch (error) {
        status.textContent = 'Could not reset the site.';
        console.error('Error resetting site filtering preference', error);
    }
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

    browser.storage.local.get('url_filter_rules').then(rawResult => {
        const rules = Object.prototype.hasOwnProperty.call(rawResult, 'url_filter_rules') && rawResult.url_filter_rules
            ? rawResult.url_filter_rules
            : OPT_DEFAULT_URL_FILTER_RULES;
        const whitelist = rules.whitelist || {};
        const blacklist = rules.blacklist || {};
        document.getElementById('whitelist_domains').value = (whitelist.domains || []).join('\n');
        document.getElementById('whitelist_regex').value = (whitelist.regex || []).join('\n');
        document.getElementById('blacklist_domains').value = (blacklist.domains || []).join('\n');
        document.getElementById('blacklist_regex').value = (blacklist.regex || []).join('\n');
    }, onError);

    optReadSiteSettings().then(optRenderSiteSettings, onError);
}

function optLinesFromTextarea(id) {
    return document.getElementById(id).value
        .split(/\r?\n/)
        .map(value => value.trim())
        .filter(value => value.length > 0);
}

function optActiveLinesFromTextarea(id) {
    return optLinesFromTextarea(id).filter(value => !value.startsWith('#'));
}

function optCompileUrlRegex(value) {
    let pattern = value;
    let flags = '';
    if (value.startsWith('/')) {
        const lastSlash = value.lastIndexOf('/');
        const possibleFlags = value.slice(lastSlash + 1);
        if (lastSlash > 0 && /^[dgimsuvy]*$/.test(possibleFlags)) {
            pattern = value.slice(1, lastSlash);
            flags = possibleFlags;
        }
    }
    return new RegExp(pattern, flags);
}

function optValidateRegexList(id, label) {
    const input = document.getElementById(id);
    for (const value of optActiveLinesFromTextarea(id)) {
        try {
            optCompileUrlRegex(value);
        } catch (error) {
            input.setAttribute('aria-invalid', 'true');
            return `${label} contains an invalid expression: ${value}`;
        }
    }
    input.removeAttribute('aria-invalid');
    return '';
}

function optValidateDomainList(id, label) {
    const input = document.getElementById(id);
    for (const value of optActiveLinesFromTextarea(id)) {
        let candidate = value.toLowerCase();
        if (candidate.startsWith('*.')) {
            candidate = candidate.slice(2);
        }
        try {
            const parsed = new URL(candidate.includes('://') ? candidate : 'http://' + candidate);
            if (!parsed.hostname) {
                throw new Error('Missing hostname');
            }
        } catch (error) {
            input.setAttribute('aria-invalid', 'true');
            return `${label} contains an invalid domain or URL: ${value}`;
        }
    }
    input.removeAttribute('aria-invalid');
    return '';
}

async function optSaveUrlRules() {
    const status = document.getElementById('url_rules_status');
    const validationError = optValidateDomainList('whitelist_domains', 'Whitelist')
        || optValidateRegexList('whitelist_regex', 'Whitelist')
        || optValidateDomainList('blacklist_domains', 'Blacklist')
        || optValidateRegexList('blacklist_regex', 'Blacklist');
    if (validationError) {
        status.dataset.state = 'error';
        status.textContent = validationError;
        return;
    }

    const rules = {
        whitelist: {
            domains: optLinesFromTextarea('whitelist_domains'),
            regex: optLinesFromTextarea('whitelist_regex')
        },
        blacklist: {
            domains: optLinesFromTextarea('blacklist_domains'),
            regex: optLinesFromTextarea('blacklist_regex')
        }
    };

    try {
        await browser.storage.local.set({ url_filter_rules: rules });
        status.dataset.state = 'saved';
        status.textContent = 'Saved.';
    } catch (error) {
        status.dataset.state = 'error';
        status.textContent = 'Could not save URL lists.';
        console.error('Error saving URL rules', error);
    }
}

document.addEventListener("DOMContentLoaded", optRestoreOptions);
document.getElementById('save_url_rules').addEventListener('click', optSaveUrlRules);
document.getElementById('site_filtering_hosts').addEventListener('click', event => {
    const hostname = event.target?.dataset?.hostname;
    if (hostname && event.target.tagName === 'BUTTON') {
        optResetSiteSetting(hostname);
    }
});
document.getElementById('site_filtering_hosts').addEventListener('change', event => {
    const hostname = event.target?.dataset?.hostname;
    if (hostname && event.target.tagName === 'SELECT') {
        optUpdateSiteSetting(hostname, event.target.value);
    }
});
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
