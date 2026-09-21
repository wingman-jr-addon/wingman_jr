const WHT_URL_RULES_STORAGE_KEY = 'url_filter_rules';
const WHT_SITE_FILTERING_STORAGE_KEY = 'site_filtering_disabled_hosts';
const WHT_REQUEST_POLICY = Object.freeze({
    SITE_DISABLED: 'site-disabled',
    URL_BLACKLISTED: 'url-blacklisted',
    URL_WHITELISTED: 'url-whitelisted',
    FILTER: 'filter'
});
const WHT_COMMON_SECOND_LEVEL_SUFFIXES = new Set([
    'ac', 'co', 'com', 'edu', 'gov', 'mil', 'net', 'org'
]);

const whtDefaultUrlRules = {
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

let whtUserRules = whtNormalizeRules(whtDefaultUrlRules);
let whtDisabledSiteHosts = new Set();

function whtHostnameFromUrl(value) {
    if (typeof value !== 'string' || !value) {
        return null;
    }
    try {
        const parsed = new URL(value);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return null;
        }
        const hostname = parsed.hostname.toLowerCase().replace(/^\.+|\.+$/g, '');
        return hostname || null;
    } catch (error) {
        return null;
    }
}

function whtNormalizeSiteHosts(hosts) {
    if (!Array.isArray(hosts)) {
        return [];
    }
    const normalized = new Set();
    for (const value of hosts) {
        if (typeof value !== 'string') {
            continue;
        }
        const hostname = whtHostnameFromUrl('http://' + value.trim());
        if (hostname) {
            normalized.add(hostname);
        }
    }
    return Array.from(normalized).sort();
}

function whtSetDisabledSiteHosts(hosts) {
    whtDisabledSiteHosts = new Set(whtNormalizeSiteHosts(hosts));
}

function whtGetTopLevelPageUrl(details) {
    if (!details || (typeof details !== 'object' && typeof details !== 'function')) {
        return null;
    }

    try {
        if (details.type === 'main_frame') {
            return whtHostnameFromUrl(details.url) ? details.url : null;
        }
    } catch (error) {
        return null;
    }

    let frameAncestors;
    try {
        frameAncestors = details.frameAncestors;
    } catch (error) {
        return null;
    }

    if (frameAncestors !== undefined && frameAncestors !== null) {
        let ancestorCount;
        try {
            if (!Array.isArray(frameAncestors)) {
                return null;
            }
            ancestorCount = frameAncestors.length;
        } catch (error) {
            return null;
        }
        if (ancestorCount > 0) {
            try {
                const topLevelUrl = frameAncestors[ancestorCount - 1].url;
                return whtHostnameFromUrl(topLevelUrl) ? topLevelUrl : null;
            } catch (error) {
                return null;
            }
        }
    }

    for (const propertyName of ['documentUrl', 'originUrl']) {
        try {
            const candidate = details[propertyName];
            if (whtHostnameFromUrl(candidate)) {
                return candidate;
            }
        } catch (error) {
            return null;
        }
    }
    return null;
}

function whtGetTopLevelPageHostname(details) {
    return whtHostnameFromUrl(whtGetTopLevelPageUrl(details));
}

function whtIsSiteFilteringDisabled(details) {
    const hostname = whtGetTopLevelPageHostname(details);
    return !!hostname && whtDisabledSiteHosts.has(hostname);
}

function whtGetSiteFilteringState(pageUrl) {
    const hostname = whtHostnameFromUrl(pageUrl);
    if (!hostname) {
        return { supported: false, hostname: null, enabled: true };
    }
    return {
        supported: true,
        hostname: hostname,
        enabled: !whtDisabledSiteHosts.has(hostname)
    };
}

async function whtSetSiteFilteringEnabled(pageUrl, isEnabled) {
    const hostname = whtHostnameFromUrl(pageUrl);
    if (!hostname) {
        return { supported: false, hostname: null, enabled: true };
    }

    const result = await browser.storage.local.get(WHT_SITE_FILTERING_STORAGE_KEY);
    const hosts = new Set(whtNormalizeSiteHosts(result[WHT_SITE_FILTERING_STORAGE_KEY]));
    if (isEnabled) {
        hosts.delete(hostname);
    } else {
        hosts.add(hostname);
    }
    const savedHosts = Array.from(hosts).sort();
    await browser.storage.local.set({ [WHT_SITE_FILTERING_STORAGE_KEY]: savedHosts });
    whtSetDisabledSiteHosts(savedHosts);
    return { supported: true, hostname: hostname, enabled: !!isEnabled };
}

