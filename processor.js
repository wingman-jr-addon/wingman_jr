const PROC_MODEL_PATH = 'sqrxr_107_graphopt/model.json'
const PROC_IMAGE_SIZE = 224;
const PROC_MIN_IMAGE_SIZE = 36;
const PROC_MIN_IMAGE_BYTES = 1024;

function onModelLoadProgress(percentage) {
    console.log('LIFECYCLE: Model load '+Math.round(percentage*100)+'% at '+performance.now());
}

let PROC_isInReviewMode = false;
let PROC_wingman;
let PROC_loadedBackend;
const wingman_startup = async () => {
    console.log('LIFECYCLE: Launching TF.js!');
    let params = (new URL(document.location)).searchParams;
    let backendRequested = params.get('backend');
    console.log('LIFECYCLE: Backend requested '+backendRequested);
    if(backendRequested != 'default') {
        tf.setBackend(backendRequested || 'wasm');
    }
    console.log(tf.env().getFlags());
    tf.enableProdMode();
    await tf.ready();
    PROC_loadedBackend = tf.getBackend();
    console.log('LIFECYCLE: TensorflowJS backend is: '+PROC_loadedBackend);
    if(PROC_loadedBackend == 'cpu') {
        console.log('LIFECYCLE: WARNING! Exiting because no fast predictor can be loaded!');
        PROC_wingman = null;
        return;
    }
    console.log('LIFECYCLE: Loading model...');
    PROC_wingman = await tf.loadGraphModel(PROC_MODEL_PATH, { onProgress: onModelLoadProgress });
    console.log('LIFECYCLE: Model loaded: ' + PROC_wingman+' at '+performance.now());

    console.log('LIFECYCLE: Warming up...');
    let dummy_data = tf.zeros([1, PROC_IMAGE_SIZE, PROC_IMAGE_SIZE, 3]);
    let warmup_result = null;
    let timingInfo = await tf.time(()=>warmup_result = PROC_wingman.predict(dummy_data));
    console.log(warmup_result);
    console.log('LIFECYCLE: TIMING LOADING: '+JSON.stringify(timingInfo));
    warmup_result.print();
    warmup_result.dispose();
    console.log('LIFECYCLE: Ready to go at '+performance.now()+'!');
};


/**
 * Given an image element, makes a prediction through PROC_wingman
 */
let PROC_inferenceTimeTotal = 0;
let PROC_inferenceCountTotal = 0;
let PROC_inferenceCanvas = document.createElement('canvas');
PROC_inferenceCanvas.width = PROC_IMAGE_SIZE;
PROC_inferenceCanvas.height = PROC_IMAGE_SIZE;
let PROC_inferenceCtx = PROC_inferenceCanvas.getContext('2d', { alpha: false});//, powerPreference: 'high-performance'});
console.log('LIFECYCLE: Inference context: '+PROC_inferenceCtx);
PROC_inferenceCtx.imageSmoothingEnabled = true;

let PROC_processingTimeTotal = 0;
let PROC_processingSinceDataEndTimeTotal = 0;
let PROC_processingSinceImageLoadTimeTotal = 0;
let PROC_processingCountTotal = 0;

async function predict(imgElement, ctx) {
  if(ctx === undefined) {
      ctx = PROC_inferenceCtx;
  }
  const drawStartTime = performance.now();
  ctx.drawImage(imgElement, 0, 0, imgElement.width, imgElement.height, 0, 0, PROC_IMAGE_SIZE,PROC_IMAGE_SIZE);
  const rightSizeImageData = ctx.getImageData(0, 0, PROC_IMAGE_SIZE, PROC_IMAGE_SIZE);
  const totalDrawTime = performance.now() - drawStartTime;
  console.log(`PERF: Draw time in ${Math.floor(totalDrawTime)}ms`);

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
    const result = PROC_wingman.predict(batched, {batchSize: 1});

    return result;
  });

  let syncedResult = logits.dataSync();
  const totalTime = performance.now() - startTime;
  PROC_inferenceTimeTotal += totalTime;
  PROC_inferenceCountTotal++;
  const avgTime = PROC_inferenceTimeTotal / PROC_inferenceCountTotal;
  console.log(`PERF: Model inference in ${Math.floor(totalTime)}ms and avg of ${Math.floor(avgTime)}ms for ${PROC_inferenceCountTotal} scanned images`);

  console.log('ML: Prediction: '+syncedResult[0]);
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


