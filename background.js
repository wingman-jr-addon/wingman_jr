let WJR_DEBUG = false;

//Ensure browser cache isn't going to cause us problems
browser.webRequest.handlerBehaviorChanged();
//User feedback
browser.runtime.onInstalled.addListener(async ({ reason, temporary, }) => {
    if (temporary) return; // skip during development
    switch (reason) {
        case "update": {
            const url = browser.runtime.getURL("https://docs.google.com/forms/d/e/1FAIpQLSfkmwmDvV0vK5x8s1rmgCNWRoj5d7FOxu4-4scyrzMy2nuJbQ/viewform?usp=sf_link");
            await browser.tabs.create({ url, });
        } break;
    }
});

browser.runtime.setUninstallURL("https://docs.google.com/forms/d/e/1FAIpQLSfYLfDewK-ovU-fQXOARqvNRaaH18UGxI2S6tAQUKv5RNSGaQ/viewform?usp=sf_link");

statusInitialize();

let BK_connectedClients = {};
let BK_openFilters = {};
let BK_openB64Filters = {};
let BK_openVidFilters = {};

let BK_isInitialized = false;
function bkInitialize() {
    statusOnLoaded();
    bkUpdateFromSettings();
    bkSetEnabled(true); //always start on
}

function bkOnClientConnected(port) {
    WJR_DEBUG && console.log(`LIFECYCLE: Processor ${port.name} connected.`);
    let registration = { port: port, tabId: null, processorId: port.name, backend: 'unknown' };
    BK_connectedClients[registration.processorId] = registration;
    WJR_DEBUG && console.log(`LIFECYCLE: There are now ${Object.keys(BK_connectedClients).length} processors`);
    port.onMessage.addListener(bkOnProcessorMessage);
    bkNotifyThreshold();
    bkBroadcastProcessorSettings();
    if (!BK_isInitialized) {
        BK_isInitialized = true;
        bkInitialize();
    }
}

let BK_currentProcessorIndex = 0;
function bkGetNextProcessor() {
    if (Object.keys(BK_connectedClients).length == 0) {
        return null;
    }
    //TODO Right now we only use primary.
    for(let key of Object.keys(BK_connectedClients)) {
        if(BK_connectedClients[key].backend == BK_processorBackendPreference[0]) {
            WJR_DEBUG && console.debug(`BACKEND: Selecting client ${key}`);
            return BK_connectedClients[key];
        }
    }
    return null;
}

function bkBroadcastMessageToProcessors(m) {
    Object.keys(BK_connectedClients).forEach(c => {
        BK_connectedClients[c].port.postMessage(m);
    });
}

let BK_isSilentModeEnabled = false;

function bkBroadcastProcessorSettings() {
    bkBroadcastMessageToProcessors({
        type: 'settings',
        isSilentModeEnabled: BK_isSilentModeEnabled
    });
}

browser.runtime.onConnect.addListener(bkOnClientConnected);


let BK_processorBackendPreference = [];

function bkReloadProcessors() {
    WJR_DEBUG && console.log('LIFECYCLE: Cleaning up old processors.');
    let keys = Object.keys(BK_connectedClients);
    for (let key of keys) {
        let client = BK_connectedClients[key];
        browser.tabs.remove(client.tabId);
        delete BK_connectedClients[key];
    }


    WJR_DEBUG && console.log('LIFECYCLE: Spawning new processors.');
    for(let i=0; i<BK_processorBackendPreference.length; i++) {
        let backend = BK_processorBackendPreference[i];
        WJR_DEBUG && console.log(`LIFECYCLE: Spawning processor with backend ${backend}`);
        browser.tabs.create({url:`/processor.html?backend=${backend}&id=${backend}-1`, active: false})
            .then(async tab=>await browser.tabs.hide(tab.id));
    }
    WJR_DEBUG && console.log('LIFECYCLE: New processors are launching!');
}


function bkOnProcessorMessage(m) {
    switch (m.type) {
        case 'scan': {
            WJR_DEBUG && console.debug('PROC: '+m);
            if(m.requestId.startsWith('crash')) {
                bkHandleCrashDetectionResult(m);
            } else {
                let filter = BK_openFilters[m.requestId];
                filter.write(m.imageBytes);
                filter.close();
                delete BK_openFilters[m.requestId];
                WJR_DEBUG && console.debug('OPEN FILTERS: '+Object.keys(BK_openFilters).length);
            }
        }
            break;
        case 'gif_scan': {
            gifOnGifFrame(m);
        }
            break;
        case 'b64_data': {
            let b64Filter = BK_openB64Filters[m.requestId];
            let b64Text = b64Filter.encoder.encode(m.dataStr);
            b64Filter.filter.write(b64Text);
        }
            break;
        case 'b64_close': {
            let b64Filter = BK_openB64Filters[m.requestId];
            b64Filter.filter.close();
            delete BK_openB64Filters[m.requestId];
        }
            break;
        case 'vid_scan': {
            vidOnVidScan(m);
        }
            break;
        case 'stat': {
            WJR_DEBUG && console.debug('STAT: '+m.requestId+' '+m.result);
            statusCompleteImageCheck(m.requestId, m.result);
            switch (m.result) {
                case 'pass': {
                    bkIncrementPassCount();
                }
                    break;
                case 'block': {
                    bkIncrementBlockCount();
                }
                //could also be tiny or error
            }
        }
            break;
        case 'registration': {
            WJR_DEBUG && console.dir(BK_connectedClients);
            WJR_DEBUG && console.log(`LIFECYCLE: Registration of processor ${m.processorId} with tab ID ${m.tabId}`);
            BK_connectedClients[m.processorId].backend = m.backend;
            BK_connectedClients[m.processorId].tabId = m.tabId;
        }
            break;
    }
}

