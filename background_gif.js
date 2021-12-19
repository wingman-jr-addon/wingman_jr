let GIF_PLACEHOLDER = null;
fetch('wingman_placeholder.gif')
.then(async r => GIF_PLACEHOLDER = await r.arrayBuffer());

function gifHex(arrayBuffer) {
    return Array.prototype.map.call(
        new Uint8Array(arrayBuffer),
        n => n.toString(16).padStart(2, "0")
    ).join("");
}

function gifReadUint32(buffer, offset) {
    return (
        buffer[offset]   << 24 |
        buffer[offset+1] << 16 |
        buffer[offset+2] << 8  |
        buffer[offset+3]
        ) >>> 0; //to uint
}

function gifReadUint24(buffer, offset) {
    return (
        buffer[offset] << 16 |
        buffer[offset+1] << 8  |
        buffer[offset+2]
        ) >>> 0; //to uint
}

function gifReadUint16(buffer, offset) {
    return (
        buffer[offset] << 8  |
        buffer[offset+1]
        ) >>> 0; //to uint
}

function gifConcatBuffersToUint8Array(buffers) {
    let fullLength = buffers.reduce((acc,buf)=>acc+buf.byteLength, 0);
    let result = new Uint8Array(fullLength);
    let offset = 0;
    for(let buffer of buffers) {
        result.set(new Uint8Array(buffer), offset);
        offset += buffer.byteLength;
    }
    return result;
}

function gifToArrayBuffer(u8Array) {
    return u8Array.buffer.slice(
        u8Array.byteOffset,
        u8Array.byteOffset+u8Array.byteLength
    );
}

function gifTryGetDataSubblocksLength(parsedGif, si) {
    let b = parsedGif.data;
    if(si >= b.byteLength) {
        return -1;
    }
    let i = si;
    while(b[i] != 0) {
        i += b[i] + 1;
        //Couldn't read the full block of data
        if( i >= b.byteLength) {
            return -1;
        }
    }
    return (i - si) + 1; //Even if the very first byte is 0, it is still length 1
}

function gifTryGetLIDLength(parsedGif, si) {
    // Local Image Descriptor
    // Already read Separator
    let i = si;
    let b = parsedGif.data;
    if (i + 2 + 2 + 2 + 2 + 1 >= b.byteLength) {
        return -1;
    }
    let left = gifReadUint16(b, i);     i+=2;
    let top = gifReadUint16(b, i);      i+=2;
    let width = gifReadUint16(b, i);    i+=2;
    let height = gifReadUint16(b, i);   i+=2;
    let packed = b[i];                  i+=1;

    //Local Color Table
    let isLocalColorTablePresent = (packed & 0x80) > 0;
    if (isLocalColorTablePresent)
    {
        let sizeOfLocalColorTable = packed & 0x7;
        let numberOfLocalColorTableEntries = 1 << (sizeOfLocalColorTable + 1);
        i += numberOfLocalColorTableEntries * 3; //RGB pixel;
        if (i >= b.byteLength) {
            return -1;
        }
    }

    if (i + 1 >= b.byteLength) {
        return -1;
    }
    let bitWidth = b[i];                i+=1;
    let subBlockSize = gifTryGetDataSubblocksLength(parsedGif, i);
    if (subBlockSize == -1 || i + subBlockSize >= b.byteLength) {
        return -1;
    }
    return (i + subBlockSize) - si;
}

function gifTryGetExtLength(parsedGif, si) {
    // Already read Introducer
    let i = si;
    let b = parsedGif.data;
    if(i + 1 + 1 >= b.byteLength) {
        return -1;
    }
    let label = b[i];       i+=1;
    let blockSize = b[i];   i+=1;
    
    if(i + blockSize >= b.byteLength) {
        return -1;
    }
    i += blockSize;
    let subBlockSize = gifTryGetDataSubblocksLength(parsedGif, i);
    if(subBlockSize == -1) {
        return -1;
    }
    return (i + subBlockSize) - si;
}

