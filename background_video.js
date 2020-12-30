
let VID_videoPlaceholderArrayBuffer = null;
fetch('wingman_placeholder.mp4')
.then(async r => VID_videoPlaceholderArrayBuffer = await r.arrayBuffer());


function concatBuffersToUint8Array(buffers) {
    let fullLength = buffers.reduce((acc,buf)=>acc+buf.byteLength, 0);
    let result = new Uint8Array(fullLength);
    console.log('DEBUGV: Full length '+fullLength);
    let offset = 0;
    for(let buffer of buffers) {
        result.set(new Uint8Array(buffer), offset);
        offset += buffer.byteLength;
    }
    return result;
}

function toArrayBuffer(u8Array) {
    return u8Array.buffer.slice(
        u8Array.byteOffset,
        u8Array.byteOffset+u8Array.byteLength
    );
}

function readUint64(buffer, offset) {
    return (
        buffer[offset]   << 56 |
        buffer[offset+1] << 48 |
        buffer[offset+2] << 40 |
        buffer[offset+3] << 32 |
        buffer[offset+4] << 24 |
        buffer[offset+5] << 16 |
        buffer[offset+6] << 8  |
        buffer[offset+7]
        ) >>> 0; //to uint
}

function readUint32(buffer, offset) {
    return (
        buffer[offset]   << 24 |
        buffer[offset+1] << 16 |
        buffer[offset+2] << 8  |
        buffer[offset+3]
        ) >>> 0; //to uint
}

function readUint24(buffer, offset) {
    return (
        buffer[offset] << 16 |
        buffer[offset+1] << 8  |
        buffer[offset+2]
        ) >>> 0; //to uint
}

function readUint16(buffer, offset) {
    return (
        buffer[offset] << 8  |
        buffer[offset+1]
        ) >>> 0; //to uint
}

function readType(buffer, offset) {
    let result = '';
    for(let i=0; i<4; i++) {
        result += String.fromCharCode(buffer[offset+i]);
    }
    return result;
}

let __aCode = 'a'.charCodeAt(0);
let __zCode = 'z'.charCodeAt(0);
function isProbableAtom(buffer, offset) {
    if(offset >= buffer.byteLength-8) {
        return false;
    }
    let length = readUint32(buffer, offset);
    if(offset+length >= buffer.byteLength) {
        return false;
    }
    //The type should basically be [a-z]
    let lengthSize = 4;
    for(let i=0; i<4; i++) {
        if(buffer[offset+lengthSize+i]<__aCode || buffer[offset+lengthSize+i] > __zCode) {
            return false;
        }
    }
    return true;
}

function dumpSIDX(buffer, atomOffset) {
    let b = buffer;
    let i = atomOffset+8;

    let version = buffer[i]; i++;
    let flags = readUint24(b,i); i+=3;
    let referenceId = readUint32(b,i); i+=4;
    let timescale = readUint32(b,i); i+=4;
    let earliestPTS;
    if(version == 0) {
        earliestPTS = readUint32(b,i); i+=4;
    } else {
        earliestPTS = readUint64(b,i); i+=8;
    }
    let firstOffset = readUint32(b,i); i+=4;
    let __reserved = readUint16(b,i); i+=2;
    let entryCount = readUint16(b,i); i+=2;

    console.log('DEBUGV:           SIDX Entry Count '+entryCount);

    //Note here that fileOffset seems to refer to the offset relative to the end of the SIDX atom
    let fileOffset = firstOffset;
    for(let ei=0; ei<entryCount; ei++) {
        let referencedSize = readUint32(b,i); i+=4;
        let subSegmentDuration = readUint32(b,i); i+=4;
        i+=4; //unused
        console.log(`DEBUGV:          SIDX Current offset ${fileOffset}, size ${referencedSize}, duration ${subSegmentDuration}`);
        fileOffset += referencedSize;
    }
}

function dumpAtoms(buffers) {
    let fullBuffer = concatBuffersToUint8Array(buffers);

    //An atom consists of a 4-byte length followed by a 4 byte ASCII indicator.
    let offset = 0;
    while(offset < fullBuffer.byteLength-7) {
        if(isProbableAtom(fullBuffer, offset)) {
            console.log('DEBUGV: Probable Atom start: '+offset);
            break;
        }
        offset++;
    }
    while(offset < fullBuffer.byteLength-7) {
        let length = readUint32(fullBuffer, offset);
        let type = readType(fullBuffer, offset+4);
        let isComplete = offset + length <= fullBuffer.byteLength;
        console.log(`DEBUGV: Atom ${type} ${offset} ${length} isComplete? ${isComplete}`);
        if(type == 'sidx') {
            dumpSIDX(fullBuffer, offset);
        }
        offset += length;
    }
}

