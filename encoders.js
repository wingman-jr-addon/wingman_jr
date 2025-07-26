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


// This helper method does a few things regarding character encoding:
// 1) Detects the charset for the TextDecoder so that bytes are properly turned into strings
// 2) Ensures the output Content-Type is UTF-8 because that is what TextEncoder supports
// 3) Returns the decoder/encoder pair
function encDetectCharsetAndSetupDecoderEncoder(details) {
    let contentType = '';
    let headerIndex = -1;
    for (let i = 0; i < details.responseHeaders.length; i++) {
        let header = details.responseHeaders[i];
        if (header.name.toLowerCase() == "content-type") {
            contentType = header.value.toLowerCase();
            headerIndex = i;
            break;
        }
    }
    for (let i = 0; i < details.responseHeaders.length; i++) {
        let header = details.responseHeaders[i];
        WJR_DEBUG && console.debug('CHARSET:  '+header.name+': '+header.value);
    }
    if (headerIndex == -1) {
      WJR_DEBUG && console.debug('CHARSET: No Content-Type header detected for '+details.url+', adding one by guessing.');
      contentType = encGuessContentType(details);
      headerIndex = details.responseHeaders.length;
      details.responseHeaders.push(
        {
          "name": "Content-Type",
          "value": contentType
        }
      );
    }

    let baseType;
    let trimmedContentType = contentType.trim();
    if(trimmedContentType.startsWith('text/html')) {
      baseType = 'text/html';
      WJR_DEBUG && console.debug('CHARSET: Detected base type was '+baseType);
    } else if(trimmedContentType.startsWith('application/xhtml+xml')) {
      baseType = 'application/xhtml+xml';
      WJR_DEBUG && console.debug('CHARSET: Detected base type was '+baseType);
    } else if(trimmedContentType.startsWith('image/')) {
      WJR_DEBUG && console.debug('CHARSET: Base64 listener is ignoring '+details.requestId+' because it is an image/ MIME type');
      return;
    } else if(trimmedContentType == 'application/pdf') {
      WJR_DEBUG && console.debug('CHARSET: Base64 listener is ignoring '+details.requestId+' because it is a PDF MIME type');
      return;
    } else {
      baseType = 'text/html';
      WJR_DEBUG && console.debug('CHARSET: The Content-Type was '+contentType+', not text/html or application/xhtml+xml.');
      return;
    }

    // Character set detection is quite a difficult problem.
    // If modifying this block of code, ensure that the tests at
    // https://www.w3.org/2006/11/mwbp-tests/index.xhtml
    // all pass - current implementation passes on all
    let decodingCharset = 'utf-8';
    let detectedCharset = encDetectCharset(contentType);

    if (detectedCharset !== undefined) {
        decodingCharset = detectedCharset;
        WJR_DEBUG && console.debug('CHARSET: Detected charset was ' + decodingCharset + ' for ' + details.url);
    } else if(trimmedContentType.startsWith('application/xhtml+xml')) {
        decodingCharset = 'utf-8';
        WJR_DEBUG && console.debug('CHARSET: No detected charset, but content type was application/xhtml+xml so using UTF-8');
    } else {
        decodingCharset = undefined;
        WJR_DEBUG && console.debug('CHARSET: No detected charset, moving ahead with Windows-1252 until sniff finds an encoding or decoding error encountered!');
    }

    let decoder = new TextDecoderWithSniffing(decodingCharset);
    let encoder = new TextEncoderWithSniffing(decoder);

    return [decoder, encoder];
}

function encConcatBuffersToUint8Array(buffers) {
    let fullLength = buffers.reduce((acc,buf)=>acc+buf.byteLength, 0);
    let result = new Uint8Array(fullLength);
    let offset = 0;
    for(let buffer of buffers) {
        result.set(new Uint8Array(buffer), offset);
        offset += buffer.byteLength;
    }
    return result;
}

function encIsUtf8Alias(declType) {
    //Passes all 6 aliases found at https://encoding.spec.whatwg.org/#names-and-labels
    return (/.*utf.?8/gmi.test(declType));
}

