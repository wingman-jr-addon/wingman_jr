//User feedback
browser.runtime.onInstalled.addListener(async ({ reason, temporary, }) => {
    if (temporary) return; // skip during development
    switch (reason) {
      case "update": {
        const url = browser.runtime.getURL("https://docs.google.com/forms/d/e/1FAIpQLSfkmwmDvV0vK5x8s1rmgCNWRoj5d7FOxu4-4scyrzMy2nuJbQ/viewform?usp=sf_link");
        await browser.tabs.create({ url, });
      } break;
    }
  });

browser.runtime.setUninstallURL("https://docs.google.com/forms/d/e/1FAIpQLSfYLfDewK-ovU-fQXOARqvNRaaH18UGxI2S6tAQUKv5RNSGaQ/viewform?usp=sf_link");

//Main plugin
const MODEL_PATH = 'sqrxr_62_graphopt/model.json'
const IMAGE_SIZE = 224;
const MIN_IMAGE_SIZE = 36;
const MIN_IMAGE_BYTES = 1024;

let isInReviewMode = false;
let wingman;
const wingman_startup = async () => {
    console.log('Launching TF.js!');
    tf.ENV.set('WEBGL_PACK',false);
    await tf.ready();
    console.log('TensorflowJS backend is: '+tf.getBackend());
    console.log('Loading model...');
    wingman = await tf.loadGraphModel(MODEL_PATH);
    console.log('Model: ' + wingman);

    console.log('Warming up...');
    let dummy_data = tf.zeros([1, IMAGE_SIZE, IMAGE_SIZE, 3]);
    let warmup_result = wingman.predict(dummy_data);
    console.log(warmup_result);
    warmup_result.print();
    warmup_result.dispose();
    console.log('Ready to go!');
};

let blockCount = 0;
let checkCount = 0;
function updateStatVisuals() {
    if (blockCount > 0) {
        let txt = (blockCount < 1000) ? blockCount+'' : '999+';
        browser.browserAction.setBadgeText({ "text": txt });
        browser.browserAction.setTitle({ title: 'Blocked '+blockCount+'/'+checkCount+' images!' });
    }
}

function incrementCheckCount() {
    checkCount++;
    updateStatVisuals();
}

function incrementBlockCount() {
    blockCount++;
    updateStatVisuals();
}

function isSafe(sqrxrScore)
{
    //FPR, TPR, Threshold
    //((0.02007051803634391, 0.7753737214791503), 0.99565566) Minimal/Normal
    //((0.04488744236506645, 0.8502491476527668), 0.9401961) Medium
    //((0.10035259018171956, 0.9061106740099659), 0.0641256) Conservative
    return sqrxrScore[0] < 0.9401961;
}

/**
 * Given an image element, makes a prediction through wingman
 */
let inferenceTimeTotal = 0;
let inferenceCountTotal = 0;
let inferenceCanvas = document.createElement('canvas');
inferenceCanvas.width = IMAGE_SIZE;
inferenceCanvas.height = IMAGE_SIZE;
let inferenceCtx = inferenceCanvas.getContext('2d');
inferenceCtx.imageSmoothingEnabled = true;

async function predict(imgElement) {

  const drawStartTime = performance.now();
  inferenceCtx.drawImage(imgElement, 0, 0, imgElement.width, imgElement.height, 0, 0, IMAGE_SIZE,IMAGE_SIZE);
  const rightSizeImageData = inferenceCtx.getImageData(0, 0, IMAGE_SIZE, IMAGE_SIZE);
  const totalDrawTime = performance.now() - drawStartTime;
  console.log(`Draw time in ${Math.floor(totalDrawTime)}ms`);

  const startTime = performance.now();
  const logits = tf.tidy(() => {
    const rightSizeImageDataTF = tf.browser.fromPixels(rightSizeImageData);
    const floatImg = rightSizeImageDataTF.toFloat();
    //EfficientNet
    //const centered = floatImg.sub(tf.tensor1d([0.485 * 255, 0.456 * 255, 0.406 * 255]));
    //const normalized = centered.div(tf.tensor1d([0.229 * 255, 0.224 * 255, 0.225 * 255]));
    //MobileNet V2
    const scaled = floatImg.div(tf.scalar(127.5));
    const normalized = scaled.sub(tf.scalar(1));
    // Reshape to a single-element batch so we can pass it to predict.
    const batched = tf.stack([normalized]);
    const result = wingman.predict(batched, {batchSize: 1});

    return result;
  });

  const totalTime = performance.now() - startTime;
  inferenceTimeTotal += totalTime;
  inferenceCountTotal++;
  const avgTime = inferenceTimeTotal / inferenceCountTotal;
  console.log(`Model inference in ${Math.floor(totalTime)}ms and avg of ${Math.floor(avgTime)}ms for ${inferenceCountTotal} scanned images`);

  let syncedResult = await logits.data();
  console.log('Prediction: '+syncedResult[0]);
  return syncedResult;
}