function isProbableAtomOfType(buffer, offset, type) {
    if(offset >= buffer.byteLength-8) {
        return false;
    }
    let length = readUint32(buffer, offset);
    if(offset+length >= buffer.byteLength) {
        return false;
    }
    //The type should basically be [a-z]
    let lengthSize = 4;
    for(let i=0; i<4; i++) {
        if(String.fromCharCode(buffer[offset+lengthSize+i]) != type[i]) {
            return false;
        }
    }
    return true;
}

function extractFragments(fullBuffer, fileStartOffset) {
    let offset = 0;
    while(offset < fullBuffer.byteLength-7) {
        if(isProbableAtomOfType(fullBuffer, offset, 'moof')) {
            console.log('DEBUGV: Probable fMP4 fragment start: '+offset);
            break;
        }
        offset++;
    }
    //Extract all fragments where at least the moof is complete
    //and the mdat is detectable, marking where incomplete
    let fragments = [];
    while(offset < fullBuffer.byteLength-7) {
        let moofLength = readUint32(fullBuffer, offset);
        let moofType = readType(fullBuffer, offset+4);
        if(moofType != 'moof') {
            //TODO log
            break;
        }
        let isMoofCompleteAndMdatDetectable = offset + moofLength +8 <= fullBuffer.byteLength;
        if(!isMoofCompleteAndMdatDetectable) {
            break;
        }
        let mdatLength = readUint32(fullBuffer, offset + moofLength);
        let mdatType = readType(fullBuffer, offset + moofLength + 4);
        if(mdatType != 'mdat') {
            //TODO log
            break;
        }
        let isMdatComplete = offset + moofLength + mdatLength <= fullBuffer.byteLength;
        if(isMdatComplete) {
            endDataOffset = offset + moofLength + mdatLength;
        } else {
            endDataOffset = fullBuffer.byteLength-1;
        }
        fragments.push({
            fileOffsetMoof: fileStartOffset+offset, //start of moof
            fileOffsetMdat: fileStartOffset+offset+moofLength,
            moofMdatData: fullBuffer.slice(offset, offset+moofLength+mdatLength),
            isMdatComplete: isMdatComplete
        });
        offset += moofLength + mdatLength;
    }
    return fragments;
}


function parseSIDX(buffer, atomOffset) {
    let b = buffer;
    let atomLength = readUint32(buffer, atomOffset);
    let i = atomOffset+8;

    let version = buffer[i]; i++;
    let flags = readUint24(b,i); i+=3;
    let referenceId = readUint32(b,i); i+=4;
    let timescale = readUint32(b,i); i+=4;
    let earliestPTS;
    if(version == 0) {
        earliestPTS = readUint32(b,i); i+=4;
    } else {
        earliestPTS = readUint64(b,i); i+=8;
    }
    let firstOffset = readUint32(b,i); i+=4;
    let __reserved = readUint16(b,i); i+=2;
    let entryCount = readUint16(b,i); i+=2;

    //Note here that fileOffset seems to refer to the offset relative to the end of the SIDX atom
    let entries = { };
    let fileOffset = atomOffset + atomLength + firstOffset; //end of sidx + firstOffset
    for(let ei=0; ei<entryCount; ei++) {
        let referencedSize = readUint32(b,i); i+=4;
        let subSegmentDuration = readUint32(b,i); i+=4;
        i+=4; //unused
        //offset being the global file offset here
        entries[fileOffset] = { offset: fileOffset, size: referencedSize, duration: subSegmentDuration, status: 'unknown' };
        fileOffset += referencedSize;
    }

    return {
        referenceId: referenceId,
        earliestPTS: earliestPTS,
        timescale: timescale,
        firstOffset: firstOffset,
        entries: entries
    };
}

