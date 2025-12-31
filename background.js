//Used to be defined here, but now with inprocwebgl, it is inherited from processor.js initialization
//let WJR_DEBUG = false;

//Ensure browser cache isn't going to cause us problems
browser.webRequest.handlerBehaviorChanged();


async function bkOnUpdate() {
    const url = 'https://docs.google.com/forms/d/e/1FAIpQLSfkmwmDvV0vK5x8s1rmgCNWRoj5d7FOxu4-4scyrzMy2nuJbQ/viewform?usp=sf_link';
    await browser.tabs.create({ url });
}

//User feedback
browser.runtime.onInstalled.addListener(async ({ reason, temporary, }) => {
    if (temporary) return; // skip during development
    switch (reason) {
        case "update": {
            await bkOnUpdate();
        } break;
    }
});

browser.runtime.setUninstallURL("https://docs.google.com/forms/d/e/1FAIpQLSfYLfDewK-ovU-fQXOARqvNRaaH18UGxI2S6tAQUKv5RNSGaQ/viewform?usp=sf_link");

statusInitialize();

let BK_connectedClients = {};
let BK_openFilters = {};
let BK_openB64Filters = {};
let BK_openVidFilters = {};

const BK_revealAllowlist = new Map();
const BK_revealAllowlistByTab = new Map();
const BK_revealAllowlistTtlMs = 30 * 1000;

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
        if(BK_connectedClients[key].backend == BK_processorBackendPreference[0] ||
            'inproc'+BK_connectedClients[key].backend == BK_processorBackendPreference[0]
        ) {
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
        if(client.tabId !== 'fake') {
            browser.tabs.remove(client.tabId);
        } else {
            console.log('LIFECYCLE: Cleaning up fake tab.');
            try {
                client.destroy();
            } catch {}
        }
        delete BK_connectedClients[key];
    }


    WJR_DEBUG && console.log('LIFECYCLE: Spawning new processors.');
    for(let i=0; i<BK_processorBackendPreference.length; i++) {
        let backend = BK_processorBackendPreference[i];
        WJR_DEBUG && console.log(`LIFECYCLE: Spawning processor with backend ${backend}`);
        if(backend == 'inprocwebgl') {
            console.log(`LIFECYCLE: Probing for inprocwebgl backend`);
            if(!bkTryStartupBackgroundJsProcessor()) {
                console.log(`LIFECYCLE: Probe for inprocwebgl failed, falling back to webgl`);
                browser.tabs.create({url:`/processor.html?backend=${backend}&id=${backend}-1`, active: false})
                    .then(async tab=>await browser.tabs.hide(tab.id));
            }
        } else {
            browser.tabs.create({url:`/processor.html?backend=${backend}&id=${backend}-1`, active: false})
                .then(async tab=>await browser.tabs.hide(tab.id));
        }
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
    }
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
            url: pseudoRequestId,
            threshold: BK_zoneThreshold
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

function bkNormalizeRevealUrl(url) {
    if (!url || url.startsWith('data:')) {
        return url;
    }
    try {
        const parsed = new URL(url);
        parsed.searchParams.delete('wingman_reveal');
        parsed.hash = '';
        return parsed.toString();
    } catch {
        return url;
    }
}

function bkRememberRevealUrl(url, tabId) {
    const normalized = bkNormalizeRevealUrl(url);
    if (!normalized) {
        console.warn('REVEAL: Unable to normalize URL', url);
        return;
    }
    BK_revealAllowlist.set(normalized, Date.now() + BK_revealAllowlistTtlMs);
    console.log('REVEAL: Allowlisted URL', normalized);
    if (tabId !== null && tabId !== undefined && tabId >= 0) {
        let origin = null;
        try {
            origin = new URL(normalized).origin;
        } catch {
            origin = null;
        }
        BK_revealAllowlistByTab.set(tabId, {
            expiresAt: Date.now() + BK_revealAllowlistTtlMs,
            origin: origin
        });
        console.log('REVEAL: Allowlisted tab', { tabId, origin: origin });
    }
}