function whtNormalizeRules(rules) {
    function normalizeList(list) {
        if (!Array.isArray(list)) {
            return [];
        }
        return list
            .filter(value => typeof value === 'string')
            .map(value => value.trim())
            .filter(value => value.length > 0 && !value.startsWith('#'));
    }

    function normalizeSimpleRules(list) {
        return normalizeList(list)
            .map(whtNormalizeSimpleRule)
            .filter(rule => rule !== null);
    }

    function compileRegexes(list) {
        return normalizeList(list)
            .map(value => {
                try {
                    return whtCompileRegex(value);
                } catch (error) {
                    console.warn('URL FILTER: Ignoring invalid regular expression', value);
                    return null;
                }
            })
            .filter(regex => regex !== null);
    }

    rules = rules || {};
    return {
        whitelist: {
            domains: normalizeSimpleRules(rules.whitelist && rules.whitelist.domains),
            regex: compileRegexes(rules.whitelist && rules.whitelist.regex)
        },
        blacklist: {
            domains: normalizeSimpleRules(rules.blacklist && rules.blacklist.domains),
            regex: compileRegexes(rules.blacklist && rules.blacklist.regex)
        }
    };
}

function whtNormalizeSimpleRule(value) {
    let candidate = value.trim().toLowerCase();
    if (candidate.startsWith('*.')) {
        candidate = candidate.slice(2);
    }
    try {
        const parsed = new URL(candidate.includes('://') ? candidate : 'http://' + candidate);
        if (candidate.includes('://') && (parsed.pathname !== '/' || parsed.search || parsed.hash)) {
            return { type: 'prefix', value: candidate };
        }
        const domain = parsed.hostname.replace(/^\*\./, '').replace(/^\.+|\.+$/g, '').toLowerCase();
        return domain ? { type: 'domain', value: domain } : null;
    } catch (error) {
        return null;
    }
}

function whtGetDomainScopes(srcUrl) {
    try {
        const parsed = new URL(srcUrl);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return null;
        }

        const host = parsed.hostname.toLowerCase().replace(/^\.+|\.+$/g, '');
        if (!host || host.includes(':') || /^\d+(\.\d+){3}$/.test(host)) {
            return host ? { host: host, parentDomain: null } : null;
        }

        const labels = host.split('.');
        let parentDomain = null;
        if (labels.length >= 3) {
            const candidateLabels = labels.slice(1);
            const looksLikePublicSuffix = candidateLabels.length === 2
                && candidateLabels[1].length === 2
                && WHT_COMMON_SECOND_LEVEL_SUFFIXES.has(candidateLabels[0]);
            if (!looksLikePublicSuffix) {
                parentDomain = candidateLabels.join('.');
            }
        }
        return { host: host, parentDomain: parentDomain };
    } catch (error) {
        return null;
    }
}

function whtSimpleMatches(url, entries) {
    let hostname;
    try {
        hostname = new URL(url).hostname.replace(/^\.+|\.+$/g, '').toLowerCase();
    } catch (error) {
        return false;
    }

    return entries.some(rule => {
        if (rule.type === 'prefix') {
            return url.toLowerCase().startsWith(rule.value);
        }
        return hostname === rule.value || hostname.endsWith('.' + rule.value);
    });
}