function createFragmentedMp4(initBuffer) {
    //This expects the init buffers to have at least (ftyp moov sidx)
    //and then initial calls to have (moof mdat)+ fragments
    //This allows (ftyp moov) to be saved as the init segment
    //and (moof mdat)+ to be appended to create valid fMP4's.
    let offset = 0;
    let ftypLength = readUint32(initBuffer, offset);
    let ftypType = readType(initBuffer, offset+4);
    if(ftypType != 'ftyp') {
        throw `Fragmented MP4 expected to start with ftyp, found ${ftypType}`;
    }
    offset = ftypLength;
    let moovLength = readUint32(initBuffer, offset);
    let moovType = readType(initBuffer, offset+4);
    if(moovType != 'moov') {
        throw `Fragmented MP4 expected moov after ftyp, found ${moovType}`;
    }
    //Now we have ftyp+moov so we can build the init segment
    let initSegment = initBuffer.slice(0, ftypLength + moovLength);
    //Parse SIDX and build up the expected locations for (moof mdat) fragments
    offset = ftypLength + moovLength;
    let sidxLength = readUint32(initBuffer, offset);
    let sidxType = readType(initBuffer, offset+4);
    if(sidxType != 'sidx') {
        throw `Fragmented MP4 expected sidx after moov, found ${sidxType}`;
    }
    let dataStartIndex = offset + sidxLength;
    let sidx = parseSIDX(initBuffer, offset);

    let fmp4 = {
        initSegment: initSegment,
        dataStartIndex: dataStartIndex,
        sidx: sidx,
        doFragmentsMatch: function(fragments) { //as produced by extractFragments
            return fragments.every(f=>this.sidx.entries[f.fileOffsetMoof]!==undefined);
        },
        markFragments: function(fragments, status) {
            for(let fragment of fragments) {
                this.sidx.entries[fragment.fileOffsetMoof].status = status;
            }
        }
    };
    
    return fmp4;
}


let VID_openRequests = { };
async function VID_onVidScan(m) {
    let openRequest = VID_openRequests[m.requestId];
    if(openRequest !== undefined) {
        delete VID_openRequests[m.requestId];
        openRequest.resolve(m);
    } //TODO reject based on error handling
}

//Request ID should be unique
async function performVideoScan(
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
        VID_openRequests[requestId] = {
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


async function VID_video_listener(details) {
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
        console.log('WEBREQV: Weird error parsing content-length '+e);
    }

    console.log('DATAV: VIDEO mime type check for '+details.requestId+' '+mimeType+': '+length+', webrequest type '+details.type+', expected content-length '+expectedContentLength+' originUrl '+details.originUrl+' documentUrl '+ details.documentUrl +' url '+details.url);
    console.dir(details);
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
            console.log(`YTVMP4: Starting for request ${details.requestId}`);
            return await VID_yt_mp4(details, mimeType, parsedUrl);
        } else if(mimeType.startsWith('video/webm')) {
            let cpn = parsedUrl.searchParams.get('cpn');
            let range = parsedUrl.searchParams.get('range');
            let itag = parsedUrl.searchParams.get('itag');
            console.log(`YTV: Mostly unsupported webm Youtube video for ${details.requestId} of type ${mimeType} (${cpn} ${range} ${itag})`);
            return await VID_yt_webm_tagalong(details, mimeType, parsedUrl);
        } else {
            let cpn = parsedUrl.searchParams.get('cpn');
            let range = parsedUrl.searchParams.get('range');
            let itag = parsedUrl.searchParams.get('itag');
            console.log(`YTV: Unsupported Youtube video for ${details.requestId} of type ${mimeType} (${cpn} ${range} ${itag})`);
            return;
        }
    } else {
        return await VID_default(details, mimeType, parsedUrl);
    }
}