function encSniffExtractEncoding(sniffString) {
    try {
        const xmlParts = /<\?xml\sversion="1\.0"\s+encoding="([^"]+)"\?>/gm.exec(sniffString);
        if(xmlParts) {
            return xmlParts[1];
        }
        const metaParts = /<meta[^>]+charset="?([^"]+)"/igm.exec(sniffString);
        if(metaParts) {
            return metaParts[1];
        }
    } catch (ex) {
        console.error('CHARSET: Sniff extraction exception: '+ex);
    }
    return null;
}

const SNIFF_SIZE = 2048; //Spec says 1024 but I've seen bad script headers exceed that prior to a declaration

function TextDecoderWithSniffing(declType)
{
    let self = this;
    self.currentType = declType;
    self.decoder = (self.currentType === undefined) ? new TextDecoder('utf-8', { ignoreBOM: true, fatal: true }) : new TextDecoder(self.currentType);
    self.sniffBufferList = [];
    self.sniffCount = 0;

    // Auto-generated, but seems generally sound
    self.isLikelyUtf8 = function(buf) {
        const n = buf.length;
        let i = 0;

        while (i < n) {
            const b1 = buf[i];

            // 1-byte (ASCII)
            if (b1 <= 0x7F) { i++; continue; }

            // 2-byte (U+0080-07FF) — lead C2-DF, trail 80-BF
            if (0xC2 <= b1 && b1 <= 0xDF) {
                if (i + 1 >= n) return false;
                const b2 = buf[i + 1];
                if (b2 < 0x80 || b2 > 0xBF) return false;
                i += 2;
                continue;
            }

            // 3-byte (U+0800-FFFF, excluding surrogates)
            if (0xE0 <= b1 && b1 <= 0xEF) {
                if (i + 2 >= n) return false;
                const b2 = buf[i + 1], b3 = buf[i + 2];
                if (b2 < 0x80 || b2 > 0xBF || b3 < 0x80 || b3 > 0xBF) return false;
                if (b1 === 0xE0 && b2 < 0xA0) return false;   // over-long
                if (b1 === 0xED && b2 > 0x9F) return false;   // surrogate range
                i += 3;
                continue;
            }

            // 4-byte (U+10000-10FFFF)
            if (0xF0 <= b1 && b1 <= 0xF4) {
                if (i + 3 >= n) return false;
                const b2 = buf[i + 1], b3 = buf[i + 2], b4 = buf[i + 3];
                if (
                    b2 < 0x80 || b2 > 0xBF ||
                    b3 < 0x80 || b3 > 0xBF ||
                    b4 < 0x80 || b4 > 0xBF
                ) return false;
                if (b1 === 0xF0 && b2 < 0x90) return false;   // over-long
                if (b1 === 0xF4 && b2 > 0x8F) return false;   // > U+10FFFF
                i += 4;
                continue;
            }

            // Any other lead byte (C0/C1, F5-FF) or stray continuation byte is illegal
            return false;
        }

        return true;
    };

    self.isSniffComplete = false;
    self.decode = function(buffer, options) {
        //Use an empty buffer as a forced flush
        let isFlush = (buffer.byteLength == 0);
        if(isFlush) {
            WJR_DEBUG && console.log('CHARSET: Empty buffer received, treating as flush. Sniff previously complete? '+self.isSniffComplete);
        }
        if(!self.isSniffComplete) {
            try {
                self.sniffBufferList.push(buffer);
                self.sniffCount += buffer.byteLength;
                WJR_DEBUG && console.debug('CHARSET: Sniff count '+self.sniffCount);
                if(isFlush || self.sniffCount >= SNIFF_SIZE) {

                    let fullSniffBuffer = encConcatBuffersToUint8Array(self.sniffBufferList);
                    if(self.sniffCount < 3) {
                        WJR_DEBUG && console.warn('CHARSET: Less than 3 characters to sniff, skipping BOM check');
                    } else {
                        let bom = new Uint8Array(fullSniffBuffer, 0, 3);
                        if(bom[0] == 0xEF && bom[1] == 0xBB && bom[2] == 0xBF) {
                            WJR_DEBUG && console.log('CHARSET: Sniff found utf-8 BOM');
                            self.currentType = 'utf-8';
                        }
                    }

                    self.sniffBufferList = null;
                    let tmpDecoder = new TextDecoder('iso-8859-1');
                    let sniffString = '';
                    try {
                        sniffString = tmpDecoder.decode(fullSniffBuffer);
                    } catch(ex) {
                        WJR_DEBUG && console.warn('CHARSET: Sniff string decode failed initially, so only pattern will work. '+ex);
                    }
                    if(sniffString.length > SNIFF_SIZE) {
                        sniffString = sniffString.substring(0, SNIFF_SIZE);
                    }
                    WJR_DEBUG && console.debug('CHARSET: Sniff string constructed: '+sniffString);
                    let extractedEncoding = encSniffExtractEncoding(sniffString);
                    if(extractedEncoding) {
                        WJR_DEBUG && console.log('CHARSET: Sniff found decoding of '+extractedEncoding+' by examining header, changing decoder');
                        self.currentType = extractedEncoding.toLowerCase();
                        self.decoder = new TextDecoder(self.currentType);
                    } else {
                        WJR_DEBUG && console.log('CHARSET: Sniff string did not indicate encoding, testing if likely utf-8');
                        if(self.isLikelyUtf8(fullSniffBuffer)) {
                            WJR_DEBUG && console.log('CHARSET: Text was likely utf-8, treating as such.');
                            self.decoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
                            self.currentType = 'utf-8';
                        } else {
                            WJR_DEBUG && console.log('CHARSET: Text was not clearly utf-8, falling back to locale approach');
                            self.decoder = new TextDecoder('iso-8859-1');
                            self.currentType = 'iso-8859-1';
                        }
                    }
                    self.isSniffComplete = true;

                    return self.decoder.decode(fullSniffBuffer, options);
                } else {
                    WJR_DEBUG && console.log('CHARSET: Sniff chunk received but not enough to complete sniff. Buffer: '+self.sniffCount);
                    return '';
                }
            } catch (ex) {
                WJR_DEBUG && console.warn('CHARSET: Sniff exception, aborting. Falling back from '+self.currentType+' to iso-8859-1 (Exception: '+ex+')');
                self.decoder = new TextDecoder('iso-8859-1');
                self.currentType = 'iso-8859-1';
                self.isSniffComplete = true;

                return self.decoder.decode(buffer, options);
            }
        } else {
            WJR_DEBUG && console.debug('CHARSET: Effective decoding ' + self.currentType);
            return self.decoder.decode(buffer, options);
        }
    }
}

