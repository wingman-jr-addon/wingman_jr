const PROC_MODEL_PATH = 'sqrxr_112_graphopt/model.json'
const PROC_IMAGE_SIZE = 224;
const PROC_MIN_IMAGE_SIZE = 36;
const PROC_MIN_IMAGE_BYTES = 1024;

let WJR_DEBUG = false;

function procOnModelLoadProgress(percentage) {
    WJR_DEBUG && console.log('LIFECYCLE: Model load '+Math.round(percentage*100)+'% at '+performance.now());
}

let PROC_isInReviewMode = false;
let PROC_wingman;
let PROC_loadedBackend;
const procWingmanStartup = async (backendRequested) => {
    WJR_DEBUG && console.log('LIFECYCLE: Launching TF.js!');
    WJR_DEBUG && console.log('LIFECYCLE: Backend requested '+backendRequested);
    if(backendRequested != 'default') {
        tf.setBackend(backendRequested || 'wasm');
    }
    tf.env().set('WEBGL_USE_SHAPES_UNIFORMS', true);
    WJR_DEBUG && console.log(tf.env().getFlags());
    tf.enableProdMode();
    await tf.ready();
    PROC_loadedBackend = tf.getBackend();
    WJR_DEBUG && console.log('LIFECYCLE: TensorflowJS backend is: '+PROC_loadedBackend);
    if(PROC_loadedBackend == 'cpu') {
        WJR_DEBUG && console.log('LIFECYCLE: WARNING! Exiting because no fast predictor can be loaded!');
        PROC_wingman = null;
        return;
    }
    WJR_DEBUG && console.log('LIFECYCLE: Loading model...');
    PROC_wingman = await tf.loadGraphModel(PROC_MODEL_PATH, { onProgress: procOnModelLoadProgress });
    WJR_DEBUG && console.log('LIFECYCLE: Model loaded: ' + PROC_wingman+' at '+performance.now());

    WJR_DEBUG && console.log('LIFECYCLE: Warming up...');
    let dummy_data = tf.zeros([1, PROC_IMAGE_SIZE, PROC_IMAGE_SIZE, 3]);
    let warmup_result = null;
    let timingInfo = await tf.time(()=>warmup_result = PROC_wingman.predict(dummy_data));
    WJR_DEBUG && console.log(warmup_result);
    console.log('LIFECYCLE: TIMING LOADING: '+JSON.stringify(timingInfo));
    warmup_result[0].dispose();
    warmup_result[1].dispose();
    console.log('LIFECYCLE: Ready to go at '+performance.now()+'!');
};


/**
 * Given an image element, makes a prediction through PROC_wingman
 */
let PROC_inferenceTimeTotal = 0;
let PROC_inferenceCountTotal = 0;


function procCreateInferenceContext() {
    let canvas = document.createElement('canvas');
    canvas.width = PROC_IMAGE_SIZE;
    canvas.height = PROC_IMAGE_SIZE;
    let ctx = canvas.getContext('2d', { alpha: false});//, powerPreference: 'high-performance'});
    WJR_DEBUG && console.log('LIFECYCLE: Inference context: '+ctx);
    ctx.imageSmoothingEnabled = true;

    return { canvas: canvas, ctx: ctx };
}

let procContextReferences = [];
let procContextPool = [];
let PROC_CTX_POOL_DEFAULT_SIZE = 1;
for(let i=0; i<PROC_CTX_POOL_DEFAULT_SIZE; i++) {
    let c = procCreateInferenceContext();
    procContextReferences.push(c);
    procContextPool.push(c);
}

function procGetCtx() {
    if(procContextPool.length == 0) {
        let c = procCreateInferenceContext();
        procContextReferences.push(c);
        procContextPool.push(c);
        console.warn(`PROC: Had to increase context pool to size ${procContextReferences.length}`);
    }
    return procContextPool.pop();
}

function procReturnCtx(c) {
    procContextPool.push(c);
}

function procIsCtxPoolEmpty() {
    return procContextPool.length == 0;
}

let PROC_processingTimeTotal = 0;
let PROC_processingSinceDataEndTimeTotal = 0;
let PROC_processingSinceImageLoadTimeTotal = 0;
let PROC_processingCountTotal = 0;

