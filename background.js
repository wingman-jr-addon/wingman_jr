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
function initialize() {
    browser.browserAction.setTitle({title: "Wingman Jr."});
    browser.browserAction.setIcon({path: "icons/wingman_icon_32_neutral.png"});
    updateFromSettings();
    setEnabled(true); //always start on
}

function onClientConnected(port) {
    console.log('LIFECYCLE: Processor '+port.name+' connected.');
    let registration = { port: port, processorId: port.name, isBusy: false, backend: 'unknown' };
    BK_connectedClients[registration.processorId] = registration;
    BK_connectedClientList.push(registration);
    console.log('LIFECYCLE: There are now '+BK_connectedClientList.length+' processors');
    port.onMessage.addListener(onProcessorMessage);
    notifyThreshold();
    if(!BK_isInitialized) {
        BK_isInitialized = true;
        initialize();
    }
}

let BK_currentProcessorIndex = 0;
function getNextProcessor() {
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
                console.log('PERF: Choosing free processor '+processor.processorId);
                return processor;
            }
        }
        //Are any WebGL? If so, return next one.
        for(let i=1; i<BK_connectedClientList.length; i++) {
            let pIndex = (BK_currentProcessorIndex+i) % BK_connectedClientList.length;
            let processor = BK_connectedClientList[pIndex];
            if(processor.backend == 'webgl') {
                console.log('PERF: Choosing webgl processor '+processor.processorId);
                return processor;
            }
        }
    }
    console.log('PERF: Choosing free/fallback processor '+preferredProcessor.processorId+' with status '+(preferredProcessor.isBusy ? 'busy' : 'free'));
    return preferredProcessor;
}

function getAcceleratedProcessor() {
    if(BK_connectedClientList.length == 0) {
        return null;
    }
    BK_currentProcessorIndex = (BK_currentProcessorIndex+1) % BK_connectedClientList.length;
    //Are any WebGL? If so, return next one.
    for(let i=1; i<BK_connectedClientList.length; i++) {
        let pIndex = (BK_currentProcessorIndex+i) % BK_connectedClientList.length;
        let processor = BK_connectedClientList[pIndex];
        if(processor.backend == 'webgl') {
            console.log('PERF: Accelerated choosing webgl processor '+processor.processorId);
            return processor;
        }
    }
    //fallback
    return getNextProcessor();
}

function broadcastMessage(m) {
    BK_connectedClientList.forEach(c=>{
        c.port.postMessage(m);
    });
}
      
browser.runtime.onConnect.addListener(onClientConnected);
browser.tabs.create({url:'/processor.html?backend=default&id=webgl-1', active: false})
    .then(async tab=>await browser.tabs.hide(tab.id));
//browser.tabs.create({url:'/processor.html?backend=webgl&id=webgl-2'});
//browser.tabs.create({url:'/processor.html?backend=wasm&id=wasm-1'});
//browser.tabs.create({url:'/processor.html?backend=wasm&id=wasm-2'});

let BK_videoPlaceholderArrayBuffer = null;
fetch('wingman_placeholder.mp4')
.then(async r => BK_videoPlaceholderArrayBuffer = await r.arrayBuffer());

function onProcessorMessage(m) {
    switch(m.type) {
        case 'scan': {
            console.log('PROC: '+m);
            console.dir(m);
            let filter = BK_openFilters[m.requestId];
            filter.write(m.imageBytes);
            filter.close();
            delete BK_openFilters[m.requestId];
            console.log('OPEN FILTERS: '+Object.keys(BK_openFilters).length);
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
            let vidFilter = BK_openVidFilters[m.requestId];
            console.log('WEBREQV: video result '+m.requestId+' was '+m.status);
            if(m.status == 'block') {
                vidFilter.filter.write(BK_videoPlaceholderArrayBuffer);
                vidFilter.filter.close();
            } else {
                vidFilter.buffers.forEach(b=>vidFilter.filter.write(b));
                vidFilter.filter.disconnect();
            }
            delete BK_openVidFilters[m.requestId];
        }
        break;
        case 'stat': {
            console.log('STAT: '+m.requestId+' '+m.result);
            incrementCheckCount();
            switch(m.result) {
                case 'pass': {
                    incrementPassCount();
                }
                break;
                case 'block': {
                    incrementBlockCount();
                }
                //could also be tiny or error
            }
        }
        break;
        case 'registration': {
            console.dir(BK_connectedClients);
            console.log('LIFECYLE: Registration '+m.processorId);
            console.dir(m);
            BK_connectedClients[m.processorId].backend = m.backend;
        }
        break;
        case 'qos': {
            console.log('QOS: '+m.processorId+' isBusy: '+m.isBusy);
            BK_connectedClients[m.processorId].isBusy = m.isBusy;
        }
        break;
    }
}


