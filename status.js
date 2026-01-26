const wingman_icon_32_img = new Image();
wingman_icon_32_img.src = 'data:image/svg+xml;base64, PHN2ZyB3aWR0aD0iMzJweCIgaGVpZ2h0PSIzMnB4IiB2ZXJzaW9uPSIxLjEiIHZpZXdCb3g9IjAgMCAzMiAzMiIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4NCgk8ZyB0cmFuc2Zvcm09InRyYW5zbGF0ZSgtNi41MzQzIC05LjQ5ODQpIj4NCgkJPHJlY3QgeD0iNi41MzQzIiB5PSI5LjQ5ODQiIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiIgZmlsbC1vcGFjaXR5PSIwIi8+DQoJCTxnIHRyYW5zZm9ybT0ibWF0cml4KDEuMTIzIDAgMCAxLjEyMyAtMTAuNDEyIC03Ni45OTMpIj4NCgkJCTxnIHRyYW5zZm9ybT0idHJhbnNsYXRlKC0uMTgyNzEpIiBzdHJva2U9IiMwMDAiIHN0cm9rZS13aWR0aD0iLjI0MTY5cHgiPg0KCQkJCTxwYXRoIGQ9Im0xNS43ODkgODMuNjk1IDEwLjg5NyAxNC45MzcgMi4xNjktMTEuNDA4LTIuNjc1OSA1Ljc2M3oiLz4NCgkJCQk8cGF0aCBkPSJtNDMuMjUyIDgzLjY5NS0xMC44OTcgMTQuOTM3LTIuMTY5LTExLjQwOCAyLjY3NTkgNS43NjN6Ii8+DQoJCQk8L2c+DQoJCQk8ZyB0cmFuc2Zvcm09InRyYW5zbGF0ZSguMjkyOTMgLTEuNTg3NSkiPg0KCQkJCTxwYXRoIGQ9Im0yNi4zODUgOTguNjAyIDIuNjQyMy0yLjkwNjYgMi42NDIzIDIuOTA2NiIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjMDAwIiBzdHJva2Utd2lkdGg9Ii4yNjQ1OHB4Ii8+DQoJCQk8L2c+DQoJCQk8Y2lyY2xlIGN4PSIyOS4zMzgiIGN5PSI4Ny41NDkiIHI9Ii4zMzcwNSIgc3Ryb2tlPSIjMTMxNTFjIiBzdHJva2Utd2lkdGg9Ii4wOTM4NDgiLz4NCgkJPC9nPg0KCTwvZz4NCjwvc3ZnPg0K';
wingman_icon_32_img.width = 32;
wingman_icon_32_img.height = 32;
wingman_icon_32_img.onload = function() {
    statusRegenerateIcon();
}


//Note: checks can occur that fail and do not result in either a block or a pass.
//Therefore, use block+pass as the total count in certain cases

let STATUS_openImageFilters = { };
let STATUS_openImageHighWaterCount = 0;

let STATUS_videoCounts = {
    'pass' : 0,
    'pass_so_far' : 0,
    'block' : 0,
    'error' : 0
};
let STATUS_videoCheckCount = 0;
let STATUS_openVideoFilters = { };
let STATUS_videoProgressCounter = 0;
let STATUS_videoLastBlockProgressCounter = -999;

const STATUS_ICON_SIZE = 32;
let STATUS_iconCanvas = document.createElement('canvas');
STATUS_iconCanvas.width = STATUS_ICON_SIZE;
STATUS_iconCanvas.height = STATUS_ICON_SIZE;
const STATUS_defaultZoneFill = '#CCCCCC';
const STATUS_defaultZoneFillOffset = '#AAAAAA';
const STATUS_tabState = new Map();

const STATUS_blockFadeoutColors = [
    'rgba(255,0,0,1.0)',
    'rgba(255,0,0,1.0)'
];

