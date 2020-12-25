
let VID_videoPlaceholderArrayBuffer = null;
fetch('wingman_placeholder.mp4')
.then(async r => VID_videoPlaceholderArrayBuffer = await r.arrayBuffer());

let VID_chainsByRequestId = { };
let VID_youtubeGroupsByCpn = { };

function getExistingChain(requestId) {
    return VID_chainsByRequestId[requestId];
}

function findCreateYoutubeGroup(cpn) {
    let existing = VID_youtubeGroupsByCpn[cpn];
    if(existing === undefined) {
        existing = {
            cpn: cpn,
            chains: [],
            orphans: []
        };
        VID_youtubeGroupsByCpn[cpn] = existing;
    }
    return existing;
}

function createYoutubeChainLink(requestId, rangeStartInclusive, rangeEndInclusive) {
    return {
        requestId: requestId,
        processorState: null,
        rangeStartInclusive: rangeStartInclusive,
        rangeEndInclusive: rangeEndInclusive,
        filterStream: null,
        buffers: [],
        flushingBuffers: []
    };
}

//Status and state are used a bit loosely here in that they refer to both
//a status marking by the processor, but ALSO the state of the internal state
//machine. A bit weak sauce.
function createYoutubeChain(group, requestId, rangeStartInclusive, rangeEndInclusive) {
    return {
        id: 'youtube-'+group.cpn+'-'+requestId,
        cpn: group.cpn,
        type: 'youtube',
        status: 'unknown',
        endInclusive: -1,
        processorState: null,
        links: [ ],
        shadowLinks: [ ],
        setFilterStream: function(requestId, filterStream) {
            let link = this.links.find(l=>l.requestId == requestId);
            link.filterStream = filterStream;
        },
        getIsSingleStream: function() {
            return false;
        },
        _isStatusFinal: function() {
            return ['pass','block','error'].indexOf(status) >= 0;
        },
        appendLink: function(requestId, rangeStartInclusive, rangeEndInclusive) {
            let newLink = createYoutubeChainLink(requestId, rangeStartInclusive, rangeEndInclusive);
            this.links.push(newLink);
            this.endInclusive = rangeEndInclusive;
        },
        appendBuffer: function(requestId, buffer) {
            if(this._isStatusFinal()) {
                return;
            }
            let link = this.links.find(l=>l.requestId == requestId);
            link.buffers.push(buffer);
            link.flushingBuffers.push(buffer);
        },
        getBuffers: function(requestId) { //not valid after status is final
            if(this._isStatusFinal()) {
                return null;
            }
            let allBuffers = [];
            for(let link of this.links) {
                if(link.requestId == requestId) break;
                link.buffers.forEach(b=>allBuffers.push(b));
            }
            return allBuffers;
        },
        getProcessorState: function(requestId) {
            return this.processorState;
        },
        updateStatus: function(requestId, status, processorState) {
            console.log('WEBREQV: Youtube update '+this.cpn+' '+this.status+'->'+status+' '+JSON.stringify(processorState));
            if(this._isStatusFinal()) { //once a final status has been achieved, everything is disconnected.
                //TODO log warning
                return;
            }
            if(['pass','block','error','pass_request'].indexOf(status) == -1) {
                //TODO log error
                return;
            }
            let link = this.links.find(l=>l.requestId == requestId);
            this.processorState = processorState;
            link.status = status;
            this.status = status;
            console.log('WEBREQV: Youtube chain status '+link.status+' for request '+requestId+' '+this.cpn+', '+this.links.length+' '+link.flushingBuffers.length);
            switch(link.status) {
                case 'pass_request':
                case 'error': { //enough data of the request has been guesstimated to be analyzed to pass it
                    link.flushingBuffers.forEach(fb=>link.filterStream.write(fb));
                    link.flushingBuffers = [];
                    link.filterStream.disconnect();
                    link.filterStream = null;
                } break;
                case 'pass': {
                    for(let aLink of this.links) {
                        if(aLink.filterStream !== null) {
                            aLink.flushingBuffers.forEach(fb=>aLlink.filterStream.write(fb));
                            aLink.filterStream.disconnect();
                            aLink.filterStream = null;
                            aLink.flushingBuffers = null;
                            aLink.buffers = null;
                        }
                    }
                } break;
                case 'block': {
                    for(let aLink of this.links) {
                        if(aLink.filterStream !== null) {
                            aLink.filterStream.close();
                            aLink.filterStream = null;
                            aLink.flushingBuffers = null;
                            aLink.buffers = null;
                        }
                    }
                } break;
            }
        }
    };
}