/////////// ZONE START /////////////////////////
var BK_isZoneAutomatic = true;
var BK_predictionBufferBlockCount = 0;
var BK_predictionBuffer = [];
var BK_estimatedTruePositivePercentage = 0;
var BK_isEstimateValid = false;

function bkAddToPredictionBuffer(prediction) {
    BK_predictionBuffer.push(prediction);
    if (prediction > 0) {
        BK_predictionBufferBlockCount++;
    }
    if (BK_predictionBuffer.length > 200) {
        let oldPrediction = BK_predictionBuffer.shift();
        if (oldPrediction > 0) {
            BK_predictionBufferBlockCount--;
        }
    }
    if (BK_predictionBuffer.length > 50) {
        let estimatedTruePositiveCount = BK_zonePrecision * BK_predictionBufferBlockCount;
        BK_estimatedTruePositivePercentage = estimatedTruePositiveCount / BK_predictionBuffer.length;
        BK_isEstimateValid = true;
    } else {
        BK_estimatedTruePositivePercentage = 0;
        BK_isEstimateValid = false;
    }
}

function bkClearPredictionBuffer() {
    BK_predictionBufferBlockCount = 0;
    BK_predictionBuffer = [];
    BK_estimatedTruePositivePercentage = 0;
}

function bkIncrementBlockCount() {
    bkAddToPredictionBuffer(1);
    bkCheckZone();
}

function bkIncrementPassCount() {
    bkAddToPredictionBuffer(0);
    bkCheckZone();
}

function bkSetZoneAutomatic(isAutomatic) {
    BK_isZoneAutomatic = isAutomatic;
}

function bkSetDefaultZone(result) {
    console.log('result');
    console.log(result);
    if (!result.default_zone || result.default_zone === 'automatic') {
        bkSetZoneAutomatic(true);
        BK_zone = 'neutral'
    } else {
        bkSetZoneAutomatic(false);
        BK_zone = result.default_zone;
    }
}

function bkCheckZone() {
    if (!BK_isEstimateValid) {
        return;
    }
    if (!BK_isZoneAutomatic) {
        return;
    }
    let requestedZone = 'untrusted';
    if (BK_estimatedTruePositivePercentage < ROC_trustedToNeutralPercentage) {
        requestedZone = 'trusted';
    } else if (BK_estimatedTruePositivePercentage < ROC_neutralToUntrustedPercentage) {
        requestedZone = 'neutral';
    }
    if (requestedZone != BK_zone) {
        bkSetZone(requestedZone);
    }
}



var BK_zoneThreshold = ROC_neutralRoc.threshold;
var BK_zonePrecision = rocCalculatePrecision(ROC_neutralRoc);
WJR_DEBUG && console.log("Zone precision is: "+BK_zonePrecision);
var BK_zone = 'neutral';
function bkSetZone(newZone)
{
    WJR_DEBUG && console.log('Zone request to: '+newZone);
    let didZoneChange = false;
    switch (newZone) {
        case 'trusted':
            BK_zoneThreshold = ROC_trustedRoc.threshold;
            BK_zonePrecision = rocCalculatePrecision(ROC_trustedRoc);
            statusSetImageZoneTrusted();
            BK_zone = newZone;
            didZoneChange = true;
            WJR_DEBUG && console.log('Zone is now trusted!');
            break;
        case 'neutral':
            BK_zoneThreshold = ROC_neutralRoc.threshold;
            BK_zonePrecision = rocCalculatePrecision(ROC_neutralRoc);
            statusSetImageZoneNeutral();
            BK_zone = newZone;
            didZoneChange = true;
            WJR_DEBUG && console.log('Zone is now neutral!');
            break;
        case 'untrusted':
            BK_zoneThreshold = ROC_untrustedRoc.threshold;
            BK_zonePrecision = rocCalculatePrecision(ROC_untrustedRoc);
            statusSetImageZoneUntrusted();
            BK_zone = newZone;
            didZoneChange = true;
            WJR_DEBUG && console.log('Zone is now untrusted!')
            break;
    }
    if(didZoneChange) {
        WJR_DEBUG && console.log("Zone precision is: "+BK_zonePrecision);
        bkClearPredictionBuffer();
        bkNotifyThreshold();
    }
}

function bkNotifyThreshold() {
    bkBroadcastMessageToProcessors({
        type: 'thresholdChange',
        threshold: BK_zoneThreshold
    });
}

////////////////////// ZONE END //////////////////////////

//////////////////// WATCHDOG START //////////////////////

/* Cleanup counts across all types */
let BK_watchdogCleanupCount = 0;
let BK_watchdogKickCount = 0;

