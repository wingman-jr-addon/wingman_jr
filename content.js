let imgObserver = null;

function checkPrioritize(entries, observer) {
    let prioritizedList = null;
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            let url = entry.target.src;
            if (url.length < 2048) {
                if(prioritizedList === null) {
                    prioritizedList = [];
                }
                prioritizedList.push(url);              
                console.log('WJR: Prioritize '+url.slice(-20));
            } else {
                console.log('WJR: Skipping prioritization for extra long URL');
            }
        }
    });
    browser.runtime.sendMessage({ "prioritize": prioritizedList });
}

function observeAllImgIntersections() {
    if(imgObserver !== null) {
        try {
        imgObserver.disconnect();
        } catch {}
    }
    let options = {
        root: null,  // Full viewport
        threshold: 0.0
      }
    console.log('WJR: Setting up intersection observer...');
    imgObserver = new IntersectionObserver(checkPrioritize, options);
    let imgs = document.getElementsByTagName('img');
    console.log('WJR: Found '+imgs.length+' imgs...');
    for(let i=0; i<imgs.length; i++) {
        let anImg = imgs[i];
        //console.log('WJR: Observing '+anImg.src);
        imgObserver.observe(anImg);
    }
}

function checkRecalculateIntersectionObservables(mutationList, observer) {
    console.log('WJR: Body mutated.');
    let needsListRebuild = false;
    mutationList.forEach((mutation) => {
        switch(mutation.type) {
          case 'childList':
              needsListRebuild = true;
              break;
        }
    });
    if (needsListRebuild) {
        observeAllImgIntersections();
    }
}

console.log('WJR: Setting up mutation observer...');
let imgMutObserver = new MutationObserver(checkRecalculateIntersectionObservables);
imgMutObserver.observe(document.body, { childList: true, subtree: true });
observeAllImgIntersections();
