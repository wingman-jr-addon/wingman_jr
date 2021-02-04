let VID_PLACEHOLDER_MP4 = null;
let VID_PLACEHOLDER_WEBM = null;
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

    console.debug('WEBREQV: VIDEO mime type check for '+details.requestId+' '+mimeType+': '+length+', webrequest type '+details.type+', expected content-length '+expectedContentLength+' originUrl '+details.originUrl+' documentUrl '+ details.documentUrl +' url '+details.url);
    let isVideo =  mimeType.startsWith('video/');
    if(!isVideo) {
        let isImage = mimeType.startsWith('image/');
        if(isImage) {
            console.log('WEBREQV: Video received an image: '+details.requestId+' '+mimeType);
            return bkImageListener(details);
        } else {
            console.debug('WEBREQV: VIDEO rejected '+details.requestId+' because MIME type was '+mimeType);
            return;
        }
    }

    //Start splitting based on different types
    let parsedUrl = new URL(details.url);
    if(parsedUrl.hostname.endsWith('.googlevideo.com')) {
        if(mimeType.startsWith('video/mp4')) {
            console.info(`YTVMP4: Starting for request ${details.requestId}`);
            return await vidYtMp4Listener(details, mimeType, parsedUrl);
        } else if(mimeType.startsWith('video/webm')) {
            console.info(`YTVWEBM: Starting for request ${details.requestId}`);
            return await vidYtWebmListener(details, mimeType, parsedUrl);
        } else {
            let cpn = parsedUrl.searchParams.get('cpn');
            let range = parsedUrl.searchParams.get('range');
            let itag = parsedUrl.searchParams.get('itag');
            console.log(`YTV: Unsupported Youtube video for ${details.requestId} of type ${mimeType} (${cpn} ${range} ${itag})`);
            return;
        }
    } else {
        return await vidDefaultListener(details, mimeType, parsedUrl, expectedContentLength);
    }
}