async function bkWatchdogGeneric(watchdogName, whichFilters, cleanupAction) {
    let keysSnapshot = Object.keys(whichFilters);
    let nowish = performance.now();
    let cleaned = [];
    let watchList = [];
    WJR_DEBUG && console.info(`WATCHDOG: Stuck ${watchdogName} check - Current open filters count: ${keysSnapshot.length} Watchdog kick: ${BK_watchdogKickCount} Total cleaned up: ${BK_watchdogCleanupCount}`);
    for(let key of keysSnapshot) {
        let ageMs = whichFilters[key] ? nowish - whichFilters[key].stopTime : 0;
        if (ageMs >= 45000) {
            BK_watchdogCleanupCount++;
            delete whichFilters[key];
            cleanupAction(key, 'error');
            cleaned.push(key);
            BK_watchdogCleanupCount++;
        } else if (ageMs >= 30000) {
            watchList.push(key);
        }
    }
    if (cleaned.length > 0) {
        console.error(`WATCHDOG: Stuck ${watchdogName} check watchdog cleaned up ${cleaned.join(',')} for a total kick count ${BK_watchdogKickCount}`);
    }
    if (watchList.length > 0) {
        console.warn(`WATCHDOG: Stuck ${watchdogName} check old age watchlist ${watchList.join(',')}`);
    }
}

async function bkWatchdog() {
    await bkWatchdogGeneric('image', BK_openFilters, statusCompleteImageCheck);
    await bkWatchdogGeneric('base64 image', BK_openB64Filters, statusCompleteImageCheck);
    await bkWatchdogGeneric('video', BK_openVidFilters, statusCompleteVideoCheck);
}

setInterval(bkWatchdog, 2500);

let CRASH_DETECTION_IMAGE = null;
fetch('silent_data/zoe-reeve-ijRuGjKpBcg-unsplash.jpg')
    .then(async r => {
        CRASH_DETECTION_IMAGE = await r.arrayBuffer();
        setInterval(bkCrashDetectionWatchdog, 7500);
    });
let CRASH_DETECTION_EXPECTED_RESULT;
let CRASH_DETECTION_WARMUPS_LEFT = 3;
let CRASH_DETECTION_COUNT = 0;
let CRASH_NO_PROCESSOR_COUNT = 0;
let CRASH_BAD_STATE_ENCOUNTERED_COUNT = 0;
const CRASH_NO_PROCESSOR_RESTART_THRESHOLD = 3;
const CRASH_BAD_STATE_RESTART_THRESHOLD = 2;
const CRASH_IDLE_SECONDS = 3 * 60;

async function bkCrashDetectionWatchdog() {
    let idleState = await browser.idle.queryState(CRASH_IDLE_SECONDS)
    if(idleState != 'active') {
        console.log('CRASH: User not active, ceasing crash check.');
        return;
    }
    let pseudoRequestId = `crash-detection-${CRASH_DETECTION_COUNT}`;
    CRASH_DETECTION_COUNT++;
    let processorReq = bkGetNextProcessor();
    if (!processorReq) {
        CRASH_NO_PROCESSOR_COUNT++;
        if(CRASH_NO_PROCESSOR_COUNT >= CRASH_NO_PROCESSOR_RESTART_THRESHOLD) {
            console.error(`CRASH: No processors found after extended time - reloading.`);
            browser.runtime.reload();
        }
        console.warn(`CRASH: Processors not yet ready.`);
        return;
    }
    try {
        let processor = processorReq.port;
        processor.postMessage({
            type: 'start',
            requestId: pseudoRequestId,
            mimeType: 'image/jpeg',
            url: pseudoRequestId
        });
        processor.postMessage({
            type: 'ondata',
            requestId: pseudoRequestId,
            data: CRASH_DETECTION_IMAGE
        });
        processor.postMessage({
            type: 'onstop',
            requestId: pseudoRequestId
        });
    } catch(e) {
        CRASH_NO_PROCESSOR_COUNT++;
        if(CRASH_NO_PROCESSOR_COUNT >= CRASH_NO_PROCESSOR_RESTART_THRESHOLD) {
            console.error(`CRASH: Failure to post to processor after extended time - reloading.`);
            browser.runtime.reload();
        }
        console.error(`CRASH: Failure to post to processor.`);
    }
}

function bkApproxEq(expected, actual) {
    return Math.abs(actual - expected) < 0.02;
}

function bkCompareSqrxScores(x, a) {
    return bkApproxEq(x[0][0],a[0][0])
        && bkApproxEq(x[1][0],a[1][0])
        && bkApproxEq(x[1][1],a[1][1])
        && bkApproxEq(x[1][2],a[1][2])
        && bkApproxEq(x[1][3],a[1][3]);
}

function bkHandleCrashDetectionResult(m) {
    if (!CRASH_DETECTION_EXPECTED_RESULT) {
        if(CRASH_DETECTION_WARMUPS_LEFT > 0) {
            CRASH_DETECTION_WARMUPS_LEFT -= 1;
            console.log(`CRASH: Warmups left before setting crash result ${CRASH_DETECTION_WARMUPS_LEFT}`);
        } else {
            CRASH_DETECTION_EXPECTED_RESULT = { ... m.sqrxrScore};
            console.log(`CRASH: Setting expected result to ${JSON.stringify(CRASH_DETECTION_EXPECTED_RESULT)}`);
        }
    } else {
        let actual = m.sqrxrScore;
        if (!bkCompareSqrxScores(CRASH_DETECTION_EXPECTED_RESULT,actual)) {
            console.error(`CRASH: Check actual ${JSON.stringify(actual)} vs. Expected ${JSON.stringify(CRASH_DETECTION_EXPECTED_RESULT)}`);
            CRASH_BAD_STATE_ENCOUNTERED_COUNT++;
            if (CRASH_BAD_STATE_ENCOUNTERED_COUNT >= CRASH_BAD_STATE_RESTART_THRESHOLD) {
                console.error(`CRASH: Bad state threshold exceeded, reloading plugin!!!`);
                browser.runtime.reload();
            }
        } else {
            console.log(`CRASH: Detection passed`);
        }
    }
}

