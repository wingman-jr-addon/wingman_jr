let dnsLookupCache = { '': true } //Add blank entry for things without a true hostname.
let isDnsFailureTripped = false;
let dnsCacheHitCount = 0;
let dnsCacheMissCount = 0;
let dnsErrorCount = 0;
let shouldShowDnsDebugMessages = true;

async function isDomainOk(urlString) {
    let url = new URL(urlString);
    let cacheResult = dnsLookupCache[url.hostname];
    if (cacheResult !== undefined) {
        dnsCacheHitCount++;
        if(shouldShowDnsDebugMessages) {
            console.log('DNS cache hit (result: '+cacheResult+') for: '+url.hostname);
        }
        return cacheResult;
    }
    dnsCacheMissCount++;

    let reqHeaders = new Headers();
    reqHeaders.append('Accept', 'application/dns-json');

    const reqInit = {
        method: 'GET',
        headers: reqHeaders,
        cache: 'default'
    };

    let req = new Request(`https://family.cloudflare-dns.com/dns-query?name=${url.hostname}&type=AAAA`);
    let response = await fetch(req, reqInit);
    if(!response.ok) {
        if(!isDnsFailureTripped) {
            isDnsFailureTripped = true;
            console.warn('DNS resolution lookup failures are occurring.');
        }
        if(shouldShowDnsDebugMessages) {
            console.log('DNS resolution failure for '+url.hostname);
        }
        dnsErrorCount++;
        return true; //Can't do anything about it, but not going to block everything!
    }
    let json = await response.json();
    let didResolve = json["Answer"] !== undefined;
    dnsLookupCache[url.hostname] = didResolve;
    if(shouldShowDnsDebugMessages) {
        console.log('DNS cache miss (result: '+didResolve+') for: '+url.hostname);
    }
    return didResolve;
}