//Note: checks can occur that fail and do not result in either a block or a pass.
//Therefore, use block+pass as the total count in certain cases
let BK_blockCount = 0;
let BK_passCount = 0;
let BK_checkCount = 0;
function updateStatVisuals() {
    if(BK_blockCount > 0) {
        let txt = (BK_blockCount < 1000) ? BK_blockCount+'' : '999+';
        browser.browserAction.setBadgeText({ "text": txt });
    }
    let openRequestIds = Object.keys(BK_openFilters);
    browser.browserAction.setTitle({ title: 'Blocked '+BK_blockCount+'/'+BK_checkCount+' total images\r\n'+
    'Blocked '+Math.round(100*BK_estimatedTruePositivePercentage)+'% of the last '+BK_predictionBuffer.length+' in this zone\r\n'+
    openRequestIds.length +' open requests: '+openRequestIds });
}

var BK_isZoneAutomatic = true;
var BK_predictionBufferBlockCount = 0;
var BK_predictionBuffer = [];
var BK_estimatedTruePositivePercentage = 0;
var BK_isEstimateValid = false;

function addToPredictionBuffer(prediction)
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

function clearPredictionBuffer() {
    BK_predictionBufferBlockCount = 0;
    BK_predictionBuffer = [];
    BK_estimatedTruePositivePercentage = 0;
}

function incrementCheckCount() {
    BK_checkCount++;
    updateStatVisuals();
}

function incrementBlockCount() {
    BK_blockCount++;
    addToPredictionBuffer(1);
    checkZone();
    updateStatVisuals();
}

function incrementPassCount() {
    BK_passCount++;
    addToPredictionBuffer(0);
    checkZone();
    updateStatVisuals();
}

function setZoneAutomatic(isAutomatic) {
    BK_isZoneAutomatic = isAutomatic;
}

function checkZone()
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
        setZone(requestedZone);
    }
}

var BK_zoneThreshold = ROC_neutralRoc.threshold;
var BK_zonePrecision = calculatePrecision(ROC_neutralRoc);
console.log("Zone precision is: "+BK_zonePrecision);
var BK_zone = 'neutral';
function setZone(newZone)
{
    console.log('Zone request to: '+newZone);
    let didZoneChange = false;
    switch(newZone)
    {
        case 'trusted':
            BK_zoneThreshold = ROC_trustedRoc.threshold;
            BK_zonePrecision = calculatePrecision(ROC_trustedRoc);
            browser.browserAction.setIcon({path: "icons/wingman_icon_32_trusted.png"});
            BK_zone = newZone;
            didZoneChange = true;
            console.log('Zone is now trusted!');
            break;
        case 'neutral':
            BK_zoneThreshold = ROC_neutralRoc.threshold;
            BK_zonePrecision = calculatePrecision(ROC_neutralRoc);
            browser.browserAction.setIcon({path: "icons/wingman_icon_32_neutral.png"});
            BK_zone = newZone;
            didZoneChange = true;
            console.log('Zone is now neutral!');
            break;
        case 'untrusted':
            BK_zoneThreshold = ROC_untrustedRoc.threshold;
            BK_zonePrecision = calculatePrecision(ROC_untrustedRoc);
            browser.browserAction.setIcon({path: "icons/wingman_icon_32_untrusted.png"});
            BK_zone = newZone;
            didZoneChange = true;
            console.log('Zone is now untrusted!')
            break;
    }
    if(didZoneChange) {
        console.log("Zone precision is: "+BK_zonePrecision);
        clearPredictionBuffer();
        notifyThreshold();
    }
}