function tileImage(c, imgElement) {
    c.ctx.clearRect(0, 0, PROC_IMAGE_SIZE, PROC_IMAGE_SIZE);
    if(imgElement.width >= imgElement.height) {
        let widthMultiplier = Math.floor(imgElement.width / imgElement.height);
        widthMultiplier = Math.ceil(Math.sqrt(widthMultiplier));
        let dstTileWidth = PROC_IMAGE_SIZE;
        let dstTileHeight = PROC_IMAGE_SIZE / widthMultiplier;
        let srcTileWidth = imgElement.width / widthMultiplier;
        let srcTileHeight = imgElement.height;
        for(let i=0; i<widthMultiplier; i++) {
            c.ctx.drawImage(imgElement, i*srcTileWidth, 0, srcTileWidth, srcTileHeight, 0, i*dstTileHeight, dstTileWidth, dstTileHeight);
            //Debug line
            if(WJR_DEBUG && widthMultiplier > 1) {
                c.ctx.fillStyle = 'red';
                c.ctx.fillRect(0, i*dstTileHeight, dstTileWidth, 1);
            }
        }
        WJR_DEBUG && console.log(`TILE: Horizontal ${widthMultiplier} ${imgElement.width}x${imgElement.height} for src ${srcTileWidth}x${srcTileHeight}`);
    } else {
        let heightMultiplier = Math.floor(imgElement.height / imgElement.width);
        heightMultiplier = Math.ceil(Math.sqrt(heightMultiplier));
        let dstTileWidth = PROC_IMAGE_SIZE / heightMultiplier;
        let dstTileHeight = PROC_IMAGE_SIZE;
        let srcTileWidth = imgElement.width;
        let srcTileHeight = imgElement.height / heightMultiplier;
        for(let i=0; i<heightMultiplier; i++) {
            c.ctx.drawImage(imgElement, 0, i*srcTileHeight, srcTileWidth, srcTileHeight, i*dstTileWidth, 0, dstTileWidth, dstTileHeight);
            if(WJR_DEBUG && heightMultiplier > 1) {
                c.ctx.fillStyle = 'red';
                c.ctx.fillRect(i*dstTileWidth, 0, 1, dstTileHeight);
            }
        }
        WJR_DEBUG && console.log(`TILE: Vertical ${heightMultiplier} ${imgElement.width}x${imgElement.height} for src ${srcTileWidth}x${srcTileHeight}`);
    }
}

function drawImage(c, imgElement) {
    c.ctx.drawImage(imgElement, 0, 0, imgElement.width, imgElement.height, 0, 0, PROC_IMAGE_SIZE,PROC_IMAGE_SIZE);
}

async function procPredict(imgElement) {
    let c = procGetCtx();
    try {
        const drawStartTime = performance.now();
        tileImage(c, imgElement);
        WJR_DEBUG && (await procCommonLogImg(c.canvas, `TILE: Output`));
        const rightSizeImageData = c.ctx.getImageData(0, 0, PROC_IMAGE_SIZE, PROC_IMAGE_SIZE);
        const totalDrawTime = performance.now() - drawStartTime;
        WJR_DEBUG && console.debug(`PERF: Draw time in ${Math.floor(totalDrawTime)}ms`);

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

        let syncedResult = [logits[0].dataSync(),logits[1].dataSync()];
        const totalTime = performance.now() - startTime;
        PROC_inferenceTimeTotal += totalTime;
        PROC_inferenceCountTotal++;
        const avgTime = PROC_inferenceTimeTotal / PROC_inferenceCountTotal;
        WJR_DEBUG && console.debug(`PERF: Model inference in ${Math.floor(totalTime)}ms and avg of ${Math.floor(avgTime)}ms for ${PROC_inferenceCountTotal} scanned images`);

        WJR_DEBUG && console.debug('ML: Prediction: '+syncedResult[0]);
        return syncedResult;
    } finally {
        procReturnCtx(c);
    }
}

