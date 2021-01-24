//Note: checks can occur that fail and do not result in either a block or a pass.
//Therefore, use block+pass as the total count in certain cases

let STATUS_counts = {
    'pass' : 0,
    'block' : 0,
    'tiny' : 0,
    'error' : 0
};
let STATUS_checkCount = 0;
let STATUS_openImageFilters = { };
let STATUS_openImageHighWaterCount = 0;

let STATUS_ICON_SIZE = 32;
let STATUS_iconCanvas = document.createElement('canvas');
STATUS_iconCanvas.width = STATUS_ICON_SIZE;
STATUS_iconCanvas.height = STATUS_ICON_SIZE;
let STATUS_zoneFill = 'white';

let STATUS_lastZoneFill = '';
let STATUS_lastProgressWidth = 0;

function statusRegenerateIcon() {
    console.log(`STATUS: ${STATUS_lastProgressWidth}, ${STATUS_lastZoneFill}`);
    // 1. First, do we need to do anything? Do this analysis to avoid extra icon flickering
    let currentProgressWidth = -1;
    if(STATUS_openImageHighWaterCount > 0) {
        let currentLength = statusGetOpenImageCount();
        let percentage = currentLength / STATUS_openImageHighWaterCount;
        currentProgressWidth = Math.round(percentage*28);
    }

    if(STATUS_zoneFill == STATUS_lastZoneFill &&
        currentProgressWidth == STATUS_lastProgressWidth) {
        console.log(`STATUS:  return match${STATUS_lastProgressWidth}, ${STATUS_lastZoneFill}`);
        return;
    }

    // 2. Save current state to last state
    STATUS_lastZoneFill = STATUS_zoneFill;
    STATUS_lastProgressWidth = currentProgressWidth;

    // 3. Actually generate and set new icon
    let ctx = STATUS_iconCanvas.getContext('2d');
    ctx.clearRect(0,0,STATUS_ICON_SIZE,STATUS_ICON_SIZE);

    // Zone background
    ctx.fillStyle = STATUS_zoneFill;
    ctx.fillRect(0,0,STATUS_ICON_SIZE,STATUS_ICON_SIZE);

    // Image progress
    if(currentProgressWidth >= 0) {
        ctx.fillStyle = '#000000';
        ctx.fillRect(2, 28, currentProgressWidth, 2);
    }

    let imageData = ctx.getImageData(0,0,STATUS_ICON_SIZE,STATUS_ICON_SIZE);
    browser.browserAction.setIcon({ imageData: imageData })
    .then(()=>
    console.log(`STATUS: icon set ${STATUS_lastProgressWidth}, ${currentProgressWidth}, ${STATUS_zoneFill}, ${STATUS_lastZoneFill}`)
    );
}

function statusGetOpenImageCount() {
    return Object.keys(STATUS_openImageFilters).length;
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
    statusRegenerateIcon();
}

function statusSetImageZoneNeutral() {
    STATUS_zoneFill = '#CCCCCC';
    statusRegenerateIcon();
}

function statusSetImageZoneUntrusted() {
    STATUS_zoneFill = '#CC8888';
    statusRegenerateIcon();
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
    STATUS_counts[status]++;
    STATUS_checkCount++;
    let currentLength = statusGetOpenImageCount();
    if(currentLength == 0) {
        STATUS_openImageHighWaterCount = 0;
    }
    statusUpdateVisuals();
}

function statusUpdateVisuals() {
    if(STATUS_counts['block'] > 0) {
        //MDN notes we can only fit "about 4" characters here
        let txt = (STATUS_counts['block'] < 1000) ? STATUS_counts['block']+'' : '999+';
        browser.browserAction.setBadgeText({ "text": txt });
    }
    
    let openRequestIds = Object.keys(STATUS_openImageFilters);
    browser.browserAction.setTitle({ title: 'Blocked '+STATUS_counts['block']+'/'+STATUS_checkCount+' total images\r\n'
        + openRequestIds.length +' open requests: \r\n'+openRequestIds.join('\r\n') });

    statusRegenerateIcon();
}