let LOG_IMG_SIZE = 150;
let PROC_logCanvas = document.createElement('canvas');
PROC_logCanvas.width = LOG_IMG_SIZE;
PROC_logCanvas.height = LOG_IMG_SIZE;
let PROC_logCtx = PROC_logCanvas.getContext('2d', { alpha: false});
PROC_logCanvas.imageSmoothingEnabled = true;
async function common_log_img(img, message)
{
    let maxSide = Math.max(img.width, img.height);
    let ratio = LOG_IMG_SIZE/maxSide;
    let newWidth = img.width*ratio;
    let newHeight = img.height*ratio;
    PROC_logCtx.clearRect(0,0,PROC_logCanvas.width,PROC_logCanvas.height);
    PROC_logCtx.drawImage(img, 0, 0, newWidth, newHeight);
    let logDataUrl = PROC_logCanvas.toDataURL('image/jpeg', 0.7);
    let blockedCSS = 'color: #00FF00; padding: 75px; line-height: 150px; background-image: url('+logDataUrl+'); background-size: contain; background-repeat: no-repeat;';
    console.log('%c '+message, blockedCSS);
}

async function common_create_svg_from_blob(img, threshold, blob)
{
    let dataURL = PROC_isInReviewMode ? await readFileAsDataURL(blob) : null;
    return common_create_svg(img, threshold, dataURL);
}

let PROC_iconDataURI = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAD6AAAA+gBtXtSawAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAGxSURBVFiF7dW9j0xRHMbxjz1m2ESWkChkiW0kGgSFnkbsJqvQTEMoRSFRydDsP6CiEoJibfQEW2hssSMKiUI2UcluY0Ui6y2M4pyJYzK7cxczFPeb3OSe+zzn+f3uyzmXkpKSf0zAIXzApz7X3oR9sB6PsLOPxXfgIQZbFw7iOQ70ofgePBOf/C9cwGsc7WHxw5hLtToyhXnUCoRVQ6VyJlQqp1Et4K+l7KmVTJvFV/Ee57sE1kMIoyGEY7jcxXsOi3iBLd06PYJ3+Iwry3jWYFa88yoaGFjGO4GP4k0Vfr0T+J6O21jbpp/C02w8g5NtnoDr+IZmyizMAO6nic10viHTH+NGNr6J6Ww8iHvZ/AepoVWxHa+ykGlswxi+oJ556+naGLamBlvz5jCy2uItaljKwhqpkSbGM9941mQj8y8ptqJW5FoW2DoWMZR5hvC2g+/qnxaHdXjSFjybtBM4ns4bbZ4ZcZv/K+zFmyx8EqPinj4iLq+7mb6gB9v6WfFDa+IWdmXabtxJ2tfk7QmTqcjFDtolP59Oz9gobqfDHbRhvBT/8z1l/29qJSUl/yc/AP3+b58RpkSuAAAAAElFTkSuQmCC";


async function common_create_svg(img, threshold, dataURL)
{
    let confidence = findConfidence(threshold);
    let visibleScore = Math.floor(confidence*100);
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
    + (PROC_isInReviewMode ? '<image href="'+dataURL+'" x="0" y="0" height="'+img.height+'px" width="'+img.width+'px" opacity="0.2" />' : '')
    +'<text transform="translate(12 20)" font-size="20" fill="red">'+visibleScore+'</text>'
    +'</g>'
    +'</svg>';
    return svgText;
}

let PROC_checkThreshold = ROC_neutralRoc;

function setThreshold(threshold) {
    PROC_checkThreshold = threshold;
}

