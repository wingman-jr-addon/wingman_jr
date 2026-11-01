async function optSaveOptions() {
    let isOnOffShown = document.querySelector('input[name="on_off_shown"]:checked').value == "on_off_shown_yes";
    let videoBlockingMode = document.querySelector('input[name="video_blocking_mode"]:checked').value;
    let isSilentModeEnabled = document.querySelector('input[name="is_silent_mode_enabled"]:checked').value == "is_silent_mode_enabled_yes";
    let defaultZone = document.querySelector('input[name="default_zone"]:checked').value;
    let modelSelection = document.querySelector('input[name="model_selection"]:checked').value;
    let backendSelection = document.querySelector('input[name="backend_selection"]:checked').value;
    try {
        await browser.runtime.sendMessage({
            type: 'settings.update',
            changes: {
                is_on_off_shown: isOnOffShown,
                video_blocking_mode: videoBlockingMode,
                is_silent_mode_enabled: isSilentModeEnabled,
                default_zone: defaultZone,
                model_selection: modelSelection,
                backend_selection: backendSelection
            }
        });
    } catch (error) {
        console.error('Error saving protected settings', error);
        await optRestoreOptions();
    }
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
let OPT_securityState = null;

function optSetSecurityStatus(id, message, state = '') {
    const element = document.getElementById(id);
    element.textContent = message;
    element.dataset.state = state;
}

function optResetProtectionFlow() {
    document.getElementById('lock_setup_wizard').hidden = true;
    document.getElementById('lock_setup_intro').hidden = false;
    document.getElementById('lock_setup_password').hidden = true;
    document.getElementById('lock_remove_wizard').hidden = true;
    document.getElementById('lock_reset_wizard').hidden = true;
    document.getElementById('new_settings_password').value = '';
    document.getElementById('confirm_settings_password').value = '';
    document.getElementById('password_match_status').textContent = '';
    document.getElementById('password_match_status').dataset.state = '';
    document.getElementById('enable_settings_lock').disabled = true;
    document.getElementById('confirm_password_reset').checked = false;
    document.getElementById('reset_settings_password').disabled = true;
}

function optRenderSecurityState() {
    if (!OPT_securityState) {
        return;
    }
    const protectedAndLocked = OPT_securityState.settingsLockEnabled
        && !OPT_securityState.settingsUnlocked;
    document.body.classList.toggle('settings-locked', protectedAndLocked);
    optResetProtectionFlow();
    document.getElementById('lock_unprotected_view').hidden = OPT_securityState.settingsLockEnabled;
    document.getElementById('lock_protected_view').hidden = !OPT_securityState.settingsLockEnabled;
    document.getElementById('unlock_settings').hidden = !protectedAndLocked;
    document.getElementById('current_settings_password').hidden = !protectedAndLocked;
    document.getElementById('lock_settings_now').hidden = protectedAndLocked;
    document.getElementById('start_disable_settings_lock').hidden = protectedAndLocked;
    document.getElementById('start_reset_settings_password').hidden = !protectedAndLocked;
    document.getElementById('settings_content').hidden = protectedAndLocked;
    document.getElementById('settings_lock_summary').textContent = protectedAndLocked
        ? 'Settings are locked. Enter the password to view or change them.'
        : 'Settings are unlocked until you leave or reload this page.';
    document.getElementById('audit_enabled').checked = OPT_securityState.trackingEnabled === true;
    document.getElementById('audit_disable_warning').hidden = true;
    document.getElementById('confirm_audit_clear').checked = false;
    document.getElementById('audit_private_help').hidden = OPT_securityState.privateAccessAllowed;
    optSetSecurityStatus(
        'settings_lock_status',
        '',
        ''
    );
    optSetSecurityStatus(
        'audit_setting_status',
        OPT_securityState.trackingEnabled
            ? (OPT_securityState.privateAccessAllowed
                ? 'Audit is on. Private browsing is included.'
                : 'Audit is on. Private browsing is not included.')
            : 'Audit is off.'
    );
}

async function optLoadSecurityState() {
    OPT_securityState = await browser.runtime.sendMessage({ type: 'audit.checkPrivateCoverage' });
    optRenderSecurityState();
}

async function optInitializeSecurityState() {
    await browser.runtime.sendMessage({ type: 'audit.lockSettings' });
    await optLoadSecurityState();
}

async function optEnableSettingsLock() {
    const password = document.getElementById('new_settings_password').value;
    const confirmation = document.getElementById('confirm_settings_password').value;
    if (!optUpdatePasswordMatchState()) {
        return;
    }
    try {
        OPT_securityState = await browser.runtime.sendMessage({
            type: 'audit.enableSettingsLock',
            password,
            confirmPassword: confirmation
        });
        optRenderSecurityState();
    } catch (error) {
        optSetSecurityStatus('settings_lock_status', error.message || String(error), 'error');
    }
}

function optUpdatePasswordMatchState() {
    const password = document.getElementById('new_settings_password').value;
    const confirmation = document.getElementById('confirm_settings_password').value;
    const status = document.getElementById('password_match_status');
    let message = '';
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
    document.getElementById('enable_settings_lock').disabled = !valid;
    return valid;
}

async function optUnlockSettings() {
    const password = document.getElementById('current_settings_password').value;
    try {
        OPT_securityState = await browser.runtime.sendMessage({
            type: 'audit.unlockSettings',
            password
        });
        document.getElementById('current_settings_password').value = '';
        optRenderSecurityState();
    } catch (error) {
        optSetSecurityStatus('settings_lock_status', error.message || String(error), 'error');
    }
}

async function optLockSettingsNow() {
    OPT_securityState = await browser.runtime.sendMessage({ type: 'audit.lockSettings' });
    optRenderSecurityState();
}

async function optDisableSettingsLock() {
    try {
        OPT_securityState = await browser.runtime.sendMessage({ type: 'audit.disableSettingsLock' });
        optRenderSecurityState();
    } catch (error) {
        optSetSecurityStatus('settings_lock_status', error.message || String(error), 'error');
    }
}

async function optResetSettingsPassword() {
    if (!document.getElementById('confirm_password_reset').checked) {
        return;
    }
    try {
        OPT_securityState = await browser.runtime.sendMessage({ type: 'audit.resetPassword' });
        optRenderSecurityState();
    } catch (error) {
        optSetSecurityStatus('settings_lock_status', error.message || String(error), 'error');
    }
}

function optStartSettingsLockSetup() {
    document.getElementById('lock_unprotected_view').hidden = true;
    document.getElementById('lock_setup_wizard').hidden = false;
    document.getElementById('settings_content').hidden = true;
    document.getElementById('lock_setup_intro').hidden = false;
    document.getElementById('lock_setup_password').hidden = true;
    optSetSecurityStatus('settings_lock_status', 'Step 1 of 2', '');
}

function optContinueSettingsLockSetup() {
    document.getElementById('lock_setup_intro').hidden = true;
    document.getElementById('lock_setup_password').hidden = false;
    optSetSecurityStatus('settings_lock_status', 'Step 2 of 2', '');
    document.getElementById('new_settings_password').focus();
}

function optBackSettingsLockSetup() {
    document.getElementById('lock_setup_intro').hidden = false;
    document.getElementById('lock_setup_password').hidden = true;
    optSetSecurityStatus('settings_lock_status', 'Step 1 of 2', '');
}

function optCancelProtectionFlow() {
    optResetProtectionFlow();
    optRenderSecurityState();
}

function optStartDisableSettingsLock() {
    document.getElementById('lock_protected_view').hidden = true;
    document.getElementById('lock_remove_wizard').hidden = false;
}

function optStartResetSettingsPassword() {
    document.getElementById('lock_protected_view').hidden = true;
    document.getElementById('lock_reset_wizard').hidden = false;
}

async function optCheckAuditPrivateAccess() {
    const wantsAuditEnabled = document.getElementById('audit_enabled').checked;
    optSetSecurityStatus('audit_setting_status', 'Checking private browsing access…');
    try {
        OPT_securityState = await browser.runtime.sendMessage({ type: 'audit.checkPrivateCoverage' });
        optRenderSecurityState();
        if (wantsAuditEnabled && OPT_securityState.privateAccessAllowed
            && !OPT_securityState.trackingEnabled) {
            document.getElementById('audit_enabled').checked = true;
            optSetSecurityStatus('audit_setting_status', 'Private browsing is included. Apply the audit setting to turn it on.', 'saved');
        }
    } catch (error) {
        optSetSecurityStatus('audit_setting_status', error.message || String(error), 'error');
    }
}

async function optApplyAuditSetting() {
    const enabled = document.getElementById('audit_enabled').checked;
    if (OPT_securityState.trackingEnabled && !enabled
        && !document.getElementById('confirm_audit_clear').checked) {
        document.getElementById('audit_disable_warning').hidden = false;
        optSetSecurityStatus('audit_setting_status', 'Confirm that the saved audit history will be erased.', 'error');
        return;
    }
    try {
        OPT_securityState = await browser.runtime.sendMessage({
            type: 'audit.setTracking',
            enabled
        });
        optRenderSecurityState();
    } catch (error) {
        optSetSecurityStatus('audit_setting_status', error.message || String(error), 'error');
    }
}

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
        await browser.runtime.sendMessage({
            type: 'setSiteFilteringMode',
            url: `https://${hostname}/`,
            mode: value,
            incognito: false
        });
        const settings = await optReadSiteSettings();
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
        await browser.runtime.sendMessage({
            type: 'resetSiteFiltering',
            url: `https://${hostname}/`,
            incognito: false
        });
        const settings = await optReadSiteSettings();
        optRenderSiteSettings(settings);
        status.textContent = `${hostname} now uses the default zone.`;
    } catch (error) {
        status.textContent = 'Could not reset the site.';
        console.error('Error resetting site filtering preference', error);
    }
}