function TextEncoderWithSniffing(decoder) {
    let self = this;
    self.utf8Encoder = new TextEncoder();
    self.linkedDecoder = decoder;

    self.encode = function(str) {
        WJR_DEBUG && console.debug('CHARSET: Encoding with decoder current type '+self.linkedDecoder.currentType);

        if(encIsUtf8Alias(self.linkedDecoder.currentType)) {
            WJR_DEBUG && console.debug('CHARSET: Encoding utf-8');
            return self.utf8Encoder.encode(str);
        }
        console.log('CHARSET: Test '+TEXT_ENCODINGS[self.linkedDecoder.currentType]);
        let effectiveEncoding = TEXT_ENCODINGS[self.linkedDecoder.currentType] ?? TEXT_ENCODINGS['iso-8859-1'];
        WJR_DEBUG && console.debug('CHARSET: Effective encoding ' + effectiveEncoding.name);
        let outputRaw = [];
        let untranslatableCount = 0;
        for(const codePoint of str) {
            let initialCodePoint = codePoint.codePointAt(0);
            let bytes = effectiveEncoding.codePointsToBytes[initialCodePoint];
            if(bytes !== undefined) {
                for(let i=0; i<bytes.length; i++) {
                    outputRaw.push(bytes[i]);
                }
            } else {
                //If no character encoding was specified, the default is a bit sketchy but locale-defined
                //However, I've seen pages where it wasn't specified, the default should be iso-8859-1/Windows-1252
                //and yet the content was actually utf-8. Since this is a passthrough, retry encoding as utf-8
                //in that specific circumstance
                if(self.linkedDecoder.currentType === undefined) {
                    console.warn('CHARSET: Encoding was unspecified, but iso-8859-1 encoding failed, so falling back to utf-8');
                    return self.utf8Encoder.encode(str);
                }
                if(untranslatableCount == 0) {
                    console.warn('CHARSET: untranslatable code point '+initialCodePoint+' found while charset='+self.linkedDecoder.currentType);
                }
                untranslatableCount++;
            }
        }
        let result = new Uint8Array(outputRaw);
        WJR_DEBUG && console.log('CHARSET: re-encoded '+result.length+' bytes ('+untranslatableCount+' untranslated code points) with effective encoding '+ effectiveEncoding.name);
        return result;
    }
}