function bkIsRevealAllowed(url, tabId) {
    const normalized = bkNormalizeRevealUrl(url);
    if (!normalized) {
        return false;
    }
    const expiresAt = BK_revealAllowlist.get(normalized);
    if (!expiresAt) {
        const tabAllow = BK_revealAllowlistByTab.get(tabId);
        if (!tabAllow) {
            WJR_DEBUG && console.log('REVEAL: URL not allowlisted', normalized);
            return false;
        }
        if (Date.now() > tabAllow.expiresAt) {
            console.log('REVEAL: Tab allowlist expired', tabId);
            BK_revealAllowlistByTab.delete(tabId);
            return false;
        }
        if (tabAllow.origin) {
            let currentOrigin = null;
            try {
                currentOrigin = new URL(normalized).origin;
            } catch {
                currentOrigin = null;
            }
            if (currentOrigin !== tabAllow.origin) {
                WJR_DEBUG && console.log('REVEAL: Tab allowlist origin mismatch', {
                    tabId,
                    expected: tabAllow.origin,
                    actual: currentOrigin
                });
                return false;
            }
        }
        console.log('REVEAL: Allowlist hit by tab', { tabId, url: normalized, origin: tabAllow.origin });
        return true;
    }
    if (Date.now() > expiresAt) {
        console.log('REVEAL: Allowlist expired', normalized);
        BK_revealAllowlist.delete(normalized);
        return false;
    }
    console.log('REVEAL: Allowlist hit', normalized);
    return true;
}