function optRenderAdaptiveMemoryState(state) {
    const enabled = state?.enabled !== false;
    const count = Number.isInteger(state?.rememberedDomainCount)
        ? state.rememberedDomainCount
        : 0;
    document.getElementById('remember_adaptive_zones').checked = enabled;
    document.getElementById('adaptive_memory_count').textContent =
        `${count} remembered ${count === 1 ? 'site' : 'sites'}`;
}

async function optSetAdaptiveMemoryEnabled(enabled) {
    const status = document.getElementById('adaptive_memory_status');
    try {
        const state = await browser.runtime.sendMessage({
            type: 'setAdaptiveZonePersistence',
            enabled: enabled
        });
        optRenderAdaptiveMemoryState(state);
        status.dataset.state = 'saved';
        status.textContent = enabled
            ? 'Adaptive zone memory enabled.'
            : 'Adaptive zone memory disabled and saved zones removed.';
    } catch (error) {
        status.dataset.state = 'error';
        status.textContent = 'Could not update adaptive zone memory.';
        console.error('Error updating adaptive zone memory', error);
    }
}

async function optClearAdaptiveMemory() {
    const status = document.getElementById('adaptive_memory_status');
    try {
        const state = await browser.runtime.sendMessage({ type: 'clearAdaptiveZoneMemory' });
        optRenderAdaptiveMemoryState(state);
        status.dataset.state = 'saved';
        status.textContent = 'Adaptive zones reset to neutral.';
    } catch (error) {
        status.dataset.state = 'error';
        status.textContent = 'Could not clear adaptive zone memory.';
        console.error('Error clearing adaptive zone memory', error);
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
        let coercedResult = (result === 'enabled' || result === 'quick' || result === 'disabled')
            ? result
            : null;
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

    function setCurrentModelSelectionChoice(rawResult) {
        const result = rawResult.model_selection === 'sqrxr_112' ? 'sqrxr_112' : 'n017';
        console.log('OPTION: Setting model to ' + result);
        document.getElementById('model_selection_' + result).checked = true;
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

    let gettingModelSelection = browser.storage.local.get('model_selection');
    gettingModelSelection.then(setCurrentModelSelectionChoice, onError);

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
    browser.runtime.sendMessage({ type: 'getAdaptiveZoneMemoryState' })
        .then(optRenderAdaptiveMemoryState, onError);
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
        await browser.runtime.sendMessage({
            type: 'settings.update',
            changes: { url_filter_rules: rules }
        });
        status.dataset.state = 'saved';
        status.textContent = 'Saved.';
    } catch (error) {
        status.dataset.state = 'error';
        status.textContent = 'Could not save URL lists.';
        console.error('Error saving URL rules', error);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    optInitializeSecurityState().catch(error => {
        optSetSecurityStatus('settings_lock_status', error.message || String(error), 'error');
    });
    optRestoreOptions();
});
window.addEventListener('pagehide', () => {
    browser.runtime.sendMessage({ type: 'audit.lockSettings' }).catch(() => {});
});
document.getElementById('start_settings_lock_setup').addEventListener('click', optStartSettingsLockSetup);
document.getElementById('continue_settings_lock_setup').addEventListener('click', optContinueSettingsLockSetup);
document.getElementById('back_settings_lock_setup').addEventListener('click', optBackSettingsLockSetup);
document.getElementById('cancel_settings_lock_setup').addEventListener('click', optCancelProtectionFlow);
document.getElementById('cancel_settings_lock_password').addEventListener('click', optCancelProtectionFlow);
document.getElementById('enable_settings_lock').addEventListener('click', optEnableSettingsLock);
document.getElementById('new_settings_password').addEventListener('input', optUpdatePasswordMatchState);
document.getElementById('confirm_settings_password').addEventListener('input', optUpdatePasswordMatchState);
document.getElementById('unlock_settings').addEventListener('click', optUnlockSettings);
document.getElementById('lock_settings_now').addEventListener('click', optLockSettingsNow);
document.getElementById('start_disable_settings_lock').addEventListener('click', optStartDisableSettingsLock);
document.getElementById('disable_settings_lock').addEventListener('click', optDisableSettingsLock);
document.getElementById('cancel_disable_settings_lock').addEventListener('click', optCancelProtectionFlow);
document.getElementById('start_reset_settings_password').addEventListener('click', optStartResetSettingsPassword);
document.getElementById('reset_settings_password').addEventListener('click', optResetSettingsPassword);
document.getElementById('cancel_reset_settings_password').addEventListener('click', optCancelProtectionFlow);
document.getElementById('confirm_password_reset').addEventListener('change', event => {
    document.getElementById('reset_settings_password').disabled = !event.target.checked;
});
document.getElementById('current_settings_password').addEventListener('keydown', event => {
    if (event.key === 'Enter') {
        event.preventDefault();
        optUnlockSettings();
    }
});
document.getElementById('apply_audit_setting').addEventListener('click', optApplyAuditSetting);
document.getElementById('check_audit_private_access').addEventListener('click', optCheckAuditPrivateAccess);
document.getElementById('audit_enabled').addEventListener('change', event => {
    const turningOff = OPT_securityState?.trackingEnabled === true && !event.target.checked;
    document.getElementById('audit_disable_warning').hidden = !turningOff;
    if (!turningOff) {
        document.getElementById('confirm_audit_clear').checked = false;
    }
});
document.getElementById('save_url_rules').addEventListener('click', optSaveUrlRules);
document.getElementById('remember_adaptive_zones').addEventListener('change', event => {
    optSetAdaptiveMemoryEnabled(event.target.checked);
});
document.getElementById('clear_adaptive_zones').addEventListener('click', optClearAdaptiveMemory);
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

var radiosModelSelection = document.forms[0].elements["model_selection"];
for (var i = 0, max = radiosModelSelection.length; i < max; i++) {
    radiosModelSelection[i].onclick = function () {
        optSaveOptions();
    }
}
