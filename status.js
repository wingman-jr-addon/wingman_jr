const wingman_icon_32_img = new Image();
wingman_icon_32_img.src = 'data:image/svg+xml;base64, PHN2ZyB3aWR0aD0iMzJweCIgaGVpZ2h0PSIzMnB4IiB2ZXJzaW9uPSIxLjEiIHZpZXdCb3g9IjAgMCAzMiAzMiIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4NCgk8ZyB0cmFuc2Zvcm09InRyYW5zbGF0ZSgtNi41MzQzIC05LjQ5ODQpIj4NCgkJPHJlY3QgeD0iNi41MzQzIiB5PSI5LjQ5ODQiIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiIgZmlsbC1vcGFjaXR5PSIwIi8+DQoJCTxnIHRyYW5zZm9ybT0ibWF0cml4KDEuMTIzIDAgMCAxLjEyMyAtMTAuNDEyIC03Ni45OTMpIj4NCgkJCTxnIHRyYW5zZm9ybT0idHJhbnNsYXRlKC0uMTgyNzEpIiBzdHJva2U9IiMwMDAiIHN0cm9rZS13aWR0aD0iLjI0MTY5cHgiPg0KCQkJCTxwYXRoIGQ9Im0xNS43ODkgODMuNjk1IDEwLjg5NyAxNC45MzcgMi4xNjktMTEuNDA4LTIuNjc1OSA1Ljc2M3oiLz4NCgkJCQk8cGF0aCBkPSJtNDMuMjUyIDgzLjY5NS0xMC44OTcgMTQuOTM3LTIuMTY5LTExLjQwOCAyLjY3NTkgNS43NjN6Ii8+DQoJCQk8L2c+DQoJCQk8ZyB0cmFuc2Zvcm09InRyYW5zbGF0ZSguMjkyOTMgLTEuNTg3NSkiPg0KCQkJCTxwYXRoIGQ9Im0yNi4zODUgOTguNjAyIDIuNjQyMy0yLjkwNjYgMi42NDIzIDIuOTA2NiIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjMDAwIiBzdHJva2Utd2lkdGg9Ii4yNjQ1OHB4Ii8+DQoJCQk8L2c+DQoJCQk8Y2lyY2xlIGN4PSIyOS4zMzgiIGN5PSI4Ny41NDkiIHI9Ii4zMzcwNSIgc3Ryb2tlPSIjMTMxNTFjIiBzdHJva2Utd2lkdGg9Ii4wOTM4NDgiLz4NCgkJPC9nPg0KCTwvZz4NCjwvc3ZnPg0K';
wingman_icon_32_img.width = 32;
wingman_icon_32_img.height = 32;
wingman_icon_32_img.onload = function() {
    statusRegenerateIcon();
}


//Note: checks can occur that fail and do not result in either a block or a pass.
//Therefore, use block+pass as the total count in certain cases

let STATUS_imageCounts = {
    'pass' : 0,
    'block' : 0,
    'tiny' : 0,
    'error' : 0
};
let STATUS_imageCheckCount = 0;
let STATUS_openImageFilters = { };
let STATUS_openImageHighWaterCount = 0;

let STATUS_videoCounts = {
    'pass' : 0,
    'block' : 0,
    'error' : 0
};
let STATUS_openVideoFilters = { };
let STATUS_videoProgressCounter = 0;
let STATUS_videoLastBlockProgressCounter = -999;

const STATUS_ICON_SIZE = 32;
let STATUS_iconCanvas = document.createElement('canvas');
STATUS_iconCanvas.width = STATUS_ICON_SIZE;
STATUS_iconCanvas.height = STATUS_ICON_SIZE;
let STATUS_zoneFill = 'white';
let STATUS_zoneFillOffset = 'white';

let STATUS_lastZoneFill = '';
let STATUS_lastProgressWidth = 0;
let STATUS_lastIsVideoInProgress = true;
let STATUS_lastIsVideoBlockShown = true;
let STATUS_lastVideoProgressCounter = -1;

const STATUS_blockFadeoutColors = [
    'rgba(255,0,0,1.0)',
    'rgba(255,0,0,1.0)'
];