///////////////// WATCHDOG END ////////////////////////////

async function bkImageListener(details, shouldBlockSilently = false) {
    if (details.statusCode < 200 || 300 <= details.statusCode) {
        return;
    }
    if (whtIsWhitelisted(details.url)) {
        WJR_DEBUG && console.log('WEBREQ: Normal whitelist '+details.url);
        return;
    }
    let mimeType = '';
    for (let i = 0; i < details.responseHeaders.length; i++) {
        let header = details.responseHeaders[i];
        if (header.name.toLowerCase() == "content-type") {
            mimeType = header.value;
            if (!shouldBlockSilently) {
                header.value = 'image/svg+xml';
            }
            break;
        }
    }

    let isGif = mimeType.startsWith('image/gif');
    if(isGif) {
        return await gifListener(details);
    }
    
    return await bkImageListenerNormal(details, mimeType);
}

async function bkImageListenerNormal(details, mimeType) {
    WJR_DEBUG && console.debug('WEBREQ: start headers '+details.requestId);
    let dataStartTime = null;
    let filter = browser.webRequest.filterResponseData(details.requestId);

    let processor = bkGetNextProcessor().port;
    processor.postMessage({
        type: 'start',
        requestId: details.requestId,
        mimeType: mimeType,
        url: details.url
    });
    statusStartImageCheck(details.requestId);

    filter.ondata = event => {
        if (dataStartTime == null) {
            dataStartTime = performance.now();
        }
        WJR_DEBUG && console.debug('WEBREQ: data '+details.requestId);
        processor.postMessage({ 
            type: 'ondata',
            requestId: details.requestId,
            data: event.data
        });
    }

    filter.onerror = e => {
        try
        {
            WJR_DEBUG && console.debug('WEBREQ: error '+details.requestId);
            processor.postMessage({
                type: 'onerror',
                requestId: details.requestId
            });
            filter.close();
        }
        catch (ex) {
            console.error('WEBREQ: Filter error: ' + e + ', ' + ex);
        }
    }

    filter.onstop = async event => {
        WJR_DEBUG && console.debug('WEBREQ: onstop '+details.requestId);
        filter.stopTime = performance.now();
        BK_openFilters[details.requestId] = filter;
        processor.postMessage({
            type: 'onstop',
            requestId: details.requestId
        });
    }
    return details;
}

async function bkDirectTypedUrlListener(details) {
    if (details.statusCode < 200 || 300 <= details.statusCode) {
        return;
    }
    if (whtIsWhitelisted(details.url)) {
        WJR_DEBUG && console.log('WEBREQ: Direct typed whitelist '+details.url);
        return;
    }
    //Try to see if there is an image MIME type
    for (let i = 0; i < details.responseHeaders.length; i++) {
        let header = details.responseHeaders[i];
        if (header.name.toLowerCase() == "content-type") {
            let mimeType = header.value;
            if(mimeType.startsWith('image/')) {
                WJR_DEBUG && console.log('WEBREQ: Direct URL: Forwarding based on mime type: '+mimeType+' for '+details.url);
                return bkImageListener(details,true);
            }
        }
    }
    //Otherwise do nothing...
    return details;
}

///////////////////////////////////////////////// DNS Lookup Tie-in /////////////////////////////////////////////////////////////

BK_shouldUseDnsBlocking = false;

async function bkDnsBlockListener(details) {
    let dnsResult = await dnsIsDomainOk(details.url);
    if(!dnsResult) {
        WJR_DEBUG && console.log('DNS: DNS Blocked '+details.url);
        return { cancel: true };
    }
    return details;
}

function bkSetDnsBlocking(onOrOff) {
    let effectiveOnOrOff = onOrOff && BK_isEnabled;
    WJR_DEBUG && console.log('CONFIG: DNS blocking set request: '+onOrOff+', effective value '+effectiveOnOrOff);
    let isCurrentlyOn = browser.webRequest.onBeforeRequest.hasListener(bkDnsBlockListener);
    if (effectiveOnOrOff != isCurrentlyOn) {
        BK_shouldUseDnsBlocking = onOrOff; //Store the requested, not effective value
        if(effectiveOnOrOff && !isCurrentlyOn) {
            WJR_DEBUG && console.log('CONFIG: DNS Adding DNS block listener')
            browser.webRequest.onBeforeRequest.addListener(
                bkDnsBlockListener,
                { urls: ["<all_urls>"], types: ["image", "imageset", "media"] },
                ["blocking"]
            );
        } else if (!effectiveOnOrOff && isCurrentlyOn) {
            WJR_DEBUG && console.log('CONFIG: DNS Removing DNS block listener')
            browser.webRequest.onBeforeRequest.removeListener(bkDnsBlockListener);
        }
        WJR_DEBUG && console.log('CONFIG: DNS blocking is now: '+onOrOff);
    } else {
        WJR_DEBUG && console.log('CONFIG: DNS blocking is already correctly set.');
    }
}