function parseGifFrames(nextBuffer, parsedGif) {
    if(!parsedGif) {
        parsedGif = {
            header: null, //actually header plus global color table
            screenWidth: -1,
            screenHeight: -1,
            unscannedFrames: [],
            newParsedData: new Uint8Array(),
            parsedIndex: 0, //index of last fully parsed image
            lastParsedIndex: 0,
            data: new Uint8Array(),
            errorIndex: -1
        };
    }

    try {
        parsedGif.data = vidConcatBuffersToUint8Array([
            parsedGif.data.buffer,
            nextBuffer
        ]);

        parsedGif.lastParsedIndex = parsedGif.parsedIndex;
        parsedGif.newParsedData = new Uint8Array();

        if(parsedGif.errorIndex > -1) {
            console.debug(`DEFG: Not parsing GIF further since it has error at index ${parsedGif.errorIndex}`);
            return parsedGif;
        }

        let i = parsedGif.parsedIndex;
        let b = parsedGif.data;

        //If not yet created, extract GIF init frame
        if(parsedGif.header == null) {
            let signature = gifReadUint24(b, i);        i+=3;
            let version = gifReadUint24(b, i);          i+=3;
            parsedGif.screenWidth = gifReadUint16(b,i); i+=2;
            parsedGif.screenHeight = gifReadUint16(b,i);i+=2;
            let packed = b[i];                          i+=1;
            let bgColor = b[i];                         i+=1;
            let aspectRatio = b[i];                     i+=1;

            let isGlobalColorTablePresent = (packed & 0x80) > 0;
            if (isGlobalColorTablePresent) {
                let sizeOfGlobalColorTable = packed & 0x7;
                let numberOfGlobalColorTableEntries = 1 << (sizeOfGlobalColorTable + 1);
                i += numberOfGlobalColorTableEntries * 3; //RGB pixel
            }
            parsedGif.header = b.slice(0, i);
            parsedGif.parsedIndex = i;
            WJR_DEBUG && console.log(`DEFG: Found Header up to ${parsedGif.parsedIndex}`);
        }

        const PEEK_TRAILER = 0x3B;
        const PEEK_LID = 0x2C;
        const PEEK_EXT = 0x21;

        let wasParseFailure = false;
        let isComplete = false;

        while(!wasParseFailure && !isComplete && i < b.byteLength) {
            let peekByte = b[i]; i+=1;
            switch(peekByte) {
                // Local Image Descriptor + Data Blocks
                case PEEK_LID:
                    WJR_DEBUG && console.debug(`DEFG: Found LID at ${i-1}!`);
                    let lidLength = gifTryGetLIDLength(parsedGif, i);
                    if(lidLength > -1) {
                        //Create a standalone GIF by placing the local
                        //image into a file with header + frame + trailer
                        //Note this doesn't cover the case where a frame
                        //is smaller than the whole image, but the vast
                        //majority of GIFs now are just full images
                        //separated by Graphics Control Extensions
                        let standaloneGif = gifConcatBuffersToUint8Array([
                                    parsedGif.header.buffer,
                                    b.slice(i-1, i+lidLength).buffer,
                                    Uint8Array.from([PEEK_TRAILER]).buffer
                                ]);
                        parsedGif.unscannedFrames.push(standaloneGif);
                        i += lidLength;
                        parsedGif.parsedIndex = i;
                        WJR_DEBUG && console.debug(`DEFG: Parsed LID - results now ${parsedGif.unscannedFrames.length} and parsed index ${parsedGif.parsedIndex}`);
                    } else {
                        WJR_DEBUG && console.debug(`DEFG: Could not fully parse LID - results now ${parsedGif.unscannedFrames.length}`);
                        wasParseFailure = true;
                    }
                    break;
                // Extension - just skip
                case PEEK_EXT:
                    WJR_DEBUG && console.debug('DEFG: Found Extension!');
                    let extLength = gifTryGetExtLength(parsedGif, i);
                    if(extLength > -1) {
                        i += extLength;
                        parsedGif.parsedIndex = i;
                    } else {
                        WJR_DEBUG && console.debug(`DEFG: Could not fully parse Extension - results now ${parsedGif.unscannedFrames.length}`);
                        wasParseFailure = true;
                    }
                    break;
                case PEEK_TRAILER:
                    WJR_DEBUG && console.debug('DEFG: Found Trailer!');
                    parsedGif.parsedIndex = i;
                    isComplete = true;
                    break;
                default:
                    console.error(`DEFG: Error parsing GIF peek byte ${peekByte} at index ${i}`);
                    wasParseFailure = true;
                    parsedGif.errorIndex = i;
                    break;
            }
        }

        parsedGif.newParsedData = parsedGif.data.slice(parsedGif.lastParsedIndex, parsedGif.parsedIndex);
    } catch(e) {
        console.error('DEFG: Error parsing gif '+e);
        //Don't set an error if we don't have the header yet
        if(parsedGif.header != null) {
            parsedGif.errorIndex = parsedGif.parsedIndex; //Best guess
        }
    }

    return parsedGif;
}


