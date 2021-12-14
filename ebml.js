
function ebmlDecodeVarint(u8Array, index) {
    //See http://matroska-org.github.io/libebml/specs.html
    //The lengths are fully dependent on the first byte.
    if(index > u8Array.length) {
        throw `EBML: Starting index ${index} exceeded the bound of the array of length ${u8Array.length}`;
    }
    let firstByte = u8Array[index];
    if(firstByte == 0) {
        throw `EBML: First byte of value 0 encodes to a length greater than spec allows at index ${index}`;
    }
    let bitChecker = 0x80;
    let byteLength = 1;
    let mask = 0x7F;
    let unmaskedValue = u8Array[index];
    while(byteLength <= 8 &&
        !(firstByte & bitChecker) &&
        index+byteLength < u8Array.length)
    {
        bitChecker>>=1;
        mask = (mask << 7) | 0xFF;
        unmaskedValue = unmaskedValue<<8 | u8Array[index+byteLength];
        byteLength++;
    }   
    if(index + byteLength == u8Array.length) {
        throw `EBML: Length was exceeded while trying to decode varint at starting index ${index}`;
    }
    let value = unmaskedValue & mask;
    return {
        index: index,
        byteLength: byteLength,
        value: value,
        mask: mask,
        unmaskedValue: unmaskedValue
    };
}

function ebmlDecodeU(u8Array, struct) {
    let result = 0;
    for(let i=0; i<struct.length; i++) {
        result <<= 8;
        result |= u8Array[struct.dataStartIndex+i];
    }
    return result;
}

//It should be noted that ID's are actually the *unmasked* values when read, unlike length.
const EBML_DEFS = [
    { id: 0x1A45DFA3, name: 'EBML'},
    { id: 0x18538067, name: 'Segment' },
    { id: 0x1549A966, name: 'SegmentInformation' },
    { id: 0x114D9B74, name: 'Seekhead' },
    { id: 0x1654AE6B, name: 'Tracks' },
    { id: 0x1C53BB6B, name: 'Cues' },
    { id: 0xBB,       name: 'CuePoint' },
    { id: 0xB7,       name: 'CueTrackPositions' },
    { id: 0xF1,       name: 'CueClusterPosition' },
    { id: 0xF0,       name: 'CueRelativePosition' },
    { id: 0x1F43B675, name: 'Cluster'},
    { id: 0xA3,       name: 'SimpleBlock' },
    { id: 0xA0,       name: 'BlockGroup' }
];

let EBML_DEFS_BY_ID = { };
let EBML_DEFS_BY_NAME = { };
for(let ebmlDef of EBML_DEFS) {
    EBML_DEFS_BY_ID[ebmlDef.id] = ebmlDef;
    EBML_DEFS_BY_NAME[ebmlDef.name] = ebmlDef;
}


function ebmlShouldRecurse(id) {
    return EBML_DEFS_BY_ID[id] !== undefined;
}

//Parse the EBML stream into an array of structures, with substructures as requested
//Note that this does NOT detect/handle the unknown length indicator
function ebmlStruct(u8Array, startIndex, length, shouldRecursePredicate) {
    if(startIndex === undefined) {
        startIndex = 0;
    }
    if(length === undefined) {
        length = u8Array.length - startIndex;
    }
    if(shouldRecursePredicate === undefined) {
        shouldRecursePredicate = ebmlShouldRecurse;
    }
    let elements = [];
    let i = startIndex;
    try {
        while(i < startIndex+length && i<u8Array.length) {
            let elementStartIndex = i;
            let idV = ebmlDecodeVarint(u8Array, i);
            i += idV.byteLength;
            let lengthV = ebmlDecodeVarint(u8Array, i);
            i += lengthV.byteLength;

            let element = { id: idV.unmaskedValue, length: lengthV.value, startIndex: elementStartIndex, dataStartIndex: i};

            if(shouldRecursePredicate(element.id)) {
                element.children = ebmlStruct(u8Array, i, lengthV.value, shouldRecursePredicate);
            }

            i += lengthV.value;

            elements.push(element);
        }
    } catch(e) {
        console.warn(`Error parsing EBML somewhere around ${i}`);
    }
    return elements;
}

