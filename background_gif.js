function gifHex(arrayBuffer)
{
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
        i += b[i];
        //Couldn't read the full block of data
        if( i >= b.byteLength) {
            return -1;
        }
    }
    return (si - i) + 1; //Even if the very first byte is 0, it is still length 1
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
    let isLocalColorTablePresent = (packed & 0x01) > 0;
    if (isLocalColorTablePresent)
    {
        let sizeOfLocalColorTable = (packed >> 5) & 0x7;
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
    if (i + subBlockSize >= b.byteLength) {
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

function parseGifFrames(allBuffers, parsedGif) {
    if(!parsedGif) {
        parsedGif = {
            header: null, //actually header
            screenWidth: -1,
            screenHeight: -1,
            unscannedFrames: [],
            parsedIndex: 0, //index of last fully parsed image
            data: new Uint8Array()
        };
    }

    // Check if we need to update our data array
    let offset = 0;
    for(let buffer of allBuffers) {
        offset += buffer.byteLength;
    }
    if(offset > data.byteLength) {
        parsedGif.data = vidConcatBuffersToUint8Array(allBuffers);
    }

    let i = parsedGif.parsedIndex;
    let b = parsedGif.data;

    //If not yet created, extract GIF init frame
    if(parsedGif.parsedIndex == 0) {
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
    }

    const PEEK_TRAILER = 0x3B;
    const PEEK_LID = 0x2C;
    const PEEK_EXT = 0x21;

    while(i < b.byteLength && b[i] != PEEK_TRAILER) {
        let peekByte = b[i]; i+=1;
        switch(peekByte) {
            // Local Image Descriptor + Data Blocks
            case PEEK_LID:
                let lidLength = gifTryGetLIDLength(parsedGif, i);
                if(lidLength > -1) {
                    //Create a standalone GIF by placing the local
                    //image into a file with header + frame + trailer
                    //Note this doesn't cover the case where a frame
                    //is smaller than the whole image, but the vast
                    //majority of GIFs now are just full images
                    //separated by Graphics Control Extensions
                    let standaloneGif = gifConcatBuffersToUint8Array(
                                parsedGif.header.buffer,
                                b.slice(i, i+lidLength),
                                Uint8Array.from([PEEK_TRAILER])
                            );
                    parsedGif.unscannedFrames.push(standaloneGif);
                    i += lidLength;
                    parsedGif.parsedIndex = i;
                }
                break;
            // Extension - just skip
            case PEEK_EXT:
                let extLength = gifTryGetExtLength(parsedGif, i);
                if(extLength > -1) {
                    i += extLength;
                    parsedGif.parsedIndex = i;
                }
                break;
        }
    }
}


let GIF_OPEN_REQUESTS = { };
async function gifOnGifFrame(m) {
    let openRequest = GIF_OPEN_REQUESTS[m.gifRequestId];
    if(openRequest !== undefined) {
        delete GIF_OPEN_REQUESTS[m.gifRequestId];
        openRequest.resolve(m);
    } //TODO reject based on error handling
}

//GIF request ID should be unique
async function gifPerformGifFrameScan(
    processor,
    gifRequestId,
    url /* informational */
) {
    let p = new Promise(function(resolve, reject) {
        GIF_OPEN_REQUESTS[gifRequestId] = {
            gifRequestId: gifRequestId, 
            resolve: resolve,
            reject: reject
        };
    });
    processor.port.postMessage({
        type: 'gif_frame',
        requestId: requestId,
        url: url,
        buffer: buffer,
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
        console.warn('WEBREQV: Weird error parsing content-length '+e);
    }

    WJR_DEBUG && console.log(`DEFV: Starting request ${details.requestId} of type ${mimeType}`);
    let filter = browser.webRequest.filterResponseData(details.requestId);

    let videoChainId = 'default-'+details.requestId;
    let allBuffers = [];
    

    let totalSize = 0;
    const fullPassScanBytes = 100*1024*1024;
    const fullPassScanDuration = 10*60;

    let totalScanCount = 0;
    let totalBlockCount = 0;
    let totalErrorCount = 0;

    let status = 'pass_so_far'; //pass_so_far, scanning, pass, block, error
    let flushIndexStart, flushIndexEnd = 0; //end exclusive
    let flushScanStartSize = 0;
    let parsedGif = null;
    let scanAndTransitionPromise;

    statusStartVideoCheck(details.requestId);

    let pump = async function(newData, isComplete) {
        try
        {
            //Ensure this top section remains synchronous
            WJR_DEBUG && console.debug(`DEFV: Data for ${details.requestId} of size ${newData.byteLength}`);
            allBuffers.push(newData);
            totalSize += newData.byteLength;

            let shouldScan = isComplete || (totalSize - flushScanStartSize >= 10*1024);

            //Now transition to scanning and create a promise for next chunk of work
            if (status == 'pass' || status == 'error') {
                //This is really a warning condition because it shouldn't happen
                filter.write(newData);
            } else if(status == 'pass_so_far' && shouldScan) {
                //Begin synchronous only setup
                status = 'scanning';
                flushIndexStart = flushIndexEnd;
                flushIndexEnd = allBuffers.length;
                flushScanStartSize = totalSize;
                let scanBuffers = allBuffers.slice(0, flushIndexEnd); //to load for scanning
                let flushBuffers = allBuffers.slice(flushIndexStart, flushIndexEnd); //to flush if pass

                parsedGif = parseGifFrames(allBuffers, parsedGif);
                //TODO get unscanned frames here and store in local variable in case parsedGif
                //gets mutated after synchronous setup
                //TODO clear unscanned frames

                WJR_DEBUG && console.info(`DEFV: Setting up scan for ${details.requestId} for buffers [${flushIndexStart}-${flushIndexEnd}) isComplete=${isComplete}`);
                let processor = bkGetNextProcessor();
                //End synchronous only setup

                //Setup async work as promise
                scanAndTransitionPromise = async ()=>{
                    WJR_DEBUG && console.info(`DEFV: Performing scan for ${details.requestId} for buffers [${flushIndexStart}-${flushIndexEnd})`);
                    let scanPerfStartTime = performance.now();
                    //TODO instead of a single one as below, actually loop over all newly available GIF frames
                    let scanResults = await gifPerformGifFrameScan(
                        processor,
                        //TODO
                        scanBuffers
                    );
                    let scanPerfTotalTime = performance.now() - scanPerfStartTime;
                    WJR_DEBUG && console.log(`DEFV: Scan results ${details.requestId} timing ${scanPerfTotalTime}/${scanResults.scanCount}=${(scanPerfTotalTime/scanResults.scanCount).toFixed(1)} for buffers [${flushIndexStart}-${flushIndexEnd}) was ${scanResults.blockCount}/${scanResults.scanCount}, error? ${scanResults.error}`);
                    totalScanCount += scanResults.scanCount;
                    totalBlockCount += scanResults.blockCount;


                    let shouldBlock = true; //TODO fix this up
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

                        let placeholder = null; //TODO SOME PLACEHOLDER STUFF
                        
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
                    } else {
                        if(/*TODO ENOUGH FRAMES || */ flushScanStartSize >= fullPassScanBytes) {
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