async function readFileAsDataURL (inputFile) {
    const temporaryFileReader = new FileReader();
  
    return new Promise((resolve, reject) => {
        temporaryFileReader.addEventListener("error", function () {
        temporaryFileReader.abort();
        reject(new DOMException("Problem parsing input file."));
      },false);
  
      temporaryFileReader.addEventListener("load", function () {
        resolve(temporaryFileReader.result);
      }, false);
      temporaryFileReader.readAsDataURL(inputFile);
    });
  };

function escapeRegExp(str) {
    return str.replace(/([.*+?^=!:${}()|\[\]\/\\])/g, "\\$1");
}

async function common_create_svg_from_blob(img, unsafeScore, blob)
{
    let dataURL = isInReviewMode ? await readFileAsDataURL(blob) : null;
    return common_create_svg(img, unsafeScore, dataURL);
}

let iconDataURI = "data:image/pngl;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAD6AAAA+gBtXtSawAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAGxSURBVFiF7dW9j0xRHMbxjz1m2ESWkChkiW0kGgSFnkbsJqvQTEMoRSFRydDsP6CiEoJibfQEW2hssSMKiUI2UcluY0Ui6y2M4pyJYzK7cxczFPeb3OSe+zzn+f3uyzmXkpKSf0zAIXzApz7X3oR9sB6PsLOPxXfgIQZbFw7iOQ70ofgePBOf/C9cwGsc7WHxw5hLtToyhXnUCoRVQ6VyJlQqp1Et4K+l7KmVTJvFV/Ee57sE1kMIoyGEY7jcxXsOi3iBLd06PYJ3+Iwry3jWYFa88yoaGFjGO4GP4k0Vfr0T+J6O21jbpp/C02w8g5NtnoDr+IZmyizMAO6nic10viHTH+NGNr6J6Ww8iHvZ/AepoVWxHa+ykGlswxi+oJ556+naGLamBlvz5jCy2uItaljKwhqpkSbGM9941mQj8y8ptqJW5FoW2DoWMZR5hvC2g+/qnxaHdXjSFjybtBM4ns4bbZ4ZcZv/K+zFmyx8EqPinj4iLq+7mb6gB9v6WfFDa+IWdmXabtxJ2tfk7QmTqcjFDtolP59Oz9gobqfDHbRhvBT/8z1l/29qJSUl/yc/AP3+b58RpkSuAAAAAElFTkSuQmCC";


async function common_create_svg(img, unsafeScore, dataURL)
{
    let visibleScore = Math.floor(unsafeScore*100);
    let svgText = '<?xml version="1.0" standalone="no"?> <!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN"   "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"> <svg width="'+img.width+'" height="'+img.height+'" version="1.1"      xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">'
    +'<g transform="translate(20 20)">'
    + '<g transform="matrix(1.123 0 0 1.123 -10.412 -76.993)">'
    + '<g transform="translate(-.18271)" stroke="#000" stroke-width=".24169px">'
    + '<path d="m15.789 83.695 10.897 14.937 2.169-11.408-2.6759 5.763z"/>'
    + '<path d="m43.252 83.695-10.897 14.937-2.169-11.408 2.6759 5.763z"/>'
    + '</g>'
    + '<g transform="translate(.29293 -1.5875)">'
    + '<path d="m26.385 98.602 2.6423-2.9066 2.6423 2.9066" fill="none" stroke="#000" stroke-width=".26458px"/>'
    + '</g>'
    + '<circle cx="29.338" cy="87.549" r=".33705" stroke="#13151c" stroke-width=".093848"/>'
    + '</g>'
    + (isInReviewMode ? '<image href="'+dataURL+'" x="0" y="0" height="'+img.height+'px" width="'+img.width+'px" opacity="0.2" />' : '')
    +'<text transform="translate(12 20)" font-size="20" fill="red">'+visibleScore+'</text>'
    +'</g>'
    +'</svg>';
    return svgText;
}