async function vidDefaultListener(details, mimeType, parsedUrl, expectedContentLength) {
    console.log(`DEFV: Starting request ${details.requestId} of type ${mimeType}`);
    let filter = browser.webRequest.filterResponseData(details.requestId);

    let videoChainId = 'default-'+details.requestId;
    let allBuffers = [];
    
    let scanStart = 0.5; //seconds
    let scanStepIncreaseThreshold = 0.70; //If perf is worse than this, ratchet up the scanStep size
    let scanStepDecreaseThreshold = 0.35; //If perf is better than this, ratchet down the scanStep size
    let scanStepRatchet = 0.5; // ratchet up interval if perf is too low
    let scanStepMin = 1.0; // the minimum scanSetep, regardless of perf
    let scanStepMax = 4.0; // the maximum scanStep, regardless of perf
    let scanStep = scanStepMin; // scan every x seconds
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
            console.debug(`DEFV: Data for ${details.requestId} of size ${newData.byteLength}`);
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

                console.info(`DEFV: Setting up scan for ${details.requestId} for buffers [${flushIndexStart}-${flushIndexEnd}) isComplete=${isComplete}`);
                let processor = bkGetNextProcessor();
                //End synchronous only setup

                //Setup async work as promise
                scanAndTransitionPromise = async ()=>{
                    console.info(`DEFV: Performing scan for ${details.requestId} for buffers [${flushIndexStart}-${flushIndexEnd})`);
                    let scanPerfStartTime = performance.now();
                    let scanResults = await vidPerformVideoScan(
                        processor,
                        videoChainId,
                        details.requestId,
                        detectedType,
                        details.url,
                        details.type,
                        scanBuffers,
                        flushScanStartTime,
                        scanStep,
                        scanMaxSteps,
                        scanBlockBailCount
                    );
                    let scanPerfTotalTime = performance.now() - scanPerfStartTime;
                    console.log(`DEFV: Scan results ${details.requestId} timing ${scanPerfTotalTime}/${scanResults.scanCount}=${(scanPerfTotalTime/scanResults.scanCount).toFixed(1)} for buffers [${flushIndexStart}-${flushIndexEnd}) was ${scanResults.blockCount}/${scanResults.scanCount}, error? ${scanResults.error}`);
                    totalScanCount += scanResults.scanCount;
                    totalBlockCount += scanResults.blockCount;
                    let isThisScanBlock = (scanResults.blockCount >= scanBlockBailCount
                        || (scanResults.scanCount >= 3 && scanResults.blockCount / scanResults.scanCount >= 0.66));
                    let isTotalScanBlock = (totalScanCount >= 8 && totalBlockCount / totalScanCount >= 0.5)
                             || (totalScanCount >= 20 && totalBlockCount / totalScanCount >= 0.15);
                    let shouldBlock = isThisScanBlock || isTotalScanBlock;
                    if(scanResults.error) {
                        console.warn(`DEFV: Scan error ${details.requestId} for buffers [${flushIndexStart}-${flushIndexEnd}): ${scanResults.error}`);
                        totalErrorCount++;
                    }
                    let shouldError = totalErrorCount >= 5;

                    // Note that due the wonders of async, buffers may have data beyond
                    // what is in flushBuffers, so we need to flush everything so that
                    // for any condition where we disconnect we don't have any stragglers
                    // causing "holes"
                    if(shouldBlock) {
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
                            console.log(`DEFV: BLOCK ${details.requestId} stuffing ${remainingLength}`);
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
                    } else {
                        if(scanResults.frames.length > 0) {
                            let lastFrame = scanResults.frames[scanResults.frames.length-1];
                            flushScanStartTime = lastFrame.time + scanStep;
                        }
                        if(flushScanStartTime >= fullPassScanDuration || flushScanStartSize >= fullPassScanBytes) {
                            console.log(`DEFV: Full PASS ${details.requestId} for buffers [${flushIndexStart}-${flushIndexEnd})`);
                            status = 'pass';
                            let disconnectBuffers = allBuffers.slice(flushIndexStart);
                            disconnectBuffers.forEach(b=>filter.write(b));
                            filter.disconnect();
                            statusCompleteVideoCheck(details.requestId, status);
                        } else {
                            console.info(`DEFV: PASS so far ${details.requestId} for buffers [${flushIndexStart}-${flushIndexEnd})`);
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
                                        console.info(`DEFV: RATCHET minned ${details.requestId}: ${timePerFrameSecs}`);
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
                console.debug(`DEFV: Skipping scan for ${details.requestId} isComplete=${isComplete}, totalSize=${totalSize}, buffers ${allBuffers.length}`);
            }
        } catch(e) {
            console.error(`DEFV: Error scanning for ${details.requestId} status ${status} for buffers [${flushIndexStart}-${flushIndexEnd}) isComplete=${isComplete}, totalSize=${totalSize}, buffers ${allBuffers.length}: ${e}`);
        } finally {
            if(isComplete) {
                console.log(`DEFV: Filter close for ${details.requestId} final status ${status}`);
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
            console.log('WEBREQ: Filter video error: '+ex);
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
async function vidYtMp4Listener(details, mimeType, parsedUrl) {

    let cpn = parsedUrl.searchParams.get('cpn');
    let videoChainId = 'yt-mp4-'+cpn+'-'+details.requestId;
    let rangeRaw = parsedUrl.searchParams.get('range');
    console.info('YTVMP4: Starting request '+details.requestId+' '+cpn+', '+rangeRaw);
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
        console.debug('YTVMP4: Data '+details.requestId+' '+cpn+', '+rangeRaw+' of size '+event.data.byteLength);
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
                console.debug(`YTVMP4: New FMP4 ${cpn} for ${details.requestId} at quality ${itag}`);
                let youtubeGroup = vidCheckCreateYtGroup(cpn);

                let fullBuffer = vidConcatBuffersToUint8Array(buffers);
                fmp4 = mp4CreateFragmentedMp4(fullBuffer);
                fmp4.videoChainId = videoChainId;
                fmp4.scanCount = 0;
                fmp4.blockCount = 0;
                youtubeGroup.fmp4s.push(fmp4);
                checkFragmentsBuffer = fullBuffer.slice(fmp4.dataStartIndex);
                fragmentFileOffset += fmp4.dataStartIndex;
                console.info(`YTVMP4: Completed creating new FMP4 ${cpn} for ${details.requestId} at quality ${itag}, index count ${fmp4.sidx.entries.length}`);
            } else {
                console.info(`YTVMP4: Will look for existing FMP4 ${cpn} for ${details.requestId} at quality ${itag}, range start ${rangeStart}`);
                checkFragmentsBuffer = vidConcatBuffersToUint8Array(buffers);
            }

            // 2. Append any (moof mdat)+
            console.info(`YTVMP4: Extract fragments for CPN ${cpn} for ${details.requestId} at quality ${itag} at range start ${rangeStart}`);
            let fragments = mp4ExtractFragments(checkFragmentsBuffer, fragmentFileOffset);
            if(fragments.length == 0) {
                console.warn(`YTVMP4: No fragments for CPN ${cpn} for ${details.requestId} at quality ${itag} at range start ${rangeStart}, continuing...`);
                buffers.forEach(b=>filter.write(b));
                filter.close();
                statusCompleteVideoCheck(details.requestId, 'pass');
                return;
            }
            console.info(`YTVMP4: Extracted ${fragments.length} fragments for CPN ${cpn} for ${details.requestId} at quality ${itag} at range start ${rangeStart}`);

            let youtubeGroup = VID_YT_GROUPS[cpn];
            if(youtubeGroup === undefined) {
                console.warn(`YTVMP4: No Youtube group found for  ${cpn} for ${details.requestId} at quality ${itag} at range start ${rangeStart}`);
                buffers.forEach(b=>filter.write(b));
                filter.close();
                statusCompleteVideoCheck(details.requestId, 'pass');
                return;
            }
            console.info(`YTVMP4: Matching fragments  ${cpn} for ${details.requestId} at quality ${itag} at range start ${rangeStart}`);
            for(let stream of youtubeGroup.fmp4s) {
                if(stream.doFragmentsMatch(fragments)) {
                    console.info(`YTVMP4: Found existing fMP4 match  ${cpn} for ${details.requestId} at quality ${itag} at range start ${rangeStart}`);
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

            // 3. Setup scanning
            console.debug(`YTVMP4: Setting up scan buffers for ${cpn} for ${details.requestId} at quality ${itag} at range start ${rangeStart}`);
            //Build up init ftyp moov (moof mdat)+   with possibly incomplete mdat
            let scanBuffers = [ vidToArrayBuffer(fmp4.initSegment) ];
            fragments.forEach(f=>scanBuffers.push(vidToArrayBuffer(f.moofMdatData)));

            let scanStart = 0.5; //seconds
            let scanStep = 1.0;
            let scanMaxSteps = 10.0;
            let scanBlockBailCount = 4.0;

            console.debug(`YTVMP4: Scanning  ${cpn} for ${details.requestId} at quality ${itag} at range start ${rangeStart}`);
            let processor = bkGetNextProcessor();
            let scanResults = await vidPerformVideoScan(
                processor,
                videoChainId,
                details.requestId,
                mimeType,
                details.url,
                details.type,
                scanBuffers,
                scanStart,
                scanStep,
                scanMaxSteps,
                scanBlockBailCount
            );
            console.info(`YTVMP4: Scan complete ${scanResults.blockCount}/${scanResults.scanCount}  ${cpn} for ${details.requestId} at quality ${itag} at range start ${rangeStart}`);
            statusIndicateVideoProgress(details.requestId);
            fmp4.scanCount += scanResults.scanCount;
            fmp4.blockCount += scanResults.blockCount;
            youtubeGroup.scanCount += scanResults.scanCount;
            youtubeGroup.blockCount += scanResults.blockCount;
            let isThisScanBlock = (scanResults.blockCount >= scanBlockBailCount
                                    || (scanResults.scanCount >= 3 && scanResults.blockCount / scanResults.scanCount >= 0.66));
            let isThisStreamBlock = (fmp4.scanCount >= 20 && fmp4.blockCount / fmp4.scanCount >= 0.15);
            let isThisGroupBlock = (youtubeGroup.scanCount >= 20 && youtubeGroup.blockCount / youtubeGroup.scanCount >= 0.15);
            console.log(`YTVMP4/MLV: Scan status for CPN ${cpn}, ${details.requestId}: ${scanResults.blockCount}/${scanResults.scanCount} < ${fmp4.blockCount}/${fmp4.scanCount} < ${youtubeGroup.blockCount}/${youtubeGroup.scanCount}`);
            if(isThisScanBlock || isThisStreamBlock || isThisGroupBlock) {
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
async function vidYtWebmListener(details, mimeType, parsedUrl) {

    let cpn = parsedUrl.searchParams.get('cpn');
    let videoChainId = 'yt-webm-'+cpn+'-'+details.requestId;
    let rangeRaw = parsedUrl.searchParams.get('range');
    console.info('YTVWEBM: Starting request '+details.requestId+' '+cpn+', '+rangeRaw);
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
        console.debug('YTVWEBM: Data '+details.requestId+' '+cpn+', '+rangeRaw+' of size '+event.data.byteLength);
        buffers.push(event.data);
    }

    filter.onerror = e => {
        try {
            filter.disconnect();
            statusCompleteVideoCheck(details.requestId, 'error');
        } catch(ex) {
            console.log('YTVWEBM: Filter video error: '+e+', '+ex);
        }
    }
  
    filter.onstop = async _ => {
        try {
            // 1. Setup the WebM stream - tuck away the init segment and create the index
            let webm;
            let checkFragmentsBuffer;
            let fragmentFileOffset = rangeStart;
            
            if(rangeStart == 0) {
                console.debug(`YTVWEBM: New WebM ${cpn} for ${details.requestId} at quality ${itag}`);
                let youtubeGroup = vidCheckCreateYtGroup(cpn);

                let fullBuffer = vidConcatBuffersToUint8Array(buffers);
                webm = ebmlCreateFragmentedWebM(fullBuffer);
                webm.videoChainId = videoChainId;
                webm.scanCount = 0;
                webm.blockCount = 0;
                youtubeGroup.webms.push(webm);
                checkFragmentsBuffer = fullBuffer.slice(webm.clusterStartIndex);
                fragmentFileOffset += webm.clusterStartIndex;
                console.info(`YTVWEBM: Completed creating new WebM ${cpn} for ${details.requestId} at quality ${itag}`);
            } else {
                console.info(`YTVWEBM: Will look for existing WebM ${cpn} for ${details.requestId} at quality ${itag}, range start ${rangeStart}`);
                checkFragmentsBuffer = vidConcatBuffersToUint8Array(buffers);
            }

            // 2. Append any Cluster
            console.debug(`YTVWEBM: Extract fragments for CPN ${cpn} for ${details.requestId} at quality ${itag} at range start ${rangeStart}`);
            let fragments = ebmlExtractFragments(checkFragmentsBuffer, fragmentFileOffset);
            if(fragments.length == 0) {
                console.warn(`YTVWEBM: No fragments for CPN ${cpn} for ${details.requestId} at quality ${itag} at range start ${rangeStart}, continuing...`);
                buffers.forEach(b=>filter.write(b));
                filter.close();
                statusCompleteVideoCheck(details.requestId, 'pass');
                return;
            }
            console.info(`YTVWEBM: Extracted ${fragments.length} fragments for CPN ${cpn} for ${details.requestId} at quality ${itag} at range start ${rangeStart}`);

            let youtubeGroup = VID_YT_GROUPS[cpn];
            if(youtubeGroup === undefined) {
                console.warn(`YTVWEBM: No Youtube group found for  ${cpn} for ${details.requestId} at quality ${itag} at range start ${rangeStart}`);
                buffers.forEach(b=>filter.write(b));
                filter.close();
                statusCompleteVideoCheck(details.requestId, 'pass');
                return;
            }
            console.info(`YTVWEBM: Matching fragments  ${cpn} for ${details.requestId} at quality ${itag} at range start ${rangeStart}`);
            for(let stream of youtubeGroup.webms) {
                if(stream.doFragmentsMatch(fragments)) {
                    console.info(`YTVWEBM: Found existing WebM match  ${cpn} for ${details.requestId} at quality ${itag} at range start ${rangeStart}`);
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

            // 3. Setup scanning
            console.debug(`YTVWEBM: Setting up scan buffers for ${cpn} for ${details.requestId} at quality ${itag} at range start ${rangeStart}`);
            //Build up init ftyp moov (moof mdat)+   with possibly incomplete mdat
            let scanBuffers = [ vidToArrayBuffer(webm.initSegment) ];
            fragments.forEach(f=>scanBuffers.push(vidToArrayBuffer(f.clusterData)));

            let scanStart = 0.5; //seconds
            let scanStep = 1.0;
            let scanMaxSteps = 10.0;
            let scanBlockBailCount = 4.0;

            console.debug(`YTVWEBM: Scanning  ${cpn} for ${details.requestId} at quality ${itag} at range start ${rangeStart}`);
            let processor = bkGetNextProcessor();
            let scanResults = await vidPerformVideoScan(
                processor,
                videoChainId,
                details.requestId,
                mimeType,
                details.url,
                details.type,
                scanBuffers,
                scanStart,
                scanStep,
                scanMaxSteps,
                scanBlockBailCount
            );
            console.debug(`YTVWEBM: Scan complete ${scanResults.blockCount}/${scanResults.scanCount}  ${cpn} for ${details.requestId} at quality ${itag} at range start ${rangeStart}`);
            statusIndicateVideoProgress(details.requestId);
            webm.scanCount += scanResults.scanCount;
            webm.blockCount += scanResults.blockCount;
            youtubeGroup.scanCount += scanResults.scanCount;
            youtubeGroup.blockCount += scanResults.blockCount;
            let isThisScanBlock = (scanResults.blockCount >= scanBlockBailCount
                                    || (scanResults.scanCount >= 3 && scanResults.blockCount / scanResults.scanCount >= 0.66));
            let isThisStreamBlock = (webm.scanCount >= 20 && webm.blockCount / webm.scanCount >= 0.15);
            let isThisGroupBlock = (youtubeGroup.scanCount >= 20 && youtubeGroup.blockCount / youtubeGroup.scanCount >= 0.15);
            console.log(`YTVWEBM/MLV: Scan status for CPN ${cpn}, ${details.requestId}: ${scanResults.blockCount}/${scanResults.scanCount} < ${webm.blockCount}/${webm.scanCount} < ${youtubeGroup.blockCount}/${youtubeGroup.scanCount}`);
            if(isThisScanBlock || isThisStreamBlock || isThisGroupBlock) {
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