function findCreateYoutubeChain(group, requestId, rangeStartInclusive, rangeEndInclusive) {
    console.log('WEBREQV: findCreateYoutubeChain '+group+', '+requestId+', '+rangeStartInclusive+'->'+rangeEndInclusive);
    if(rangeStartInclusive == 0) { //start new group
        let newChain = createYoutubeChain(group, requestId, rangeStartInclusive, rangeEndInclusive);
        console.log('WEBREQV: findCreateYoutubeChain new '+group+', '+requestId+', '+rangeStartInclusive+'->'+rangeEndInclusive);
        group.chains.push(newChain);
        newChain.appendLink(requestId, rangeStartInclusive, rangeEndInclusive);
        return newChain;
    }
    
    let existingChain = group.chains.find(c => c.endInclusive+1 == rangeStartInclusive);
    if(existingChain !== undefined) {
        existingChain.appendLink(requestId, rangeStartInclusive, rangeEndInclusive);
        console.log('WEBREQV: findCreateYoutubeChain existing '+existingChain.id+', '+requestId+', '+rangeStartInclusive+'->'+rangeEndInclusive);
        return existingChain;
    }
    //Youtube will try to pick up where it started failing - as in the case of a block.
    //So, we will try to check the last link of any failed chains and see if it matches.
    let blockedChain = group.chains.find(c=>
        c.status=='block' &&
        c.links.length >= 1 &&
        c.links[c.links.length-1].rangeStartInclusive == rangeStartInclusive);
    if(blockedChain !== undefined) {
        console.log('WEBREQV: findCreateYoutubeChain blocked shadow link '+blockedChain.id+', '+requestId+', '+rangeStartInclusive+'->'+rangeEndInclusive);
        let shadowLink = createYoutubeChainLink(requestId, rangeStartInclusive, rangeEndInclusive);
        blockedChain.shadowLinks.push(shadowLink);
        return blockedChain;
    }
    //Ok, one last ditch effort - if it's a true orphan AND one of the video chains
    //for this group is already blocked, then we should block too by returning
    //a dummy chain with a block status
    let anyBlockedChain = group.chains.find(c=>c.status=='block');
    if(anyBlockedChain !== undefined) {
        console.log('WEBREQV: findCreateYoutubeChain orphan but others blocked '+group.cpn+', '+requestId+', '+rangeStartInclusive+'->'+rangeEndInclusive);
        return { status: 'block' };
    }

    console.log('WEBREQV: findCreateYoutubeChain orphan '+group.cpn+', '+requestId+', '+rangeStartInclusive+'->'+rangeEndInclusive);

    let orphan = createYoutubeChainLink(requestId, rangeStartInclusive, rangeEndInclusive);
    group.orphans.push(orphan);
    throw `Orphan link ${group.cpn} ${requestId} ${rangeStartInclusive} ${rangeEndInclusive}`;
}

function createDefaultVideoChain(requestId) {
    let newChain = {
        id: 'default-'+requestId,
        type: 'default',
        status: 'unknown',
        processorState: null,
        filterStream: null,
        buffers: [],
        flushingBuffers: [],
        setFilterStream: function(requestId, filterStream) {
            this.filterStream = filterStream;
        },
        getIsSingleStream: function() {
            return true;
        },
        _isStatusFinal: function() {
            return ['pass','block','error'].indexOf(status) >= 0;
        },
        appendBuffer: function(requestId, buffer) {
            if(this._isStatusFinal()) {
                return;
            }
            this.buffers.push(buffer);
            this.flushingBuffers.push(buffer);
        },
        getBuffers: function(requestId) { //not valid after status is final
            if(this._isStatusFinal()) {
                return null;
            }
            return this.buffers;
        },
        getProcessorState: function(requestId) {
            return this.processorState;
        },
        updateStatus: function(requestId, status, processorState) {
            if(this._isStatusFinal()) { //once a final status has been achieved, everything is disconnected.
                //TODO log warning
                return;
            }
            if(['pass','block','error','pass_request'].indexOf(status) == -1) {
                //TODO log error
                return;
            }
            this.processorState = processorState;
            this.status = status;

            switch(this.status) {
                case 'pass_request':
                case 'pass': { //enough data of the request has been guesstimated to be analyzed to pass it
                    this.flushingBuffers.forEach(fb=>this.filterStream.write(fb));
                    this.flushingBuffers = null;
                    this.filterStream.disconnect();
                    this.filterStream = null;
                    this.buffers = null;
                } break;
                case 'error': { //at this point, essentially a pass
                    this.flushingBuffers.forEach(fb=>this.filterStream.write(fb));
                    this.flushingBuffers = null;
                    this.filterStream.disconnect();
                    this.filterStream = null;
                    this.buffers = null;
                } break;
                case 'block': {
                    this.filterStream.write(VID_videoPlaceholderArrayBuffer);
                    this.filterStream.close();
                    this.filterStream = null;
                    this.flushingBuffers = null;
                    this.buffers = null;
                } break;
            }
        }
    };
    return newChain;
}