function isSafe(sqrxrScore) {
    return sqrxrScore[0] < PROC_checkThreshold;
}



const loadImagePromise = url => new Promise( (resolve, reject) => {
    const img = new Image()
    img.onerror = e => reject(e)
    img.onload = () => resolve(img)
    img.decoding = 'sync'
    img.src = url
});

let PROC_timingInfoDumpCount = 0;

async function performFiltering(entry) {
    let dataEndTime = performance.now();
    console.log('WEBREQP: starting work for '+entry.requestId +' from '+entry.url);
    let result = {
        type: 'scan',
        requestId: entry.requestId,
        imageBytes: null,
        result: null
    };
    let byteCount = 0;
    for(let i=0; i<entry.buffers.length; i++) {
        byteCount += entry.buffers[i].byteLength;
    }
    let blob = new Blob(entry.buffers, {type: entry.mimeType});
    let url = null;
    try
    {
        if(byteCount >= PROC_MIN_IMAGE_BYTES) { //only scan if the image is complex enough to be objectionable
            url = URL.createObjectURL(blob);
            let img = await loadImagePromise(url);
            console.log('img loaded '+entry.requestId)
            if(img.width>=PROC_MIN_IMAGE_SIZE && img.height>=PROC_MIN_IMAGE_SIZE){ //there's a lot of 1x1 pictures in the world that don't need filtering!
                console.log('ML: predict '+entry.requestId+' size '+img.width+'x'+img.height+', materialization occured with '+byteCount+' bytes');
                let imgLoadTime = performance.now();
                let sqrxrScore = [0];
                if(PROC_timingInfoDumpCount<10) {
                    PROC_timingInfoDumpCount++;
                    let timingInfo = await tf.time(async ()=>sqrxrScore=await predict(img));
                    console.log('PERF: TIMING NORMAL: '+JSON.stringify(timingInfo));
                } else {
                    sqrxrScore = await predict(img);
                }
                if(isSafe(sqrxrScore)) {
                    console.log('ML: Passed: '+sqrxrScore[0]+' '+entry.requestId);
                    result.result = 'pass';
                    result.imageBytes = await blob.arrayBuffer();
                } else {
                    console.log('ML: Blocked: '+sqrxrScore[0]+' '+entry.requestId);
                    let svgText = await common_create_svg_from_blob(img, sqrxrScore[0], blob);
                    common_log_img(img, 'BLOCKED IMG '+sqrxrScore);
                    let encoder = new TextEncoder();
                    let encodedTypedBuffer = encoder.encode(svgText);
                    result.result = 'block';
                    result.imageBytes = encodedTypedBuffer.buffer;
                }
                const endTime = performance.now();
                const totalTime = endTime - entry.startTime;
                const totalSinceDataEndTime = endTime - dataEndTime;
                const totalSinceImageLoadTime = endTime - imgLoadTime;
                PROC_processingTimeTotal += totalTime;
                PROC_processingSinceDataEndTimeTotal += totalSinceDataEndTime;
                PROC_processingSinceImageLoadTimeTotal += totalSinceImageLoadTime;
                PROC_processingCountTotal++;
                console.log('PERF: Processed in '+totalTime
                    +' (' +totalSinceDataEndTime+' data end, '
                    +totalSinceImageLoadTime+' img load) with an avg of '
                    +Math.round(PROC_processingTimeTotal/PROC_processingCountTotal)
                    +' ('+Math.round(PROC_processingSinceDataEndTimeTotal/PROC_processingCountTotal)
                    +' data end, ' + Math.round(PROC_processingSinceImageLoadTimeTotal/PROC_processingCountTotal)
                    +' img load) at a count of '+PROC_processingCountTotal);
                console.log('WEBREQ: Finishing '+entry.requestId);
            } else {
                result.result = 'tiny';
                result.imageBytes = await blob.arrayBuffer();
            }
        } else {
            result.result = 'tiny';
            result.imageBytes = await blob.arrayBuffer();
        }
    } catch(e) {
        console.log('WEBREQP: Error for '+entry.url+': '+e);
        result.result = 'error';
        result.imageBytes = result.imageBytes || await blob.arrayBuffer();
    } finally {
        console.log('WEBREQP: Finishing '+entry.requestId);
        if(url != null) {
            URL.revokeObjectURL(url);
        }
    }
    return result;
}

