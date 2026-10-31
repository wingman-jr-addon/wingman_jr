const assert = require('assert');
const fs = require('fs');

const audit = fs.readFileSync('audit.js', 'utf8');
const background = fs.readFileSync('background.js', 'utf8');
const options = fs.readFileSync('options.js', 'utf8');
const processor = fs.readFileSync('processor.js', 'utf8');
const setup = fs.readFileSync('setup.js', 'utf8');
const silentCollections = fs.readFileSync('silent_collections.js', 'utf8');
const whitelist = fs.readFileSync('whitelist.js', 'utf8');
const auditPage = fs.readFileSync('audit.html', 'utf8');
const optionsPage = fs.readFileSync('options.html', 'utf8');

assert.match(audit, /settingsLockEnabled:\s*input\.settingsLockEnabled === true \|\| migratedAccountability/,
    'legacy Accountability users migrate to Audit plus settings protection');
assert.match(audit, /async function auditRequireSettingsUnlocked\(\)/,
    'the background exposes one central settings guard');
assert.match(audit, /case 'audit\.setTracking'/,
    'audit is a simple independent on/off setting');
assert.doesNotMatch(audit, /ACCOUNTABILITY:/,
    'Accountability is no longer a runtime tracking mode');

for (const messageType of [
    'setOnOff',
    'setMasterPause',
    'setSiteFilteringMode',
    'resetSiteFiltering',
    'setAdaptiveZonePersistence',
    'clearAdaptiveZoneMemory',
    'settings.update'
]) {
    const start = background.indexOf(`request.type == '${messageType}'`);
    assert.ok(start >= 0, `${messageType} handler exists`);
    const handler = background.slice(start, start + 800);
    assert.match(handler, /auditRequireSettingsUnlocked|bkUpdateProtectedSettings/,
        `${messageType} is protected by the settings lock`);
}

assert.match(whitelist, /async function whtAddDomainRule[\s\S]*auditRequireSettingsUnlocked/,
    'context-menu URL-list changes use the central guard');
assert.doesNotMatch(options, /browser\.storage\.local\.set\(/,
    'the options page cannot bypass the guarded background settings API');
assert.match(setup, /type:\s*'settings\.update'/,
    'the setup wizard cannot bypass an existing settings lock');
assert.doesNotMatch(silentCollections, /browser\.storage\.local\.set\(/,
    'silent collection settings cannot bypass the guarded background API');
assert.match(silentCollections, /type:\s*'audit\.getState'/,
    'the silent collection manager presents a locked state');
assert.doesNotMatch(auditPage, /value="accountability"|Apply mode|Create accountability password/,
    'the history page no longer owns the protection model');
assert.match(optionsPage, /id="confirm_settings_password"/,
    'password protection requires a confirmation field');
assert.match(optionsPage, /id="settings_content" hidden/,
    'settings start hidden until the protection state is known');
assert.match(options, /password !== confirmation/,
    'the options flow rejects mismatched passwords');
assert.match(options, /confirm_settings_password'\)\.addEventListener\('input', optUpdatePasswordMatchState\)/,
    'password confirmation is validated while the user types');
assert.match(optionsPage, /id="enable_settings_lock" disabled/,
    'protection cannot be submitted until password validation succeeds');
assert.doesNotMatch(optionsPage, /I understand that private browsing is not currently included/,
    'the obsolete incomplete-private-browsing acknowledgement is gone');
assert.doesNotMatch(audit, /allowIncompletePrivateCoverage/,
    'audit activation always requires complete private-window coverage');
assert.doesNotMatch(audit + options + optionsPage, /AUDIT_UNLOCK_MS|five minutes/i,
    'settings unlock no longer expires on a timer');
assert.match(options, /async function optInitializeSecurityState\(\)[\s\S]*type:\s*'audit\.lockSettings'/,
    'every settings-page load starts from a locked state');
assert.match(options, /addEventListener\('pagehide'[\s\S]*type:\s*'audit\.lockSettings'/,
    'leaving the settings page makes a best-effort lock request');
assert.match(background, /settingsLocked:[\s\S]*settingsLockEnabled[\s\S]*auditSettingsAreUnlocked/,
    'processors receive the effective settings-lock state');
assert.match(processor, /async function procCommonWarnImg[\s\S]*if \(PROC_settingsLocked\)[\s\S]*return;/,
    'blocked-image console previews are suppressed while settings are locked');
assert.match(auditPage, /Run in Private Windows/,
    'the audit viewer preserves private-window coverage instructions');
assert.match(optionsPage, /Run in Private Windows/,
    'audit settings explain how to enable private-window coverage');
assert.doesNotMatch(auditPage, /Manage audit and settings protection/,
    'the audit viewer does not link back to the options page');

console.log('settings protection contract tests passed');
