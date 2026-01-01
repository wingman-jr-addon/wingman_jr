let VID_PLACEHOLDER_MP4 = null;
let VID_PLACEHOLDER_WEBM = null;
const VID_QUICK_SCAN_MAX_FRAMES = 3;
fetch('wingman_placeholder.mp4')
.then(async r => VID_PLACEHOLDER_MP4 = await r.arrayBuffer());

fetch('wingman_placeholder.webm')
.then(async r => VID_PLACEHOLDER_WEBM = await r.arrayBuffer());



function vidConcatBuffersToUint8Array(buffers) {
    let fullLength = buffers.reduce((acc,buf)=>acc+buf.byteLength, 0);
    let result = new Uint8Array(fullLength);
    let offset = 0;
    for(let buffer of buffers) {
        result.set(new Uint8Array(buffer), offset);
        offset += buffer.byteLength;
    }
    return result;
}

function vidToArrayBuffer(u8Array) {
    return u8Array.buffer.slice(
        u8Array.byteOffset,
        u8Array.byteOffset+u8Array.byteLength
    );
}

function vidDetectType(u8Array) {
    if(mp4IsLikelyProbe(u8Array)) {
        return 'video/mp4';
    } else if(ebmlIsLikelyProbe(u8Array)) {
        return 'video/webm';
    } else {
        return 'video/*';
    }
}

function vidGetQuickScanMaxSteps(scanMaxSteps, totalScanCount) {
    if (BK_videoScanMode !== 'quick') {
        return scanMaxSteps;
    }
    let remaining = VID_QUICK_SCAN_MAX_FRAMES - totalScanCount;
    return Math.max(0, Math.min(scanMaxSteps, remaining));
}

function vidShouldQuickScanBlock(scanResults) {
    return BK_videoScanMode === 'quick' && scanResults.blockCount > 0;
}

async function vidPrerequestListener(details) {
    if (whtIsWhitelisted(details.url)) {
        return;
    }
    let parsedUrl = new URL(details.url);
    //Youtube check
    if(parsedUrl.hostname.endsWith('.googlevideo.com')) {
        let cpn = parsedUrl.searchParams.get('cpn');
        let youtubeGroupPrecheck = VID_YT_GROUPS[cpn];
        if (youtubeGroupPrecheck !== undefined) {
            if(youtubeGroupPrecheck.status == 'block') {
                console.warn(`YTV: Pre-block known CPN ${cpn}`)
                return { cancel: true };
            }
        }
    }
}

let VID_OPEN_REQUESTS = { };
async function vidOnVidScan(m) {
    let openRequest = VID_OPEN_REQUESTS[m.requestId];
    if(openRequest !== undefined) {
        delete VID_OPEN_REQUESTS[m.requestId];
        openRequest.resolve(m);
    } //TODO reject based on error handling
}

//Request ID should be unique
async function vidPerformVideoScan(
    processor,
    videoChainId,
    requestId,
    mimeType,
    url,
    requestType,
    buffers,
    threshold,
    scanStart,
    scanStep,
    scanMaxSteps,
    scanBlockBailCount
) {
    let p = new Promise(function(resolve, reject) {
        VID_OPEN_REQUESTS[requestId] = {
            requestId: requestId, 
            resolve: resolve,
            reject: reject
        };
    });
    processor.port.postMessage({
        type: 'vid_chunk',
        videoChainId: videoChainId,
        requestId: requestId,
        requestType: requestType,
        url: url,
        mimeType: mimeType,
        buffers: buffers,
        threshold: threshold,
        scanStart: scanStart,
        scanStep: scanStep,
        scanMaxSteps: scanMaxSteps,
        scanBlockBailCount: scanBlockBailCount
    })
    return p;
}