async function fast_filter(filter,img,allData,sqrxrScore, url, blob, shouldBlockSilently) {
    try
    {
        let unsafeScore = sqrxrScore[0];
        if(isSafe(sqrxrScore)) {
            console.log('Passed: '+sqrxrScore[0]+' '+url);
            for(let i=0; i<allData.length; i++) {
                filter.write(allData[i]);
            }
            filter.close();
            URL.revokeObjectURL(img.src);
        } else {
            let blockType = shouldBlockSilently ? 'silently' : 'with SVG'
            console.log('Blocked '+blockType+': '+sqrxrScore[0]+' '+url);
            incrementBlockCount();
            if (!shouldBlockSilently) {
                let svgText = await common_create_svg_from_blob(img, unsafeScore, blob);
                let encoder = new TextEncoder();
                let encodedTypedBuffer = encoder.encode(svgText);
                filter.write(encodedTypedBuffer.buffer);
            }
            filter.close();
            URL.revokeObjectURL(img.src);
        }
    }
    catch
    {
        filter.close();
        URL.revokeObjectURL(img.src);
    }
}

let capturedWorkQueue = {};

async function listener(details, shouldBlockSilently=false) {
    let mimeType = '';
    for(let i=0; i<details.responseHeaders.length; i++) {
        let header = details.responseHeaders[i];
        if(header.name.toLowerCase() == "content-type") {
            mimeType = header.value;
            if(!shouldBlockSilently) {
                header.value = 'image/svg+xml';
            }
            break;
        }
    }
    console.log('start headers '+details.requestId);
    const startTime = performance.now();
    let filter = browser.webRequest.filterResponseData(details.requestId);
    let allData = [];
    
  
    filter.ondata = event => {
        console.log('data '+details.requestId);
        allData.push(event.data);
    }

    filter.onerror = e => {
        try
        {
            filter.close();
        }
        catch(ex)
        {
            console.log('Filter error: '+e+', '+ex);
        }
    }
  
    filter.onstop = async event => {
        incrementCheckCount();
        let capturedWork = async () => {
            console.log('starting work for '+details.requestId +' from '+details.url);
            try
            {
                let byteCount = 0;
                for(let i=0; i<allData.length; i++) {
                    byteCount += allData[i].byteLength;
                }

                if(byteCount >= MIN_IMAGE_BYTES) { //only scan if the image is complex enough to be objectionable

                    let blob = new Blob(allData, {type: mimeType});
                    let url = URL.createObjectURL(blob);
                    let img = new Image();

                    img.onload = async function(e) {
                        if(img.width>=MIN_IMAGE_SIZE && img.height>=MIN_IMAGE_SIZE){ //there's a lot of 1x1 pictures in the world that don't need filtering!
                            console.log('predict '+details.requestId+' size '+img.width+'x'+img.height+', materialization occured with '+byteCount+' bytes');
                            let sqrxrScore = await predict(img);
                            await fast_filter(filter,img,allData,sqrxrScore,details.url,blob, shouldBlockSilently);
                            const totalTime = performance.now() - startTime;
                            console.log(`Total processing in ${Math.floor(totalTime)}ms`);
                        } else {
                            for(let i=0; i<allData.length; i++) {
                                filter.write(allData[i]);
                            }
                            filter.close();
                        }
                    }
                    img.src = url;
                } else {
                    console.log('tiny, skipping materialization '+details.requestId+' with '+byteCount+' bytes');
                    for(let i=0; i<allData.length; i++) {
                        filter.write(allData[i]);
                    }
                    filter.close();
                }
            } catch(e) {
                console.log('Error for '+details.url+': '+e)
                for(let i=0; i<allData.length; i++) {
                    filter.write(allData[i]);
                }
                filter.close();
            }
        };

        console.log('queuing '+details.requestId);
        capturedWorkQueue[details.requestId] = capturedWork;

        let lowestRequest = 10000000;
        let remainingWorkCount = 0;
        for(let key in capturedWorkQueue) {
            if (capturedWorkQueue.hasOwnProperty(key)) { 
                remainingWorkCount++;
                if(key < lowestRequest) {
                    lowestRequest = key;
                }
            }
        }
        console.log('dequeuing '+lowestRequest);
        let work = capturedWorkQueue[lowestRequest];
        await work();
        delete capturedWorkQueue[lowestRequest];
        console.log('remaining: '+(remainingWorkCount-1));
    }
    return details;
  }