function statusRegenerateIcon() {
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
    if(STATUS_zoneFill == STATUS_lastZoneFill &&
        currentProgressWidth == STATUS_lastProgressWidth &&
        isVideoInProgress == STATUS_lastIsVideoInProgress &&
        isVideoBlockShown == STATUS_lastIsVideoBlockShown) {
        return;
    }

    // 2. Save current state to last state
    STATUS_lastZoneFill = STATUS_zoneFill;
    STATUS_lastProgressWidth = currentProgressWidth;
    STATUS_lastIsVideoInProgress = isVideoInProgress;
    STATUS_lastIsVideoBlockShown = isVideoBlockShown;
    STATUS_lastVideoProgressCounter = STATUS_videoProgressCounter;

    // 3. Actually generate and set new icon
    let ctx = STATUS_iconCanvas.getContext('2d');
    ctx.clearRect(0,0,STATUS_ICON_SIZE,STATUS_ICON_SIZE);

    // Zone background
    ctx.fillStyle = STATUS_zoneFill;
    ctx.fillRect(0,0,STATUS_ICON_SIZE,STATUS_ICON_SIZE);

    // Icon
    ctx.drawImage(wingman_icon_32_img, 0, 0);

    // Image progress
    if(currentProgressWidth >= 0) {
        ctx.fillStyle = STATUS_zoneFillOffset;
        ctx.fillRect(0, 24, currentProgressWidth, 8);
    }

    if(isVideoInProgress || isVideoBlockShown) {
        ctx.fillStyle = isVideoBlockShown ? 'white' : STATUS_zoneFillOffset;
        ctx.fillRect(24, 24, 8, 8);

        ctx.fillStyle = isVideoBlockShown ? STATUS_blockFadeoutColors[stepsSinceLastBlock] : 'black';
        ctx.font = '8px sans-serif';
        ctx.textBaseline = 'top';
        ctx.fillText('V', 24, 24);
    }

    let imageData = ctx.getImageData(0,0,STATUS_ICON_SIZE,STATUS_ICON_SIZE);
    browser.browserAction.setIcon({ imageData: imageData });
}



function statusInitialize() {
    browser.browserAction.setIcon({path: "icons/wingman_icon_32.png"});
}

function statusOnLoaded() {
    browser.browserAction.setTitle({title: "Wingman Jr."});
    statusSetImageZoneNeutral();
}

function statusSetImageZoneTrusted() {
    STATUS_zoneFill = '#88CC88';
    STATUS_zoneFillOffset = '#66AA66';
    statusRegenerateIcon();
}

function statusSetImageZoneNeutral() {
    STATUS_zoneFill = '#CCCCCC';
    STATUS_zoneFillOffset = '#AAAAAA';
    statusRegenerateIcon();
}

function statusSetImageZoneUntrusted() {
    STATUS_zoneFill = '#DD9999';
    STATUS_zoneFillOffset = '#AA6666';
    statusRegenerateIcon();
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
        delete STATUS_openVideoFilters[requestId];
        statusUpdateVisuals();
    } catch(e) {
    }
}

function statusGetOpenImageCount() {
    return Object.keys(STATUS_openImageFilters).length;
}

function statusStartImageCheck(requestId) {
    STATUS_openImageFilters[requestId] = requestId;
    let currentLength = statusGetOpenImageCount();
    if(currentLength > STATUS_openImageHighWaterCount) {
        STATUS_openImageHighWaterCount = currentLength;
    }
}

function statusCompleteImageCheck(requestId, status) {
    delete STATUS_openImageFilters[requestId];
    STATUS_imageCounts[status]++;
    STATUS_imageCheckCount++;
    let currentLength = statusGetOpenImageCount();
    if(currentLength == 0) {
        STATUS_openImageHighWaterCount = 0;
    }
    statusUpdateVisuals();
}

function statusUpdateVisuals() {
    if(STATUS_imageCounts['block'] > 0) {
        //MDN notes we can only fit "about 4" characters here
        let txt = (STATUS_imageCounts['block'] < 1000) ? STATUS_imageCounts['block']+'' : '999+';
        browser.browserAction.setBadgeText({ "text": txt });
    }
    
    let openRequestIds = Object.keys(STATUS_openImageFilters);
    browser.browserAction.setTitle({ title: 'Blocked '+STATUS_imageCounts['block']+'/'+STATUS_imageCheckCount+' total images\r\n'
        + openRequestIds.length +' open requests: \r\n'+openRequestIds.join('\r\n') });

    statusRegenerateIcon();
}