function ebmlDump(structArray, level) {
    if (level === undefined) {
        level = 0;
    }
    let prefix = '|'+' '.repeat(level)+'+ ';
    let result = '';
    for(let element of structArray) {
        let def = EBML_DEFS_BY_ID[element.id];
        let name = def ? def.name : '(Unknown 0x'+element.id.toString(16)+')';
        let line = prefix + name + ' at '+element.startIndex+' (data at '+element.dataStartIndex+') length '+element.length;
        result += line + '\r\n';
        if(element.children !== undefined) {
            result += ebmlDump(element.children, level + 1);
        }
    }
    return result;
}

//Generate the WebM initialization segment and Cues index
function ebmlCreateFragmentedWebM(u8Array) {
    //General strategy:
    //1) Find the Segment and mark so we know the relative position
    //2) Find the end of the Segment->SegmentInformation section so we can build a generic initialization segment
    //3) Find the Segment->Cues->CuePoint->CueTrackPositions, CueClusterPosition
    //4) If available, find the first Cluster and indicate that as the data start

    let idCache = ['Segment','Cues','CuePoint','CueTrackPositions'].map(name=>EBML_DEFS_BY_NAME[name].id);
    let structs = ebmlStruct(u8Array, 0, u8Array.length, id=>idCache.indexOf(id)>=0);

    //1) Find the Segment
    let segmentStruct = structs.find(s=>s.id == EBML_DEFS_BY_NAME['Segment'].id);
    let segmentStartIndex = segmentStruct.dataStartIndex;

    //2) Build the generic initialization segment
    let infoStruct = segmentStruct.children.find(s=>s.id == EBML_DEFS_BY_NAME['SegmentInformation'].id);
    let endOfInfoIndex = infoStruct.dataStartIndex + infoStruct.length;
    let tracksStruct = segmentStruct.children.find(s=>s.id == EBML_DEFS_BY_NAME['Tracks'].id);
    let endOfTracksIndex = tracksStruct.dataStartIndex + tracksStruct.length;
    let endOfInitIndex = Math.max(endOfInfoIndex, endOfTracksIndex);
    let initBuffer = u8Array.slice(0, endOfInitIndex);
    
    //Now futz with it to make the segment length unknown instead of whatever we had.
    //First re-read the id and length manually so we can tweak on length
    let segmentId = ebmlDecodeVarint(initBuffer, segmentStruct.startIndex);
    let segmentLengthIndex = segmentStruct.startIndex + segmentId.byteLength;
    let segmentLength = ebmlDecodeVarint(initBuffer, segmentLengthIndex);
    //The trick here is to set the length to unknown. Since this is all 1's (regardless of size), we
    //can coincidentally reuse the mask (with an extra 1) in the decode routine as the value here.
    let unknownValue = segmentLength.mask << 1 | 0x01;
    for(let i=segmentLength.byteLength-1; i>=0; i--, unknownValue>>=8) {
        initBuffer[segmentLengthIndex+i] = unknownValue & 0xFF;
    }

    //3) Build index from Cues
    let cues = segmentStruct.children.filter(s=>s.id == EBML_DEFS_BY_NAME['Cues'].id);
    let cuePoints = cues.flatMap(s=>s.children).filter(s=>s.id == EBML_DEFS_BY_NAME['CuePoint'].id);
    let cueTrackPositions = cuePoints.flatMap(s=>s.children).filter(s=>s.id == EBML_DEFS_BY_NAME['CueTrackPositions'].id);

    let indices = { };
    for(let ctp of cueTrackPositions) {
        //At present we don't actually care which track it belongs to although this is ordinarily
        //important.
        let ccp = ctp.children.find(s=>s.id == EBML_DEFS_BY_NAME['CueClusterPosition'].id);
        let ccpOffset = ebmlDecodeU(u8Array, ccp);
        let globalIndex = segmentStartIndex + ccpOffset;
        indices[globalIndex] = { offset: globalIndex, status: 'unknown' };
    }

    let firstCluster = segmentStruct.children.find(s=>s.id == EBML_DEFS_BY_NAME['Cluster'].id);
    let clusterStartIndex = undefined;
    if(firstCluster) {
        clusterStartIndex = firstCluster.startIndex;
    }

    return {
        initSegment: initBuffer,
        clusterStartIndex: clusterStartIndex,
        segmentStartIndex: segmentStartIndex,
        indices: indices,
        doFragmentsMatch: function(fragments) { //as produced by ebmlExtractFragments
            //NOTE: Just starting with this logic. By spec, not all Clusters are
            //in here, so we do a reduced check.
            let matches = fragments.filter(f=>this.indices[f.fileOffsetCluster]!==undefined);
            let shouldQualify = matches.length >= 2 || matches.length >= fragments.length
                || (matches.length >= 1 && fragments.length <= 3);
            WJR_DEBUG && console.info(`YTVWEBM: Fragment match count ${matches.length}/${fragments.length}, should qualify? ${shouldQualify}`);
            return shouldQualify;
        },
        markFragments: function(fragments, status) {
            for(let fragment of fragments) {
                if(this.indices[fragment.fileOffsetCluster] !== undefined) {
                    this.indices[fragment.fileOffsetCluster].status = status;
                }
            }
        }
    };
}