async function vidRootListener(details) {
    if (details.statusCode < 200 || 300 <= details.statusCode) {
        return;
    }
    if (whtIsWhitelisted(details.url)) {
        WJR_DEBUG && console.log('WEBREQV: Video whitelist '+details.url);
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

    let expectedContentLength = -1;
    try {
        for(let i=0; i<details.responseHeaders.length; i++) {
            let header = details.responseHeaders[i];
            if(header.name.toLowerCase() == "content-length") {
                expectedContentLength = parseInt(header.value);
                break;
            }
        }
    }
    catch(e) {
        console.warn('WEBREQV: Weird error parsing content-length '+e);
    }

    let threshold = BK_zoneThreshold;

    let contentRange = undefined;
    for(let i=0; i<details.responseHeaders.length; i++) {
        let header = details.responseHeaders[i];
        if(header.name.toLowerCase() == "content-range") {
            //bytes start-end/size
            var matches = [...header.value.matchAll(/bytes[ |\t]*([0-9]+)-([0-9]+)\/([0-9]+)(.*)/ig)];
            if(matches.length > 0)
            {
                let start = parseInt(matches[0][1]);
                let end = parseInt(matches[0][2]);
                let size = parseInt(matches[0][3]);
                contentRange = { start: start, end: end, size: size};
                break;
            } else {
                //bytes */size
                var starMatches = [...header.value.matchAll(/bytes[ |\t]*\*\/([0-9]+)(.*)/ig)];
                if(starMatches.length > 0) {
                    console.warn(`WEBREQV: Content-Range star value with integer size - pretend range doesn't exist: ${header.value}`);
                } else {
                    //We don't support other units etc.
                    console.error(`WEBREQV: Unhandled Content-Range value: ${header.value}`);
                }
            } 
        }
    }

    WJR_DEBUG && console.debug('WEBREQV: VIDEO mime type check for '+details.requestId+' '+mimeType+': '+length+', webrequest type '+details.type+', expected content-length '+expectedContentLength+' content-range '+JSON.stringify(contentRange)+' originUrl '+details.originUrl+' documentUrl '+ details.documentUrl +' url '+details.url);
    let isVideo =  mimeType.startsWith('video/');
    if(!isVideo) {
        let isImage = mimeType.startsWith('image/');
        if(isImage) {
            WJR_DEBUG && console.log('WEBREQV: Video received an image: '+details.requestId+' '+mimeType);
            return bkImageListener(details);
        } else {
            WJR_DEBUG && console.debug('WEBREQV: VIDEO rejected '+details.requestId+' because MIME type was '+mimeType);
            return;
        }
    }

    //Start splitting based on different types
    let parsedUrl = new URL(details.url);
    if(parsedUrl.hostname.endsWith('.googlevideo.com')) {
        if(mimeType.startsWith('video/mp4')) {
            WJR_DEBUG && console.info(`WEBREQV/YTVMP4: Starting for request ${details.requestId}`);
            return await vidYtMp4Listener(details, mimeType, parsedUrl, threshold);
        } else if(mimeType.startsWith('video/webm')) {
            WJR_DEBUG && console.info(`WEBREQV/YTVWEBM: Starting for request ${details.requestId}`);
            return await vidYtWebmListener(details, mimeType, parsedUrl, threshold);
        } else {
            let cpn = parsedUrl.searchParams.get('cpn');
            let range = parsedUrl.searchParams.get('range');
            let itag = parsedUrl.searchParams.get('itag');
            WJR_DEBUG && console.log(`WEBREQV/YTV: Unsupported Youtube video for ${details.requestId} of type ${mimeType} (${cpn} ${range} ${itag})`);
            return;
        }
    //If range is valid and ONLY a partial request, then consider it to be DASH
    } else if (contentRange !== undefined && !(contentRange.start == 0 && contentRange.end == contentRange.size - 1)) {
        if(mimeType.startsWith('video/mp4')) {
            WJR_DEBUG && console.info(`WEBREQV/DASHVMP4: Starting for request ${details.requestId} range ${JSON.stringify(contentRange)} for url ${details.url}`);
            return await vidDashMp4Listener(details, mimeType, parsedUrl, contentRange, threshold);
        } else if(mimeType.startsWith('video/webm')) {
            console.warn(`WEBREQV/DASHVMP4: Unsupported DASH WEBM request ${details.requestId} for url ${details.url}`);
            return await vidDefaultListener(details, mimeType, parsedUrl, expectedContentLength, threshold);
        } else {
            console.warn(`WEBREQV/MLV: Request range for interesting MIME type ${mimeType}`);
            return await vidDefaultListener(details, mimeType, parsedUrl, expectedContentLength, threshold);
        }
    } else {
        WJR_DEBUG && console.info(`WEBREQV/MLV: Default video listener for url ${details.url}`);
        return await vidDefaultListener(details, mimeType, parsedUrl, expectedContentLength, threshold);
    }
}

async function vidDefaultListener(details, mimeType, parsedUrl, expectedContentLength, threshold) {
    WJR_DEBUG && console.log(`DEFV: Starting request ${details.requestId} of type ${mimeType}`);
    let filter = browser.webRequest.filterResponseData(details.requestId);

    let videoChainId = 'default-'+details.requestId;
    let allBuffers = [];
    
    let scanStart = 0.5; //seconds
    let scanStepIncreaseThreshold = 0.70; //If perf is worse than this, ratchet up the scanStep size
    let scanStepDecreaseThreshold = 0.35; //If perf is better than this, ratchet down the scanStep size
    let scanStepRatchet = 0.5; // ratchet up interval if perf is too low
    let scanStepMin = 1.0; // the minimum scanSetep, regardless of perf
    let scanStepMax = 4.0; // the maximum scanStep, regardless of perf
    //Short videos often times employ shock factors and don't get the usual spinup time
    //so we combat this by artificially setting the minimum even lower than usual
    let isShortVideo = (expectedContentLength > 0 && expectedContentLength < 500*1024*1024);
    let scanStep = isShortVideo ? 0.25 : scanStepMin; // scan every x seconds
    let scanMaxSteps = 20.0;
    let scanBlockBailCount = 3.0;
    let totalSize = 0;
    const fullPassScanBytes = 100*1024*1024;
    const fullPassScanDuration = 10*60;

    let totalScanCount = 0;
    let totalBlockCount = 0;
    let totalErrorCount = 0;
    
    let detectedType = mimeType;
    let status = 'pass_so_far'; //pass_so_far, scanning, pass, block, error
    let flushIndexStart, flushIndexEnd = 0; //end exclusive
    let flushScanStartTime = scanStart;
    let flushScanStartSize = 0;
    let scanAndTransitionPromise;

    statusStartVideoCheck(details.requestId);

    let pump = async function(newData, isComplete) {
        try
        {
            //Ensure this top section remains synchronous
            WJR_DEBUG && console.debug(`DEFV: Data for ${details.requestId} of size ${newData.byteLength}`);
            allBuffers.push(newData);
            totalSize += newData.byteLength;

            let shouldScan = isComplete || (totalSize - flushScanStartSize >= 500*1024);

            //Now transition to scanning and create a promise for next chunk of work
            if (status == 'pass' || status == 'error') {
                //This is really a warning condition because it shouldn't happen
                filter.write(newData);
            } else if(status == 'pass_so_far' && shouldScan) {
                //Begin synchronous only setup
                status = 'scanning';
                if(detectedType.startsWith('application/octet-stream')) {
                    let detectionArray = vidConcatBuffersToUint8Array(allBuffers);
                    detectedType = vidDetectType(detectionArray);
                    console.warn(`DEFV: MIME type was default ${mimeType} so tried to detect type and found ${detectedType}`);
                }
                flushIndexStart = flushIndexEnd;
                flushIndexEnd = allBuffers.length;
                flushScanStartSize = totalSize;
                let scanBuffers = allBuffers.slice(0, flushIndexEnd); //to load for scanning
                let flushBuffers = allBuffers.slice(flushIndexStart, flushIndexEnd); //to flush if pass

                WJR_DEBUG && console.info(`DEFV: Setting up scan for ${details.requestId} for buffers [${flushIndexStart}-${flushIndexEnd}) isComplete=${isComplete}`);
                let processor = bkGetNextProcessor();
                //End synchronous only setup

                //Setup async work as promise
                scanAndTransitionPromise = async ()=>{
                    WJR_DEBUG && console.info(`DEFV: Performing scan for ${details.requestId} for buffers [${flushIndexStart}-${flushIndexEnd})`);
                    let effectiveScanMaxSteps = vidGetQuickScanMaxSteps(scanMaxSteps, totalScanCount);
                    if(effectiveScanMaxSteps <= 0) {
                        status = 'pass';
                        let disconnectBuffers = allBuffers.slice(flushIndexStart);
                        disconnectBuffers.forEach(b=>filter.write(b));
                        filter.disconnect();
                        statusCompleteVideoCheck(details.requestId, status);
                        return;
                    }
                    let scanPerfStartTime = performance.now();
                    let scanResults = await vidPerformVideoScan(
                        processor,
                        videoChainId,
                        details.requestId,
                        detectedType,
                        details.url,
                        details.type,
                        scanBuffers,
                        threshold,
                        flushScanStartTime,
                        scanStep,
                        effectiveScanMaxSteps,
                        scanBlockBailCount
                    );
                    let scanPerfTotalTime = performance.now() - scanPerfStartTime;
                    WJR_DEBUG && console.log(`DEFV: Scan results ${details.requestId} timing ${scanPerfTotalTime}/${scanResults.scanCount}=${(scanPerfTotalTime/scanResults.scanCount).toFixed(1)} for buffers [${flushIndexStart}-${flushIndexEnd}) was ${scanResults.blockCount}/${scanResults.scanCount}, error? ${scanResults.error}`);
                    totalScanCount += scanResults.scanCount;
                    totalBlockCount += scanResults.blockCount;
                    let isQuickScanBlock = vidShouldQuickScanBlock(scanResults);
                    let isThisScanBlock = (scanResults.blockCount >= scanBlockBailCount
                        || (scanResults.scanCount >= 3 && scanResults.blockCount / scanResults.scanCount >= 0.66));
                    let isTotalScanBlock = (totalScanCount >= 8 && totalBlockCount / totalScanCount >= 0.5)
                             || (totalScanCount >= 20 && totalBlockCount / totalScanCount >= 0.15);
                    let shouldBlock = isQuickScanBlock || isThisScanBlock || isTotalScanBlock;
                    if(scanResults.error) {
                        console.warn(`DEFV: Scan error ${details.requestId} for buffers [${flushIndexStart}-${flushIndexEnd}): ${scanResults.error}`);
                        totalErrorCount++;
                    }
                    let shouldError = totalErrorCount >= 5;
                    let shouldQuickPass = (BK_videoScanMode === 'quick' && totalScanCount >= VID_QUICK_SCAN_MAX_FRAMES);

                    // Note that due the wonders of async, buffers may have data beyond
                    // what is in flushBuffers, so we need to flush everything so that
                    // for any condition where we disconnect we don't have any stragglers
                    // causing "holes"
                    if(shouldBlock) {
                        if(isQuickScanBlock) {
                            console.warn(`DEFV: Quick scan BLOCK ${details.requestId} due to ${scanResults.blockCount} blocked frames`);
                        }
                        console.warn(`DEFV: BLOCK ${details.requestId} for buffers [${flushIndexStart}-${flushIndexEnd}) with global stats ${totalBlockCount}/${totalScanCount}`);
                        status = 'block';

                        let placeholder = mimeType.startsWith('video/webm') ? VID_PLACEHOLDER_WEBM : VID_PLACEHOLDER_MP4;
                        
                        if(flushIndexStart == 0) {
                            filter.write(placeholder);
                        }
                        //Ideally you would close the filter here, BUT... some systems will keep retrying by picking up
                        //at the last location. So, we will be sneaky and if there are bytes left we will just stuff
                        //with random data.
                        if(expectedContentLength > 0) {
                            let remainingLength = expectedContentLength - placeholder.byteLength;
                            WJR_DEBUG && console.log(`DEFV: BLOCK ${details.requestId} stuffing ${remainingLength}`);
                            let stuffer = new Uint8Array(1024).fill(0);
                            while(remainingLength > stuffer.length) {
                                filter.write(stuffer);
                                remainingLength -= stuffer.length;
                            }
                            stuffer = new Uint8Array(remainingLength).fill(0);
                            filter.write(stuffer);
                        }
                        filter.close();
                        statusCompleteVideoCheck(details.requestId, status);
                    } else if(shouldError) {
                        console.warn(`DEFV: ERROR ${details.requestId} for buffers [${flushIndexStart}-${flushIndexEnd})`);
                        status = 'error';
                        let disconnectBuffers = allBuffers.slice(flushIndexStart);
                        disconnectBuffers.forEach(b=>filter.write(b));
                        filter.disconnect();
                        statusCompleteVideoCheck(details.requestId, status);
                    } else if(shouldQuickPass) {
                        WJR_DEBUG && console.log(`DEFV: Quick scan PASS ${details.requestId} for buffers [${flushIndexStart}-${flushIndexEnd})`);
                        status = 'pass';
                        let disconnectBuffers = allBuffers.slice(flushIndexStart);
                        disconnectBuffers.forEach(b=>filter.write(b));
                        filter.disconnect();
                        statusCompleteVideoCheck(details.requestId, status);
                    } else {
                        if(scanResults.frames.length > 0) {
                            let lastFrame = scanResults.frames[scanResults.frames.length-1];
                            flushScanStartTime = lastFrame.time + scanStep;
                        }
                        if(flushScanStartTime >= fullPassScanDuration || flushScanStartSize >= fullPassScanBytes) {
                            WJR_DEBUG && console.log(`DEFV: Full PASS ${details.requestId} for buffers [${flushIndexStart}-${flushIndexEnd})`);
                            status = 'pass';
                            let disconnectBuffers = allBuffers.slice(flushIndexStart);
                            disconnectBuffers.forEach(b=>filter.write(b));
                            filter.disconnect();
                            statusCompleteVideoCheck(details.requestId, status);
                        } else {
                            WJR_DEBUG && console.info(`DEFV: PASS so far ${details.requestId} for buffers [${flushIndexStart}-${flushIndexEnd})`);
                            status = 'pass_so_far';
                            flushBuffers.forEach(b=>filter.write(b));

                            //Check if perf was bad enough that we should ratchet.
                            if(scanResults.scanCount > 0) {
                                let timePerFrameSecs = (scanPerfTotalTime / scanResults.scanCount) / 1000.0; //super noisy
                                if(timePerFrameSecs > scanStepIncreaseThreshold*scanStep) {
                                    if(scanStep >= scanStepMax) {
                                        console.warn(`DEFV: RATCHET maxed ${details.requestId}: ${timePerFrameSecs}`);
                                    } else {
                                        scanStep += scanStepRatchet;
                                        console.warn(`DEFV: RATCHET increased ${details.requestId} to scanStep ${scanStep}: ${timePerFrameSecs} over ${scanResults.scanCount} frames`);
                                    }
                                } else if(timePerFrameSecs < scanStepDecreaseThreshold*scanStep) {
                                    if(scanStep <= scanStepMin) {
                                        WJR_DEBUG && console.info(`DEFV: RATCHET minned ${details.requestId}: ${timePerFrameSecs}`);
                                    } else {
                                        scanStep -= scanStepRatchet;
                                        console.warn(`DEFV: RATCHET decreased ${details.requestId} to scanStep ${scanStep}: ${timePerFrameSecs} over ${scanResults.scanCount} frames`);
                                    }
                                }
                            }
                        }
                    }
                }
                await scanAndTransitionPromise();
                statusIndicateVideoProgress(details.requestId);
            } else {
                WJR_DEBUG && console.debug(`DEFV: Skipping scan for ${details.requestId} isComplete=${isComplete}, totalSize=${totalSize}, buffers ${allBuffers.length}`);
            }
        } catch(e) {
            console.error(`DEFV: Error scanning for ${details.requestId} status ${status} for buffers [${flushIndexStart}-${flushIndexEnd}) isComplete=${isComplete}, totalSize=${totalSize}, buffers ${allBuffers.length}: ${e}`);
        } finally {
            if(isComplete) {
                WJR_DEBUG && console.log(`DEFV: Filter close for ${details.requestId} final status ${status}`);
                filter.close();
                statusCompleteVideoCheck(details.requestId, status);
            }
        }
    }
  
    filter.ondata = async event => {
        if(status == 'block') {
            return;
        }
        await pump(event.data, false);
    }

    filter.onerror = e => {
        try {
            filter.disconnect();
            statusCompleteVideoCheck(details.requestId, 'error');
        } catch(ex) {
            WJR_DEBUG && console.log('WEBREQ: Filter video error: '+ex);
        }
    }
  
    filter.onstop = async _ => {
        if(status == 'scanning') {
            await scanAndTransitionPromise();
            statusIndicateVideoProgress(details.requestId);
        }
        if(status == 'block') {
            return;
        }
        await pump(new Uint8Array(), true);
    }
    return details;
}

function vidCheckCreateDashGroup(url) {
    let dashGroup = VID_DASH_GROUPS[url];
    if(dashGroup === undefined) {
        dashGroup = {
            status: 'unknown',
            url: url,
            actions: [],
            fmp4: null,
            webm: null,
            scanCount: 0,
            blockCount: 0
        };
        VID_DASH_GROUPS[url] = dashGroup;
    }
    return dashGroup;
}

let VID_DASH_GROUPS = { };

function findSuspectDashGroups() {
    let suspectGroups = { }
    for(let [url, group] of Object.entries(VID_DASH_GROUPS)) {
        if(group.actions.length > 5) {
            if(group.actions[group.actions.length-2].range.start == group.actions[group.actions.length-1].range.start) {
                suspectGroups[url] = group;
            }
        }
    }
    return suspectGroups;
}

function stuffPlaceholderMp4(filter, expectedContentLength) {
    //Ideally you would close the filter here, BUT... some systems will keep retrying by picking up
    //at the last location. So, we will be sneaky and if there are bytes left we will just stuff
    //with random data. However, still others just keep trying anyways.
    if(expectedContentLength >= VID_PLACEHOLDER_MP4.byteLength) {
        filter.write(VID_PLACEHOLDER_MP4);
        let remainingLength = expectedContentLength - VID_PLACEHOLDER_MP4.byteLength;
        let stuffer = new Uint8Array(1024).fill(0);
        while(remainingLength > stuffer.length) {
            filter.write(stuffer);
            remainingLength -= stuffer.length;
        }
        stuffer = new Uint8Array(remainingLength).fill(0);
        filter.write(stuffer);
    } else {
        filter.write(VID_PLACEHOLDER_MP4.slice(0, expectedContentLength));
    }
}

async function vidDashMp4Listener(details, mimeType, parsedUrl, range, threshold) {
    let url = details.url;
    let videoChainId = `dash-mp4-${details.requestId}-bytes-${range.start}-${range.end}-url-${url}`;
    WJR_DEBUG && console.info('DASHVMP4: Starting request '+details.requestId+' '+range.start+'-'+range.end);

    let dashGroupPrecheck = VID_DASH_GROUPS[url];
    if (dashGroupPrecheck !== undefined) {
        if(dashGroupPrecheck.status == 'pass') {
            console.warn(`DASHVMP4: Already passed for request id ${details.requestId} range ${range.start}-${range.end} with original request ${dashGroupPrecheck.startRequestId} for URL ${url}`);
            dashGroupPrecheck.actions.push({ requestId: details.requestId, range: range, action: 'precheck-pass'});
            return details;
        }
    }

    let filter = browser.webRequest.filterResponseData(details.requestId);
    let expectedContentLength = range.end - range.start + 1; //Because end is inclusive

    let buffers = [];
  
    filter.onstart = _ => {
        let dashGroupPrecheck = VID_DASH_GROUPS[url];
        if (dashGroupPrecheck !== undefined) {
            if(dashGroupPrecheck.status == 'block') {
                stuffPlaceholderMp4(filter, expectedContentLength);
                filter.close();
                //Indicate we blocked it ... up to a point; we will keep it so memory growth is not unbounded on retries
                if(dashGroupPrecheck.actions.length < 200) {
                    dashGroupPrecheck.actions.push({ requestId: details.requestId, range: range, action: 'onstart-block'});
                }
            } else if(dashGroupPrecheck.status == 'pass') {
                console.warn(`DASHVMP4: Already passed for request id ${details.requestId} range ${range.start}-${range.end} with original request ${dashGroupPrecheck.startRequestId} for URL ${url}`);
                dashGroupPrecheck.actions.push({ requestId: details.requestId, range: range, action: 'precheck-pass'});
                return;
            }
        }
        statusStartVideoCheck(details.requestId);
    }

    filter.ondata = event => {
        WJR_DEBUG && console.debug('DASHVMP4: Data '+details.requestId+', '+range.start+'-'+range.end+' of size '+event.data.byteLength+' for '+url);
        buffers.push(event.data);
    }

    filter.onerror = e => {
        try {
            filter.disconnect();
            statusCompleteVideoCheck(details.requestId, 'error');
        } catch(ex) {
            console.error('DASHVMP4: Filter video error: '+e+', '+ex);
        }
    }
  
    filter.onstop = async _ => {
        try {
            // 1. Setup the FMP4 stream - tuck away the init segment and create the index
            let fragmentFileOffset = range.start;
            let checkFragmentsBuffer = null;
            
            if(range.start == 0) {
                WJR_DEBUG && console.debug(`DASHVMP4: New FMP4 for ${details.requestId} at${url}`);
                let dashGroup = vidCheckCreateDashGroup(url);
                dashGroup.startRequestId = details.requestId;

                let fullBuffer = vidConcatBuffersToUint8Array(buffers);
                let [initSegment, isAudioOnly] = mp4GetInitSegment(fullBuffer, url);
                let fmp4 = {
                    initSegment: initSegment,
                    videoChainId: videoChainId,
                    scanCount: 0,
                    blockCount: 0,
                    isAudioOnly: isAudioOnly
                };
                dashGroup.fmp4 = fmp4;
                if(!isAudioOnly) {
                    dashGroup.actions.push({ requestId: details.requestId, range: range, action: 'create'});
                    //Just pick up after the init segment and ignore the fact there may be a SIDX
                    checkFragmentsBuffer = fullBuffer.slice(initSegment.length);
                    fragmentFileOffset += initSegment.length;
                    WJR_DEBUG && console.info(`DASHVMP4: Completed creating new FMP4 for ${details.requestId}, check fragments remaining size ${checkFragmentsBuffer.length} for range ${range.start}-${range.end} init seg length ${initSegment.length}, url ${url}`);
                } else {
                    dashGroup.actions.push({ requestId: details.requestId, range: range, action: 'create-audio-only'});
                    dashGroup.status = 'pass';
                    buffers.forEach(b=>filter.write(b));
                    filter.close();
                    statusCompleteVideoCheck(details.requestId, 'pass');
                    WJR_DEBUG && console.log(`DASHVMP4/MLV: Considering total pass for ${details.requestId} because it is audio-only for url ${url}`);
                    return;
                }
            } else {
                WJR_DEBUG && console.info(`DASHVMP4: Will look for existing FMP4 for ${details.requestId}, range start ${range.start}`);
                checkFragmentsBuffer = vidConcatBuffersToUint8Array(buffers);
            }

            // 2. Append any (moof mdat)+
            let dashGroup = VID_DASH_GROUPS[url];
            if(dashGroup === undefined) {
                console.warn(`DASHVMP4: No DASH group found for  ${details.requestId} at range start ${range.start} for url ${url}`);
                buffers.forEach(b=>filter.write(b));
                filter.close();
                statusCompleteVideoCheck(details.requestId, 'pass');
                return;
            }
            if(dashGroup.status == 'pass') {
                WJR_DEBUG && console.info(`DASHVMP4: DASH group already passed for URL for ${details.requestId} at range start ${range.start} for url ${url}`);
                buffers.forEach(b=>filter.write(b));
                filter.close();
                statusCompleteVideoCheck(details.requestId, 'pass');
                dashGroup.actions.push({ requestId: details.requestId, range: range, action: 'already-passed'});
                return;
            }
            WJR_DEBUG && console.info(`DASHVMP4: Matching fragments for ${details.requestId} at range start ${range.start}`);
            if(dashGroup.fmp4 === null) {
                console.warn(`DASHVMP4: No fMP4 match for ${details.requestId} at range start ${range.start} for url ${url}`);
                buffers.forEach(b=>filter.write(b));
                filter.close();
                statusCompleteVideoCheck(details.requestId, 'pass');
                dashGroup.actions.push({ requestId: details.requestId, range: range, action: 'no-fmp4'});
                return;
            }

            WJR_DEBUG && console.info(`DASHVMP4: Extract fragments for ${details.requestId} at range start ${range.start}`);
            let fragments = mp4ExtractFragments(checkFragmentsBuffer, fragmentFileOffset, true, videoChainId);
            if(fragments.length == 0) {
                console.warn(`DASHVMP4: No fragments for ${details.requestId} at range start ${range.start}, continuing...`);
                buffers.forEach(b=>filter.write(b));
                filter.close();
                statusCompleteVideoCheck(details.requestId, 'pass');
                dashGroup.actions.push({ requestId: details.requestId, range: range, action: 'no-fragments'});
                return;
            }
            WJR_DEBUG && console.info(`DASHVMP4: Extracted ${fragments.length} fragments for ${details.requestId} at range start ${range.start}`);

            let fmp4 = dashGroup.fmp4;

            // 3. Setup scanning
            WJR_DEBUG && console.debug(`DASHVMP4: Setting up scan buffers for ${details.requestId} at range start ${range.start}`);
            //Build up init ftyp moov (moof mdat)+   with possibly incomplete mdat
            let scanBuffers = [ vidToArrayBuffer(fmp4.initSegment) ];
            fragments.forEach(f=>scanBuffers.push(vidToArrayBuffer(f.moofMdatData)));

            let scanStart = 0.5; //seconds
            let scanStep = 1.0;
            //Increase scan steps if we used the MDAT fallback
            let maxScanGroupSteps = 15.0;
            let scanMaxSteps = fragments[0].wasMdatFallback ? maxScanGroupSteps : 10.0;
            let scanBlockBailCount = 4.0;
            let effectiveScanMaxSteps = vidGetQuickScanMaxSteps(scanMaxSteps, dashGroup.scanCount);

            WJR_DEBUG && console.debug(`DASHVMP4: Scanning for ${details.requestId} at range start ${range.start}`);
            let processor = bkGetNextProcessor();
            if(effectiveScanMaxSteps <= 0) {
                status = 'pass';
                dashGroup.status = 'pass';
                dashGroup.actions.push({ requestId: details.requestId, range: range, action: 'pass-quick'});
                buffers.forEach(b=>filter.write(b));
                filter.disconnect();
                statusCompleteVideoCheck(details.requestId, status);
                return;
            }
            let scanResults = await vidPerformVideoScan(
                processor,
                videoChainId,
                details.requestId,
                mimeType,
                details.url,
                details.type,
                scanBuffers,
                threshold,
                scanStart,
                scanStep,
                effectiveScanMaxSteps,
                scanBlockBailCount
            );
            WJR_DEBUG && console.info(`DASHVMP4: Scan complete ${scanResults.blockCount}/${scanResults.scanCount}  for ${details.requestId} at range start ${range.start} for url ${url}`);
            statusIndicateVideoProgress(details.requestId);
            fmp4.scanCount += scanResults.scanCount;
            fmp4.blockCount += scanResults.blockCount;
            dashGroup.scanCount += scanResults.scanCount;
            dashGroup.blockCount += scanResults.blockCount;
            let isQuickScanBlock = vidShouldQuickScanBlock(scanResults);
            let isThisScanBlock = (scanResults.blockCount >= scanBlockBailCount
                                    || (scanResults.scanCount >= 3 && scanResults.blockCount / scanResults.scanCount >= 0.66));
            let isThisStreamBlock = (fmp4.scanCount >= 20 && fmp4.blockCount / fmp4.scanCount >= 0.15);
            let isThisGroupBlock = (dashGroup.scanCount >= 20 && dashGroup.blockCount / dashGroup.scanCount >= 0.15);
            WJR_DEBUG && console.log(`DASHVMP4/MLV: Scan status for ${details.requestId}: ${scanResults.blockCount}/${scanResults.scanCount} < ${fmp4.blockCount}/${fmp4.scanCount} < ${dashGroup.blockCount}/${dashGroup.scanCount} for url ${url}`);
            if(isQuickScanBlock || isThisScanBlock || isThisStreamBlock || isThisGroupBlock) {
                if(isQuickScanBlock) {
                    console.warn(`DASHVMP4/MLV: Quick scan BLOCK ${details.requestId} due to ${scanResults.blockCount} blocked frames for url ${url}`);
                }
                console.warn(`DASHVMP4/MLV: Considering total block for ${details.requestId}: ${scanResults.blockCount}/${scanResults.scanCount} < ${fmp4.blockCount}/${fmp4.scanCount} < ${dashGroup.blockCount}/${dashGroup.scanCount} for url ${url}`);
                status = 'block';
                dashGroup.status = 'block';
                stuffPlaceholderMp4(filter, expectedContentLength);
                filter.close();
                dashGroup.actions.push({ requestId: details.requestId, range: range, action: 'block'});
            } else {
                status = 'pass';
                if(dashGroup.scanCount >= maxScanGroupSteps) {
                    WJR_DEBUG && console.log(`DASHVMP4/MLV: Considering total pass for ${details.requestId}: ${scanResults.blockCount}/${scanResults.scanCount} < ${fmp4.blockCount}/${fmp4.scanCount} < ${dashGroup.blockCount}/${dashGroup.scanCount} for url ${url}`);
                    dashGroup.status = 'pass';
                    dashGroup.actions.push({ requestId: details.requestId, range: range, action: 'pass-total'});
                } else {
                    dashGroup.actions.push({ requestId: details.requestId, range: range, action: 'pass-so-far'});
                }
                buffers.forEach(b=>filter.write(b));
                filter.disconnect();
            }
            statusCompleteVideoCheck(details.requestId, status);
        } catch(e) {
            console.error(`DASHVMP4: Error for ${details.requestId} ${e} ${e.stack}`);
            buffers.forEach(b=>filter.write(b));
            filter.close();
            statusCompleteVideoCheck(details.requestId, 'error');
            let dashGroup = VID_DASH_GROUPS[url];
            if(dashGroup !== undefined) {
                dashGroup.actions.push({ requestId: details.requestId, range: range, action: 'error', exception: e});
            }
        }
    }
    return details;
}



function vidCheckCreateYtGroup(cpn) {
    let youtubeGroup = VID_YT_GROUPS[cpn];
    if(youtubeGroup === undefined) {
        youtubeGroup = {
            status: 'unknown',
            cpn: cpn,
            fmp4s: [],
            webms: [],
            scanCount: 0,
            blockCount: 0
        };
        VID_YT_GROUPS[cpn] = youtubeGroup;
    }
    return youtubeGroup;
}

let VID_YT_GROUPS = { };

//Youtube MP4 stream listener.
//Note this expects that each fragment is relatively small
async function vidYtMp4Listener(details, mimeType, parsedUrl, threshold) {

    let cpn = parsedUrl.searchParams.get('cpn');
    let videoChainId = 'yt-mp4-'+cpn+'-'+details.requestId;
    let rangeRaw = parsedUrl.searchParams.get('range');
    if(rangeRaw === undefined || rangeRaw === null) {
        console.warn(`YTFMP4: For request ${details.requestId} ${cpn}, failed to get the range, aborting. URL: ${details.url}`);
        return details;
    }
    WJR_DEBUG && console.info('YTVMP4: Starting request '+details.requestId+' '+cpn+', '+rangeRaw);
    let splitIndex = rangeRaw.indexOf('-'); //e.g. range=0-3200
    let rangeStart = parseInt(rangeRaw.substr(0, splitIndex));
    let rangeEnd = parseInt(rangeRaw.substr(splitIndex+1));
    let itag = parsedUrl.searchParams.get('itag');

    let filter = browser.webRequest.filterResponseData(details.requestId);

    let buffers = [];
  
    //This is a safety net, already happens in a pre-check mostly
    filter.onstart = _ => {
        let youtubeGroupPrecheck = VID_YT_GROUPS[cpn];
        if (youtubeGroupPrecheck !== undefined) {
            if(youtubeGroupPrecheck.status == 'block') {
                filter.close();
            }
        }
        statusStartVideoCheck(details.requestId);
    }

    filter.ondata = event => {
        WJR_DEBUG && console.debug('YTVMP4: Data '+details.requestId+' '+cpn+', '+rangeRaw+' of size '+event.data.byteLength);
        buffers.push(event.data);
    }

    filter.onerror = e => {
        try {
            filter.disconnect();
            statusCompleteVideoCheck(details.requestId, 'error');
        } catch(ex) {
            console.error('YTVMP4: Filter video error: '+e+', '+ex);
        }
    }
  
    filter.onstop = async _ => {
        try {
            // 1. Setup the FMP4 stream - tuck away the init segment and create the index
            let fmp4;
            let checkFragmentsBuffer;
            let fragmentFileOffset = rangeStart;
            
            if(rangeStart == 0) {
                WJR_DEBUG && console.debug(`YTVMP4: New FMP4 ${cpn} for ${details.requestId} at quality ${itag}`);
                let youtubeGroup = vidCheckCreateYtGroup(cpn);

                let fullBuffer = vidConcatBuffersToUint8Array(buffers);
                fmp4 = mp4CreateFragmentedMp4(fullBuffer);
                fmp4.videoChainId = videoChainId;
                fmp4.scanCount = 0;
                fmp4.blockCount = 0;
                youtubeGroup.fmp4s.push(fmp4);
                checkFragmentsBuffer = fullBuffer.slice(fmp4.dataStartIndex);
                fragmentFileOffset += fmp4.dataStartIndex;
                WJR_DEBUG && console.info(`YTVMP4: Completed creating new FMP4 ${cpn} for ${details.requestId} at quality ${itag}, index count ${fmp4.sidx.entries.length}`);
            } else {
                WJR_DEBUG && console.info(`YTVMP4: Will look for existing FMP4 ${cpn} for ${details.requestId} at quality ${itag}, range start ${rangeStart}`);
                checkFragmentsBuffer = vidConcatBuffersToUint8Array(buffers);
            }

            // 2. Append any (moof mdat)+
            WJR_DEBUG && console.info(`YTVMP4: Extract fragments for CPN ${cpn} for ${details.requestId} at quality ${itag} at range start ${rangeStart}`);
            let fragments = mp4ExtractFragments(checkFragmentsBuffer, fragmentFileOffset);
            if(fragments.length == 0) {
                console.warn(`YTVMP4: No fragments for CPN ${cpn} for ${details.requestId} at quality ${itag} at range start ${rangeStart}, continuing...`);
                buffers.forEach(b=>filter.write(b));
                filter.close();
                statusCompleteVideoCheck(details.requestId, 'pass');
                return;
            }
            WJR_DEBUG && console.info(`YTVMP4: Extracted ${fragments.length} fragments for CPN ${cpn} for ${details.requestId} at quality ${itag} at range start ${rangeStart}`);

            let youtubeGroup = VID_YT_GROUPS[cpn];
            if(youtubeGroup === undefined) {
                console.warn(`YTVMP4: No Youtube group found for  ${cpn} for ${details.requestId} at quality ${itag} at range start ${rangeStart}`);
                buffers.forEach(b=>filter.write(b));
                filter.close();
                statusCompleteVideoCheck(details.requestId, 'pass');
                return;
            }
            WJR_DEBUG && console.info(`YTVMP4: Matching fragments  ${cpn} for ${details.requestId} at quality ${itag} at range start ${rangeStart}`);
            for(let stream of youtubeGroup.fmp4s) {
                if(stream.doFragmentsMatch(fragments)) {
                    WJR_DEBUG && console.info(`YTVMP4: Found existing fMP4 match  ${cpn} for ${details.requestId} at quality ${itag} at range start ${rangeStart}`);
                    fmp4 = stream;
                    break;
                }
            }
            if(fmp4 === undefined) {
                console.warn(`YTVMP4: No fMP4 match  ${cpn} for ${details.requestId} at quality ${itag} at range start ${rangeStart}`);
                buffers.forEach(b=>filter.write(b));
                filter.close();
                statusCompleteVideoCheck(details.requestId, 'pass');
                return;
            }

            let scanMaxSteps = 10.0;
            let effectiveScanMaxSteps = vidGetQuickScanMaxSteps(scanMaxSteps, youtubeGroup.scanCount);
            if(effectiveScanMaxSteps <= 0) {
                status = 'pass';
                buffers.forEach(b=>filter.write(b));
                filter.disconnect();
                fmp4.markFragments(fragments, status);
                statusCompleteVideoCheck(details.requestId, status);
                return;
            }

            // 3. Setup scanning
            WJR_DEBUG && console.debug(`YTVMP4: Setting up scan buffers for ${cpn} for ${details.requestId} at quality ${itag} at range start ${rangeStart}`);
            //Build up init ftyp moov (moof mdat)+   with possibly incomplete mdat
            let scanBuffers = [ vidToArrayBuffer(fmp4.initSegment) ];
            fragments.forEach(f=>scanBuffers.push(vidToArrayBuffer(f.moofMdatData)));

            let scanStart = 0.5; //seconds
            let scanStep = 1.0;
            let scanBlockBailCount = 4.0;

            WJR_DEBUG && console.debug(`YTVMP4: Scanning  ${cpn} for ${details.requestId} at quality ${itag} at range start ${rangeStart}`);
            let processor = bkGetNextProcessor();
            let scanResults = await vidPerformVideoScan(
                processor,
                videoChainId,
                details.requestId,
                mimeType,
                details.url,
                details.type,
                scanBuffers,
                threshold,
                scanStart,
                scanStep,
                effectiveScanMaxSteps,
                scanBlockBailCount
            );
            WJR_DEBUG && console.info(`YTVMP4: Scan complete ${scanResults.blockCount}/${scanResults.scanCount}  ${cpn} for ${details.requestId} at quality ${itag} at range start ${rangeStart}`);
            statusIndicateVideoProgress(details.requestId);
            fmp4.scanCount += scanResults.scanCount;
            fmp4.blockCount += scanResults.blockCount;
            youtubeGroup.scanCount += scanResults.scanCount;
            youtubeGroup.blockCount += scanResults.blockCount;
            let isQuickScanBlock = vidShouldQuickScanBlock(scanResults);
            let isThisScanBlock = (scanResults.blockCount >= scanBlockBailCount
                                    || (scanResults.scanCount >= 3 && scanResults.blockCount / scanResults.scanCount >= 0.66));
            let isThisStreamBlock = (fmp4.scanCount >= 20 && fmp4.blockCount / fmp4.scanCount >= 0.15);
            let isThisGroupBlock = (youtubeGroup.scanCount >= 20 && youtubeGroup.blockCount / youtubeGroup.scanCount >= 0.15);
            WJR_DEBUG && console.log(`YTVMP4/MLV: Scan status for CPN ${cpn}, ${details.requestId}: ${scanResults.blockCount}/${scanResults.scanCount} < ${fmp4.blockCount}/${fmp4.scanCount} < ${youtubeGroup.blockCount}/${youtubeGroup.scanCount}`);
            if(isQuickScanBlock || isThisScanBlock || isThisStreamBlock || isThisGroupBlock) {
                if(isQuickScanBlock) {
                    console.warn(`YTVMP4/MLV: Quick scan BLOCK ${details.requestId} due to ${scanResults.blockCount} blocked frames (CPN ${cpn})`);
                }
                status = 'block';
                youtubeGroup.status = 'block';
                filter.write(VID_PLACEHOLDER_MP4);
                filter.close();
            } else {
                status = 'pass';
                buffers.forEach(b=>filter.write(b));
                filter.disconnect();
            }
            fmp4.markFragments(fragments, status);
            statusCompleteVideoCheck(details.requestId, status);
        } catch(e) {
            console.error(`YTVMP4: Error for ${details.requestId} ${e}`);
            buffers.forEach(b=>filter.write(b));
            filter.close();
            statusCompleteVideoCheck(details.requestId, 'error');
        }
    }
    return details;
}

//Youtube WebM stream listener.
//Note this expects that each fragment is relatively small
async function vidYtWebmListener(details, mimeType, parsedUrl, threshold) {

    let cpn = parsedUrl.searchParams.get('cpn');
    let videoChainId = 'yt-webm-'+cpn+'-'+details.requestId;
    let rangeRaw = parsedUrl.searchParams.get('range');
    WJR_DEBUG && console.info('YTVWEBM: Starting request '+details.requestId+' '+cpn+', '+rangeRaw);
    let splitIndex = rangeRaw.indexOf('-'); //e.g. range=0-3200
    let rangeStart = parseInt(rangeRaw.substr(0, splitIndex));
    let rangeEnd = parseInt(rangeRaw.substr(splitIndex+1));
    let itag = parsedUrl.searchParams.get('itag');

    let filter = browser.webRequest.filterResponseData(details.requestId);

    let buffers = [];
  
    //This is a safety net, already happens in a pre-check mostly
    filter.onstart = _ => {
        let youtubeGroupPrecheck = VID_YT_GROUPS[cpn];
        if (youtubeGroupPrecheck !== undefined) {
            if(youtubeGroupPrecheck.status == 'block') {
                filter.close();
            }
        }
        statusStartVideoCheck(details.requestId);
    }

    filter.ondata = event => {
        WJR_DEBUG && console.debug('YTVWEBM: Data '+details.requestId+' '+cpn+', '+rangeRaw+' of size '+event.data.byteLength);
        buffers.push(event.data);
    }

    filter.onerror = e => {
        try {
            filter.disconnect();
            statusCompleteVideoCheck(details.requestId, 'error');
        } catch(ex) {
            WJR_DEBUG && console.log('YTVWEBM: Filter video error: '+e+', '+ex);
        }
    }
  
    filter.onstop = async _ => {
        try {
            // 1. Setup the WebM stream - tuck away the init segment and create the index
            let webm;
            let checkFragmentsBuffer;
            let fragmentFileOffset = rangeStart;
            
            if(rangeStart == 0) {
                WJR_DEBUG && console.debug(`YTVWEBM: New WebM ${cpn} for ${details.requestId} at quality ${itag}`);
                let youtubeGroup = vidCheckCreateYtGroup(cpn);

                let fullBuffer = vidConcatBuffersToUint8Array(buffers);
                webm = ebmlCreateFragmentedWebM(fullBuffer);
                webm.videoChainId = videoChainId;
                webm.scanCount = 0;
                webm.blockCount = 0;
                youtubeGroup.webms.push(webm);
                checkFragmentsBuffer = fullBuffer.slice(webm.clusterStartIndex);
                fragmentFileOffset += webm.clusterStartIndex;
                WJR_DEBUG && console.info(`YTVWEBM: Completed creating new WebM ${cpn} for ${details.requestId} at quality ${itag}`);
            } else {
                WJR_DEBUG && console.info(`YTVWEBM: Will look for existing WebM ${cpn} for ${details.requestId} at quality ${itag}, range start ${rangeStart}`);
                checkFragmentsBuffer = vidConcatBuffersToUint8Array(buffers);
            }

            // 2. Append any Cluster
            WJR_DEBUG && console.debug(`YTVWEBM: Extract fragments for CPN ${cpn} for ${details.requestId} at quality ${itag} at range start ${rangeStart}`);
            let fragments = ebmlExtractFragments(checkFragmentsBuffer, fragmentFileOffset);
            if(fragments.length == 0) {
                console.warn(`YTVWEBM: No fragments for CPN ${cpn} for ${details.requestId} at quality ${itag} at range start ${rangeStart}, continuing...`);
                buffers.forEach(b=>filter.write(b));
                filter.close();
                statusCompleteVideoCheck(details.requestId, 'pass');
                return;
            }
            WJR_DEBUG && console.info(`YTVWEBM: Extracted ${fragments.length} fragments for CPN ${cpn} for ${details.requestId} at quality ${itag} at range start ${rangeStart}`);

            let youtubeGroup = VID_YT_GROUPS[cpn];
            if(youtubeGroup === undefined) {
                console.warn(`YTVWEBM: No Youtube group found for  ${cpn} for ${details.requestId} at quality ${itag} at range start ${rangeStart}`);
                buffers.forEach(b=>filter.write(b));
                filter.close();
                statusCompleteVideoCheck(details.requestId, 'pass');
                return;
            }
            WJR_DEBUG && console.info(`YTVWEBM: Matching fragments  ${cpn} for ${details.requestId} at quality ${itag} at range start ${rangeStart}`);
            for(let stream of youtubeGroup.webms) {
                if(stream.doFragmentsMatch(fragments)) {
                    WJR_DEBUG && console.info(`YTVWEBM: Found existing WebM match  ${cpn} for ${details.requestId} at quality ${itag} at range start ${rangeStart}`);
                    webm = stream;
                    break;
                }
            }
            if(webm === undefined) {
                console.warn(`YTVWEBM: No WebM match  ${cpn} for ${details.requestId} at quality ${itag} at range start ${rangeStart}`);
                buffers.forEach(b=>filter.write(b));
                filter.close();
                statusCompleteVideoCheck(details.requestId, 'pass');
                return;
            }

            let scanMaxSteps = 10.0;
            let effectiveScanMaxSteps = vidGetQuickScanMaxSteps(scanMaxSteps, youtubeGroup.scanCount);
            if(effectiveScanMaxSteps <= 0) {
                status = 'pass';
                buffers.forEach(b=>filter.write(b));
                filter.disconnect();
                webm.markFragments(fragments, status);
                statusCompleteVideoCheck(details.requestId, status);
                return;
            }

            // 3. Setup scanning
            WJR_DEBUG && console.debug(`YTVWEBM: Setting up scan buffers for ${cpn} for ${details.requestId} at quality ${itag} at range start ${rangeStart}`);
            //Build up init ftyp moov (moof mdat)+   with possibly incomplete mdat
            let scanBuffers = [ vidToArrayBuffer(webm.initSegment) ];
            fragments.forEach(f=>scanBuffers.push(vidToArrayBuffer(f.clusterData)));

            let scanStart = 0.5; //seconds
            let scanStep = 1.0;
            let scanBlockBailCount = 4.0;

            WJR_DEBUG && console.debug(`YTVWEBM: Scanning  ${cpn} for ${details.requestId} at quality ${itag} at range start ${rangeStart}`);
            let processor = bkGetNextProcessor();
            let scanResults = await vidPerformVideoScan(
                processor,
                videoChainId,
                details.requestId,
                mimeType,
                details.url,
                details.type,
                scanBuffers,
                threshold,
                scanStart,
                scanStep,
                effectiveScanMaxSteps,
                scanBlockBailCount
            );
            WJR_DEBUG && console.debug(`YTVWEBM: Scan complete ${scanResults.blockCount}/${scanResults.scanCount}  ${cpn} for ${details.requestId} at quality ${itag} at range start ${rangeStart}`);
            statusIndicateVideoProgress(details.requestId);
            webm.scanCount += scanResults.scanCount;
            webm.blockCount += scanResults.blockCount;
            youtubeGroup.scanCount += scanResults.scanCount;
            youtubeGroup.blockCount += scanResults.blockCount;
            let isQuickScanBlock = vidShouldQuickScanBlock(scanResults);
            let isThisScanBlock = (scanResults.blockCount >= scanBlockBailCount
                                    || (scanResults.scanCount >= 3 && scanResults.blockCount / scanResults.scanCount >= 0.66));
            let isThisStreamBlock = (webm.scanCount >= 20 && webm.blockCount / webm.scanCount >= 0.15);
            let isThisGroupBlock = (youtubeGroup.scanCount >= 20 && youtubeGroup.blockCount / youtubeGroup.scanCount >= 0.15);
            WJR_DEBUG && console.log(`YTVWEBM/MLV: Scan status for CPN ${cpn}, ${details.requestId}: ${scanResults.blockCount}/${scanResults.scanCount} < ${webm.blockCount}/${webm.scanCount} < ${youtubeGroup.blockCount}/${youtubeGroup.scanCount}`);
            if(isQuickScanBlock || isThisScanBlock || isThisStreamBlock || isThisGroupBlock) {
                if(isQuickScanBlock) {
                    console.warn(`YTVWEBM/MLV: Quick scan BLOCK ${details.requestId} due to ${scanResults.blockCount} blocked frames (CPN ${cpn})`);
                }
                status = 'block';
                youtubeGroup.status = 'block';
                filter.write(VID_PLACEHOLDER_WEBM);
                filter.close();
            } else {
                status = 'pass';
                buffers.forEach(b=>filter.write(b));
                filter.disconnect();
            }
            webm.markFragments(fragments, status);
            statusCompleteVideoCheck(details.requestId, status);
        } catch(e) {
            console.error(`YTVWEBM: Error for ${details.requestId} ${e}`);
            buffers.forEach(b=>filter.write(b));
            filter.close();
            statusCompleteVideoCheck(details.requestId, 'error');
        }
    }
    return details;
}