//Use this if you change BK_isEnabled
function bkRefreshDnsBlocking() {
    bkSetDnsBlocking(BK_shouldUseDnsBlocking);
}

////////////////////////////////base64 IMAGE SEARCH SPECIFIC STUFF BELOW, BOO HISS!!!! ///////////////////////////////////////////


// Listen for any Base 64 encoded images, particularly the first page of
// "above the fold" image search requests in Google Images
async function bkBase64ContentListener(details) {
    if (details.statusCode < 200 || 300 <= details.statusCode) {
        return;
    }
    if (whtIsWhitelisted(details.url)) {
        WJR_DEBUG && console.log('WEBREQ: Base64 whitelist '+details.url);
        return;
    }
    WJR_DEBUG && console.debug('WEBREQ: base64 headers '+details.requestId+' '+details.url);
    // The received data is a stream of bytes. In order to do text-based
    // modifications, it is necessary to decode the bytes into a string
    // using the proper character encoding, do any modifications, then
    // encode back into a stream of bytes.
    // Historically, detecting character encoding has been a tricky task
    // taken on by the browser. Here, a simplified approach is taken
    // and the complexity is hidden in a helper method.
    let decoderEncoder = bkDetectCharsetAndSetupDecoderEncoder(details);
    if (!decoderEncoder) {
        return;
    }
    let [decoder, encoder] = decoderEncoder;
    if (!decoder) {
        return;
    }
    let filter = browser.webRequest.filterResponseData(details.requestId);
    let b64Filter = {
        requestId: details.requestId,
        encoder: encoder,
        filter: filter
    };
    BK_openB64Filters[details.requestId] = b64Filter;

    //Choose highest power here because we have many images possibly
    let processor = bkGetNextProcessor().port;
    processor.postMessage({
        type: 'b64_start',
        requestId: details.requestId
    });

    filter.ondata = evt => {
        let str = decoder.decode(evt.data, { stream: true });
        processor.postMessage({
            type: 'b64_ondata',
            requestId: details.requestId,
            dataStr: str
        });
    };

    filter.onstop = async evt => {
        let str = decoder.decode(evt.data, { stream: true });
        processor.postMessage({
            type: 'b64_ondata',
            requestId: details.requestId,
            dataStr: str
        });
        processor.postMessage({
            type: 'b64_onstop',
            requestId: details.requestId
        });
    }

    filter.onerror = e => {
        try {
            processor.postMessage({
                type: 'b64_onerror',
                requestId: details.requestId
            })
        }
        catch (e) {
            console.error('WEBREQ: Filter error: ' + e);
        }
    }

    return details;
}


// This helper method does a few things regarding character encoding:
// 1) Detects the charset for the TextDecoder so that bytes are properly turned into strings
// 2) Ensures the output Content-Type is UTF-8 because that is what TextEncoder supports
// 3) Returns the decoder/encoder pair
function bkDetectCharsetAndSetupDecoderEncoder(details) {
    let contentType = '';
    let headerIndex = -1;
    for (let i = 0; i < details.responseHeaders.length; i++) {
        let header = details.responseHeaders[i];
        if (header.name.toLowerCase() == "content-type") {
            contentType = header.value.toLowerCase();
            headerIndex = i;
            break;
        }
    }
    for (let i = 0; i < details.responseHeaders.length; i++) {
        let header = details.responseHeaders[i];
        WJR_DEBUG && console.debug('CHARSET:  '+header.name+': '+header.value);
    }
    if (headerIndex == -1) {
      WJR_DEBUG && console.debug('CHARSET: No Content-Type header detected for '+details.url+', adding one by guessing.');
      contentType = bkGuessContentType(details);
      headerIndex = details.responseHeaders.length;
      details.responseHeaders.push(
        {
          "name": "Content-Type",
          "value": contentType
        }
      );
    }

    let baseType;
    let trimmedContentType = contentType.trim();
    if(trimmedContentType.startsWith('text/html')) {
      baseType = 'text/html';
      WJR_DEBUG && console.debug('CHARSET: Detected base type was '+baseType);
    } else if(trimmedContentType.startsWith('application/xhtml+xml')) {
      baseType = 'application/xhtml+xml';
      WJR_DEBUG && console.debug('CHARSET: Detected base type was '+baseType);
    } else if(trimmedContentType.startsWith('image/')) {
      WJR_DEBUG && console.debug('CHARSET: Base64 listener is ignoring '+details.requestId+' because it is an image/ MIME type');
      return;
    } else if(trimmedContentType == 'application/pdf') {
      WJR_DEBUG && console.debug('CHARSET: Base64 listener is ignoring '+details.requestId+' because it is a PDF MIME type');
      return;
    } else {
      baseType = 'text/html';
      WJR_DEBUG && console.debug('CHARSET: The Content-Type was '+contentType+', not text/html or application/xhtml+xml.');
      return;
    }

    // Character set detection is quite a difficult problem.
    // In general, this implementation supports iso-8859-1 and utf-8.
    // By default, the implementation starts in iso-8859-1 and then
    // "upgrades" to utf-8 if any of a variety of conditions are encountered:
    //  1) Headers: Content-Type has a charset
    //  2) Content sniffing: starts with BOM
    //  3) Content sniffing: XML encoding indicates utf-8
    //  4) Content sniffing: meta http-equiv Content-Type indicates utf-8
    // Content sniffing uses the first 512 bytes currently.
    // Note that if decoding as utf-8 fails, decoding will fallback to 
    // iso-8859-1.
    // If modifying this block of code, ensure that the tests at
    // https://www.w3.org/2006/11/mwbp-tests/index.xhtml
    // all pass - current implementation passes on all
    let decodingCharset = 'utf-8';
    let detectedCharset = bkDetectCharset(contentType);

    if (detectedCharset !== undefined) {
        decodingCharset = detectedCharset;
        WJR_DEBUG && console.debug('CHARSET: Detected charset was ' + decodingCharset + ' for ' + details.url);
    } else if(trimmedContentType.startsWith('application/xhtml+xml')) {
        decodingCharset = 'utf-8';
        WJR_DEBUG && console.debug('CHARSET: No detected charset, but content type was application/xhtml+xml so using UTF-8');
    } else {
        decodingCharset = undefined;
        WJR_DEBUG && console.debug('CHARSET: No detected charset, moving ahead with UTF-8 until decoding error encountered!');
    }

    let decoder = new TextDecoderWithSniffing(decodingCharset);
    let encoder = new TextEncoderWithSniffing(decoder);

    return [decoder, encoder];
}