let GIF_OPEN_REQUESTS = { };
function gifOnGifFrame(m) {
    let openRequest = GIF_OPEN_REQUESTS[m.requestId];
    if(openRequest !== undefined) {
        delete GIF_OPEN_REQUESTS[m.requestId];
        openRequest.resolve(m);
    }
}

//GIF request ID should be unique
async function gifPerformGifFrameScan(
    processor,
    gifRequestId,
    gifFrame,
    url /* informational */
) {
    let p = new Promise(function(resolve, reject) {
        GIF_OPEN_REQUESTS[gifRequestId] = {
            requestId: gifRequestId, 
            resolve: resolve,
            reject: reject
        };
    });
    processor.port.postMessage({
        type: 'gif_frame',
        requestId: gifRequestId,
        url: url,
        buffers: [gifFrame.buffer],
        mimeType: 'image/gif'
    })
    return p;
}

async function gifListener(details) {
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
        console.warn('WEBREQG: Weird error parsing content-length '+e);
    }

    let mimeType = 'image/gif';
    WJR_DEBUG && console.log(`DEFG: Starting request ${details.requestId} of type ${mimeType} of expected content-length ${expectedContentLength}`);
    let filter = browser.webRequest.filterResponseData(details.requestId);

    let gifChainId = 'gif-'+details.requestId;
    let gifFrameCount = 0;

    let totalSize = 0;
    const fullPassScanFrames = 100;
    const fullPassScanBytes = 100*1024*1024;

    let totalScanCount = 0;
    let totalBlockCount = 0;
    let totalErrorCount = 0;

    let status = 'pass_so_far'; //pass_so_far, scanning, pass, block, error
    let parsedGif = null;
    let scanAndTransitionPromise;

    statusStartVideoCheck(details.requestId);

    let pump = async function(newData, isComplete) {
        let parseRange = '<unknown>';
        try
        {
            //Ensure this top section remains synchronous
            WJR_DEBUG && console.debug(`DEFG: Data for ${details.requestId} of size ${newData.byteLength}`);
            parsedGif = parseGifFrames(newData, parsedGif);
            let capturedParsedIndex = parsedGif.parsedIndex;
            let capturedLastParsedIndex = parsedGif.lastParsedIndex;
            let unscannedFrames = parsedGif.unscannedFrames;
            parsedGif.unscannedFrames = [];
            let capturedNewParsedData = parsedGif.newParsedData;
            parseRange = `[${parsedGif.lastParsedIndex}-${parsedGif.parsedIndex})/${expectedContentLength}`;

            totalSize += newData.byteLength;

            let shouldScan = isComplete || capturedNewParsedData.byteLength > 0;

            //Now transition to scanning and create a promise for next chunk of work
            if (status == 'pass' || status == 'error') {
                //This is really a warning condition because it shouldn't happen
                filter.write(capturedNewParsedData);
            } else if(status == 'pass_so_far' && shouldScan) {
                //Begin synchronous only setup
                status = 'scanning';

                WJR_DEBUG && console.info(`DEFG: Setting up scan for ${details.requestId} for ${parseRange} and ${unscannedFrames.length} frames, isComplete=${isComplete}, totalScanCount ${totalScanCount}`);
                let processor = bkGetNextProcessor();
                //End synchronous only setup

                //Setup async work as promise
                scanAndTransitionPromise = async ()=>{
                    WJR_DEBUG && console.info(`DEFG: Performing scan for ${details.requestId} for ${parseRange}`);
                    let scanPerfStartTime = performance.now();
                    let thisScanCount = 0;
                    let thisBlockCount = 0;
                    for(let unscannedFrame of unscannedFrames) {
                        let gifScan = await gifPerformGifFrameScan(
                            processor,
                            gifChainId+'-'+gifFrameCount,
                            unscannedFrame,
                            details.url
                        );
                        gifFrameCount++;
                        thisScanCount++;
                        if(gifScan.result == 'block') {
                            thisBlockCount++;
                        }
                    }
                    
                    let scanPerfTotalTime = performance.now() - scanPerfStartTime;
                    WJR_DEBUG && console.log(`DEFG: Scan results ${details.requestId} timing ${scanPerfTotalTime} for ${parseRange} was ${thisBlockCount}/${thisScanCount}`);
                    totalScanCount += thisScanCount;
                    totalBlockCount += thisBlockCount;

                    let shouldBlock = totalBlockCount > 0;
                    let shouldError = false;

                    if(shouldBlock) {
                        console.warn(`DEFG: BLOCK ${details.requestId} for ${parseRange} with global stats ${totalBlockCount}/${totalScanCount}`);
                        status = 'block';

                        let placeholder = GIF_PLACEHOLDER ?? new Uint8Array();
                        filter.write(placeholder);
                        
                        //Ideally you would close the filter here, BUT... some systems will keep retrying by picking up
                        //at the last location. So, we will be sneaky and if there are bytes left we will just stuff
                        //with random data.
                        if(expectedContentLength > 0) {
                            let remainingLength = expectedContentLength - placeholder.byteLength;
                            WJR_DEBUG && console.log(`DEFG: BLOCK ${details.requestId} stuffing ${remainingLength}`);
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
                        console.warn(`DEFG: ERROR ${details.requestId} for ${parseRange}`);
                        status = 'error';
                        let disconnectBuffer = parsedGif.data.slice(capturedLastParsedIndex);
                        filter.write(disconnectBuffer);
                        filter.disconnect();
                        statusCompleteVideoCheck(details.requestId, status);
                    } else {
                        if(totalScanCount > fullPassScanFrames || capturedParsedIndex >= fullPassScanBytes) {
                            WJR_DEBUG && console.log(`DEFG: PASS Full ${details.requestId} for ${parseRange}`);
                            status = 'pass';
                            filter.write(capturedNewParsedData);
                            let disconnectBuffer = parsedGif.data.slice(capturedParsedIndex);
                            filter.write(disconnectBuffer);
                            filter.disconnect();
                            statusCompleteVideoCheck(details.requestId, status);
                        } else {
                            WJR_DEBUG && console.info(`DEFG: PASS so far ${details.requestId} for ${parseRange}`);
                            status = 'pass_so_far';
                            if(capturedNewParsedData.byteLength > 0) {
                                filter.write(capturedNewParsedData);
                            }
                        }
                    }
                }
                await scanAndTransitionPromise();
                statusIndicateVideoProgress(details.requestId);
            } else if(status == 'scanning') {
                WJR_DEBUG && console.debug(`DEFG: Already scanning so bumping back parsedIndex for ${details.requestId} current status ${status} isComplete=${isComplete}, totalSize=${totalSize}, parse range ${parseRange}, ${capturedNewParsedData.byteLength}`);
                parsedGif.parsedIndex = capturedLastParsedIndex;
            } else {
                WJR_DEBUG && console.debug(`DEFG: Skipping scan for ${details.requestId} current status ${status} isComplete=${isComplete}, totalSize=${totalSize}, parse range ${parseRange}, ${capturedNewParsedData.byteLength}`);
            }
        } catch(e) {
            console.error(`DEFG: Error scanning for ${details.requestId} status ${status} for ${parseRange} isComplete=${isComplete}, totalSize=${totalSize}: ${e}`);
        } finally {
            if(isComplete) {
                WJR_DEBUG && console.log(`DEFG: Filter close for ${details.requestId} final status ${status} parse range ${parseRange}`);
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
            WJR_DEBUG && console.log('WEBREQG: Filter video error: '+ex);
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
