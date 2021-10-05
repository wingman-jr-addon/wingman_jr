function hex(arrayBuffer)
{
    return Array.prototype.map.call(
        new Uint8Array(arrayBuffer),
        n => n.toString(16).padStart(2, "0")
    ).join("");
}


function mp4ReadUint64(buffer, offset) {
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

function mp4ReadUint32(buffer, offset) {
    return (
        buffer[offset]   << 24 |
        buffer[offset+1] << 16 |
        buffer[offset+2] << 8  |
        buffer[offset+3]
        ) >>> 0; //to uint
}

function mp4ReadUint24(buffer, offset) {
    return (
        buffer[offset] << 16 |
        buffer[offset+1] << 8  |
        buffer[offset+2]
        ) >>> 0; //to uint
}

function mp4ReadUint16(buffer, offset) {
    return (
        buffer[offset] << 8  |
        buffer[offset+1]
        ) >>> 0; //to uint
}

function mp4ReadType(buffer, offset) {
    let result = '';
    for(let i=0; i<4; i++) {
        result += String.fromCharCode(buffer[offset+i]);
    }
    return result;
}

const MP4_A_CODE = 'a'.charCodeAt(0);
const MP4_Z_CODE = 'z'.charCodeAt(0);
function mp4IsProbableAtom(buffer, offset, allowInvalidLength=false) {
    if(offset >= buffer.byteLength-8) {
        return false;
    }
    let length = mp4ReadUint32(buffer, offset);
    if(offset+length >= buffer.byteLength && !allowInvalidLength) {
        return false;
    }
    //The type should basically be [a-z]
    let lengthSize = 4;
    for(let i=0; i<4; i++) {
        if(buffer[offset+lengthSize+i]<MP4_A_CODE || buffer[offset+lengthSize+i] > MP4_Z_CODE) {
            return false;
        }
    }
    return true;
}

function mp4DumpSIDX(buffer, atomOffset) {
    let b = buffer;
    let i = atomOffset+8;

    let version = buffer[i]; i++;
    let flags = mp4ReadUint24(b,i); i+=3;
    let referenceId = mp4ReadUint32(b,i); i+=4;
    let timescale = mp4ReadUint32(b,i); i+=4;
    let earliestPTS;
    if(version == 0) {
        earliestPTS = mp4ReadUint32(b,i); i+=4;
    } else {
        earliestPTS = mp4ReadUint64(b,i); i+=8;
    }
    let firstOffset = mp4ReadUint32(b,i); i+=4;
    let __reserved = mp4ReadUint16(b,i); i+=2;
    let entryCount = mp4ReadUint16(b,i); i+=2;

    WJR_DEBUG && console.debug('DEBUGV:           SIDX Entry Count '+entryCount);

    //Note here that fileOffset seems to refer to the offset relative to the end of the SIDX atom
    let fileOffset = firstOffset;
    for(let ei=0; ei<entryCount; ei++) {
        let referencedSize = mp4ReadUint32(b,i); i+=4;
        let subSegmentDuration = mp4ReadUint32(b,i); i+=4;
        i+=4; //unused
        WJR_DEBUG && console.debug(`DEBUGV:          SIDX Current offset ${fileOffset}, size ${referencedSize}, duration ${subSegmentDuration}`);
        fileOffset += referencedSize;
    }
}

function mp4DumpAtoms(buffers, debugString=null) {
    let fullBuffer = vidConcatBuffersToUint8Array(buffers);

    mp4DumpAtomsFromUint8Array(fullBuffer, debugString);
}

function mp4DumpAtomsFromUint8Array(fullBuffer, debugString=null, recurse=0) {
    //An atom consists of a 4-byte length followed by a 4 byte ASCII indicator.
    console.warn(`DEBUGV: Dumping atoms for Uint8Array.byteLength ${fullBuffer.byteLength} for ${debugString}`);
    let offset = 0;
    while(offset < fullBuffer.byteLength-7) {
        if(mp4IsProbableAtom(fullBuffer, offset, true)) {
            console.warn(`DEBUGV: Probable Atom start: ${offset} for ${debugString}`);
            break;
        }
        offset++;
    }
    while(offset < fullBuffer.byteLength-7) {
        let length = mp4ReadUint32(fullBuffer, offset);
        let type = mp4ReadType(fullBuffer, offset+4);
        let isComplete = offset + length <= fullBuffer.byteLength;
        console.warn(`DEBUGV: Atom ${type} ${offset} ${length} isComplete? ${isComplete} for ${debugString}`);
        if(type == 'sidx') {
            mp4DumpSIDX(fullBuffer, offset);
        }
        if(recurse > 0 && isComplete) {
            mp4DumpAtomsFromUint8Array(fullBuffer.slice(offset+8, offset+8+length), debugString, recurse - 1);
        }
        offset += length;
    }
}

function mp4IsProbableAtomOfType(buffer, offset, type, allowInvalidLength=false) {
    if(offset >= buffer.byteLength-8) {
        return false;
    }
    let length = mp4ReadUint32(buffer, offset);
    if(offset+length >= buffer.byteLength && !allowInvalidLength) {
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

function mp4ExtractFragments(fullBuffer, fileStartOffset, allowMdatFallback=false, debugString=null) {
    if(fullBuffer.length == 0) {
        return [];
    }
    let offset = 0;
    let wasProbableStartFound = false;
    while(offset < fullBuffer.byteLength-7) {
        if(mp4IsProbableAtomOfType(fullBuffer, offset, 'moof')) {
            WJR_DEBUG && console.debug(`DEBUGV: Probable fMP4 fragment start: ${offset} for ${debugString}`);
            wasProbableStartFound = true;
            break;
        }
        offset++;
    }
    if(!wasProbableStartFound) {
        if(!allowMdatFallback) {
            console.warn(`DEBUGV: No probable fMP4 start found for buffer length ${fullBuffer.length}, fallback to mdat not allowed for ${debugString}`);
            return [];
        }
        //This fallback is when a range request was made so it looked like DASH but was actually
        //a range request against a normal FTYP/MOOV/MDAT MP4.
        console.warn(`DEBUGV: No probable fMP4 start found for buffer length ${fullBuffer.length}, checking for mdat instead for ${debugString}`);
        wasProbableStartFound = false;
        offset = 0;
        while(offset < fullBuffer.byteLength-7) {
            if(mp4IsProbableAtomOfType(fullBuffer, offset, 'mdat', true)) {
                WJR_DEBUG && console.debug(`DEBUGV: Probable MP4 mdat start: ${offset} for ${debugString}`);
                wasProbableStartFound = true;
                break;
            }
            offset++;
        }
        if(wasProbableStartFound) {
            let mdatLength = mp4ReadUint32(fullBuffer, offset);
            let predictedEnd = offset + mdatLength;
            let isMdatComplete = predictedEnd <= fullBuffer.length;
            //It's a hack to use the full buffer but the lack of [free] can mess up the [moov] index references
            //I think; this causes images to go all black if not included
            console.warn(`DEBUGV: Fallback to mdat looks feasible - start offset was ${offset}, atom length ${mdatLength}, however, using remaining buffer to pick up e.g. [free]  (for ${debugString})`);
            let fakeFragment = {
                fileOffsetMoof: fileStartOffset, //just smash it in there
                fileOffsetMdat: fileStartOffset,
                moofMdatData: fullBuffer.slice(0, fullBuffer.length), //"copy"
                isMdatComplete: isMdatComplete,
                wasMdatFallback: true
            }
            return [fakeFragment];
        } else {
            console.warn(`DEBUGV: No fallback to mdat feasible. ${debugString}`);
            mp4DumpAtomsFromUint8Array(fullBuffer, debugString);
            return [];
        }
    }
    //Extract all fragments where at least the moof is complete
    //and the mdat is detectable, marking where incomplete
    let fragments = [];
    while(offset < fullBuffer.byteLength-7) {
        let moofLength = mp4ReadUint32(fullBuffer, offset);
        let moofType = mp4ReadType(fullBuffer, offset+4);
        if(moofType != 'moof') {
            console.warn(`Expected moof, got ${moofType} for ${debugString}`);
            break;
        }
        let isMoofCompleteAndMdatDetectable = offset + moofLength +8 <= fullBuffer.byteLength;
        if(!isMoofCompleteAndMdatDetectable) {
            break;
        }
        let mdatLength = mp4ReadUint32(fullBuffer, offset + moofLength);
        let mdatType = mp4ReadType(fullBuffer, offset + moofLength + 4);
        if(mdatType != 'mdat') {
            console.warn(`Expected mdat, got ${mdatType} for ${debugString}`);
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


function mp4ParseSIDX(buffer, atomOffset) {
    let b = buffer;
    let atomLength = mp4ReadUint32(buffer, atomOffset);
    let i = atomOffset+8;

    let version = buffer[i]; i++;
    let flags = mp4ReadUint24(b,i); i+=3;
    let referenceId = mp4ReadUint32(b,i); i+=4;
    let timescale = mp4ReadUint32(b,i); i+=4;
    let earliestPTS;
    if(version == 0) {
        earliestPTS = mp4ReadUint32(b,i); i+=4;
    } else {
        earliestPTS = mp4ReadUint64(b,i); i+=8;
    }
    let firstOffset = mp4ReadUint32(b,i); i+=4;
    let __reserved = mp4ReadUint16(b,i); i+=2;
    let entryCount = mp4ReadUint16(b,i); i+=2;

    //Note here that fileOffset seems to refer to the offset relative to the end of the SIDX atom
    let entries = { };
    let fileOffset = atomOffset + atomLength + firstOffset; //end of sidx + firstOffset
    for(let ei=0; ei<entryCount; ei++) {
        let referencedSize = mp4ReadUint32(b,i); i+=4;
        let subSegmentDuration = mp4ReadUint32(b,i); i+=4;
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

function mp4CreateFragmentedMp4(initBuffer) {
    //This expects the init buffers to have at least (ftyp moov sidx)
    //and then initial calls to have (moof mdat)+ fragments
    //This allows (ftyp moov) to be saved as the init segment
    //and (moof mdat)+ to be appended to create valid fMP4's.
    let offset = 0;
    let ftypLength = mp4ReadUint32(initBuffer, offset);
    let ftypType = mp4ReadType(initBuffer, offset+4);
    if(ftypType != 'ftyp') {
        throw `Fragmented MP4 expected to start with ftyp, found ${ftypType}`;
    }
    offset = ftypLength;
    let moovLength = mp4ReadUint32(initBuffer, offset);
    let moovType = mp4ReadType(initBuffer, offset+4);
    if(moovType != 'moov') {
        throw `Fragmented MP4 expected moov after ftyp, at index ${ftypLength} found ${moovType}`;
    }
    //Now we have ftyp+moov so we can build the init segment
    let initSegment = initBuffer.slice(0, ftypLength + moovLength);
    //Parse SIDX and build up the expected locations for (moof mdat) fragments
    offset = ftypLength + moovLength;
    let sidxLength = mp4ReadUint32(initBuffer, offset);
    let sidxType = mp4ReadType(initBuffer, offset+4);
    if(sidxType != 'sidx') {
        throw `Fragmented MP4 expected sidx after moov, at index ${ftypLength}+${moovLength} found ${sidxType} with length ${sidxType}`;
    }
    let dataStartIndex = offset + sidxLength;
    let sidx = mp4ParseSIDX(initBuffer, offset);

    let fmp4 = {
        initSegment: initSegment,
        dataStartIndex: dataStartIndex,
        sidx: sidx,
        doFragmentsMatch: function(fragments) { //as produced by extractFragments
            let matches = fragments.filter(f=>this.sidx.entries[f.fileOffsetMoof]!==undefined);
            let shouldQualify = matches.length == fragments.length;
            WJR_DEBUG && console.info(`YTVMP4: Fragment match count ${matches.length}/${fragments.length}, should qualify? ${shouldQualify}`);
            return shouldQualify;
        },
        markFragments: function(fragments, status) {
            for(let fragment of fragments) {
                this.sidx.entries[fragment.fileOffsetMoof].status = status;
            }
        }
    };
    
    return fmp4;
}

function mp4GetInitSegment(initBuffer, debugString=null) {
    //This expects the init buffers to have at least (ftyp moov)
    //and then initial calls to have (moof mdat)+ fragments
    //This allows (ftyp moov) to be saved as the init segment
    //and (moof mdat)+ to be appended to create valid fMP4's.
    let offset = 0;
    let ftypLength = mp4ReadUint32(initBuffer, offset);
    let ftypType = mp4ReadType(initBuffer, offset+4);
    if(ftypType != 'ftyp') {
        throw `Fragmented MP4 expected to start with ftyp, found ${ftypType} buffer length ${initBuffer.length} hex ${hex(initBuffer.slice(0,7))}, ${debugString}`;
    }
    offset = ftypLength;


    let totalFreeLength = 0;
    let moovLength = 0;

    while(offset < initBuffer.byteLength-7) {
        let moovOrFreeLength = mp4ReadUint32(initBuffer, offset);
        let moovOrFreeType = mp4ReadType(initBuffer, offset + 4);
        if(moovOrFreeType == 'free' || moovOrFreeType == 'mdat') {
            console.warn(`DEBUGV: Detected free/mdat of length ${moovOrFreeLength} between ftyp and moov for ${debugString}`);
            totalFreeLength += moovOrFreeLength;
            offset += moovOrFreeLength;
            continue;
        } else if(moovOrFreeType == 'moov') {
            moovLength = moovOrFreeLength;
            break;
        } else {
            throw `Fragmented MP4 expected moov or free, at index ${offset} got ${moovOrFreeType} ${debugString}`;
        }
    }
    //Now we have ftyp+moov so we can build the init segment
    let initSegment = initBuffer.slice(0, ftypLength + totalFreeLength + moovLength);
    let moovAtom = initBuffer.slice(ftypLength + totalFreeLength, ftypLength + totalFreeLength + moovLength);
    let isAudioOnly = false;
    WJR_DEBUG && console.debug(`TKHD: Checking detection for moov atom of length ${moovLength}`);
    //let moovAtomContents = moovAtom.slice(8);
    //mp4DumpAtomsFromUint8Array(moovAtomContents, debugString, recurse=2);
    for(let i=0; i<moovLength; i++) {
        if(mp4IsProbableAtomOfType(moovAtom, i, 'tkhd', true)) {
            //84 is start of track width
            let tkhdLength = mp4ReadUint32(moovAtom, i);
            if(tkhdLength >= 92) {
                //Note these are actually floats but for zero detection this is enough.
                let trackWidth = mp4ReadUint32(moovAtom, i+8+76);
                let trackHeight = mp4ReadUint32(moovAtom, i+8+80);
                isAudioOnly = (trackWidth == 0 && trackHeight == 0);
                WJR_DEBUG && console.info(`TKHD: Detected size of ${trackWidth}, ${trackHeight} indicating isAudioOnly=${isAudioOnly} for ${debugString}`);
            } else {
                console.warn(`TKHD: Detected strange length of ${tkhdLength} for ${debugString}`);
            }
        }
    }

    return [initSegment, isAudioOnly];
}

function mp4IsLikelyProbe(u8Array) {
    if(u8Array.byteLength < 8) {
        return false;
    }
    let ftypType = mp4ReadType(initBuffer, offset+4);
    return ftypType == 'ftyp';
}