function statusGetTabState(tabId) {
    let key = tabId ?? 'global';
    let state = STATUS_tabState.get(key);
    if (!state) {
        state = {
            imageCounts: {
                pass: 0,
                block: 0,
                tiny: 0,
                error: 0
            },
            imageCheckCount: 0,
            zoneFill: STATUS_defaultZoneFill,
            zoneFillOffset: STATUS_defaultZoneFillOffset,
            zoneName: 'neutral',
            lastZoneFill: '',
            lastProgressWidth: 0,
            lastIsVideoInProgress: true,
            lastIsVideoBlockShown: true,
            lastVideoProgressCounter: -1,
            isBurstActive: false,
            lastIsBurstActive: true
        };
        STATUS_tabState.set(key, state);
    }
    return state;
}

function statusRegenerateIcon(tabId) {
    let state = statusGetTabState(tabId);
    // 1. First, do we need to do anything? Do this analysis to avoid extra icon flickering
    let currentProgressWidth = -1;
    if(STATUS_openImageHighWaterCount > 0) {
        let currentLength = statusGetOpenImageCount();
        let percentage = currentLength / STATUS_openImageHighWaterCount;
        currentProgressWidth = Math.round(percentage*24);
    }

    let isVideoInProgress = statusGetOpenVideoCount() > 0;
    let stepsSinceLastBlock = STATUS_videoProgressCounter - STATUS_videoLastBlockProgressCounter
    let isVideoBlockShown =  stepsSinceLastBlock < STATUS_blockFadeoutColors.length;
    

    // TODO reinstate STATUS_videoProgressCounter == STATUS_lastVideoProgressCounter
    // if video progress is ever directly used
    if(state.zoneFill == state.lastZoneFill &&
        currentProgressWidth == state.lastProgressWidth &&
        isVideoInProgress == state.lastIsVideoInProgress &&
        isVideoBlockShown == state.lastIsVideoBlockShown &&
        state.isBurstActive == state.lastIsBurstActive) {
        return;
    }

    // 2. Save current state to last state
    state.lastZoneFill = state.zoneFill;
    state.lastProgressWidth = currentProgressWidth;
    state.lastIsVideoInProgress = isVideoInProgress;
    state.lastIsVideoBlockShown = isVideoBlockShown;
    state.lastVideoProgressCounter = STATUS_videoProgressCounter;
    state.lastIsBurstActive = state.isBurstActive;

    // 3. Actually generate and set new icon
    let ctx = STATUS_iconCanvas.getContext('2d');
    ctx.clearRect(0,0,STATUS_ICON_SIZE,STATUS_ICON_SIZE);

    // Zone background
    ctx.fillStyle = state.zoneFill;
    ctx.fillRect(0,0,STATUS_ICON_SIZE,STATUS_ICON_SIZE);

    // Icon
    ctx.drawImage(wingman_icon_32_img, 0, 0);

    // Image progress
    if(currentProgressWidth >= 0) {
        ctx.fillStyle = state.zoneFillOffset;
        ctx.fillRect(0, 24, currentProgressWidth, 8);
    }

    if(isVideoInProgress || isVideoBlockShown) {
        ctx.fillStyle = isVideoBlockShown ? 'white' : state.zoneFillOffset;
        ctx.fillRect(24, 24, 8, 8);

        ctx.fillStyle = isVideoBlockShown ? STATUS_blockFadeoutColors[stepsSinceLastBlock] : 'black';
        ctx.font = '8px sans-serif';
        ctx.textBaseline = 'top';
        ctx.fillText('V', 24, 24);
    }

    if(state.isBurstActive) {
        ctx.fillStyle = state.zoneFillOffset;
        ctx.fillRect(24, 0, 8, 8);

        ctx.fillStyle = 'black';
        ctx.font = '8px sans-serif';
        ctx.textBaseline = 'top';
        ctx.fillText('B', 24, 0);
    }

    let imageData = ctx.getImageData(0,0,STATUS_ICON_SIZE,STATUS_ICON_SIZE);
    browser.browserAction.setIcon({ imageData: imageData, tabId: tabId ?? undefined });
}



function statusInitialize() {
    browser.browserAction.setIcon({path: "icons/wingman_icon_32.png"});
}

function statusOnLoaded() {
    browser.browserAction.setTitle({title: "Wingman Jr."});
}