function notifyThreshold() {
    broadcastMessage({
        type:'thresholdChange',
        threshold: BK_zoneThreshold
    });
}

async function listener(details, shouldBlockSilently=false) {
    if (details.statusCode < 200 || 300 <= details.statusCode) {
        return;
    }
    if (isWhitelisted(details.url)) {
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
    console.log('WEBREQ: start headers '+details.requestId);
    let dataStartTime = null;
    let filter = browser.webRequest.filterResponseData(details.requestId);

    let processor = getNextProcessor().port;
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
        console.log('WEBREQ: data '+details.requestId);
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
            console.log('WEBREQ: Filter error: '+e+', '+ex);
        }
    }
  
    filter.onstop = async event => {
        BK_openFilters[details.requestId] = filter;
        processor.postMessage({
            type: 'onstop',
            requestId: details.requestId
        });
    }
    return details;
  }

async function direct_typed_url_listener(details) {
    if (details.statusCode < 200 || 300 <= details.statusCode) {
        return;
    }
    if (isWhitelisted(details.url)) {
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
                return listener(details,true);
            }
        }
    }
    //Otherwise do nothing...
    return details;
}

///////////////////////////////////////////////// Video ////////////////////////////////////////////////////////////////

// The video listener behaves a bit differently in that it both queues up the data locally as well
// as passes it to the processor until it hears back a response.
async function video_listener(details) {
    if (details.statusCode < 200 || 300 <= details.statusCode) {
        return;
    }
    if (isWhitelisted(details.url)) {
        console.log('WEBREQV: Video whitelist '+details.url);
        return;
    }
    let mimeType = '';
    for(let i=0; i<details.responseHeaders.length; i++) {
        let header = details.responseHeaders[i];
        if(header.name.toLowerCase() == "content-type") {
            mimeType = header.value;
            break;
        }
    }

    console.log('VIDEO mime type check for '+details.requestId+' '+mimeType+': '+length+', webrequest type '+details.type);
    let isVideo =  mimeType.startsWith('video/');
    if(!isVideo) {
        let isImage = mimeType.startsWith('image/');
        if(isImage) {
            console.log('WEBREQV: Video received an image: '+details.requestId+' '+mimeType);
            return listener(details);
        } else {
            return;
        }
    }

    console.log('WEBREQV: video start headers '+details.requestId);
    let dataStartTime = null;
    let filter = browser.webRequest.filterResponseData(details.requestId);

    let processor = getNextProcessor().port;
    processor.postMessage({
        type: 'vid_start',
        requestId : details.requestId,
        requestType: details.type,
        url: details.url,
        mimeType: mimeType,
        url: details.url
    });

    let vidFilter = {
        requestId: details.requestId,
        filter: filter,
        buffers: []
    };
    BK_openVidFilters[details.requestId] = vidFilter;
    let totalSize = 0;
    let packetCounter = 0;
  
    filter.ondata = event => {
        if (dataStartTime == null) {
            dataStartTime = performance.now();
        }
        console.log('WEBREQV: video data '+details.requestId+' size '+event.data.byteLength);
        totalSize += event.data.byteLength;
        vidFilter.buffers.push(event.data);
        
        processor.postMessage({ 
            type: 'vid_ondata',
            requestId: details.requestId,
            packetNo: packetCounter,
            data: event.data
        });
        packetCounter++;
    }

    filter.onerror = e => {
        try
        {
            processor.postMessage({
                type: 'vid_onerror',
                requestId: details.requestId
            });
            filter.disconnect();
        }
        catch(ex)
        {
            console.log('WEBREQ: Filter video error: '+e+', '+ex);
        }
    }
  
    filter.onstop = async event => {
        let dataStopTime = performance.now();
        console.log('WEBREQV: Video request '+details.requestId+' had '+totalSize+' bytes and took '+(dataStopTime-dataStartTime)+' ms, it had MIME type '+mimeType+' and came from source '+details.type);
        processor.postMessage({
            type: 'vid_onstop',
            requestId: details.requestId
        });
    }
    return details;
  }