function bkConcatBuffersToUint8Array(buffers) {
    let fullLength = buffers.reduce((acc,buf)=>acc+buf.byteLength, 0);
    let result = new Uint8Array(fullLength);
    let offset = 0;
    for(let buffer of buffers) {
        result.set(new Uint8Array(buffer), offset);
        offset += buffer.byteLength;
    }
    return result;
}

function bkDoesSniffStringIndicateUtf8(sniffString) {
    return (
        /<\?xml\sversion="1\.0"\s+encoding="utf-8"\?>/gm.test(sniffString)
    || /<meta[^>]+utf-8/igm.test(sniffString));
}

function TextDecoderWithSniffing(declType)
{
    let self = this;
    self.currentType = declType;
    self.decoder = (self.currentType === undefined) ? new TextDecoder('utf-8', { ignoreBOM: true, fatal: true }) : new TextDecoder(self.currentType);
    self.sniffBufferList = [];
    self.sniffCount = 0;

    self.decode = function(buffer, options) {
        if(self.currentType === undefined) {
            try {
                if(self.sniffCount < 512) {
                    //Start by checking for BOM
                    //Buffer should always be >= 3 but just in case...
                    if(self.sniffCount == 0 && buffer.byteLength >= 3) {
                        let bom = new Uint8Array(buffer, 0, 3);
                        if(bom[0] == 0xEF && bom[1] == 0xBB && bom[2] == 0xBF) {
                            WJR_DEBUG && console.debug('CHARSET: Sniff found utf-8 BOM');
                            self.currentType = 'utf-8';
                        }
                    }
                    //Continue with normal header sniffing
                    if(self.currentType === undefined) {
                        self.sniffBufferList.push(buffer);
                        self.sniffCount += buffer.byteLength;
                        WJR_DEBUG && console.debug('CHARSET: Sniff count '+self.sniffCount);
                        if(self.sniffCount >= 512) {
                            let fullSniffBuffer = bkConcatBuffersToUint8Array(self.sniffBufferList);
                            self.sniffBufferList = null;
                            let tmpDecoder = new TextDecoder('iso-8859-1');
                            let sniffString = tmpDecoder.decode(fullSniffBuffer);
                            WJR_DEBUG && console.debug('CHARSET: Sniff string constructed: '+sniffString);
                            if(bkDoesSniffStringIndicateUtf8(sniffString)) {
                                WJR_DEBUG && console.debug('CHARSET: Sniff found decoding of utf-8 by examining header');
                                self.currentType = 'utf-8';
                            } else {
                                WJR_DEBUG && console.debug('CHARSET: Sniff string did not indicate UTF-8');
                            }
                        }
                    }
                }
                WJR_DEBUG && console.debug('CHARSET: Sniffing decoding of utf-8');
                return self.decoder.decode(buffer, options);
            } catch {
                WJR_DEBUG && console.warn('CHARSET: Falling back from '+self.currentType+' to iso-8859-1');
                self.decoder = new TextDecoder('iso-8859-1');
                self.currentType = 'iso-8859-1';
                return self.decoder.decode(buffer, options);
            }
        } else {
            WJR_DEBUG && console.debug('CHARSET: Effective decoding ' + self.currentType);
            return self.decoder.decode(buffer, options);
        }
    }
}

function TextEncoderWithSniffing(decoder) {
    let self = this;
    self.utf8Encoder = new TextEncoder();
    self.iso_8859_1_Encoder = new TextEncoderISO_8859_1();
    self.linkedDecoder = decoder;

    self.encode = function(str) {
        WJR_DEBUG && console.debug('CHARSET: Encoding with decoder current type '+self.linkedDecoder.currentType);
        if(self.linkedDecoder.currentType === undefined) {
            WJR_DEBUG && console.debug('CHARSET: Effective encoding iso-8859-1');
            return self.iso_8859_1_Encoder.encode(str);
        } else if(self.linkedDecoder.currentType == 'utf-8') {
            WJR_DEBUG && console.debug('CHARSET: Effective encoding utf-8');
            return self.utf8Encoder.encode(str);
        } else {
            WJR_DEBUG && console.debug('CHARSET: Effective encoding iso-8859-1');
            return self.iso_8859_1_Encoder.encode(str);
        }
    }
}