function findCreateChain(details) {
    console.log('WEBREQV: findCreateChain for '+details.requestId);
    let parsedUrl = new URL(details.url);
    let newChain;
    if(parsedUrl.hostname.endsWith('.googlevideo.com')) {
        let cpn = parsedUrl.searchParams.get('cpn');
        let youtubeGroup = findCreateYoutubeGroup(cpn);
        let rangeRaw = parsedUrl.searchParams.get('range');
        console.log('WEBREQV: Youtube chain for request '+details.requestId+' '+cpn+', '+rangeRaw);
        let splitIndex = rangeRaw.indexOf('-'); //e.g. range=0-3200
        let rangeStart = parseInt(rangeRaw.substr(0, splitIndex));
        let rangeEnd = parseInt(rangeRaw.substr(splitIndex+1));
        newChain = findCreateYoutubeChain(youtubeGroup, details.requestId, rangeStart, rangeEnd);
    } else {
        newChain = createDefaultVideoChain(details.requestId);
    }
    VID_chainsByRequestId[details.requestId] = newChain;
    return newChain;
}


async function VID_onVidScan(m) {
    let videoChain = getExistingChain(m.requestId);
    console.log('WEBREQV: video result '+m.requestId+' was '+m.status+' chain '+videoChain.id);
    videoChain.updateStatus(m.requestId, m.status, m.processorState);
}

// The video listener behaves a bit differently in that it both queues up the data locally as well
// as passes it to the processor until it hears back a response.
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

    let videoChain;
    try {
        videoChain = findCreateChain(details);
    } catch(e) {
        console.log('WEBREQV: Video group error for '+details.requestId+': '+e);
        console.dir(e);
        return; //Don't filter
    }
    console.log('WEBREQV: Video group exists with type '+videoChain.type+' status '+videoChain.status+' for '+videoChain.id+' at request '+details.requestId);
    if(videoChain.status == 'pass') {
        return;
    } else if (videoChain.status == 'block') {
        //Note I tried doing { cancel:true } here but cannot because we are too
        //late by onHeadersReceived.
        let blockFilter = browser.webRequest.filterResponseData(details.requestId);
        blockFilter.ondata = _ => {
            blockFilter.write(VID_videoPlaceholderArrayBuffer);
            blockFilter.close();
        };
        return details;
    } else if (videoChain.status == 'pass_request') {
        //continue scanning
    } else if(videoChain.status == 'unknown') {
        //continue scanning
    } else {
        return; //Generally this is error and we want to pass it through
    }

    console.log('WEBREQV: video start headers '+details.requestId);
    let filter = browser.webRequest.filterResponseData(details.requestId);
    videoChain.setFilterStream(details.requestId, filter);

    let processor = getNextProcessor().port;
    processor.postMessage({
        type: 'vid_start',
        videoChainId: videoChain.id,
        requestId : details.requestId,
        requestType: details.type,
        url: details.url,
        mimeType: mimeType,
        existingBuffers: videoChain.getBuffers(details.requestId),
        processorState: videoChain.getProcessorState(details.requestId),
    });
  
    filter.ondata = event => {
        videoChain.appendBuffer(details.requestId, event.data);        
        processor.postMessage({ 
            type: 'vid_ondata',
            videoChainId: videoChain.id,
            requestId: details.requestId,
            data: event.data
        });
    }

    filter.onerror = e => {
        try
        {
            videoChain.updateStatus(details.requestId, 'error', null);
            processor.postMessage({
                type: 'vid_onerror',
                videoChainId: videoChain.id,
                requestId: details.requestId,
            })
        }
        catch(ex)
        {
            console.log('WEBREQ: Filter video error: '+e+', '+ex);
        }
    }
  
    filter.onstop = async event => {
        let dataStopTime = performance.now();
        console.log('WEBREQV: Video request '+details.requestId+' took ms, it had MIME type '+mimeType+' and came from source '+details.type);
        
        processor.postMessage({
            type: 'vid_onstop',
            videoChainId: videoChain.id,
            requestId: details.requestId,
            isSingleStream: videoChain.getIsSingleStream()
        });
    }
    return details;
}