browser.webRequest.onHeadersReceived.addListener(
    listener,
    {urls:["<all_urls>"], types:["image","imageset"]},
    ["blocking","responseHeaders"]
  );

async function direct_typed_url_listener(details) {
    //Try to see if there is an image MIME type
    for(let i=0; i<details.responseHeaders.length; i++) {
        let header = details.responseHeaders[i];
        if(header.name.toLowerCase() == "content-type") {
            let mimeType = header.value;
            if(mimeType.startsWith('image/')) {
                console.log('Direct URL: Forwarding based on mime type: '+mimeType+' for '+details.url);
                return listener(details,true);
            }
        }
    }
    //Otherwise do nothing...
    return details;
}

browser.webRequest.onHeadersReceived.addListener(
    direct_typed_url_listener,
    {urls:["<all_urls>"], types:["main_frame"]},
    ["blocking","responseHeaders"]
  );


////////////////////////////////base64 IMAGE SEARCH SPECIFIC STUFF BELOW, BOO HISS!!!! ///////////////////////////////////////////

async function base64_fast_filter(img,sqrxrScore, url) {
    console.log('base64 fast filter!');
	let unsafeScore = sqrxrScore[0];
    if(isSafe(sqrxrScore)) {
        console.log('base64 filter Passed: '+sqrxrScore[0]+' '+url);
        return null;
    } else {
        incrementBlockCount();
        console.log('base64 filter Blocked: '+sqrxrScore[0]+' '+url);
        let svgText = await common_create_svg(img,unsafeScore,img.src);
        let svgURI='data:image/svg+xml;base64,'+window.btoa(svgText);
        return svgURI;
    }
}