///////////////////////////////////////////////// DNS Lookup Tie-in /////////////////////////////////////////////////////////////

BK_shouldUseDnsBlocking = false;

async function dnsBlockListener(details) {
    let dnsResult = await isDomainOk(details.url);
    if(!dnsResult) {
        console.log('DNS: DNS Blocked '+details.url);
        return { cancel: true };
    }
    return details;
}

function setDnsBlocking(onOrOff) {
    let effectiveOnOrOff = onOrOff && BK_isEnabled;
    console.log('CONFIG: DNS blocking set request: '+onOrOff+', effective value '+effectiveOnOrOff);
    let isCurrentlyOn = browser.webRequest.onBeforeRequest.hasListener(dnsBlockListener);
    if(effectiveOnOrOff != isCurrentlyOn) {
        BK_shouldUseDnsBlocking = onOrOff; //Store the requested, not effective value
        if(effectiveOnOrOff && !isCurrentlyOn) {
            console.log('CONFIG: DNS Adding DNS block listener')
            browser.webRequest.onBeforeRequest.addListener(
                dnsBlockListener,
                {urls:["<all_urls>"], types:["image","imageset","media"]},
                ["blocking"]
              );
        } else if (!effectiveOnOrOff && isCurrentlyOn) {
            console.log('CONFIG: DNS Removing DNS block listener')
            browser.webRequest.onBeforeRequest.removeListener(dnsBlockListener);
        }
        console.log('CONFIG: DNS blocking is now: '+onOrOff);
    } else {
        console.log('CONFIG: DNS blocking is already correctly set.');
    }
}

//Use this if you change BK_isEnabled
function refreshDnsBlocking() {
    setDnsBlocking(BK_shouldUseDnsBlocking);
}

////////////////////////////////base64 IMAGE SEARCH SPECIFIC STUFF BELOW, BOO HISS!!!! ///////////////////////////////////////////


// Listen for any Base 64 encoded images, particularly the first page of
// "above the fold" image search requests in Google Images
async function base64_listener(details) {
    if (details.statusCode < 200 || 300 <= details.statusCode) {
        return;
    }
    if (isWhitelisted(details.url)) {
        console.log('WEBREQ: Base64 whitelist '+details.url);
        return;
    }
    console.log('WEBREQ: base64 headers '+details.requestId+' '+details.url);
    // The received data is a stream of bytes. In order to do text-based
    // modifications, it is necessary to decode the bytes into a string
    // using the proper character encoding, do any modifications, then
    // encode back into a stream of bytes.
    // Historically, detecting character encoding has been a tricky task
    // taken on by the browser. Here, a simplified approach is taken
    // and the complexity is hidden in a helper method.
    let decoder, encoder;
    [decoder, encoder] = detectCharsetAndSetupDecoderEncoder(details);
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
    let processor = getAcceleratedProcessor().port; 
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
            console.log('WEBREQ: Filter error: '+e);
        }
    }
  
  return details;
}


// This helper method does a few things regarding character encoding:
// 1) Detects the charset for the TextDecoder so that bytes are properly turned into strings
// 2) Ensures the output Content-Type is UTF-8 because that is what TextEncoder supports
// 3) Returns the decoder/encoder pair
function detectCharsetAndSetupDecoderEncoder(details) {
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
      console.log('CHARSET: No Content-Type header detected for '+details.url+', adding one.');
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
      console.log('CHARSET: Detected base type was '+baseType);
    } else if(contentType.trim().startsWith('application/xhtml+xml')) {
      baseType = 'application/xhtml+xml';
      console.log('CHARSET: Detected base type was '+baseType);
    } else if(contentType.trim().startsWith('image/')) {
      console.log('CHARSET: Base64 listener is ignoring '+details.requestId+' because it is an image/ MIME type');
      return;
    } else {
      baseType = 'text/html';
      console.log('CHARSET: The Content-Type was '+contentType+', not text/html or application/xhtml+xml.');
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
    let detectedCharset = detectCharset(contentType);
  
    if(detectedCharset !== undefined) {
        decodingCharset = detectedCharset;
        console.log('CHARSET: Detected charset was ' + decodingCharset + ' for ' + details.url);
    }
    details.responseHeaders[headerIndex].value = baseType+';charset=utf-8';
  
    let decoder = new TextDecoder(decodingCharset);
    let encoder = new TextEncoder(); //Encoder does not support non-UTF-8 charsets so this is always utf-8.
  
    return [decoder,encoder];
  }
  
  