// Guess the content type when none is supplied
// Ideally this would actually look at the bytes supplied but we
// don't have those available yet, so do some hacky guessing
function encGuessContentType(details) {
    try {
        for (let i = 0; i < details.responseHeaders.length; i++) {
            let header = details.responseHeaders[i];
            // If no content-type was specified BUT a default filename was
            // provided, fallback to a MIME type derived from the extension - YUCK
            // e.g. content-disposition: inline; filename="user-guide-nokia-5310-user-guide.pdf" -> application/pdf
            // Note: we will not try to handle filename* as per https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Disposition
            // and https://datatracker.ietf.org/doc/html/rfc5987#page-7
            if (header.name.toLowerCase() == "content-disposition") {
                let filenameMatches = [...header.value.matchAll(/filename[ ]*=[ ]*\"([^\"]*)\"/g)];
                if(filenameMatches.length > 0) {
                    let filename = filenameMatches[0][1]; //First capture group of first match
                    let extensionMatch = filename.match(/\.[^\.]+$/);
                    if(extensionMatch != null && extensionMatch.length > 0) {
                        let extension = extensionMatch[0];
                        switch(extension) {
                            case ".pdf":
                                WJR_DEBUG && console.debug('CHARSET: Guessed content type application/pdf using extension ' + extension + ' for ' + details.url);
                                return 'application/pdf';
                            default:
                                WJR_DEBUG && console.debug('CHARSET: Unhandled file extension "' + extension + '" for ' + details.url);
                                break;
                        }
                    }
                }
                break;
            }
        }
    } catch(e) {
        console.error('CHARSET: Exception guessing content type when none supplied for '+details.url+' '+e);
    }
    return 'text/html';
}


// Detect the charset from Content-Type
function encDetectCharset(contentType) {
    /*
    From https://tools.ietf.org/html/rfc7231#section-3.1.1.5:

    A parameter value that matches the token production can be
    transmitted either as a token or within a quoted-string.  The quoted
    and unquoted values are equivalent.  For example, the following
    examples are all equivalent, but the first is preferred for
    consistency:

    text/html;charset=utf-8
    text/html;charset=UTF-8
    Text/HTML;Charset="utf-8"
    text/html; charset="utf-8"

    Internet media types ought to be registered with IANA according to
    the procedures defined in [BCP13].

    Note: Unlike some similar constructs in other header fields, media
    type parameters do not allow whitespace (even "bad" whitespace)
    around the "=" character.

    ...

    And regarding application/xhtml+xml, from https://tools.ietf.org/html/rfc3236#section-2
    and the referenced links, it can be seen that charset is handled the same way with
    respect to Content-Type.
    */

    let charsetMarker = "charset="; // Spaces *shouldn't* matter
    let foundIndex = contentType.indexOf(charsetMarker);
    if (foundIndex == -1) {
        return undefined;
    }
    let charsetMaybeQuoted = contentType.substr(foundIndex + charsetMarker.length).trim();
    let charset = charsetMaybeQuoted.replace(/\"/g, '');
    return charset;
}