//listen for "above the fold" image search requests
async function base64_listener(details) {
    console.log('base64 headers '+details.requestId+' '+details.url);
    let mimeType = '';
    for(let i=0; i<details.responseHeaders.length; i++) {
        let header = details.responseHeaders[i];
        if(header.name.toLowerCase() == "content-type") {
            mimeType = header.value;
            break;
        }
    }
    console.log('base64 mime type for '+details.requestId+': '+mimeType);
    if (!mimeType.trim().startsWith('text/html')) {
        return;
    }


    const startTime = performance.now();
    let filter = browser.webRequest.filterResponseData(details.requestId);
    let decoder = new TextDecoder("utf-8");
    let encoder = new TextEncoder();

    let fullStr = ''; //ugh

    filter.ondata = event => {
        let str = decoder.decode(event.data, {stream: true});
        fullStr += str;
      }

    filter.onstop = e => {
        try
        {
            console.log('base64 stop '+fullStr.length);
            incrementCheckCount();

            //Unfortunately, str.replace cannot accept a promise as a function,
            //so we simply set 'em up and knock 'em down.
            //Note there used to be a funky bit at the end to catch = encoded as \x3d
            //but it isn't needed any more with \ in the main body being caught for JS encoding.
            let dataURIMatcher = /data:image\\{0,2}\/[a-z]+;base64,[A-Za-z0-9=+\/ \-\\]+/g;
            let imageDataURIs = fullStr.match(dataURIMatcher);
            if (imageDataURIs === null) {
                console.log('base64 no images detected, passing through original');
                filter.write(encoder.encode(fullStr));
                filter.close();
                return;
            }
            console.log('base64 match count: '+imageDataURIs.length);


            let replacements = [];
            let imageCheckCount = 0;

            function ensureProgress() {
                imageCheckCount++;
                console.log('base64 progress: '+imageCheckCount+'/'+imageDataURIs.length);

                if(imageCheckCount == imageDataURIs.length) {
                    let filteredStr = fullStr;
                    for(let j=0; j<replacements.length; j++) {
                        let replacement = replacements[j];
                        //Why on earth doesn't JS just have a replaceAll instead?
                        //Arguably replaceAll might be better semantics but without caching, this should
                        //get called once per time, so replace will get the right number of times
                        //If I go with the regex method instead, it works BUT then it errors out
                        //when the image gets too big.
                        filteredStr = filteredStr.replace(replacement.old_img, replacement.new_img);
                        //filteredStr = filteredStr.replace(new RegExp(escapeRegExp(replacement.old_img),'g'),replacement.new_img);
                    }
                    filter.write(encoder.encode(filteredStr));
                    filter.close();
                }
            }
            
            for(let i=0; i<imageDataURIs.length; i++)
            {
                let rawImageDataURI = imageDataURIs[i];
                //Note we now have move \x3d's into ='s for proper base64 decoding
                let imageDataURI = rawImageDataURI;
                let wasJSEncoded = imageDataURI.startsWith('data:image\\/'); //Unencoded, data:image\\/
                let prefixId = imageDataURI.slice(0,20);
                if(wasJSEncoded) {
                    imageDataURI = imageDataURI.replace(/\\/g,''); //Unencoded, \ -> ''
                    let newPrefixId = imageDataURI.slice(0,20);
                    console.log('base64 image JS encoding detected: '+prefixId+'->'+newPrefixId);
                } else {
                    console.log('base64 image no extra encoding detected: '+prefixId);
                }
                imageDataURI = imageDataURI.replace(/\\x3[dD]/g,'=');
                let imageId = imageDataURI.slice(-20);
                console.debug('base64 image loading: '+imageId);


                let byteCount = imageDataURI.length*3/4;

                if(byteCount >= MIN_IMAGE_BYTES) {
                    let img = new Image();

                    img.onload = async function(e) {
                        console.log('base64 image loaded: '+imageId);
                        try
                        {
                            if(img.width>=MIN_IMAGE_SIZE && img.height>=MIN_IMAGE_SIZE){ //there's a lot of 1x1 pictures in the world that don't need filtering!
                                console.log('base64 predict '+imageId+' size '+img.width+'x'+img.height+', materialization occured with '+byteCount+' bytes');
                                let sqrxrScore = await predict(img);
                                console.log('base64 score: '+sqrxrScore);
                                let replacement = await base64_fast_filter(img, sqrxrScore, details.url);
                                const totalTime = performance.now() - startTime;
                                console.log(`Total processing in ${Math.floor(totalTime)}ms`);
                                if(replacement !== null) {
                                    if(wasJSEncoded) {
                                        console.log('base64 JS encoding replacement fixup for '+imageId);
                                        replacement = replacement.replace(/\//g,'\\/'); //Unencoded / -> \/
                                    }
                                    //Important! We have to use raw as the old so we don't miss the actual replacement match due to decoding vagaries
                                    replacements.push({'old_img':rawImageDataURI,'new_img':replacement});
                                }
                            } else {
                                console.debug('base64 skipping image with small dimensions: '+imageId);
                            }
                        }
                        catch(e)
                        {
                            console.error('base64 check failure for '+imageId+': '+e);
                        }
                        ensureProgress();
                    }
                    img.onerror = function(e) {
                        console.log('base64 img load error: '+e);
                    }
                    img.src = imageDataURI;
                } else {
                    ensureProgress();
                }
            }
        }
        catch(e)
        {
            console.log('Filter stop error: '+e);
        }
    }

    filter.onerror = e => {
        try
        {
            filter.close();
        }
        catch(e)
        {
            console.log('Filter error: '+e);
        }
    }
  
  return details;
}

browser.webRequest.onHeadersReceived.addListener(
    base64_listener,
    {
        urls:[
            "<all_urls>"
        ],
        types:["main_frame"]
    },
    ["blocking","responseHeaders"]
  );

///////////////////////////////Context Menu//////////////////////////////
browser.menus.create({
    id: "toggle-review-mode",
    title: "Toggle Review Mode"
  });


browser.menus.onClicked.addListener((info, tab) => {
    switch (info.menuItemId) {
      case "toggle-review-mode":
        isInReviewMode = !isInReviewMode;
        console.log('Review mode? '+isInReviewMode);
        break;
    }
  });

////////////////////////Actual Startup//////////////////////////////
wingman_startup();