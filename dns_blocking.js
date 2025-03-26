let dnsLookupCache = { '': true } //Add blank entry for things without a true hostname.
let dnsInFlightRequests = { }
let dnsInFlightRequestsCounter = { }
let dnsIsDnsFailureTripped = false;
let dnsCacheHitCount = 0;
let dnsCacheMissCount = 0;
let dnsErrorCount = 0;
let dnsShouldShowDebugMessages = false;

async function dnsIsDomainOk(urlString) {
    let url = new URL(urlString);
    let cacheResult = dnsLookupCache[url.hostname];
    if (cacheResult !== undefined) {
        dnsCacheHitCount++;
        if(dnsShouldShowDebugMessages) {
            WJR_DEBUG && console.log('DNS cache hit (result: '+cacheResult+') for: '+url.hostname);
        }
        return cacheResult;
    }
    dnsCacheMissCount++;

    //I used to simply make the request. But we end up spamming the DNS requests multiple times when
    //the cache is not yet populated but one or more requests to fill the cache are in flight.
    //The approach here is to make sure we get the same promise and await it.
    let p = null;
    let wasTrueMiss = false;
    if (url.hostname in dnsInFlightRequests) {
        p = dnsInFlightRequests[url.hostname];
        dnsInFlightRequestsCounter[url.hostname]++;
        if(dnsShouldShowDebugMessages) {
            WJR_DEBUG && console.log('DNS in flight: multiple lookups ('+dnsInFlightRequestsCounter[url.hostname]+') occurring on '+url.hostname);
        }
    } else {
        p = dnsMakeRequest(url);
        dnsInFlightRequests[url.hostname] = p;
        dnsInFlightRequestsCounter[url.hostname] = 1;
        wasTrueMiss = true;
    }
    let result = await p;
    dnsInFlightRequestsCounter[url.hostname]--;
    if(dnsShouldShowDebugMessages) {
        WJR_DEBUG && console.log('DNS in flight: '+dnsInFlightRequestsCounter[url.hostname]+' remaining requests for '+url.hostname);
    }
    if (dnsInFlightRequestsCounter[url.hostname]<=0) {
        if(dnsShouldShowDebugMessages) {
            WJR_DEBUG && console.log('DNS in flight: cleaning up for '+url.hostname);
        }
        delete dnsInFlightRequests[url.hostname];
        delete dnsInFlightRequestsCounter[url.hostname];
    }
    WJR_DEBUG && console.log('DNS cache '+(wasTrueMiss ? 'miss' : 'hold')+' (result: '+result+') for hostname: '+url.hostname);
    return result;
}

async function dnsMakeRequest(url) {
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
        if(!dnsIsDnsFailureTripped) {
            dnsIsDnsFailureTripped = true;
            console.warn('DNS resolution lookup failures are occurring.');
        }
        if(dnsShouldShowDebugMessages) {
            WJR_DEBUG && console.log('DNS resolution failure for '+url.hostname);
        }
        dnsErrorCount++;
        return true; //Can't do anything about it, but not going to block everything!
    }
    let json = await response.json();
    //Known values as first string in Comment for blocking
    //"EDE(16): Censored"
    //"EDE(17): Filtered"
    let shouldNotBlock = (json["Comment"] === undefined) || (json["Comment"].some((c)=>(c+'').indexOf('EDE(')));
    if(!shouldNotBlock) {
        console.log('DNS: Adding new block for '+url.hostname+' '+JSON.stringify(json["Comment"]));
    } else {
        console.log('DNS: should not block for '+url.hostname+' Comment: '+JSON.stringify(json["Comment"]));
    }
    dnsLookupCache[url.hostname] = shouldNotBlock;
    return shouldNotBlock;
}