async function procReadFileAsDataURL (inputFile) {
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


let PROC_LOG_IMG_SIZE = 150;
let PROC_logCanvas = document.createElement('canvas');
PROC_logCanvas.width = PROC_LOG_IMG_SIZE;
PROC_logCanvas.height = PROC_LOG_IMG_SIZE;
let PROC_logCtx = PROC_logCanvas.getContext('2d', { alpha: false});
PROC_logCanvas.imageSmoothingEnabled = true;

async function procCommonLogImg(img, message)
{
    if(!WJR_DEBUG) {
        return;
    }
    return await procCommonLogImgGeneric(img, message, console.log);
}

async function procCommonWarnImg(img, message)
{
    return await procCommonLogImgGeneric(img, message, console.warn);
}

async function procCommonLogImgGeneric(img, message, logger)
{
    let maxSide = Math.max(img.width, img.height);
    let ratio = PROC_LOG_IMG_SIZE/maxSide;
    let newWidth = img.width*ratio;
    let newHeight = img.height*ratio;
    PROC_logCtx.clearRect(0,0,PROC_logCanvas.width,PROC_logCanvas.height);
    PROC_logCtx.drawImage(img, 0, 0, newWidth, newHeight);
    let logDataUrl = PROC_logCanvas.toDataURL('image/jpeg', 0.7);
    let blockedCSS = 'color: #00FF00; padding: 75px; line-height: 150px; background-image: url('+logDataUrl+'); background-size: contain; background-repeat: no-repeat;';
    logger('%c '+message, blockedCSS);
}

async function procCommonCreateSvgFromBlob(img, sqrxrScore, blob)
{
    let dataURL = PROC_isInReviewMode ? await procReadFileAsDataURL(blob) : null;
    return procCommonCreateSvg(img, sqrxrScore, dataURL);
}

let PROC_iconDataURI = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAD6AAAA+gBtXtSawAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAGxSURBVFiF7dW9j0xRHMbxjz1m2ESWkChkiW0kGgSFnkbsJqvQTEMoRSFRydDsP6CiEoJibfQEW2hssSMKiUI2UcluY0Ui6y2M4pyJYzK7cxczFPeb3OSe+zzn+f3uyzmXkpKSf0zAIXzApz7X3oR9sB6PsLOPxXfgIQZbFw7iOQ70ofgePBOf/C9cwGsc7WHxw5hLtToyhXnUCoRVQ6VyJlQqp1Et4K+l7KmVTJvFV/Ee57sE1kMIoyGEY7jcxXsOi3iBLd06PYJ3+Iwry3jWYFa88yoaGFjGO4GP4k0Vfr0T+J6O21jbpp/C02w8g5NtnoDr+IZmyizMAO6nic10viHTH+NGNr6J6Ww8iHvZ/AepoVWxHa+ykGlswxi+oJ556+naGLamBlvz5jCy2uItaljKwhqpkSbGM9941mQj8y8ptqJW5FoW2DoWMZR5hvC2g+/qnxaHdXjSFjybtBM4ns4bbZ4ZcZv/K+zFmyx8EqPinj4iLq+7mb6gB9v6WfFDa+IWdmXabtxJ2tfk7QmTqcjFDtolP59Oz9gobqfDHbRhvBT/8z1l/29qJSUl/yc/AP3+b58RpkSuAAAAAElFTkSuQmCC";

let PROC_isSilentModeEnabled = true;
async function procCommonCreateSvg(img, sqrxrScore, dataURL)
{
    let threshold = sqrxrScore[0][0];
    let confidence = rocFindConfidence(threshold);
    let visibleScore = Math.floor(confidence*100);
    if(PROC_isSilentModeEnabled) {
        return await SM_getReplacementSVG(img, visibleScore);
    } else {
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
}

function procScoreToStr(sqrxrScore) {
    return sqrxrScore[0][0].toFixed(5) + ' ('+
        sqrxrScore[1][0].toFixed(2)+', '+
        sqrxrScore[1][1].toFixed(2)+', '+
        sqrxrScore[1][2].toFixed(2)+', '+
        sqrxrScore[1][3].toFixed(2)+')';
}

function procGetRocScore(sqrxrScore) {
    return sqrxrScore[0][0];
}

function procIsSafe(sqrxrScore, threshold) {
    return sqrxrScore[0][0] < threshold;
}

const procLoadImagePromise = url => new Promise( (resolve, reject) => {
    const img = new Image()
    img.onerror = e => reject(e)
    img.onload = () => resolve(img)
    img.decoding = 'sync'
    img.src = url
});

async function procPerformFiltering(entry) {
    let dataEndTime = performance.now();
    WJR_DEBUG && console.info('WEBREQP: starting work for '+entry.requestId +' from '+entry.url);
    let result = {
        type: 'scan',
        requestId: entry.requestId,
        imageBytes: null,
        result: null,
        rocScore: 0,
        opaque: entry.opaque
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
            let img = await procLoadImagePromise(url);
            WJR_DEBUG && console.debug('img loaded '+entry.requestId)
            if(img.width>=PROC_MIN_IMAGE_SIZE && img.height>=PROC_MIN_IMAGE_SIZE){ //there's a lot of 1x1 pictures in the world that don't need filtering!
                WJR_DEBUG && console.debug('ML: predict '+entry.requestId+' size '+img.width+'x'+img.height+', materialization occured with '+byteCount+' bytes');
                let imgLoadTime = performance.now();
                let sqrxrScore = await procPredict(img);
                result.sqrxrScore = sqrxrScore;
                result.rocScore = procGetRocScore(sqrxrScore);
                if(procIsSafe(sqrxrScore, entry.threshold)) {
                    WJR_DEBUG && console.log('ML: Passed: '+procScoreToStr(sqrxrScore)+' '+entry.requestId);
                    result.result = 'pass';
                    result.imageBytes = await blob.arrayBuffer();
                } else {
                    WJR_DEBUG && console.log('ML: Blocked: '+procScoreToStr(sqrxrScore)+' '+entry.requestId);
                    let svgText = await procCommonCreateSvgFromBlob(img, sqrxrScore, blob);
                    procCommonWarnImg(img, 'BLOCKED IMG '+procScoreToStr(sqrxrScore));
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
                WJR_DEBUG && console.debug('PERF: Processed in '+totalTime
                    +' (' +totalSinceDataEndTime+' data end, '
                    +totalSinceImageLoadTime+' img load) with an avg of '
                    +Math.round(PROC_processingTimeTotal/PROC_processingCountTotal)
                    +' ('+Math.round(PROC_processingSinceDataEndTimeTotal/PROC_processingCountTotal)
                    +' data end, ' + Math.round(PROC_processingSinceImageLoadTimeTotal/PROC_processingCountTotal)
                    +' img load) at a count of '+PROC_processingCountTotal);
                WJR_DEBUG && console.debug('WEBREQ: Finishing '+entry.requestId);
            } else {
                result.result = 'tiny';
                result.imageBytes = await blob.arrayBuffer();
            }
        } else {
            result.result = 'tiny';
            result.imageBytes = await blob.arrayBuffer();
        }
    } catch(e) {
        console.error('WEBREQP: Error for '+entry.url+': '+e+' '+JSON.stringify(e)+' '+e.stack);
        result.result = 'error';
        result.imageBytes = result.imageBytes || await blob.arrayBuffer();
    } finally {
        WJR_DEBUG && console.debug('WEBREQP: Finishing '+entry.requestId);
        if(url != null) {
            URL.revokeObjectURL(url);
        }
    }
    return result;
}

async function procAdvanceB64Filtering(dataStr, b64Filter, outputPort) {
    b64Filter.fullStr += dataStr;
}

async function procCompleteB64Filtering(b64Filter, outputPort) {
    let startTime = performance.now();
    let fullStr = b64Filter.fullStr;
    WJR_DEBUG && console.info('WEBREQ: base64 stop '+fullStr.length);

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
            WJR_DEBUG && console.debug('WEBREQ: base64 image JS encoding detected: '+prefixId+'->'+newPrefixId);
        } else {
            WJR_DEBUG && console.debug('WEBREQ: base64 image no extra encoding detected: '+prefixId);
        }
        imageDataURI = imageDataURI.replace(/\\x3[dD]/g,'=');
        let imageToOutput = imageDataURI;
        let imageId = imageDataURI.slice(-20);
        WJR_DEBUG && console.debug('WEBREQ: base64 image loading: '+imageId);
        let byteCount = imageDataURI.length*3/4;

        if(byteCount >= PROC_MIN_IMAGE_BYTES) {
            WJR_DEBUG && console.info('WEBREQ: base64 image loaded: '+imageId);
            try
            {
                let img = await procLoadImagePromise(imageDataURI);
                if(img.width>=PROC_MIN_IMAGE_SIZE && img.height>=PROC_MIN_IMAGE_SIZE){ //there's a lot of 1x1 pictures in the world that don't need filtering!
                    WJR_DEBUG && console.debug('ML: base64 predict '+imageId+' size '+img.width+'x'+img.height+', materialization occured with '+byteCount+' bytes');
                    let sqrxrScore = await procPredict(img);
                    WJR_DEBUG && console.debug('ML: base64 score: '+procScoreToStr(sqrxrScore));
                    let replacement = null; //safe
                    let rocScore = procGetRocScore(sqrxrScore);
                    if(procIsSafe(sqrxrScore, b64Filter.threshold)) {
                        outputPort.postMessage({
                            type:'stat',
                            result:'pass',
                            rocScore: rocScore,
                            requestId: b64Filter.requestId+'_'+imageId,
                            opaque: b64Filter.opaque
                        });
                        WJR_DEBUG && console.log('ML: base64 filter Passed: '+procScoreToStr(sqrxrScore)+' '+b64Filter.requestId);
                    } else {
                        outputPort.postMessage({
                            type:'stat',
                            result:'block',
                            rocScore: rocScore,
                            requestId: b64Filter.requestId+'_'+imageId,
                            opaque: b64Filter.opaque
                        });
                        let svgText = await procCommonCreateSvg(img,sqrxrScore,img.src);
                        let svgURI='data:image/svg+xml;base64,'+window.btoa(svgText);
                        WJR_DEBUG && console.log('ML: base64 filter Blocked: '+procScoreToStr(sqrxrScore)+' '+b64Filter.requestId);
                        procCommonWarnImg(img, 'BLOCKED IMG BASE64 '+procScoreToStr(sqrxrScore));
                        replacement = svgURI;
                    }

                    const totalTime = performance.now() - startTime;
                    WJR_DEBUG && console.log(`PERF: Total processing in ${Math.floor(totalTime)}ms`);
                    if(replacement !== null) {
                        if(wasJSEncoded) {
                            WJR_DEBUG && console.log('WEBREQ: base64 JS encoding replacement fixup for '+imageId);
                            replacement = replacement.replace(/\//g,'\\/'); //Unencoded / -> \/
                        }
                        imageToOutput = replacement;
                    }
                } else {
                    outputPort.postMessage({
                        type:'stat',
                        result:'tiny',
                        rocScore: 0,
                        requestId: b64Filter.requestId+'_'+imageId,
                        opaque: b64Filter.opaque
                    });
                    WJR_DEBUG && console.debug('WEBREQ: base64 skipping image with small dimensions: '+imageId);
                }
            }
            catch(e)
            {
                outputPort.postMessage({
                    type:'stat',
                    result:'error',
                    rocScore: 0,
                    requestId: b64Filter.requestId+'_'+imageId,
                    opaque: b64Filter.opaque
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
let PROC_scanStartCount = 0;
let PROC_throttleRejectionCount = 0;
async function procCheckProcess() {
    WJR_DEBUG && console.info('QUEUE: In Flight: '+PROC_inFlight+' In Queue: '+PROC_processingQueue.length);
    if(PROC_processingQueue.length == 0) {
        return;
    }
    if(PROC_inFlight > PROC_CTX_POOL_DEFAULT_SIZE) {
        PROC_throttleRejectionCount++;
        WJR_DEBUG && console.log('QUEUE: Throttling ('+PROC_inFlight+')');
        return;
    }
    //It is critical that PROC_inFlight always goes up AND DOWN, hence all the try/catch action.
    let toProcess = PROC_processingQueue.shift();
    if(toProcess !== undefined) {
        PROC_inFlight++;
        PROC_scanStartCount++;
        PROC_throttleRejectionCount = 0;
        let result;
        try {
            WJR_DEBUG && console.debug('QUEUE: Processing (PROC_inFlight='+PROC_inFlight+') request '+toProcess.requestId);
            result = await procPerformFiltering(toProcess);
        } catch(ex) {
            console.error('ML: Error scanning image '+ex);
        }
        PROC_inFlight--;
        if(PROC_inFlight < 0) {
            console.error(`QUEUE: Invalid negative PROC_inFlight ${PROC_inFlight}! Setting to 0.`);
            PROC_inFlight = 0;
        }
        try {
            PROC_port.postMessage(result);
            PROC_port.postMessage({
                type:'stat',
                result: result.result,
                rocScore: result.rocScore,
                requestId: toProcess.requestId,
                opaque: result.opaque
            });
        } catch(e) {
            console.error('ERROR: Processor failed to communicate to background: '+e);
        }
    } else {
        WJR_DEBUG && console.log('QUEUE: Rare time where processing queue drained? Length: '+PROC_processingQueue.length);
    }
    await procCheckProcess();
}

let PROC_watchdogScanStartCount = 0;
let PROC_watchdogThrottleRejectionCount = 0;
let PROC_watchdogKickCount = 0;
async function procWatchdog() {
    //Has the throttle count increased and scan start count stayed stuck?
    WJR_DEBUG && console.info(`WATCHDOG: Processor queue check - Current in flight ${PROC_inFlight}, queue length ${PROC_processingQueue.length}, throttle rejection count ${PROC_throttleRejectionCount}, scan start count ${PROC_scanStartCount}, kick count ${PROC_watchdogKickCount}`);
    if(PROC_watchdogThrottleRejectionCount > PROC_throttleRejectionCount
        && PROC_watchdogScanStartCount == PROC_scanStartCount) {
        try {
            PROC_watchdogKickCount++;
            console.error(`WATCHDOG: Processor queue kicked! Resetting in flight count. Current in flight ${PROC_inFlight}, queue length ${PROC_processingQueue.length}, throttle rejection count ${PROC_throttleRejectionCount}, scan start count ${PROC_scanStartCount}, kick count ${PROC_watchdogKickCount}`);
            PROC_inFlight = 0;
            await procCheckProcess();
        } catch(e) {
            console.error(`WATCHDOG: Error kicking processor queue check scan ${e}`);
        }
    }

    PROC_watchdogScanStartCount = PROC_scanStartCount;
    PROC_watchdogThrottleRejectionCount = PROC_throttleRejectionCount;
}
setInterval(procWatchdog, 3000);



function procGetMaxVideoTime(video) {
    /* 
    if(!isNaN(video.duration)) {
        return video.duration;
    }
    */
    let maxTime = -1;
    for(let i=0; i<video.buffered.length; i++) {
        if(video.buffered.end(i) > maxTime) {
            maxTime = video.buffered.end(i);
        }
    }
    return maxTime;
}

function procGetBufferedRangesString(video) {
    let result = '';
    for(let i=0; i<video.buffered.length && (result += ','); i++) {
        result += '['+video.buffered.start(i)+','+video.buffered.end(i)+']';
    }
    return result;
}

const VIDEO_LOAD_TIMEOUT_MS = 5000;
const procVideoLoadedData = (video,url,seekTime) => new Promise( (resolve, reject) => {
    let isResolved = false;
    video.addEventListener('error', ()=>reject(video.error), {once: true});
    video.addEventListener('seeked',  () => {
        video.width = video.videoWidth;
        video.height = video.videoHeight;
        isResolved = true;
        resolve();
    } , {once:true});
    //Note that the URL is in memory, not remote
    //making a small timeout a reasonable choice
    //Without the below, there was at least one URL
    //that simply didn't fire the expected events,
    //so this acts as a safeguard
    let timeoutId = setTimeout(() => {
        clearTimeout(timeoutId);
        if(isResolved) {
            return;
        }
        WJR_DEBUG && console.warn(`MLV: Timed out`);
        reject(`MLV: Timed out in ${VIDEO_LOAD_TIMEOUT_MS} ms`);
      }, VIDEO_LOAD_TIMEOUT_MS);
    video.src = url;
    video.currentTime = seekTime;
});

function procGetMp4Parsed(buffers) {
    let size = buffers.reduce((a,b) => a + b.byteLength, 0);
    let bytes = new Uint8Array(size);
    let offset = 0;
    for (let b of buffers) {
        bytes.set(b, offset);
        offset += b.byteLength;
    }
    let parsed = muxjs.mp4.tools.inspect(bytes);
    return parsed;
}

function procGetVideoUrl(requestId, mimeType, buffers) {
    if(mimeType.toLowerCase().startsWith('video/mp2t')) {
        WJR_DEBUG && console.info('MLV: URL MP2T detected for '+requestId+', mime '+mimeType);
        //remux that sucker to MP4 quick
        let transmuxer = new muxjs.mp4.Transmuxer();
        let tBuffers = [];
        transmuxer.on('data', (segment) => {
            if(tBuffers.length == 0) {
                tBuffers.push(segment.initSegment);
            }
            tBuffers.push(segment.data);
        });
        buffers.forEach(b=>transmuxer.push(new Uint8Array(b)));
        transmuxer.flush();
        let blob = new Blob(tBuffers, {type: 'video/mp4'});
        return URL.createObjectURL(blob);
    } else {
        WJR_DEBUG && console.debug('MLV: URL default detected for '+requestId+', mime '+mimeType);
        let blob = new Blob(buffers, {type: mimeType});
        return URL.createObjectURL(blob);
    }
}


async function procGetVideoScanStatus(
    videoChainId,
    requestId,
    requestType,
    url,
    mimeType,
    buffers,
    threshold,
    scanStart,
    scanStep,
    scanMaxSteps,
    scanBlockBailCount
) {
    let inferenceVideo, videoUrl, sqrxrScore;

    let scanResults = {
        type: 'vid_scan',
        videoChainId: videoChainId,
        requestId: requestId,
        scanCount: 0,
        blockCount: 0,
        error: undefined,
        frames: []
    };
    try {
        WJR_DEBUG && console.info('MLV: SCAN video '+requestId+', type '+requestType+', MIME '+mimeType+' for video group '+videoChainId);
        inferenceVideo = document.createElement('video');
        inferenceVideo.onencrypted = function() {
            WJR_DEBUG && console.log('MLV: encrypted: '+requestId); //This will fail :(
        };
        //inferenceVideo.type = vidFilter.mimeType; //?
        inferenceVideo.autoplay = false;
        videoUrl = procGetVideoUrl(requestId, mimeType, buffers);

        for(var i=0; i<scanMaxSteps; i++) {
            let seekTime = scanStart+scanStep*i;
            await procVideoLoadedData(inferenceVideo, videoUrl, seekTime);
            let maxTime = procGetMaxVideoTime(inferenceVideo); //important to do this AFTER loading
            WJR_DEBUG && console.log('MLV: SCAN max time '+maxTime+' vs seek time '+seekTime+' vs current time '+inferenceVideo.currentTime+' vs ranges '+procGetBufferedRangesString(inferenceVideo)+' vs readyState '+inferenceVideo.readyState+' vs seeking='+inferenceVideo.seeking+' for '+videoChainId+' at request '+requestId);
            if(maxTime < seekTime) {
                break; //invalid even though it tried to seek!
            }

            WJR_DEBUG && console.debug('MLV: predicting video '+requestId+' WxH '+inferenceVideo.width+','+inferenceVideo.height+' at '+seekTime+' for video group '+videoChainId);
            
            sqrxrScore = await procPredict(inferenceVideo);
            scanResults.scanCount++;
            let frameStatus;
            if(procIsSafe(sqrxrScore, threshold))
            {
                WJR_DEBUG && console.log('MLV: SCAN PASS video score @'+seekTime+': '+procScoreToStr(sqrxrScore)+' type '+requestType+', MIME '+mimeType+' for video group '+videoChainId);
                await procCommonLogImg(inferenceVideo, 'MLV: SCAN PASS VID @'+seekTime+' '+procScoreToStr(sqrxrScore));
                frameStatus = 'pass';
            }
            else
            {
                WJR_DEBUG && console.log('MLV: SCAN BLOCKED video score @'+seekTime+': '+procScoreToStr(sqrxrScore)+' type '+requestType+', MIME '+mimeType+' for video group '+videoChainId);
                await procCommonWarnImg(inferenceVideo, 'MLV: SCAN BLOCKED VID @'+seekTime+' '+procScoreToStr(sqrxrScore));
                frameStatus = 'block';
                scanResults.blockCount++;
            }
            scanResults.frames.push({ 'time': seekTime, 'status': frameStatus});
            if(scanResults.blockCount >= scanBlockBailCount) {
                WJR_DEBUG && console.log('MLV: Bailing on '+requestId+' for video chain '+videoChainId+' because of block count '+scanResults.blockCount);
                break;
            }
        }
    } catch(e) {
        WJR_DEBUG && console.error('MLV: SCAN Error scanning video group '+videoChainId+':'+e+' '+e.name+' '+e.code+' '+e.message);
        scanResults.error = e;
    } finally {
        URL.revokeObjectURL(videoUrl);
    }
    return scanResults;
}

async function procOnPortMessage(m) {
    WJR_DEBUG && console.debug(`PROCV: Received message of type ${m.type}`);
    switch(m.type) {
        case 'set_all_logging': {
            WJR_DEBUG = m.value;
        }
        break;
        case 'settings' : {
            WJR_DEBUG && console.log(`CONFIG: Settings update for ${PROC_processorId}: ${JSON.stringify(m)}`);
            PROC_isSilentModeEnabled = m.isSilentModeEnabled;
        }
        break;
        case 'start': {
            PROC_openRequests[m.requestId] = {
                requestId: m.requestId,
                url: m.url,
                mimeType: m.mimeType,
                threshold: m.threshold,
                opaque: m.opaque,
                startTime: performance.now(),
                buffers: []
            };
            WJR_DEBUG && console.debug('PERF: '+PROC_processorId+' has open requests queue size '+Object.keys(PROC_openRequests).length);
        }
        break;
        case 'ondata': {
            WJR_DEBUG && console.debug('DATA: '+m.requestId);
            PROC_openRequests[m.requestId].buffers.push(m.data);
        }
        break;
        case 'onerror': {
            delete PROC_openRequests[m.requestId];
            PROC_port.postMessage({
                type:'stat',
                result: 'error',
                rocScore: 0,
                requestId: m.requestId
            });
        }
        break;
        case 'onstop': {
            PROC_processingQueue.push(PROC_openRequests[m.requestId]);
            delete PROC_openRequests[m.requestId];
            await procCheckProcess();
        }
        break;
        case 'gif_frame': {
            WJR_DEBUG && console.debug('GIF: '+m.requestId);
            let gifRequest = {
                requestId: m.requestId,
                url: m.url,
                mimeType: m.mimeType,
                startTime: performance.now(),
                buffers: m.buffers,
                threshold: m.threshold
            };
            let gifScanResult = await procPerformFiltering(gifRequest);
            let gifResponse = {
                type: 'gif_scan',
                requestId: gifScanResult.requestId,
                result: gifScanResult.result
            };
            PROC_port.postMessage(gifResponse);
        }
        break;
        case 'b64_start': {
            PROC_openB64Requests[m.requestId] = {
                requestId: m.requestId,
                threshold: m.threshold,
                opaque: m.opaque,
                startTime: performance.now(),
                fullStr: ''
            };
        }
        break;
        case 'b64_ondata': {
            await procAdvanceB64Filtering(m.dataStr, PROC_openB64Requests[m.requestId], PROC_port);
        }
        break;
        case 'b64_onerror': {
            delete openB64Filters[m.requestId];
        }
        case 'b64_onstop': {
            await procCompleteB64Filtering(PROC_openB64Requests[m.requestId], PROC_port);
        }
        break;
        case 'vid_chunk': {
            WJR_DEBUG && console.log('DATAV: vid_start '+m.requestId+' with buffers length '+m.buffers.length+' for video chain '+m.videoChainId);
            let scanResults = await procGetVideoScanStatus(
                m.videoChainId,
                m.requestId,
                m.requestType,
                m.url,
                m.mimeType,
                m.buffers,
                m.threshold,
                m.scanStart,
                m.scanStep,
                m.scanMaxSteps,
                m.scanBlockBailCount
            );
            try {
                PROC_port.postMessage(scanResults);
            } catch(e) {
                //Sometimes we can get a DataCloneError, presumably if the native exception can't be cloned
                if(scanResults.error) {
                    WJR_DEBUG && console.warn(`DATAV: Failed to post video result for ${m.requestId} because ${e}, try to avoid DataCloneError`);
                    scanResults.error = scanResults.error.message;
                    PROC_port.postMessage(scanResults);
                } else {
                    console.error(`DATAV: Failed to post video result for ${m.requestId} because ${e}, unsure how to proceed.`);
                }
            }
        }
        break;
        default: {
            console.error('ERROR: received unknown message: '+m);
        }
        break;
    }
}

let PROC_port = null;
