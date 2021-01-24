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


let BK_connectedClients = {};
let BK_connectedClientList = [];
let BK_openFilters = {};
let BK_openB64Filters = {};
let BK_openVidFilters = {};

let BK_isInitialized = false;
function bkInitialize() {
    browser.browserAction.setTitle({title: "Wingman Jr."});
    browser.browserAction.setIcon({path: "icons/wingman_icon_32_neutral.png"});
    bkUpdateFromSettings();
    bkSetEnabled(true); //always start on
}

function bkOnClientConnected(port) {
    console.log('LIFECYCLE: Processor '+port.name+' connected.');
    let registration = { port: port, processorId: port.name, isBusy: false, backend: 'unknown' };
    BK_connectedClients[registration.processorId] = registration;
    BK_connectedClientList.push(registration);
    console.log('LIFECYCLE: There are now '+BK_connectedClientList.length+' processors');
    port.onMessage.addListener(bkOnProcessorMessage);
    bkNotifyThreshold();
    if(!BK_isInitialized) {
        BK_isInitialized = true;
        bkInitialize();
    }
}

let BK_currentProcessorIndex = 0;
function bkGetNextProcessor() {
    if(BK_connectedClientList.length == 0) {
        return null;
    }
    BK_currentProcessorIndex = (BK_currentProcessorIndex+1) % BK_connectedClientList.length;
    let preferredProcessor = BK_connectedClientList[BK_currentProcessorIndex];
    if (preferredProcessor.isBusy) {
        //Are any free? If so, return next one.
        for(let i=1; i<BK_connectedClientList.length; i++) {
            let pIndex = (BK_currentProcessorIndex+i) % BK_connectedClientList.length;
            let processor = BK_connectedClientList[pIndex];
            if(!processor.isBusy) {
                console.debug('PERF: Choosing free processor '+processor.processorId);
                return processor;
            }
        }
        //Are any WebGL? If so, return next one.
        for(let i=1; i<BK_connectedClientList.length; i++) {
            let pIndex = (BK_currentProcessorIndex+i) % BK_connectedClientList.length;
            let processor = BK_connectedClientList[pIndex];
            if(processor.backend == 'webgl') {
                console.info('PERF: Choosing webgl processor '+processor.processorId);
                return processor;
            }
        }
    }
    console.info('PERF: Choosing free/fallback processor '+preferredProcessor.processorId+' with status '+(preferredProcessor.isBusy ? 'busy' : 'free'));
    return preferredProcessor;
}

function bkBroadcastMessageToProcessors(m) {
    BK_connectedClientList.forEach(c=>{
        c.port.postMessage(m);
    });
}
      
browser.runtime.onConnect.addListener(bkOnClientConnected);
browser.tabs.create({url:'/processor.html?backend=default&id=webgl-1', active: false})
    .then(async tab=>await browser.tabs.hide(tab.id));
//browser.tabs.create({url:'/processor.html?backend=webgl&id=webgl-2'});
//browser.tabs.create({url:'/processor.html?backend=wasm&id=wasm-1'});
//browser.tabs.create({url:'/processor.html?backend=wasm&id=wasm-2'});


