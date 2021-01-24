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

function statusSetImageZoneTrusted() {
    browser.browserAction.setIcon({path: "icons/wingman_icon_32_trusted.png"});
}

function statusSetImageZoneNeutral() {
    browser.browserAction.setIcon({path: "icons/wingman_icon_32_neutral.png"});
}

function statusSetImageZoneUntrusted() {
    browser.browserAction.setIcon({path: "icons/wingman_icon_32_untrusted.png"});
}

function statusStartImageCheck(requestId) {
    STATUS_openImageFilters[requestId] = requestId;
}

function statusCompleteImageCheck(requestId, status) {
    delete STATUS_openImageFilters[requestId];
    STATUS_counts[status]++;
    STATUS_checkCount++;
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
}