async function advanceB64Filtering(dataStr, b64Filter, outputPort) {
    b64Filter.fullStr += dataStr;
}

async function completeB64Filtering(b64Filter, outputPort) {
    let startTime = performance.now();
    let fullStr = b64Filter.fullStr;
    console.log('WEBREQ: base64 stop '+fullStr.length);

    //Unfortunately, str.replace cannot accept a promise as a function,
    //so we simply set 'em up and knock 'em down.
    //Note there is a funky bit at the end to catch = encoded as \x3d
    //but we need to exclude e.g. \x22 from showing up inside the match. Ugh.
    //However, we also must allow '\/' to show up, making for a nasty two character
    //allowed sequence when the rest are single chars up to the end. Double ugh.
    let dataURIMatcher = /data:image\\{0,2}\/[a-z]+;base64,([A-Za-z0-9=+\/ \-]|\\\/)+(\\x3[dD])*/g;
    let endOfLastImage = 0;
    let result;
    while((result = dataURIMatcher.exec(fullStr))!==null) {
        //We found an image. We can output from the end of the last image
        //until the start of this one to start with.
        let inBetweenStr = fullStr.substring(endOfLastImage, result.index);
        outputPort.postMessage({
            type: 'b64_data',
            requestId: b64Filter.requestId,
            dataStr: inBetweenStr
        });
        endOfLastImage = result.index + result[0].length;

        //Now check the image and either output the original or the replacement
        let rawImageDataURI = result[0];
        //Note we now have move \x3d's into ='s for proper base64 decoding
        let imageDataURI = rawImageDataURI;
        let wasJSEncoded = imageDataURI.startsWith('data:image\\/'); //Unencoded, data:image\\/
        let prefixId = imageDataURI.slice(0,20);
        if(wasJSEncoded) {
            imageDataURI = imageDataURI.replace(/\\/g,''); //Unencoded, \ -> ''
            let newPrefixId = imageDataURI.slice(0,20);
            console.log('WEBREQ: base64 image JS encoding detected: '+prefixId+'->'+newPrefixId);
        } else {
            console.log('WEBREQ: base64 image no extra encoding detected: '+prefixId);
        }
        imageDataURI = imageDataURI.replace(/\\x3[dD]/g,'=');
        let imageToOutput = imageDataURI;
        let imageId = imageDataURI.slice(-20);
        console.debug('WEBREQ: base64 image loading: '+imageId);
        let byteCount = imageDataURI.length*3/4;

        if(byteCount >= PROC_MIN_IMAGE_BYTES) {
            console.log('WEBREQ: base64 image loaded: '+imageId);
            try
            {
                let img = await loadImagePromise(imageDataURI);
                if(img.width>=PROC_MIN_IMAGE_SIZE && img.height>=PROC_MIN_IMAGE_SIZE){ //there's a lot of 1x1 pictures in the world that don't need filtering!
                    console.log('ML: base64 predict '+imageId+' size '+img.width+'x'+img.height+', materialization occured with '+byteCount+' bytes');
                    let sqrxrScore = await predict(img);
                    console.log('ML: base64 score: '+sqrxrScore);
                    let unsafeScore = sqrxrScore[0];
                    let replacement = null; //safe
                    if(isSafe(sqrxrScore)) {
                        outputPort.postMessage({
                            type:'stat',
                            result:'pass',
                            requestId: b64Filter.requestId+'_'+imageId
                        });
                        console.log('ML: base64 filter Passed: '+sqrxrScore[0]+' '+b64Filter.requestId);
                    } else {
                        outputPort.postMessage({
                            type:'stat',
                            result:'block',
                            requestId: b64Filter.requestId+'_'+imageId
                        });
                        let svgText = await common_create_svg(img,unsafeScore,img.src);
                        let svgURI='data:image/svg+xml;base64,'+window.btoa(svgText);
                        common_log_img(img, 'BLOCKED IMG BASE64 '+sqrxrScore[0]);
                        replacement = svgURI;
                    }

                    const totalTime = performance.now() - startTime;
                    console.log(`PERF: Total processing in ${Math.floor(totalTime)}ms`);
                    if(replacement !== null) {
                        if(wasJSEncoded) {
                            console.log('WEBREQ: base64 JS encoding replacement fixup for '+imageId);
                            replacement = replacement.replace(/\//g,'\\/'); //Unencoded / -> \/
                        }
                        imageToOutput = replacement;
                    }
                } else {
                    outputPort.postMessage({
                        type:'stat',
                        result:'tiny',
                        requestId: b64Filter.requestId+'_'+imageId
                    });
                    console.debug('WEBREQ: base64 skipping image with small dimensions: '+imageId);
                }
            }
            catch(e)
            {
                outputPort.postMessage({
                    type:'stat',
                    result:'error',
                    requestId: b64Filter.requestId+'_'+imageId
                });
                console.error('WEBREQ: base64 check failure for '+imageId+': '+e);
            }
            
        }

        outputPort.postMessage({
            type: 'b64_data',
            requestId: b64Filter.requestId,
            dataStr: imageToOutput
        });
    }
    
    //Now flush the last part
    let finalNonImageChunk = fullStr.substring(endOfLastImage);
    outputPort.postMessage({
        type: 'b64_data',
        requestId: b64Filter.requestId,
        dataStr: finalNonImageChunk
    });
    outputPort.postMessage({
        type: 'b64_close',
        requestId: b64Filter.requestId
    });
}

let PROC_openRequests = {};
let PROC_openB64Requests = {};
let PROC_openVidRequests = {};
let PROC_processingQueue = [];
let PROC_inFlight = 0;
async function checkProcess() {
    console.log('QUEUE: In Flight: '+PROC_inFlight+' In Queue: '+PROC_processingQueue.length);
    if(PROC_processingQueue.length == 0) {
        PROC_port.postMessage({
            type: 'qos',
            processorId: PROC_processorId,
            isBusy: false
        })
        return;
    }
    if(PROC_inFlight > 0) { //Note, if increasing, consider inference context reuse strategy!
        if(PROC_processingQueue.length > 30) {
            console.log('QUEUE: Pressure warning! '+PROC_processingQueue.length+' Setting PROC_inFlight=0');
            PROC_inFlight = 0;
        } else {
            console.log('QUEUE: Throttling ('+PROC_inFlight+')');
            return;
        }
    }
    //It is critical that PROC_inFlight always goes up AND DOWN, hence all the try/catch action.
    let toProcess = PROC_processingQueue.shift();
    if(toProcess !== undefined) {
        PROC_inFlight++;
        let result;
        try {
            PROC_port.postMessage({
                type: 'qos',
                processorId: PROC_processorId,
                isBusy: true
            })
            console.log('QUEUE: Processing (PROC_inFlight='+PROC_inFlight+') request '+toProcess.requestId);
            result = await performFiltering(toProcess);
            
        } catch(ex) {
            console.log('ML: Error scanning image '+ex);
        }
        PROC_inFlight--;
        if(PROC_inFlight < 0) {
            console.log('QUEUE: Recovering from pressure release, upping to PROC_inFlight=0');
            PROC_inFlight = 0;
        }
        try {
            PROC_port.postMessage(result);
            PROC_port.postMessage({
                type:'stat',
                result: result.result,
                requestId: toProcess.requestId
            });
        } catch(e) {
            console.log('ERROR: Processor failed to communicate to background: '+e);
        }
    } else {
        console.log('QUEUE: Rare time where processing queue drained? Length: '+PROC_processingQueue.length);
    }
    await checkProcess();
}


const videoLoadedData = (video,url,seekTime) => new Promise( (resolve, reject) => {
    video.addEventListener('error', e=>reject(e), {once: true});
    video.addEventListener('seeked',  () => {
        video.width = video.videoWidth;
        video.height = video.videoHeight;
        resolve();
    } , {once:true});
    video.src = url;
    video.currentTime = seekTime;
});

function getVideoUrl(vidFilter) {
    if(vidFilter.mimeType.toLowerCase().startsWith('video/mp2t')) {
        console.log('MLV: URL MP2T detected for '+vidFilter.requestId+', mime '+vidFilter.mimeType);
        //remux that sucker to MP4 quick
        let transmuxer = new muxjs.mp4.Transmuxer();
        let tBuffers = [];
        transmuxer.on('data', (segment) => {
            if(tBuffers.length == 0) {
                tBuffers.push(segment.initSegment);
            }
            tBuffers.push(segment.data);
        });
        vidFilter.buffers.forEach(b=>transmuxer.push(new Uint8Array(b)));
        transmuxer.flush();
        let blob = new Blob(tBuffers, {type: 'video/mp4'});
        return URL.createObjectURL(blob);
    } else {
        console.log('MLV: URL default detected for '+vidFilter.requestId+', mime '+vidFilter.mimeType);
        let blob = new Blob(vidFilter.buffers, {type: vidFilter.mimeType});
        return URL.createObjectURL(blob);
    }
}


async function getVideoScanStatus(vidFilter) {
    let videoCanvas = document.createElement('canvas');
    videoCanvas.width = PROC_IMAGE_SIZE;
    videoCanvas.height = PROC_IMAGE_SIZE;
    let videoCtx = videoCanvas.getContext('2d', { alpha: false});//, powerPreference: 'high-performance'});
    videoCtx.imageSmoothingEnabled = true;
    let inferenceVideo, url, sqrxrScore, status;
    try {
        console.log('MLV: scanning video '+vidFilter.requestId+' size '+vidFilter.totalSize+', type '+vidFilter.requestType+', MIME '+vidFilter.mimeType+', URL '+vidFilter.url);
        inferenceVideo = document.createElement('video');
        inferenceVideo.onencrypted = function() {
            console.log('MLV: encrypted: '+vidFilter.requestId); //This will fail :(
        };
        //inferenceVideo.type = vidFilter.mimeType; //?
        inferenceVideo.autoplay = false;

        url = getVideoUrl(vidFilter);

        let step = 0.75;
        let initial = 0.5;
        let stepCount = 7;
        let blockCount = 0;
        let blockThreshold = 3;

        for(var i=0; i<stepCount; i++) {
            let seekTime = initial+step*i;
            await videoLoadedData(inferenceVideo, url, seekTime);

            console.log('MLV: predicting video '+vidFilter.requestId+' WxH '+inferenceVideo.width+','+inferenceVideo.height+' at '+seekTime);
            
            sqrxrScore = await predict(inferenceVideo, videoCtx);
            if(isSafe(sqrxrScore))
            {
                console.log('MLV: video score @'+seekTime+': '+sqrxrScore+' status? pass, type '+vidFilter.requestType+', MIME '+vidFilter.mimeType);
            }
            else
            {
                console.log('MLV: video score @'+seekTime+': '+sqrxrScore+' status? block, type '+vidFilter.requestType+', MIME '+vidFilter.mimeType);
                await common_log_img(inferenceVideo, 'MLV: BLOCKED VID @'+seekTime+' '+sqrxrScore);
                blockCount++;
            }
        }
        status = blockCount >= blockThreshold ? 'block' : 'pass';
        console.log('MLV: video summary '+vidFilter.requestId+':'+vidFilter.requestType+' status '+status+' blocks '+blockCount+'/'+stepCount+' with status');
    } catch(e) {
        console.log('MLV: Error scanning '+e);
        status = 'error';
    } finally {
        URL.revokeObjectURL(url);
    }
    return status;
}

async function onPortMessage(m) {
    switch(m.type) {
        case 'start': {
            PROC_openRequests[m.requestId] = {
                requestId: m.requestId,
                url: m.url,
                mimeType: m.mimeType,
                startTime: performance.now(),
                buffers: []
            };
            console.log('PERF: '+PROC_processorId+' has open requests queue size '+Object.keys(PROC_openRequests).length);
        }
        break;
        case 'ondata': {
            console.log('DATA: '+m.requestId);
            PROC_openRequests[m.requestId].buffers.push(m.data);
        }
        break;
        case 'onerror': {
            delete PROC_openRequests[m.requestId];
        }
        break;
        case 'onstop': {
            PROC_processingQueue.push(PROC_openRequests[m.requestId]);
            delete PROC_openRequests[m.requestId];
            await checkProcess();
        }
        case 'b64_start': {
            PROC_openB64Requests[m.requestId] = {
                requestId: m.requestId,
                startTime: performance.now(),
                fullStr: ''
            };
        }
        break;
        case 'b64_ondata': {
            await advanceB64Filtering(m.dataStr, PROC_openB64Requests[m.requestId], PROC_port);
        }
        break;
        case 'b64_onerror': {
            delete openB64Filters[m.requestId];
        }
        case 'b64_onstop': {
            await completeB64Filtering(PROC_openB64Requests[m.requestId], PROC_port);
        }
        break;
        case 'vid_start': {
            console.log('DATAV: vid_start '+m.requestId);
            PROC_openVidRequests[m.requestId] = {
                requestId: m.requestId,
                requestType: m.requestType,
                url: m.url,
                mimeType: m.mimeType,
                buffers: [],
                hasScanningBegun: false,
                totalSize: 0
            };
        }
        break;
        case 'vid_ondata': {
            console.log('DATAV: '+m.requestId+' packet '+m.packetNo);
            let vidFilter = PROC_openVidRequests[m.requestId];
            if(vidFilter === undefined) {
                break;
            }
            vidFilter.buffers.push(m.data);
            vidFilter.totalSize += m.data.byteLength;
            console.log('DATAV: '+m.requestId+' packet '+m.packetNo+' total size '+vidFilter.totalSize);
            
            if(!vidFilter.hasScanningBegun && vidFilter.totalSize >= 1024*300) {
                vidFilter.hasScanningBegun = true;
                let scanStatus = await getVideoScanStatus(vidFilter);
                if(scanStatus != 'error') {
                    PROC_port.postMessage({
                        type: 'vid_scan',
                        requestId: vidFilter.requestId,
                        status: scanStatus
                    });
                    delete PROC_openVidRequests[m.requestId];
                } else {
                    //try it again
                    vidFilter.hasScanningBegun = false;
                }
            }
            
        }
        break;
        case 'vid_onerror': {
            console.log('DATAV: vid_onerror '+m.requestId);
            delete PROC_openVidRequests[m.requestId];
        }
        break;
        case 'vid_onstop': {
            console.log('DATAV: vid_onstop '+m.requestId);
            let vidFilter = PROC_openVidRequests[m.requestId];
            if(vidFilter === undefined) {
                break;
            }
            let scanStatus = await getVideoScanStatus(vidFilter);
            PROC_port.postMessage({
                type: 'vid_scan',
                requestId: vidFilter.requestId,
                status: scanStatus
            });
            delete PROC_openVidRequests[m.requestId];
        }
        break;
        case 'thresholdChange': {
            console.log('PROC: Setting threshold '+m.threshold);
            setThreshold(m.threshold);
        }
        break;
        default: {
            console.error('ERROR: received unknown message: '+m);
        }
        break;
    }
}

let PROC_port = null;
let PROC_processorId = (new URL(document.location)).searchParams.get('id');
wingman_startup()
.then(async ()=>
{
    PROC_port = browser.runtime.connect(browser.runtime.id, {name:PROC_processorId});
    PROC_port.onMessage.addListener(onPortMessage);
    PROC_port.postMessage({
        type: 'registration',
        processorId: PROC_processorId,
        backend: PROC_loadedBackend
    });
});