//This is a specialized method to simply probe if the location is likely the start of a Cluster
const EBML_CLUSTER_ID_ARRAY = [0x1F, 0x43, 0xB6, 0x75];
function ebmlIsLikelyCluster(u8Array, index) {
    for(let i=index; i<index+4 && i<u8Array.length; i++) {
        if(u8Array[i] != EBML_CLUSTER_ID_ARRAY[i]) {
            return false;
        }
    }
    //One last thing we can do is to make sure - if we have more data - is to guarantee the
    //next byte is not 0 because that would lead to an invalid length
    return index+4 >= u8Array.length || u8Array[index+4] != 0;
}

function ebmlExtractFragments(u8Array, fileStartOffset) {
    //Basic strategy: find the start of the first Cluster, then gather all
    //Clusters / partial Clusters after that
    let offset = 0;
    while(offset < u8Array.byteLength-1) {
        if(ebmlIsLikelyCluster(u8Array, offset)) {
            WJR_DEBUG && console.debug('DEBUGV: Probable fWebM Cluster start: '+offset);
            break;
        }
        offset++;
    }
    let structs = ebmlStruct(u8Array, offset, u8Array.length-offset, id=>false /* No subelements */);
    let clusterStructs = structs.filter(s=>s.id == EBML_DEFS_BY_NAME['Cluster'].id);
    let fragments = [];
    for(let clusterStruct of clusterStructs) {
        let endOfClusterIndex = clusterStruct.dataStartIndex + clusterStruct.length;
        let isClusterComplete = endOfClusterIndex >= u8Array.length;
        fragments.push({
            fileOffsetCluster: fileStartOffset + clusterStruct.startIndex,
            clusterData: u8Array.slice(clusterStruct.startIndex, isClusterComplete ? endOfClusterIndex : u8Array.length - 1),
            isClusterComplete: isClusterComplete
        });
    }
    return fragments;
}

//This is a specialized method to simply probe if the location is likely the start of a Cluster
const EBML_EBML_ID_ARRAY = [0x1A, 0x45, 0xDF, 0xA3];
function ebmlIsLikelyProbe(u8Array) {
    if(u8Array.byteLength < 4) {
        return false;
    }
    for(let i=0; i<4; i++) {
        if(u8Array[i] != EBML_CLUSTER_ID_ARRAY[i]) {
            return false;
        }
    }
    return true;
}