function TextEncoderISO_8859_1()
{
    this.encode = function(str) {
        var result = new Uint8Array(str.length);
        for(let i=0; i<str.length; i++) {
            let charCodeClamped = str.charCodeAt(i);
            if(charCodeClamped > 255) {
                charCodeClamped = 255;
            }
            result[i] = charCodeClamped;
        }
        return result;
    }
}

// Guess the content type when none is supplied
// Ideally this would actually look at the bytes supplied but we
// don't have those available yet, so do some hacky guessing
function bkGuessContentType(details) {
    try {
        for (let i = 0; i < details.responseHeaders.length; i++) {
            let header = details.responseHeaders[i];
            // If no content-type was specified BUT a default filename was
            // provided, fallback to a MIME type derived from the extension - YUCK
            // e.g. content-disposition: inline; filename="user-guide-nokia-5310-user-guide.pdf" -> application/pdf
            // Note: we will not try to handle filename* as per https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Disposition
            // and https://datatracker.ietf.org/doc/html/rfc5987#page-7
            if (header.name.toLowerCase() == "content-disposition") {
                let filenameMatches = [...header.value.matchAll(/filename[ ]*=[ ]*\"([^\"]*)\"/g)];
                if(filenameMatches.length > 0) {
                    let filename = filenameMatches[0][1]; //First capture group of first match
                    let extensionMatch = filename.match(/\.[^\.]+$/);
                    if(extensionMatch != null && extensionMatch.length > 0) {
                        let extension = extensionMatch[0];
                        switch(extension) {
                            case ".pdf":
                                WJR_DEBUG && console.debug('CHARSET: Guessed content type application/pdf using extension ' + extension + ' for ' + details.url);
                                return 'application/pdf';
                            default:
                                WJR_DEBUG && console.debug('CHARSET: Unhandled file extension "' + extension + '" for ' + details.url);
                                break;
                        }
                    }
                }
                break;
            }
        }
    } catch(e) {
        console.error('CHARSET: Exception guessing content type when none supplied for '+details.url+' '+e);
    }
    return 'text/html';
}


// Detect the charset from Content-Type
function bkDetectCharset(contentType) {
    /*
    From https://tools.ietf.org/html/rfc7231#section-3.1.1.5:

    A parameter value that matches the token production can be
    transmitted either as a token or within a quoted-string.  The quoted
    and unquoted values are equivalent.  For example, the following
    examples are all equivalent, but the first is preferred for
    consistency:

    text/html;charset=utf-8
    text/html;charset=UTF-8
    Text/HTML;Charset="utf-8"
    text/html; charset="utf-8"

    Internet media types ought to be registered with IANA according to
    the procedures defined in [BCP13].

    Note: Unlike some similar constructs in other header fields, media
    type parameters do not allow whitespace (even "bad" whitespace)
    around the "=" character.

    ...

    And regarding application/xhtml+xml, from https://tools.ietf.org/html/rfc3236#section-2
    and the referenced links, it can be seen that charset is handled the same way with
    respect to Content-Type.
    */

    let charsetMarker = "charset="; // Spaces *shouldn't* matter
    let foundIndex = contentType.indexOf(charsetMarker);
    if (foundIndex == -1) {
        return undefined;
    }
    let charsetMaybeQuoted = contentType.substr(foundIndex + charsetMarker.length).trim();
    let charset = charsetMaybeQuoted.replace(/\"/g, '');
    return charset;
}


////////////////////////////Context Menu////////////////////////////

browser.menus.create({
    title: "Hide Image",
    documentUrlPatterns: ["*://*/*"],
    contexts: ["image"],
    onclick(info, tab) {
      browser.tabs.executeScript(tab.id, {
        frameId: info.frameId,
        code: `browser.menus.getTargetElement(${info.targetElementId}).style.visibility="hidden";`,
      });
    },
  });


////////////////////////Actual Startup//////////////////////////////



function bkRegisterAllCallbacks() {

    browser.webRequest.onHeadersReceived.addListener(
        bkImageListener,
        { urls: ["<all_urls>"], types: ["image", "imageset"] },
        ["blocking", "responseHeaders"]
    );

    browser.webRequest.onHeadersReceived.addListener(
        bkDirectTypedUrlListener,
        { urls: ["<all_urls>"], types: ["main_frame"] },
        ["blocking", "responseHeaders"]
    );

    browser.webRequest.onHeadersReceived.addListener(
        bkBase64ContentListener,
        {
            urls: [
                "<all_urls>"
            ],
            types: ["main_frame"]
        },
        ["blocking", "responseHeaders"]
    );

    if (BK_isVideoEnabled) {
        browser.webRequest.onBeforeRequest.addListener(
            vidPrerequestListener,
            { urls: ["<all_urls>"], types: ["media", "xmlhttprequest"] },
            ["blocking"]
        );

        browser.webRequest.onHeadersReceived.addListener(
            vidRootListener,
            { urls: ["<all_urls>"], types: ["media", "xmlhttprequest"] },
            ["blocking", "responseHeaders"]
        );
    }
}

function bkUnregisterAllCallbacks() {
    browser.webRequest.onHeadersReceived.removeListener(bkImageListener);
    browser.webRequest.onHeadersReceived.removeListener(bkDirectTypedUrlListener);
    browser.webRequest.onHeadersReceived.removeListener(bkBase64ContentListener);

    //Try to unregister whether or not they were previously registered
    browser.webRequest.onBeforeRequest.removeListener(vidPrerequestListener);
    browser.webRequest.onHeadersReceived.removeListener(vidRootListener);
}

function bkRefreshCallbackRegistration() {
    WJR_DEBUG && console.log('CONFIG: Callback wireup refresh start.');
    bkUnregisterAllCallbacks();
    if (BK_isEnabled) {
        bkRegisterAllCallbacks();
    }
    bkRefreshDnsBlocking();
    WJR_DEBUG && console.log('CONFIG: Callback wireup refresh complete!');
}

let BK_isEnabled = false;
function bkSetEnabled(isOn) {
    WJR_DEBUG && console.log('CONFIG: Setting enabled to '+isOn);
    if(isOn == BK_isEnabled) {
        return;
    }
    WJR_DEBUG && console.log('CONFIG: Handling callback wireup change.');
    if(isOn) {
        bkRegisterAllCallbacks();
    } else {
        bkUnregisterAllCallbacks();
    }
    BK_isEnabled = isOn;
    bkRefreshDnsBlocking();
    WJR_DEBUG && console.log('CONFIG: Callback wireups changed!');
}

let BK_isVideoEnabled = true;
function bkSetVideoEnabled(isOn) {
    WJR_DEBUG && console.log('CONFIG: Setting video enabled to '+isOn);
    if(isOn == BK_isVideoEnabled) {
        return;
    }
    WJR_DEBUG && console.log('CONFIG: Handling video callback wireup change.');
    BK_isVideoEnabled = isOn;
    bkRefreshCallbackRegistration();
    WJR_DEBUG && console.log('CONFIG: Video callback wireups changed!');
}

let BK_isOnOffSwitchShown = false;

function bkUpdateFromSettings() {
    browser.storage.local.get('is_dns_blocking').then(dnsResult =>
        bkSetDnsBlocking(dnsResult.is_dns_blocking == true));
    browser.storage.local.get('is_on_off_shown').then(onOffResult =>
        BK_isOnOffSwitchShown = onOffResult.is_on_off_shown == true);
    browser.storage.local.get('is_video_blocking_disabled').then(videoDisabledResult => {
        bkSetVideoEnabled(!videoDisabledResult.is_video_blocking_disabled);
    });
    browser.storage.local.get('is_silent_mode_enabled').then(silentModeEnabledResult => {
        BK_isSilentModeEnabled = silentModeEnabledResult.is_silent_mode_enabled || false;
        bkBroadcastProcessorSettings();
    });
    bkLoadBackendSettings();
}

function bkLoadBackendSettings() {
    browser.storage.local.get('backend_selection').then(result => {
        let backends = result.backend_selection ? result.backend_selection.split('_') : ['webgl'];
        let hasChanged = backends.length != BK_processorBackendPreference.length;
        for (let i = 0; i < backends.length && !hasChanged; i++) {
            hasChanged = backends[i] != BK_processorBackendPreference[i];
        }
        if(hasChanged) {
            WJR_DEBUG && console.log(`LIFECYCLE: Requested backends changed to ${backends.join(',')}`);
            BK_processorBackendPreference = backends;
            bkReloadProcessors();
        } else {
            WJR_DEBUG && console.log(`LIFECYCLE: Backend selected remained the same: ${backends.join(',')}`);
        }
    });
}

function bkSetAllLogging(onOrOff) {
    WJR_DEBUG = onOrOff;
    bkBroadcastMessageToProcessors({ "type": "set_all_logging", "value" : onOrOff});
}

function bkHandleMessage(request, sender, sendResponse) {
    if (request.type == 'setZone') {
        bkSetZone(request.zone);
    }
    else if (request.type == 'getZone') {
        sendResponse({ zone: BK_zone });
    }
    else if (request.type == 'setZoneAutomatic') {
        bkSetZoneAutomatic(request.isZoneAutomatic);
    }
    else if (request.type == 'getZoneAutomatic') {
        sendResponse({ isZoneAutomatic: BK_isZoneAutomatic });
    }
    else if (request.type == 'setDnsBlocking') {
        bkUpdateFromSettings();
    }
    else if (request.type == 'getOnOff') {
        sendResponse({ onOff: BK_isEnabled ? 'on' : 'off' });
    }
    else if (request.type == 'setOnOff') {
        bkSetEnabled(request.onOff == 'on');
    }
    else if (request.type == 'getOnOffSwitchShown') {
        sendResponse({ isOnOffSwitchShown: BK_isOnOffSwitchShown });
    }
    else if (request.type == 'setOnOffSwitchShown') {
        bkUpdateFromSettings();
    }
    else if (request.type == 'setVideoBlockingDisabled') {
        bkUpdateFromSettings();
    }
    else if (request.type == 'setSilentModeEnabled') {
        bkUpdateFromSettings();
    }
    else if (request.type == 'setBackendSelection') {
        bkUpdateFromSettings();
    }
}
browser.runtime.onMessage.addListener(bkHandleMessage);
browser.storage.local.get('default_zone')
    .then(bkSetDefaultZone)
    .then(() => {
        bkSetZone(BK_zone);
    })
    .then(() => {
        bkLoadBackendSettings(); //The loading of the first processor kicks off the rest of initialization
    });