// Detect the charset from Content-Type
function detectCharset(contentType) {
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

function registerAllCallbacks() {

    browser.webRequest.onHeadersReceived.addListener(
        listener,
        {urls:["<all_urls>"], types:["image","imageset"]},
        ["blocking","responseHeaders"]
      );

      browser.webRequest.onHeadersReceived.addListener(
        direct_typed_url_listener,
        {urls:["<all_urls>"], types:["main_frame"]},
        ["blocking","responseHeaders"]
      );

    browser.webRequest.onHeadersReceived.addListener(
        video_listener,
        {urls:["<all_urls>"], types:["media","xmlhttprequest"]},
        ["blocking","responseHeaders"]
      );

      browser.webRequest.onHeadersReceived.addListener(
        base64_listener,
        {
            urls:[
                "<all_urls>"
            ],
            types:["main_frame"]
        },
        ["blocking","responseHeaders"]
      );
}

function unregisterAllCallbacks() {
    browser.webRequest.onHeadersReceived.removeListener(listener);
    browser.webRequest.onHeadersReceived.removeListener(direct_typed_url_listener);
    browser.webRequest.onHeadersReceived.removeListener(video_listener);
    browser.webRequest.onHeadersReceived.removeListener(base64_listener);
}

let BK_isEnabled = false;
function setEnabled(isOn) {
    console.log('CONFIG: Setting enabled to '+isOn);
    if(isOn == BK_isEnabled) {
        return;
    }
    console.log('CONFIG: Handling callback wireup change.');
    if(isOn) {
        registerAllCallbacks();
    } else {
        unregisterAllCallbacks();
    }
    BK_isEnabled = isOn;
    refreshDnsBlocking();
    console.log('CONFIG: Callback wireups changed!');
}

let BK_isOnOffSwitchShown = false;

function updateFromSettings() {
    browser.storage.local.get("is_dns_blocking").then(dnsResult=>
    setDnsBlocking(dnsResult.is_dns_blocking == true));
    browser.storage.local.get("is_on_off_shown").then(onOffResult=>
    BK_isOnOffSwitchShown = onOffResult.is_on_off_shown == true);
}

function handleMessage(request, sender, sendResponse) {
    if(request.type=='setZone')
    {
        setZone(request.zone);
    }
    else if(request.type=='getZone')
    {
        sendResponse({zone: BK_zone});
    }
    else if(request.type=='setZoneAutomatic')
    {
        setZoneAutomatic(request.isZoneAutomatic);
    }
    else if(request.type=='getZoneAutomatic')
    {
        sendResponse({isZoneAutomatic:BK_isZoneAutomatic});
    }
    else if(request.type=='setDnsBlocking')
    {
        updateFromSettings();
    }
    else if(request.type=='getOnOff')
    {
        sendResponse({onOff:BK_isEnabled ? 'on' : 'off'});
    }
    else if(request.type=='setOnOff')
    {
        setEnabled(request.onOff=='on');
    }
    else if(request.type=='getOnOffSwitchShown')
    {
        sendResponse({isOnOffSwitchShown: BK_isOnOffSwitchShown});
    }
    else if(request.type=='setOnOffSwitchShown')
    {
        updateFromSettings();
    }
}
browser.runtime.onMessage.addListener(handleMessage);
setZone('neutral');
browser.browserAction.setIcon({path: "icons/wingman_icon_32.png"});