function statusSetImageZoneTrusted(tabId) {
    let state = statusGetTabState(tabId);
    state.zoneFill = '#88CC88';
    state.zoneFillOffset = '#66AA66';
    state.zoneName = 'trusted';
    statusRegenerateIcon(tabId);
}

function statusSetImageZoneNeutral(tabId) {
    let state = statusGetTabState(tabId);
    state.zoneFill = '#CCCCCC';
    state.zoneFillOffset = '#AAAAAA';
    state.zoneName = 'neutral';
    statusRegenerateIcon(tabId);
}

function statusSetImageZoneUntrusted(tabId) {
    let state = statusGetTabState(tabId);
    state.zoneFill = '#DD9999';
    state.zoneFillOffset = '#AA6666';
    state.zoneName = 'untrusted';
    statusRegenerateIcon(tabId);
}

function statusSetBurstActive(tabId, isActive) {
    let state = statusGetTabState(tabId);
    if (state.isBurstActive === isActive) {
        return;
    }
    state.isBurstActive = isActive;
    statusRegenerateIcon(tabId);
}

function statusGetOpenVideoCount() {
    return Object.keys(STATUS_openVideoFilters).length;
}

function statusStartVideoCheck(requestId) {
    STATUS_openVideoFilters[requestId] = requestId;
    statusUpdateVisuals();
}

function statusIndicateVideoProgress(requestId) {
    STATUS_videoProgressCounter++;
    statusUpdateVisuals();
}

function statusCompleteVideoCheck(requestId, status) {
    try {
        if(status == 'block') {
            STATUS_videoLastBlockProgressCounter = STATUS_videoProgressCounter;
        }
        STATUS_videoCounts[status]++;
        STATUS_videoCheckCount++;
        delete STATUS_openVideoFilters[requestId];
        statusUpdateVisuals();
    } catch(e) {
    }
}

function statusGetOpenImageCount() {
    return Object.keys(STATUS_openImageFilters).length;
}

function statusStartImageCheck(requestId, tabId) {
    STATUS_openImageFilters[requestId] = requestId;
    let currentLength = statusGetOpenImageCount();
    if(currentLength > STATUS_openImageHighWaterCount) {
        STATUS_openImageHighWaterCount = currentLength;
    }
    statusRegenerateIcon(tabId);
}

function statusCompleteImageCheck(requestId, status, tabId) {
    delete STATUS_openImageFilters[requestId];
    let state = statusGetTabState(tabId);
    state.imageCounts[status]++;
    state.imageCheckCount++;
    let currentLength = statusGetOpenImageCount();
    if(currentLength == 0) {
        STATUS_openImageHighWaterCount = 0;
    }
    statusUpdateVisuals(tabId);
}

function statusUpdateVisuals(tabId) {
    let state = statusGetTabState(tabId);
    let totalBlockCount = state.imageCounts['block'] + STATUS_videoCounts['block'];
    if(totalBlockCount > 0) {
        //MDN notes we can only fit "about 4" characters here
        let txt = (totalBlockCount < 1000) ? totalBlockCount+'' : '999+';
        browser.browserAction.setBadgeText({ "text": txt, tabId: tabId ?? undefined });
    } else {
        browser.browserAction.setBadgeText({ "text": '', tabId: tabId ?? undefined });
    }
    
    let openRequestIds = Object.keys(STATUS_openImageFilters);
    let zoneLabel = state.zoneName ?? 'neutral';
    let burstLabel = state.isBurstActive ? ' (burst override active)' : '';
    browser.browserAction.setTitle({ title: 'Zone: ' + zoneLabel + burstLabel + '\r\n'
        + 'Blocked '+state.imageCounts['block']+'/'+state.imageCheckCount+' images\r\n'
        + '               ' + STATUS_videoCounts['block']+'/'+STATUS_videoCheckCount+' videos\r\n'
        + openRequestIds.length +' open requests: \r\n'+openRequestIds.join('\r\n'), tabId: tabId ?? undefined });

    statusRegenerateIcon(tabId);
}
