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
function mp4IsProbableAtom(buffer, offset) {
    if(offset >= buffer.byteLength-8) {
        return false;
    }
    let length = mp4ReadUint32(buffer, offset);
    if(offset+length >= buffer.byteLength) {
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

    console.debug('DEBUGV:           SIDX Entry Count '+entryCount);

    //Note here that fileOffset seems to refer to the offset relative to the end of the SIDX atom
    let fileOffset = firstOffset;
    for(let ei=0; ei<entryCount; ei++) {
        let referencedSize = mp4ReadUint32(b,i); i+=4;
        let subSegmentDuration = mp4ReadUint32(b,i); i+=4;
        i+=4; //unused
        console.debug(`DEBUGV:          SIDX Current offset ${fileOffset}, size ${referencedSize}, duration ${subSegmentDuration}`);
        fileOffset += referencedSize;
    }
}

function mp4DumpAtoms(buffers) {
    let fullBuffer = vidConcatBuffersToUint8Array(buffers);

    //An atom consists of a 4-byte length followed by a 4 byte ASCII indicator.
    let offset = 0;
    while(offset < fullBuffer.byteLength-7) {
        if(mp4IsProbableAtom(fullBuffer, offset)) {
            console.debug('DEBUGV: Probable Atom start: '+offset);
            break;
        }
        offset++;
    }
    while(offset < fullBuffer.byteLength-7) {
        let length = mp4ReadUint32(fullBuffer, offset);
        let type = mp4ReadType(fullBuffer, offset+4);
        let isComplete = offset + length <= fullBuffer.byteLength;
        console.debug(`DEBUGV: Atom ${type} ${offset} ${length} isComplete? ${isComplete}`);
        if(type == 'sidx') {
            mp4DumpSIDX(fullBuffer, offset);
        }
        offset += length;
    }
}

function mp4IsProbableAtomOfType(buffer, offset, type) {
    if(offset >= buffer.byteLength-8) {
        return false;
    }
    let length = mp4ReadUint32(buffer, offset);
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

function mp4ExtractFragments(fullBuffer, fileStartOffset) {
    let offset = 0;
    while(offset < fullBuffer.byteLength-7) {
        if(mp4IsProbableAtomOfType(fullBuffer, offset, 'moof')) {
            console.debug('DEBUGV: Probable fMP4 fragment start: '+offset);
            break;
        }
        offset++;
    }
    //Extract all fragments where at least the moof is complete
    //and the mdat is detectable, marking where incomplete
    let fragments = [];
    while(offset < fullBuffer.byteLength-7) {
        let moofLength = mp4ReadUint32(fullBuffer, offset);
        let moofType = mp4ReadType(fullBuffer, offset+4);
        if(moofType != 'moof') {
            console.warn(`Expected moof, got ${moofType}`);
            break;
        }
        let isMoofCompleteAndMdatDetectable = offset + moofLength +8 <= fullBuffer.byteLength;
        if(!isMoofCompleteAndMdatDetectable) {
            break;
        }
        let mdatLength = mp4ReadUint32(fullBuffer, offset + moofLength);
        let mdatType = mp4ReadType(fullBuffer, offset + moofLength + 4);
        if(mdatType != 'mdat') {
            console.warn(`Expected mdat, got ${mdatType}`);
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
        throw `Fragmented MP4 expected moov after ftyp, found ${moovType}`;
    }
    //Now we have ftyp+moov so we can build the init segment
    let initSegment = initBuffer.slice(0, ftypLength + moovLength);
    //Parse SIDX and build up the expected locations for (moof mdat) fragments
    offset = ftypLength + moovLength;
    let sidxLength = mp4ReadUint32(initBuffer, offset);
    let sidxType = mp4ReadType(initBuffer, offset+4);
    if(sidxType != 'sidx') {
        throw `Fragmented MP4 expected sidx after moov, found ${sidxType}`;
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
            console.info(`YTVMP4: Fragment match count ${matches.length}/${fragments.length}, should qualify? ${shouldQualify}`);
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
