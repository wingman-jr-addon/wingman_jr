let imgObserver = null;
let prefetchCount = 0;
let prefetchInFlightCount = 0;

//https://gomakethings.com/how-to-test-if-an-element-is-in-the-viewport-with-vanilla-javascript/
function isInViewport(elem) {
    var bounding = elem.getBoundingClientRect();
    return (
        bounding.top >= 0 &&
        bounding.left >= 0 &&
        bounding.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
        bounding.right <= (window.innerWidth || document.documentElement.clientWidth)
    );
};

async function checkPrioritize(entries, observer) {
    let prioritizedList = null;
    entries.forEach(async entry => {
        if (entry.isIntersecting) {
            let url = entry.target.src;
            let urlSnippet = url.slice(-20);
            let target = entry.target;
            if(target.complete) {
                console.log('WJR: Image already complete! '+urlSnippet);
                return;
            }
            if(target.srcset != '') {
                console.log('WJR: srcset not supported? '+urlSnippet+' '+target.srcset+' !!! '+target.currentSrc);
                //return;
            }
            if (url.length < 2048) {
                if(prioritizedList === null) {
                    prioritizedList = [];
                }
                prioritizedList.push(url);
                setTimeout(async ()=>{
                    if(target.complete) {
                        console.log('WJR: Image already completed! '+urlSnippet);
                        return;
                    }
                    if(!isInViewport(target)) {
                        console.log('WJR: Image not in viewport any more! '+urlSnippet);
                        return;
                    }
                    if(prefetchInFlightCount > 16) {
                        console.log('WJR: Already prefetching all the things, skipping prefetch of '+urlSnippet);
                        return;
                    }
                    prefetchCount++;
                    prefetchInFlightCount++;
                    console.log('WJR: Prefetch started ('+prefetchCount+','+prefetchInFlightCount+') '+urlSnippet);
                    let response = await fetch(target.currentSrc);
                    prefetchInFlightCount--;
                    if(!response.ok) {
                        console.log('WJR: Failed to fetch image: '+urlSnippet);
                        return;
                    }
                    let blob = await response.blob();
                    let fetchedURL = URL.createObjectURL(blob);
                    //target.decode = 'sync';
                    target.src = fetchedURL;
                    console.log('WJR: Prefetch finished ('+prefetchCount+','+prefetchInFlightCount+') '+urlSnippet + ' of size '+blob.size);
                }, 120);
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
