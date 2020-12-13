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


let connectedClients = {};
let connectedClientList = [];
let openFilters = {};
let openB64Filters = {};

let isInitialized = false;
function initialize() {
    browser.browserAction.setTitle({title: "Wingman Jr."});
    browser.browserAction.setIcon({path: "icons/wingman_icon_32_neutral.png"});
    updateFromSettings();
    setEnabled(true); //always start on
}

function onClientConnected(port) {
    console.log('LIFECYCLE: Processor '+port.name+' connected.');
    let registration = { port: port, processorId: port.name, isBusy: false, backend: 'unknown' };
    connectedClients[port.name] = registration;
    connectedClientList.push(registration);
    console.log('LIFECYCLE: There are now '+connectedClientList.length+' processors');
    port.onMessage.addListener(onProcessorMessage);
    if(!isInitialized) {
        isInitialized = true;
        initialize();
    }
}

let currentProcessorIndex = 0;
function getNextProcessor() {
    if(connectedClientList.length == 0) {
        return null;
    }
    currentProcessorIndex = (currentProcessorIndex+1) % connectedClientList.length;
    let preferredProcessor = connectedClientList[currentProcessorIndex];
    if (preferredProcessor.isBusy) {
        //Are any free? If so, return next one.
        for(let i=1; i<connectedClientList.length; i++) {
            let pIndex = (currentProcessorIndex+i) % connectedClientList.length;
            let processor = connectedClientList[pIndex];
            if(!processor.isBusy) {
                console.log('PERF: Choosing free processor '+processor.processorId);
                return processor;
            }
        }
        //Are any WebGL? If so, return next one.
        for(let i=1; i<connectedClientList.length; i++) {
            let pIndex = (currentProcessorIndex+i) % connectedClientList.length;
            let processor = connectedClientList[pIndex];
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
    if(connectedClientList.length == 0) {
        return null;
    }
    currentProcessorIndex = (currentProcessorIndex+1) % connectedClientList.length;
    //Are any WebGL? If so, return next one.
    for(let i=1; i<connectedClientList.length; i++) {
        let pIndex = (currentProcessorIndex+i) % connectedClientList.length;
        let processor = connectedClientList[pIndex];
        if(processor.backend == 'webgl') {
            console.log('PERF: Accelerated choosing webgl processor '+processor.processorId);
            return processor;
        }
    }
    //fallback
    return getNextProcessor();
}

function broadcastMessage(m) {
    connectedClients.forEach(c=>{
        c.postMessage(m);
    });
}
      
browser.runtime.onConnect.addListener(onClientConnected);
browser.tabs.create({url:'/processor.html?backend=webgl&id=webgl-1'});
//browser.tabs.create({url:'/processor.html?backend=webgl&id=webgl-2'});
//browser.tabs.create({url:'/processor.html?backend=wasm&id=wasm-1'});
//browser.tabs.create({url:'/processor.html?backend=wasm&id=wasm-2'});


function onProcessorMessage(m) {
    switch(m.type) {
        case 'scan': {
            console.log('PROC: '+m);
            console.dir(m);
            let filter = openFilters[m.requestId];
            filter.write(m.imageBytes);
            filter.close();
            delete openFilters[m.requestId];
            console.log('OPEN FILTERS: '+openFilters.length);
        }
        break;
        case 'b64_data': {
            let b64Filter = openB64Filters[m.requestId];
            let b64Text = b64Filter.encoder.encode(m.dataStr);
            b64Filter.filter.write(b64Text);
        }
        break;
        case 'b64_close': {
            let b64Filter = openB64Filters[m.requestId];
            b64Filter.filter.close();
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
            connectedClients[m.processorId].backend = m.backend;
        }
        break;
        case 'qos': {
            console.log('QOS: '+m.processorId+' isBusy: '+m.isBusy);
            connectedClients[m.processorId].isBusy = m.isBusy;
        }
        break;
    }
}


//Note: checks can occur that fail and do not result in either a block or a pass.
//Therefore, use block+pass as the total count in certain cases
let blockCount = 0;
let passCount = 0;
let checkCount = 0;
function updateStatVisuals() {
    if (blockCount > 0) {
        let txt = (blockCount < 1000) ? blockCount+'' : '999+';
        browser.browserAction.setBadgeText({ "text": txt });
        browser.browserAction.setTitle({ title: 'Blocked '+blockCount+'/'+checkCount+' total images\r\n'+
        'Blocked '+Math.round(100*estimatedTruePositivePercentage)+'% of the last '+predictionBuffer.length+' in this zone' });
    }
}

var isZoneAutomatic = true;
var predictionBufferBlockCount = 0;
var predictionBuffer = [];
var estimatedTruePositivePercentage = 0;
var isEstimateValid = false;

function addToPredictionBuffer(prediction)
{
    predictionBuffer.push(prediction);
    if(prediction>0) {
        predictionBufferBlockCount++;
    }
    if(predictionBuffer.length>200) {
        let oldPrediction = predictionBuffer.shift();
        if(oldPrediction > 0) {
            predictionBufferBlockCount--;
        }
    }
    if(predictionBuffer.length>50) {
        let estimatedTruePositiveCount = zonePrecision*predictionBufferBlockCount;
        estimatedTruePositivePercentage = estimatedTruePositiveCount / predictionBuffer.length;
        isEstimateValid = true;
    } else {
        estimatedTruePositivePercentage = 0;
        isEstimateValid = false;
    }
}

function clearPredictionBuffer() {
    predictionBufferBlockCount = 0;
    predictionBuffer = [];
    estimatedTruePositivePercentage = 0;
}

function incrementCheckCount() {
    checkCount++;
    updateStatVisuals();
}

function incrementBlockCount() {
    blockCount++;
    addToPredictionBuffer(1);
    checkZone();
    updateStatVisuals();
}

function incrementPassCount() {
    passCount++;
    addToPredictionBuffer(0);
    checkZone();
    updateStatVisuals();
}

function setZoneAutomatic(isAutomatic) {
    isZoneAutomatic = isAutomatic;
}

function checkZone()
{
    if(!isEstimateValid) {
        return;
    }
    if(!isZoneAutomatic) {
        return;
    }
    let requestedZone = 'untrusted';
    if(estimatedTruePositivePercentage < 0.015) {
        requestedZone = 'trusted';
    } else if(estimatedTruePositivePercentage < 0.04) {
        requestedZone = 'neutral';
    }
    if(requestedZone != zone) {
        setZone(requestedZone);
    }
}

//FPR, TPR, Threshold - Positive=Unsafe
//((0.0049182506978598965, 0.6592216129463688), 0.9987614) //Trusted
//Binary confusion matrix at threshold = 0.9987614
//[[7486   37]
// [2548 4929]]
//((0.015020603482653197, 0.7378627791895145), 0.9977756) //Neutral
//Binary confusion matrix at threshold = 0.9977756
//[[7410  113]
// [1960 5517]]
//((0.10022597368071248, 0.9025010030761), 0.09442982) //Untrusted
//Binary confusion matrix at threshold = 0.09442982
//[[6769  754]
// [ 729 6748]]
var zoneThreshold = 0.9401961;
var zonePrecision = 5517/(113+5517);
var zone = 'neutral';
function setZone(newZone)
{
    console.log('ZONE: Zone request to: '+newZone);
    let didZoneChange = false;
    switch(newZone)
    {
        case 'trusted':
            zoneThreshold = 0.9987614;
            zonePrecision = 4929/(37+4929);
            browser.browserAction.setIcon({path: "icons/wingman_icon_32_trusted.png"});
            zone = newZone;
            didZoneChange = true;
            console.log('ZONE: Zone is now trusted!');
            break;
        case 'neutral':
            zoneThreshold = 0.9977756;
            zonePrecision = 5517/(113+5517);
            browser.browserAction.setIcon({path: "icons/wingman_icon_32_neutral.png"});
            zone = newZone;
            didZoneChange = true;
            console.log('ZONE: Zone is now neutral!');
            break;
        case 'untrusted':
            zoneThreshold = 0.09442982;
            zonePrecision = 6784/(754+6784);
            browser.browserAction.setIcon({path: "icons/wingman_icon_32_untrusted.png"});
            zone = newZone;
            didZoneChange = true;
            console.log('ZONE: Zone is now untrusted!')
            break;
    }
    if(didZoneChange) {
        clearPredictionBuffer();
        broadcastMessage({
            type:'thresholdChange',
            threshold: zoneThreshold
        });
    }
}

function isSafe(sqrxrScore)
{
    return sqrxrScore[0] < zoneThreshold;
}

/**
 * Given an image element, makes a prediction through wingman
 */
let inferenceTimeTotal = 0;
let inferenceCountTotal = 0;

let processingTimeTotal = 0;
let processingSinceDataStartTimeTotal = 0;
let processingSinceDataEndTimeTotal = 0;
let processingSinceImageLoadTimeTotal = 0;
let processingCountTotal = 0;


let iconDataURI = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAD6AAAA+gBtXtSawAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAGxSURBVFiF7dW9j0xRHMbxjz1m2ESWkChkiW0kGgSFnkbsJqvQTEMoRSFRydDsP6CiEoJibfQEW2hssSMKiUI2UcluY0Ui6y2M4pyJYzK7cxczFPeb3OSe+zzn+f3uyzmXkpKSf0zAIXzApz7X3oR9sB6PsLOPxXfgIQZbFw7iOQ70ofgePBOf/C9cwGsc7WHxw5hLtToyhXnUCoRVQ6VyJlQqp1Et4K+l7KmVTJvFV/Ee57sE1kMIoyGEY7jcxXsOi3iBLd06PYJ3+Iwry3jWYFa88yoaGFjGO4GP4k0Vfr0T+J6O21jbpp/C02w8g5NtnoDr+IZmyizMAO6nic10viHTH+NGNr6J6Ww8iHvZ/AepoVWxHa+ykGlswxi+oJ556+naGLamBlvz5jCy2uItaljKwhqpkSbGM9941mQj8y8ptqJW5FoW2DoWMZR5hvC2g+/qnxaHdXjSFjybtBM4ns4bbZ4ZcZv/K+zFmyx8EqPinj4iLq+7mb6gB9v6WfFDa+IWdmXabtxJ2tfk7QmTqcjFDtolP59Oz9gobqfDHbRhvBT/8z1l/29qJSUl/yc/AP3+b58RpkSuAAAAAElFTkSuQmCC";


let timingInfoDumpCount = 0;

async function listener(details, shouldBlockSilently=false) {
    if (details.statusCode < 200 || 300 <= details.statusCode) {
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
        incrementCheckCount();
        openFilters[details.requestId] = filter;
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

///////////////////////////////////////////////// DNS Lookup Tie-in /////////////////////////////////////////////////////////////

shouldUseDnsBlocking = false;

async function dnsBlockListener(details) {
    let dnsResult = await isDomainOk(details.url);
    if(!dnsResult) {
        console.log('DNS: DNS Blocked '+details.url);
        return { cancel: true };
    }
    return details;
}

function setDnsBlocking(onOrOff) {
    let effectiveOnOrOff = onOrOff && isEnabled;
    console.log('CONFIG: DNS blocking set request: '+onOrOff+', effective value '+effectiveOnOrOff);
    let isCurrentlyOn = browser.webRequest.onBeforeRequest.hasListener(dnsBlockListener);
    if(effectiveOnOrOff != isCurrentlyOn) {
        shouldUseDnsBlocking = onOrOff; //Store the requested, not effective value
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

//Use this if you change isEnabled
function refreshDnsBlocking() {
    setDnsBlocking(shouldUseDnsBlocking);
}

////////////////////////////////base64 IMAGE SEARCH SPECIFIC STUFF BELOW, BOO HISS!!!! ///////////////////////////////////////////


// Listen for any Base 64 encoded images, particularly the first page of
// "above the fold" image search requests in Google Images
async function base64_listener(details) {
    if (details.statusCode < 200 || 300 <= details.statusCode) {
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
    openB64Filters[details.requestId] = b64Filter;

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
    browser.webRequest.onHeadersReceived.removeListener(base64_listener);
}

let isEnabled = false;
function setEnabled(isOn) {
    console.log('CONFIG: Setting enabled to '+isOn);
    if(isOn == isEnabled) {
        return;
    }
    console.log('CONFIG: Handling callback wireup change.');
    if(isOn) {
        registerAllCallbacks();
    } else {
        unregisterAllCallbacks();
    }
    isEnabled = isOn;
    refreshDnsBlocking();
    console.log('CONFIG: Callback wireups changed!');
}

let isOnOffSwitchShown = false;

function updateFromSettings() {
    browser.storage.local.get("is_dns_blocking").then(dnsResult=>
    setDnsBlocking(dnsResult.is_dns_blocking == true));
    browser.storage.local.get("is_on_off_shown").then(onOffResult=>
    isOnOffSwitchShown = onOffResult.is_on_off_shown == true);
}

function handleMessage(request, sender, sendResponse) {
    if(request.type=='setZone')
    {
        setZone(request.zone);
    }
    else if(request.type=='getZone')
    {
        sendResponse({zone: zone});
    }
    else if(request.type=='setZoneAutomatic')
    {
        setZoneAutomatic(request.isZoneAutomatic);
    }
    else if(request.type=='getZoneAutomatic')
    {
        sendResponse({isZoneAutomatic:isZoneAutomatic});
    }
    else if(request.type=='setDnsBlocking')
    {
        updateFromSettings();
    }
    else if(request.type=='getOnOff')
    {
        sendResponse({onOff:isEnabled ? 'on' : 'off'});
    }
    else if(request.type=='setOnOff')
    {
        setEnabled(request.onOff=='on');
    }
    else if(request.type=='getOnOffSwitchShown')
    {
        sendResponse({isOnOffSwitchShown: isOnOffSwitchShown});
    }
    else if(request.type=='setOnOffSwitchShown')
    {
        updateFromSettings();
    }
}
browser.runtime.onMessage.addListener(handleMessage);
setZone('neutral');
browser.browserAction.setIcon({path: "icons/wingman_icon_32.png"});