function whtCompileRegex(value) {
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

function whtRegexMatches(url, regexes) {
    return regexes.some(regex => {
        regex.lastIndex = 0;
        return regex.test(url);
    });
}

function whtRuleSetMatches(url, ruleSet) {
    return whtSimpleMatches(url, ruleSet.domains) || whtRegexMatches(url, ruleSet.regex);
}

function whtIsBlacklisted(url) {
    return whtRuleSetMatches(url, whtUserRules.blacklist);
}

function whtIsWhitelisted(url) {
    if (whtRuleSetMatches(url, whtUserRules.blacklist)) {
        return false;
    }
    return whtRuleSetMatches(url, whtUserRules.whitelist);
}

function whtGetRequestPolicy(details) {
    if (whtIsSiteFilteringDisabled(details)) {
        return WHT_REQUEST_POLICY.SITE_DISABLED;
    }

    let requestUrl;
    try {
        requestUrl = details && details.url;
    } catch (error) {
        requestUrl = null;
    }
    if (typeof requestUrl !== 'string') {
        return WHT_REQUEST_POLICY.FILTER;
    }
    if (whtIsBlacklisted(requestUrl)) {
        return WHT_REQUEST_POLICY.URL_BLACKLISTED;
    }
    if (whtIsWhitelisted(requestUrl)) {
        return WHT_REQUEST_POLICY.URL_WHITELISTED;
    }
    return WHT_REQUEST_POLICY.FILTER;
}

function whtSetUserRules(rules) {
    whtUserRules = whtNormalizeRules(rules);
    if (typeof bkClearRevealAllowlist === 'function') {
        bkClearRevealAllowlist();
    }
}

function whtCopyEditableRules(rules) {
    function copyList(list) {
        return Array.isArray(list)
            ? list.filter(value => typeof value === 'string').slice()
            : [];
    }

    rules = rules || {};
    return {
        whitelist: {
            domains: copyList(rules.whitelist && rules.whitelist.domains),
            regex: copyList(rules.whitelist && rules.whitelist.regex)
        },
        blacklist: {
            domains: copyList(rules.blacklist && rules.blacklist.domains),
            regex: copyList(rules.blacklist && rules.blacklist.regex)
        }
    };
}

function whtIsSameDomainRule(value, domain) {
    if (typeof value !== 'string' || value.trim().startsWith('#')) {
        return false;
    }
    const rule = whtNormalizeSimpleRule(value);
    return rule && rule.type === 'domain' && rule.value === domain;
}

async function whtAddDomainRule(listName, domain) {
    if (listName !== 'whitelist' && listName !== 'blacklist') {
        throw new Error('Unknown URL rule list: ' + listName);
    }

    const normalizedRule = whtNormalizeSimpleRule(domain);
    if (!normalizedRule || normalizedRule.type !== 'domain') {
        throw new Error('Invalid domain: ' + domain);
    }

    const result = await browser.storage.local.get(WHT_URL_RULES_STORAGE_KEY);
    const storedRules = Object.prototype.hasOwnProperty.call(result, WHT_URL_RULES_STORAGE_KEY)
        && result[WHT_URL_RULES_STORAGE_KEY]
        ? result[WHT_URL_RULES_STORAGE_KEY]
        : whtDefaultUrlRules;
    const rules = whtCopyEditableRules(storedRules);
    const selectedDomains = rules[listName].domains;
    const otherListName = listName === 'whitelist' ? 'blacklist' : 'whitelist';

    if (!selectedDomains.some(value => whtIsSameDomainRule(value, normalizedRule.value))) {
        selectedDomains.push(normalizedRule.value);
    }
    rules[otherListName].domains = rules[otherListName].domains
        .filter(value => !whtIsSameDomainRule(value, normalizedRule.value));

    await browser.storage.local.set({ [WHT_URL_RULES_STORAGE_KEY]: rules });
    whtSetUserRules(rules);
    return rules;
}

browser.storage.local.get(WHT_URL_RULES_STORAGE_KEY)
    .then(result => {
        const savedRules = Object.prototype.hasOwnProperty.call(result, WHT_URL_RULES_STORAGE_KEY)
            && result[WHT_URL_RULES_STORAGE_KEY]
            ? result[WHT_URL_RULES_STORAGE_KEY]
            : whtDefaultUrlRules;
        whtSetUserRules(savedRules);
    })
    .catch(error => console.error('URL FILTER: Unable to load URL rules', error));

browser.storage.local.get(WHT_SITE_FILTERING_STORAGE_KEY)
    .then(result => whtSetDisabledSiteHosts(result[WHT_SITE_FILTERING_STORAGE_KEY]))
    .catch(error => console.error('SITE FILTER: Unable to load disabled sites', error));

browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes[WHT_URL_RULES_STORAGE_KEY]) {
        whtSetUserRules(changes[WHT_URL_RULES_STORAGE_KEY].newValue || whtDefaultUrlRules);
    }
    if (areaName === 'local' && changes[WHT_SITE_FILTERING_STORAGE_KEY]) {
        whtSetDisabledSiteHosts(changes[WHT_SITE_FILTERING_STORAGE_KEY].newValue);
    }
});
