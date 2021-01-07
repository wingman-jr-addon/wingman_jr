
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
    { id: 0x1A45DFA3, name: "EBML"},
    { id: 0x18538067, name: "Segment" },
    { id: 0x114D9B74, name: "Seekhead" },
    { id: 0x1C53BB6B, name: "Cues" },
    { id: 0xBB,       name: "CuePoint" },
    { id: 0xB7,       name: "CueTrackPositions" },
    { id: 0xF1,       name: "CueClusterPosition" },
    { id: 0xF0,       name: "CueRelativePosition" }
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
        while(i < startIndex+length) {
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
        console.error(`Error parsing EBML somewhere around ${i}`);
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

//Generate the global file position indices of the Cues
function ebmlGenerateCuesIndex(u8Array) {
    //General strategy:
    //1) Find the Segment and mark so we know the relative position
    //2) Find the Segment->Cues->CuePoint->CueTrackPositions, CueClusterPosition

    let idCache = ['Segment','Cues','CuePoint','CueTrackPositions'].map(name=>EBML_DEFS_BY_NAME[name].id);
    let structs = ebmlStruct(u8Array, 0, u8Array.length, id=>idCache.indexOf(id)>=0);

    let segmentStruct = structs.find(s=>s.id == EBML_DEFS_BY_NAME['Segment'].id);
    let segmentStartIndex = segmentStruct.dataStartIndex;

    let cues = segmentStruct.children.filter(s=>s.id == EBML_DEFS_BY_NAME['Cues'].id);
    let cuePoints = cues.flatMap(s=>s.children).filter(s=>s.id == EBML_DEFS_BY_NAME['CuePoint'].id);
    let cueTrackPositions = cuePoints.flatMap(s=>s.children).filter(s=>s.id == EBML_DEFS_BY_NAME['CueTrackPositions'].id);

    let indices = [];
    for(let ctp of cueTrackPositions) {
        //At present we don't actually care which track it belongs to although this is ordinarily
        //important.
        let ccp = ctp.children.find(s=>s.id == EBML_DEFS_BY_NAME['CueClusterPosition'].id);
        let ccpOffset = ebmlDecodeU(u8Array, ccp);
        let globalIndex = segmentStartIndex + ccpOffset;
        indices.push(globalIndex);
    }
    return indices;
}