function bkOnProcessorMessage(m) {
    switch(m.type) {
        case 'scan': {
            console.debug('PROC: '+m);
            let filter = BK_openFilters[m.requestId];
            filter.write(m.imageBytes);
            filter.close();
            delete BK_openFilters[m.requestId];
            console.debug('OPEN FILTERS: '+Object.keys(BK_openFilters).length);
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
            console.debug('STAT: '+m.requestId+' '+m.result);
            statusCompleteImageCheck(m.requestId, m.result);
            switch(m.result) {
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
            console.dir(BK_connectedClients);
            console.log('LIFECYLE: Registration '+m.processorId);
            BK_connectedClients[m.processorId].backend = m.backend;
        }
        break;
        case 'qos': {
            console.debug('QOS: '+m.processorId+' isBusy: '+m.isBusy);
            BK_connectedClients[m.processorId].isBusy = m.isBusy;
        }
        break;
    }
}

var BK_isZoneAutomatic = true;
var BK_predictionBufferBlockCount = 0;
var BK_predictionBuffer = [];
var BK_estimatedTruePositivePercentage = 0;
var BK_isEstimateValid = false;

function bkAddToPredictionBuffer(prediction)
{
    BK_predictionBuffer.push(prediction);
    if(prediction>0) {
        BK_predictionBufferBlockCount++;
    }
    if(BK_predictionBuffer.length>200) {
        let oldPrediction = BK_predictionBuffer.shift();
        if(oldPrediction > 0) {
            BK_predictionBufferBlockCount--;
        }
    }
    if(BK_predictionBuffer.length>50) {
        let estimatedTruePositiveCount = BK_zonePrecision*BK_predictionBufferBlockCount;
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

function bkCheckZone()
{
    if(!BK_isEstimateValid) {
        return;
    }
    if(!BK_isZoneAutomatic) {
        return;
    }
    let requestedZone = 'untrusted';
    if(BK_estimatedTruePositivePercentage < ROC_trustedToNeutralPercentage) {
        requestedZone = 'trusted';
    } else if(BK_estimatedTruePositivePercentage < ROC_neutralToUntrustedPercentage) {
        requestedZone = 'neutral';
    }
    if(requestedZone != BK_zone) {
        bkSetZone(requestedZone);
    }
}

var BK_zoneThreshold = ROC_neutralRoc.threshold;
var BK_zonePrecision = rocCalculatePrecision(ROC_neutralRoc);
console.log("Zone precision is: "+BK_zonePrecision);
var BK_zone = 'neutral';
function bkSetZone(newZone)
{
    console.log('Zone request to: '+newZone);
    let didZoneChange = false;
    switch(newZone)
    {
        case 'trusted':
            BK_zoneThreshold = ROC_trustedRoc.threshold;
            BK_zonePrecision = rocCalculatePrecision(ROC_trustedRoc);
            statusSetImageZoneTrusted();
            BK_zone = newZone;
            didZoneChange = true;
            console.log('Zone is now trusted!');
            break;
        case 'neutral':
            BK_zoneThreshold = ROC_neutralRoc.threshold;
            BK_zonePrecision = rocCalculatePrecision(ROC_neutralRoc);
            statusSetImageZoneNeutral();
            BK_zone = newZone;
            didZoneChange = true;
            console.log('Zone is now neutral!');
            break;
        case 'untrusted':
            BK_zoneThreshold = ROC_untrustedRoc.threshold;
            BK_zonePrecision = rocCalculatePrecision(ROC_untrustedRoc);
            statusSetImageZoneUntrusted();
            BK_zone = newZone;
            didZoneChange = true;
            console.log('Zone is now untrusted!')
            break;
    }
    if(didZoneChange) {
        console.log("Zone precision is: "+BK_zonePrecision);
        bkClearPredictionBuffer();
        bkNotifyThreshold();
    }
}

function bkNotifyThreshold() {
    bkBroadcastMessageToProcessors({
        type:'thresholdChange',
        threshold: BK_zoneThreshold
    });
}

async function bkImageListener(details, shouldBlockSilently=false) {
    if (details.statusCode < 200 || 300 <= details.statusCode) {
        return;
    }
    if (whtIsWhitelisted(details.url)) {
        console.log('WEBREQ: Normal whitelist '+details.url);
        return;
    }
    let mimeType = '';
    for(let i=0; i<details.responseHeaders.length; i++) {
        let header = details.responseHeaders[i];
        if(header.name.toLowerCase() == "content-type") {
            mimeType = header.value;
            if(!shouldBlockSilently) {
                header.value = 'image/svg+xml';
            }
            break;
        }
    }
    console.debug('WEBREQ: start headers '+details.requestId);
    let dataStartTime = null;
    let filter = browser.webRequest.filterResponseData(details.requestId);

    let processor = bkGetNextProcessor().port;
    processor.postMessage({
        type: 'start',
        requestId : details.requestId,
        mimeType: mimeType,
        url: details.url
    });
  
    filter.ondata = event => {
        if (dataStartTime == null) {
            dataStartTime = performance.now();
        }
        console.debug('WEBREQ: data '+details.requestId);
        processor.postMessage({ 
            type: 'ondata',
            requestId: details.requestId,
            data: event.data
        });
    }

    filter.onerror = e => {
        try
        {
            processor.postMessage({
                type: 'onerror',
                requestId: details.requestId
            });
            filter.close();
        }
        catch(ex)
        {
            console.error('WEBREQ: Filter error: '+e+', '+ex);
        }
    }
  
    filter.onstop = async event => {
        console.debug('WEBREQ: onstop '+details.requestId);
        BK_openFilters[details.requestId] = filter;
        processor.postMessage({
            type: 'onstop',
            requestId: details.requestId
        });
        statusStartImageCheck(details.requestId);
    }
    return details;
  }

async function bkDirectTypedUrlListener(details) {
    if (details.statusCode < 200 || 300 <= details.statusCode) {
        return;
    }
    if (whtIsWhitelisted(details.url)) {
        console.log('WEBREQ: Direct typed whitelist '+details.url);
        return;
    }
    //Try to see if there is an image MIME type
    for(let i=0; i<details.responseHeaders.length; i++) {
        let header = details.responseHeaders[i];
        if(header.name.toLowerCase() == "content-type") {
            let mimeType = header.value;
            if(mimeType.startsWith('image/')) {
                console.log('WEBREQ: Direct URL: Forwarding based on mime type: '+mimeType+' for '+details.url);
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
        console.log('DNS: DNS Blocked '+details.url);
        return { cancel: true };
    }
    return details;
}

function bkSetDnsBlocking(onOrOff) {
    let effectiveOnOrOff = onOrOff && BK_isEnabled;
    console.log('CONFIG: DNS blocking set request: '+onOrOff+', effective value '+effectiveOnOrOff);
    let isCurrentlyOn = browser.webRequest.onBeforeRequest.hasListener(bkDnsBlockListener);
    if(effectiveOnOrOff != isCurrentlyOn) {
        BK_shouldUseDnsBlocking = onOrOff; //Store the requested, not effective value
        if(effectiveOnOrOff && !isCurrentlyOn) {
            console.log('CONFIG: DNS Adding DNS block listener')
            browser.webRequest.onBeforeRequest.addListener(
                bkDnsBlockListener,
                {urls:["<all_urls>"], types:["image","imageset","media"]},
                ["blocking"]
              );
        } else if (!effectiveOnOrOff && isCurrentlyOn) {
            console.log('CONFIG: DNS Removing DNS block listener')
            browser.webRequest.onBeforeRequest.removeListener(bkDnsBlockListener);
        }
        console.log('CONFIG: DNS blocking is now: '+onOrOff);
    } else {
        console.log('CONFIG: DNS blocking is already correctly set.');
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
        console.log('WEBREQ: Base64 whitelist '+details.url);
        return;
    }
    console.debug('WEBREQ: base64 headers '+details.requestId+' '+details.url);
    // The received data is a stream of bytes. In order to do text-based
    // modifications, it is necessary to decode the bytes into a string
    // using the proper character encoding, do any modifications, then
    // encode back into a stream of bytes.
    // Historically, detecting character encoding has been a tricky task
    // taken on by the browser. Here, a simplified approach is taken
    // and the complexity is hidden in a helper method.
    let decoder, encoder;
    [decoder, encoder] = bkDetectCharsetAndSetupDecoderEncoder(details);
    if(!decoder) {
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
        requestId : details.requestId
    });

    filter.ondata = evt => {
        let str = decoder.decode(evt.data, {stream: true});
        processor.postMessage({
            type: 'b64_ondata',
            requestId : details.requestId,
            dataStr: str
        });
      };

    filter.onstop = async evt => {
        let str = decoder.decode(evt.data, {stream: true});
        processor.postMessage({
            type: 'b64_ondata',
            requestId : details.requestId,
            dataStr: str
        });
        processor.postMessage({
            type: 'b64_onstop',
            requestId : details.requestId
        });
    }

    filter.onerror = e => {
        try
        {
            processor.postMessage({
                type: 'b64_onerror',
                requestId : details.requestId
            })
        }
        catch(e)
        {
            console.error('WEBREQ: Filter error: '+e);
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
    for(let i=0; i<details.responseHeaders.length; i++) {
        let header = details.responseHeaders[i];
        if(header.name.toLowerCase() == "content-type") {
            contentType = header.value.toLowerCase();
            headerIndex = i;
            break;
        }
    }
    if (headerIndex == -1) {
      console.debug('CHARSET: No Content-Type header detected for '+details.url+', adding one.');
      headerIndex = details.responseHeaders.length;
      contentType = 'text/html';
      details.responseHeaders.push(
        {
          "name": "Content-Type",
          "value":"text/html"
        }
      );
    }
  
    let baseType;
    if(contentType.trim().startsWith('text/html')) {
      baseType = 'text/html';
      console.debug('CHARSET: Detected base type was '+baseType);
    } else if(contentType.trim().startsWith('application/xhtml+xml')) {
      baseType = 'application/xhtml+xml';
      console.debug('CHARSET: Detected base type was '+baseType);
    } else if(contentType.trim().startsWith('image/')) {
      console.debug('CHARSET: Base64 listener is ignoring '+details.requestId+' because it is an image/ MIME type');
      return;
    } else {
      baseType = 'text/html';
      console.debug('CHARSET: The Content-Type was '+contentType+', not text/html or application/xhtml+xml.');
      return;
    }
  
    // It is important to detect the charset to correctly initialize TextDecoder or
    // else we run into garbage output sometimes.
    // However, TextEncoder does NOT support other than 'utf-8', so it is necessary
    // to change the Content-Type on the header to UTF-8
    // If modifying this block of code, ensure that the tests at
    // https://www.w3.org/2006/11/mwbp-tests/index.xhtml
    // all pass - current implementation only fails on #9 but this detection ensures
    // tests #3,4,5, and 8 pass.
    let decodingCharset = 'utf-8';
    let detectedCharset = bkDetectCharset(contentType);
  
    if(detectedCharset !== undefined) {
        decodingCharset = detectedCharset;
        console.debug('CHARSET: Detected charset was ' + decodingCharset + ' for ' + details.url);
    }
    details.responseHeaders[headerIndex].value = baseType+';charset=utf-8';
  
    let decoder = new TextDecoder(decodingCharset);
    let encoder = new TextEncoder(); //Encoder does not support non-UTF-8 charsets so this is always utf-8.
  
    return [decoder,encoder];
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
    let charsetMaybeQuoted = contentType.substr(foundIndex+charsetMarker.length).trim();
    let charset = charsetMaybeQuoted.replace(/\"/g, '');
    return charset;
  }



////////////////////////Actual Startup//////////////////////////////

let BK_isVideoEnabled = true;

function bkRegisterAllCallbacks() {

    browser.webRequest.onHeadersReceived.addListener(
        bkImageListener,
        {urls:["<all_urls>"], types:["image","imageset"]},
        ["blocking","responseHeaders"]
    );

    browser.webRequest.onHeadersReceived.addListener(
        bkDirectTypedUrlListener,
        {urls:["<all_urls>"], types:["main_frame"]},
        ["blocking","responseHeaders"]
    );

    browser.webRequest.onHeadersReceived.addListener(
        bkBase64ContentListener,
        {
            urls:[
                "<all_urls>"
            ],
            types:["main_frame"]
        },
        ["blocking","responseHeaders"]
    );

    if(BK_isVideoEnabled) {
        browser.webRequest.onBeforeRequest.addListener(
            vidPrerequestListener,
            {urls:["<all_urls>"], types:["media","xmlhttprequest"]},
            ["blocking"]
        );
    
        browser.webRequest.onHeadersReceived.addListener(
            vidRootListener,
            {urls:["<all_urls>"], types:["media","xmlhttprequest"]},
            ["blocking","responseHeaders"]
        );
    }
}

function bkUnregisterAllCallbacks() {
    browser.webRequest.onHeadersReceived.removeListener(bkImageListener);
    browser.webRequest.onHeadersReceived.removeListener(bkDirectTypedUrlListener);
    browser.webRequest.onHeadersReceived.removeListener(bkBase64ContentListener);

    if(BK_isVideoEnabled) {
        browser.webRequest.onBeforeRequest.removeListener(vidPrerequestListener);
        browser.webRequest.onHeadersReceived.removeListener(vidRootListener);
    }
}

let BK_isEnabled = false;
function bkSetEnabled(isOn) {
    console.log('CONFIG: Setting enabled to '+isOn);
    if(isOn == BK_isEnabled) {
        return;
    }
    console.log('CONFIG: Handling callback wireup change.');
    if(isOn) {
        bkRegisterAllCallbacks();
    } else {
        bkUnregisterAllCallbacks();
    }
    BK_isEnabled = isOn;
    bkRefreshDnsBlocking();
    console.log('CONFIG: Callback wireups changed!');
}

let BK_isOnOffSwitchShown = false;

function bkUpdateFromSettings() {
    browser.storage.local.get("is_dns_blocking").then(dnsResult=>
    bkSetDnsBlocking(dnsResult.is_dns_blocking == true));
    browser.storage.local.get("is_on_off_shown").then(onOffResult=>
    BK_isOnOffSwitchShown = onOffResult.is_on_off_shown == true);
}

function bkHandleMessage(request, sender, sendResponse) {
    if(request.type=='setZone')
    {
        bkSetZone(request.zone);
    }
    else if(request.type=='getZone')
    {
        sendResponse({zone: BK_zone});
    }
    else if(request.type=='setZoneAutomatic')
    {
        bkSetZoneAutomatic(request.isZoneAutomatic);
    }
    else if(request.type=='getZoneAutomatic')
    {
        sendResponse({isZoneAutomatic:BK_isZoneAutomatic});
    }
    else if(request.type=='setDnsBlocking')
    {
        bkUpdateFromSettings();
    }
    else if(request.type=='getOnOff')
    {
        sendResponse({onOff:BK_isEnabled ? 'on' : 'off'});
    }
    else if(request.type=='setOnOff')
    {
        bkSetEnabled(request.onOff=='on');
    }
    else if(request.type=='getOnOffSwitchShown')
    {
        sendResponse({isOnOffSwitchShown: BK_isOnOffSwitchShown});
    }
    else if(request.type=='setOnOffSwitchShown')
    {
        bkUpdateFromSettings();
    }
}
browser.runtime.onMessage.addListener(bkHandleMessage);
bkSetZone('neutral');
browser.browserAction.setIcon({path: "icons/wingman_icon_32.png"});