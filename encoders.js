/* Works in conjuction with auto-generated encoders_data.js
   The optimal data structures in that objects are not able to 
   be generated due to limitations of JSON int key maps, so
   first thing is to repack it quick */
console.log('CHARSET: Repacking encoder data from '+TEXT_ENCODINGS_RAW);
for(let ei=0; ei<TEXT_ENCODINGS_RAW.length; ei++) {
    let encoding = TEXT_ENCODINGS_RAW[ei];
    if(encoding.dotnet_name == null) {
        console.warn('CHARSET: Encoding had no correspondence: '+encoding.name);
        continue
    }
    if(encoding.codePoints == null || encoding.bytesForCodePoints == null) {
        console.error('CHARSET: Encoding failed to provide a map '+encoding.name);
        continue;
    }
    if(encoding.codePoints.length != encoding.bytesForCodePoints.length) {
        console.error('CHARSET: Encoding map codepoint/byte count mismatch: '+encoding.name);
        continue;
    }
    encoding.codePointsToBytes = {};
    for(let i=0; i<encoding.codePoints.length; i++) {
        encoding.codePointsToBytes[encoding.codePoints[i]] = encoding.bytesForCodePoints[i];
    }
    //Clean up large data arrays present in map
    encoding.codePoints = null;
    encoding.bytesForCodePoints = null;
    console.log('CHARSET: Repacked encoding '+encoding.name + ' with aliases '+encoding.aliases);
}

/* Now map using the alias names. Note here that the encoding
   name should NOT be used, because there are instances where
   this will create a problem. Browsers map what is called
   "iso-8859-1" from the served page to "windows-1252" for
   historical reasons. */
let TEXT_ENCODINGS = {};
let TEXT_ENCODINGS_COUNT = 0;
for(let ei=0; ei<TEXT_ENCODINGS_RAW.length; ei++) {
    let encoding = TEXT_ENCODINGS_RAW[ei];
    for(let ai=0; ai<encoding.aliases.length; ai++) {
        let alias = encoding.aliases[ai];
        TEXT_ENCODINGS[alias] = encoding;
        TEXT_ENCODINGS_COUNT++;
    }
}

console.log('CHARSET: Repacked '+TEXT_ENCODINGS_COUNT+' encodings.');