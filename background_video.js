let VID_PLACEHOLDER_MP4 = null;
fetch('wingman_placeholder.mp4')
.then(async r => VID_PLACEHOLDER_MP4 = await r.arrayBuffer());


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
    requestType,
    url,
    mimeType,
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

    console.debug('DATAV: VIDEO mime type check for '+details.requestId+' '+mimeType+': '+length+', webrequest type '+details.type+', expected content-length '+expectedContentLength+' originUrl '+details.originUrl+' documentUrl '+ details.documentUrl +' url '+details.url);
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
        return await vidDefaultListener(details, mimeType, parsedUrl);
    }
}

async function vidDefaultListener(details, mimeType, parsedUrl) {
    console.log(`DEFV: Starting request ${details.requestId} of type ${mimeType}`);
    let filter = browser.webRequest.filterResponseData(details.requestId);

    let videoChainId = 'default-'+details.requestId;
    let buffers = [];
    let scanStart = 0.5; //seconds
    let scanStep = 1.0;
    let scanMaxSteps = 20.0;
    let scanBlockBailCount = 3.0;
    let totalSize = 0;
    
    let status = 'unknown'; //pass, block
  
    filter.ondata = async event => {
        console.debug(`DEFV: Data for ${details.requestId} of size ${event.data.byteLength}`);
        buffers.push(event.data);
        totalSize += event.data.byteLength;

        if(totalSize >= 500*1024 && status == 'unknown') {
            status = 'scanning';
            console.info(`DEFV: Triggering scan ${details.requestId} because total size ${totalSize}`);
            let processor = getNextProcessor();
            let scanResults = await vidPerformVideoScan(
                processor,
                videoChainId,
                details.requestId,
                details.type,
                details.url,
                mimeType,
                buffers,
                scanStart,
                scanStep,
                scanMaxSteps,
                scanBlockBailCount
            );
            console.log(`DEFV: Scan results ${details.requestId} were ${scanResults.blockCount}/${scanResults.scanCount}, error? ${scanResults.error}`);
            if(scanResults.blockCount >= scanBlockBailCount) {
                status = 'block';
                filter.write(VID_PLACEHOLDER_MP4);
                filter.close();
            } else {
                status = 'pass';
                buffers.forEach(b=>filter.write(b));
                filter.disconnect();
            }
        }
    }

    filter.onerror = e => {
        try {
            filter.disconnect();
        } catch(ex) {
            console.log('WEBREQ: Filter video error: '+ex);
        }
    }
  
    filter.onstop = async _ => {
        if(status != 'unknown') {
            return;
        }
        console.info(`DEFV: Triggering scan ${details.requestId} onstop because status is unknown`);
        let processor = getNextProcessor();
        let scanResults = await vidPerformVideoScan(
            processor,
            videoChainId,
            details.requestId,
            mimeType,
            details.url,
            details.type,
            buffers,
            scanStart,
            scanStep,
            scanMaxSteps,
            scanBlockBailCount
        );
        console.log(`DEFV: Scan results ${details.requestId} were ${scanResults.blockCount}/${scanResults.scanCount}, error? ${scanResults.error}`);
        if(scanResults.blockCount >= scanBlockBailCount) {
            status = 'block';
            filter.write(VID_PLACEHOLDER_MP4);
            filter.close();
        } else {
            status = 'pass';
            buffers.forEach(b=>filter.write(b));
            filter.disconnect();
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
  
    //TODO Move this logic to pre-request
    filter.onstart = _ => {
        let youtubeGroupPrecheck = VID_YT_GROUPS[cpn];
        if (youtubeGroupPrecheck !== undefined) {
            if(youtubeGroupPrecheck.status == 'block') {
                filter.write(VID_PLACEHOLDER_MP4);
                filter.close();
            }
        }
    }

    filter.ondata = event => {
        console.debug('YTVMP4: Data '+details.requestId+' '+cpn+', '+rangeRaw+' of size '+event.data.byteLength);
        buffers.push(event.data);
    }

    filter.onerror = e => {
        try {
            filter.disconnect();
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
                return;
            }
            console.info(`YTVMP4: Extracted ${fragments.length} fragments for CPN ${cpn} for ${details.requestId} at quality ${itag} at range start ${rangeStart}`);

            let youtubeGroup = VID_YT_GROUPS[cpn];
            if(youtubeGroup === undefined) {
                console.warn(`YTVMP4: No Youtube group found for  ${cpn} for ${details.requestId} at quality ${itag} at range start ${rangeStart}`);
                buffers.forEach(b=>filter.write(b));
                filter.close();
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
            let processor = getNextProcessor();
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
            /*let scanResults = {
                scanCount: 0,
                blockCount: 0
            };*/
            console.info(`YTVMP4: Scan complete ${scanResults.blockCount}/${scanResults.scanCount}  ${cpn} for ${details.requestId} at quality ${itag} at range start ${rangeStart}`);
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
        } catch(e) {
            console.error(`YTVMP4: Error for ${details.requestId} ${e}`);
            buffers.forEach(b=>filter.write(b));
            filter.close();
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
  
    //TODO Move this logic to pre-request
    filter.onstart = _ => {
        let youtubeGroupPrecheck = VID_YT_GROUPS[cpn];
        if (youtubeGroupPrecheck !== undefined) {
            if(youtubeGroupPrecheck.status == 'block') {
                filter.write(VID_PLACEHOLDER_MP4);
                filter.close();
            }
        }
    }

    filter.ondata = event => {
        console.debug('YTVWEBM: Data '+details.requestId+' '+cpn+', '+rangeRaw+' of size '+event.data.byteLength);
        buffers.push(event.data);
    }

    filter.onerror = e => {
        try {
            filter.disconnect();
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
                return;
            }
            console.info(`YTVWEBM: Extracted ${fragments.length} fragments for CPN ${cpn} for ${details.requestId} at quality ${itag} at range start ${rangeStart}`);

            let youtubeGroup = VID_YT_GROUPS[cpn];
            if(youtubeGroup === undefined) {
                console.warn(`YTVWEBM: No Youtube group found for  ${cpn} for ${details.requestId} at quality ${itag} at range start ${rangeStart}`);
                buffers.forEach(b=>filter.write(b));
                filter.close();
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
            let processor = getNextProcessor();
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
            /*let scanResults = {
                scanCount: 0,
                blockCount: 0
            };*/
            console.debug(`YTVWEBM: Scan complete ${scanResults.blockCount}/${scanResults.scanCount}  ${cpn} for ${details.requestId} at quality ${itag} at range start ${rangeStart}`);
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
                filter.write(VID_PLACEHOLDER_MP4);
                filter.close();
            } else {
                status = 'pass';
                buffers.forEach(b=>filter.write(b));
                filter.disconnect();
            }
            webm.markFragments(fragments, status);
        } catch(e) {
            console.error(`YTVWEBM: Error for ${details.requestId} ${e}`);
            buffers.forEach(b=>filter.write(b));
            filter.close();
        }
    }
    return details;
}