async function bkImageListener(details, shouldBlockSilently = false) {
    if (details.statusCode < 200 || 300 <= details.statusCode) {
        return;
    }
    if (whtIsWhitelisted(details.url)) {
        WJR_DEBUG && console.log('WEBREQ: Normal whitelist '+details.url);
        return;
    }
    if (bkIsRevealAllowed(details.url, details.tabId)) {
        WJR_DEBUG && console.log('WEBREQ: Reveal whitelist '+details.url);
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
        url: details.url,
        threshold: BK_zoneThreshold
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
    if (bkIsRevealAllowed(details.url, details.tabId)) {
        WJR_DEBUG && console.log('WEBREQ: Direct typed reveal whitelist '+details.url);
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
    let decoderEncoder = encDetectCharsetAndSetupDecoderEncoder(details);
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
        requestId: details.requestId,
        threshold: BK_zoneThreshold
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
        let str = decoder.decode(evt.data ?? new ArrayBuffer(), { stream: true });
        //Force a flush
        str += decoder.decode(new ArrayBuffer(), { stream: true });
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

////////////////////////////Context Menu////////////////////////////

if (browser.menus) {
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

    browser.menus.create({
        id: "wingman-reveal-blocked-image",
        title: "Reveal Blocked Image",
        documentUrlPatterns: ["*://*/*"],
        contexts: ["image"],
    });

    browser.menus.onClicked.addListener(async (info, tab) => {
        if (info.menuItemId !== "wingman-reveal-blocked-image") {
            return;
        }
        console.log('REVEAL: Context menu clicked', {
            frameId: info.frameId,
            tabId: tab?.id
        });

        const [targetInfo] = await browser.tabs.executeScript(tab.id, {
            frameId: info.frameId,
            code: `(() => {
                const target = browser.menus.getTargetElement(${info.targetElementId});
                if (!target || !target.src) {
                    return null;
                }
                return { src: target.src };
            })();`,
        });

        if (!targetInfo || !targetInfo.src) {
            console.warn('REVEAL: Missing target src');
            return;
        }

        if (targetInfo.src.startsWith('data:image/svg+xml')) {
            console.log('REVEAL: Handling SVG data URL');
            await browser.tabs.executeScript(tab.id, {
                frameId: info.frameId,
                code: `(() => {
                    const target = browser.menus.getTargetElement(${info.targetElementId});
                    if (!target || !target.src || !target.src.startsWith('data:image/svg+xml')) {
                        return;
                    }
                    const src = target.src;
                    const commaIndex = src.indexOf(',');
                    if (commaIndex === -1) {
                        return;
                    }
                    const payload = src.slice(commaIndex + 1);
                    let svgText = '';
                    if (src.includes(';base64')) {
                        svgText = atob(payload);
                    } else {
                        svgText = decodeURIComponent(payload);
                    }
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(svgText, 'image/svg+xml');
                    const imageNode = doc.querySelector('image');
                    const href = imageNode?.getAttribute('href') || imageNode?.getAttribute('xlink:href');
                    if (href) {
                        target.src = href;
                        console.log('REVEAL: SVG href extracted', href);
                    } else {
                        console.warn('REVEAL: No href found in SVG');
                    }
                })();`,
            });
            return;
        }

        console.log('REVEAL: Allowlisting URL for reveal', targetInfo.src);
        bkRememberRevealUrl(targetInfo.src, tab?.id);

        await browser.tabs.executeScript(tab.id, {
            frameId: info.frameId,
            code: `(() => {
                const target = browser.menus.getTargetElement(${info.targetElementId});
                if (!target || !target.src) {
                    console.warn('REVEAL: Target missing during reload');
                    return;
                }
                const originalSrc = target.src;
                const previousObjectUrl = target.dataset.wingmanRevealObjectUrl;
                if (previousObjectUrl) {
                    URL.revokeObjectURL(previousObjectUrl);
                    delete target.dataset.wingmanRevealObjectUrl;
                }
                target.removeAttribute('srcset');
                console.log('REVEAL: Fetching image with cache reload', originalSrc);
                fetch(originalSrc, { cache: 'reload' })
                    .then(response => {
                        if (!response.ok) {
                            throw new Error('HTTP ' + response.status);
                        }
                        return response.blob();
                    })
                    .then(blob => {
                        const objectUrl = URL.createObjectURL(blob);
                        target.dataset.wingmanRevealObjectUrl = objectUrl;
                        target.src = objectUrl;
                        console.log('REVEAL: Set image to fetched blob URL');
                    })
                    .catch(error => {
                        console.warn('REVEAL: Fetch reload failed, resetting src', error);
                        target.src = '';
                        target.src = originalSrc;
                    });
            })();`,
        });
    });
}

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
    WJR_DEBUG && console.log('CONFIG: Callback wireups changed!');
}

let BK_videoScanMode = 'quick';
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

function bkNormalizeVideoScanMode(mode) {
    if(mode === 'enabled' || mode === 'quick' || mode === 'disabled') {
        return mode;
    }
    return 'quick';
}

function bkSetVideoScanMode(mode) {
    let normalizedMode = bkNormalizeVideoScanMode(mode);
    if(normalizedMode === BK_videoScanMode) {
        return;
    }
    BK_videoScanMode = normalizedMode;
    bkSetVideoEnabled(BK_videoScanMode !== 'disabled');
}

let BK_isOnOffSwitchShown = false;

function bkUpdateFromSettings() {
    browser.storage.local.get('is_on_off_shown').then(onOffResult =>
        BK_isOnOffSwitchShown = onOffResult.is_on_off_shown == true);
    browser.storage.local.get(['video_blocking_mode', 'is_video_blocking_disabled']).then(videoBlockingResult => {
        let mode = videoBlockingResult.video_blocking_mode;
        if(!mode) {
            if(videoBlockingResult.is_video_blocking_disabled === true) {
                mode = 'disabled';
            } else if(videoBlockingResult.is_video_blocking_disabled === false) {
                mode = 'enabled';
            } else {
                mode = 'quick';
            }
        }
        bkSetVideoScanMode(mode);
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
    else if (request.type == 'setVideoBlockingMode') {
        bkUpdateFromSettings();
    }
    else if (request.type == 'setSilentModeEnabled') {
        bkUpdateFromSettings();
    }
    else if (request.type == 'setBackendSelection') {
        bkUpdateFromSettings();
    }
    else if (request.type == 'revealBlockedImage') {
        console.log('REVEAL: Message received', request.url);
        bkRememberRevealUrl(request.url, sender?.tab?.id);
        sendResponse({ ok: true });
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