async function VID_default(details, mimeType, parsedUrl) {
    let filter = browser.webRequest.filterResponseData(details.requestId);

    let videoChainId = 'default-'+details.requestId;
    //requestId
    //url,
    //mimeType,
    let buffers = [];
    let scanStart = 0.5; //seconds
    let scanStep = 1.0;
    let scanMaxSteps = 30.0;
    let scanBlockBailCount = 3.0;
    let totalSize = 0;
    
    let status = 'unknown'; //pass, block
  
    filter.ondata = async event => {
        buffers.push(event.data);
        totalSize += event.data.byteLength;

        if(totalSize >= 500*1024 && status == 'unknown') {
            let processor = getNextProcessor();
            let scanResults = await performVideoScan(
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
            if(scanResults.blockCount >= scanBlockBailCount) {
                status = 'block';
                filter.write(VID_videoPlaceholderArrayBuffer);
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
        let processor = getNextProcessor();
        let scanResults = await performVideoScan(
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
        if(scanResults.blockCount >= scanBlockBailCount) {
            status = 'block';
            filter.write(VID_videoPlaceholderArrayBuffer);
            filter.close();
        } else {
            status = 'pass';
            buffers.forEach(b=>filter.write(b));
            filter.disconnect();
        }
    }
    return details;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function checkCreateYoutubeGroup(cpn) {
    let youtubeGroup = VID_youtubeGroups[cpn];
    if(youtubeGroup === undefined) {
        youtubeGroup = {
            status: 'unknown',
            cpn: cpn,
            fmp4s: [],
            webms: [],
            scanCount: 0,
            blockCount: 0
        };
        VID_youtubeGroups[cpn] = youtubeGroup;
    }
    return youtubeGroup;
}

let VID_youtubeGroups = { };

//Youtube MP4 stream listener.
//Note this expects that each fragment is relatively small, so it does nothing
//as part of the 
async function VID_yt_mp4(details, mimeType, parsedUrl) {

    let cpn = parsedUrl.searchParams.get('cpn');
    let videoChainId = 'yt-mp4-'+cpn+'-'+details.requestId;
    let rangeRaw = parsedUrl.searchParams.get('range');
    console.log('YTVMP4: Starting request '+details.requestId+' '+cpn+', '+rangeRaw);
    let splitIndex = rangeRaw.indexOf('-'); //e.g. range=0-3200
    let rangeStart = parseInt(rangeRaw.substr(0, splitIndex));
    let rangeEnd = parseInt(rangeRaw.substr(splitIndex+1));
    let itag = parsedUrl.searchParams.get('itag');

    console.log('YTVMP4: video start headers '+details.requestId);
    let filter = browser.webRequest.filterResponseData(details.requestId);

    let buffers = [];
  
    //TODO Move this logic to pre-request
    filter.onstart = _ => {
        let youtubeMp4GroupPrecheck = VID_youtubeGroups[cpn];
        if (youtubeMp4GroupPrecheck !== undefined) {
            if(youtubeMp4GroupPrecheck.status == 'block') {
                filter.write(VID_videoPlaceholderArrayBuffer);
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
            console.log('YTVMP4: Filter video error: '+e+', '+ex);
        }
    }
  
    filter.onstop = async _ => {
        try {
            // 1. Setup the FMP4 stream - tuck away the init segment and create the index
            let fmp4;
            let checkFragmentsBuffer;
            
            if(rangeStart == 0) {
                console.log(`YTVMP4: New FMP4 ${cpn} for ${details.requestId} at quality ${itag}`);
                let youtubeGroup = checkCreateYoutubeGroup(cpn);

                let fullBuffer = concatBuffersToUint8Array(buffers);
                fmp4 = createFragmentedMp4(fullBuffer);
                fmp4.videoChainId = videoChainId;
                fmp4.scanCount = 0;
                fmp4.blockCount = 0;
                youtubeGroup.fmp4s.push(fmp4);
                checkFragmentsBuffer = fullBuffer.slice(fmp4.dataStartIndex);
                console.log(`YTVMP4: Completed creating new FMP4 ${cpn} for ${details.requestId} at quality ${itag}, index count ${fmp4.sidx.entries.length}`);
            } else {
                console.log(`YTVMP4: Will look for existing FMP4 ${cpn} for ${details.requestId} at quality ${itag}, range start ${rangeStart}`);
                checkFragmentsBuffer = concatBuffersToUint8Array(buffers);
            }

            // 2. Append any (moof mdat)+
            console.log(`YTVMP4: Extract fragments for CPN ${cpn} for ${details.requestId} at quality ${itag} at range start ${rangeStart}`);
            let fragments = extractFragments(checkFragmentsBuffer, rangeStart);
            if(fragments.length == 0) {
                console.log(`YTVMP4: No fragments for CPN ${cpn} for ${details.requestId} at quality ${itag} at range start ${rangeStart}, continuing...`);
                buffers.forEach(b=>filter.write(b));
                filter.close();
                return;
            }
            console.log(`YTVMP4: Extracted ${fragments.length} fragments for CPN ${cpn} for ${details.requestId} at quality ${itag} at range start ${rangeStart}`);

            let youtubeGroup = VID_youtubeGroups[cpn];
            if(youtubeGroup === undefined) {
                console.log(`YTVMP4: No Youtube group found for  ${cpn} for ${details.requestId} at quality ${itag} at range start ${rangeStart}`);
                buffers.forEach(b=>filter.write(b));
                filter.close();
                return;
            }
            console.log(`YTVMP4: Matching fragments  ${cpn} for ${details.requestId} at quality ${itag} at range start ${rangeStart}`);
            for(let stream of youtubeGroup.fmp4s) {
                if(stream.doFragmentsMatch(fragments)) {
                    console.log(`YTVMP4: Found existing fMP4 match  ${cpn} for ${details.requestId} at quality ${itag} at range start ${rangeStart}`);
                    fmp4 = stream;
                    break;
                }
            }
            if(fmp4 === undefined) {
                console.log(`YTVMP4: No fMP4 match  ${cpn} for ${details.requestId} at quality ${itag} at range start ${rangeStart}`);
                buffers.forEach(b=>filter.write(b));
                filter.close();
                return;
            }

            // 3. Setup scanning
            console.debug(`YTVMP4: Setting up scan buffers for ${cpn} for ${details.requestId} at quality ${itag} at range start ${rangeStart}`);
            //Build up init ftyp moov (moof mdat)+   with possibly incomplete mdat
            let scanBuffers = [ toArrayBuffer(fmp4.initSegment) ];
            fragments.forEach(f=>scanBuffers.push(toArrayBuffer(f.moofMdatData)));

            let scanStart = 0.5; //seconds
            let scanStep = 1.0;
            let scanMaxSteps = 10.0;
            let scanBlockBailCount = 4.0;

            console.debug(`YTVMP4: Scanning  ${cpn} for ${details.requestId} at quality ${itag} at range start ${rangeStart}`);
            let processor = getNextProcessor();
            let scanResults = await performVideoScan(
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
            console.log(`YTVMP4: Scan complete ${scanResults.blockCount}/${scanResults.scanCount}  ${cpn} for ${details.requestId} at quality ${itag} at range start ${rangeStart}`);
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
                filter.write(VID_videoPlaceholderArrayBuffer);
                filter.close();
            } else {
                status = 'pass';
                buffers.forEach(b=>filter.write(b));
                filter.disconnect();
            }
            fmp4.markFragments(fragments, status);
        } catch(e) {
            console.log(`YTVMP4: Error for ${details.requestId} ${e}`);
            buffers.forEach(b=>filter.write(b));
            filter.close();
        }
    }
    return details;
}

async function VID_yt_webm_tagalong(details, mimeType, parsedUrl) {

    let cpn = parsedUrl.searchParams.get('cpn');
    let videoChainId = 'yt-mp4-'+cpn+'-'+details.requestId;
    let rangeRaw = parsedUrl.searchParams.get('range');
    console.log('YTVWEBM: Starting request '+details.requestId+' '+cpn+', '+rangeRaw);
    let splitIndex = rangeRaw.indexOf('-'); //e.g. range=0-3200
    let rangeStart = parseInt(rangeRaw.substr(0, splitIndex));
    let rangeEnd = parseInt(rangeRaw.substr(splitIndex+1));
    let itag = parsedUrl.searchParams.get('itag');
    


    console.log('YTVMP4: video start headers '+details.requestId);
    let filter = browser.webRequest.filterResponseData(details.requestId);
  
    //TODO Move this logic to pre-request
    filter.onstart = _ => {
        let youtubeGroupPrecheck = VID_youtubeGroups[cpn];
        if (youtubeGroupPrecheck !== undefined) {
            if(youtubeGroupPrecheck.status == 'block') {
                console.log(`YTVWEBM: Pre-blocking CPN ${cpn} for ${details.requestId}`);
                filter.write(VID_videoPlaceholderArrayBuffer);
                filter.close();
            }
        }
    }

    filter.ondata = event => {
        console.debug('YTVWEBM: Data '+details.requestId+' '+cpn+', '+rangeRaw+' of size '+event.data.byteLength);
        filter.write(event.data);
    }

    filter.onerror = e => {
        try {
            filter.disconnect();
        } catch(ex) {
            console.log('YTVMP4: Filter video error: '+e+', '+ex);
        }
    }
  
    filter.onstop = async _ => {
        filter.close();
    }
    return details;
}