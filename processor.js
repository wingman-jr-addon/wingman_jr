const PROC_DEFAULT_MODEL_SELECTION = 'n017';
const PROC_MODEL_CONFIGS = Object.freeze({
    n017: Object.freeze({
        path: 'n017_graph_model/model.json',
        preprocessing: 'n017'
    }),
    sqrxr_112: Object.freeze({
        path: 'sqrxr_112_graphopt/model.json',
        preprocessing: 'sqrxr_112'
    })
});
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
let PROC_activeModelSelection = PROC_DEFAULT_MODEL_SELECTION;
let PROC_PIXEL_SCALE_TENSOR;
let PROC_MEAN_TENSOR;
let PROC_STD_TENSOR;
let PROC_CLASSIC_SCALE_TENSOR;
let PROC_CLASSIC_SHIFT_TENSOR;

function procNormalizeModelSelection(modelRequested) {
    return Object.prototype.hasOwnProperty.call(PROC_MODEL_CONFIGS, modelRequested)
        ? modelRequested
        : PROC_DEFAULT_MODEL_SELECTION;
}

function procDisposeModelState() {
    if (PROC_wingman && typeof PROC_wingman.dispose === 'function') {
        PROC_wingman.dispose();
    }
    PROC_wingman = null;
    for (const tensor of [
        PROC_PIXEL_SCALE_TENSOR,
        PROC_MEAN_TENSOR,
        PROC_STD_TENSOR,
        PROC_CLASSIC_SCALE_TENSOR,
        PROC_CLASSIC_SHIFT_TENSOR
    ]) {
        if (tensor && typeof tensor.dispose === 'function') {
            tensor.dispose();
        }
    }
    PROC_PIXEL_SCALE_TENSOR = null;
    PROC_MEAN_TENSOR = null;
    PROC_STD_TENSOR = null;
    PROC_CLASSIC_SCALE_TENSOR = null;
    PROC_CLASSIC_SHIFT_TENSOR = null;
}

const procWingmanStartup = async (backendRequested, modelRequested = PROC_DEFAULT_MODEL_SELECTION) => {
    procDisposeModelState();
    PROC_activeModelSelection = procNormalizeModelSelection(modelRequested);
    const modelConfig = PROC_MODEL_CONFIGS[PROC_activeModelSelection];
    await rocSelectModel(PROC_activeModelSelection);
    WJR_DEBUG && console.log('LIFECYCLE: Launching TF.js!');
    WJR_DEBUG && console.log('LIFECYCLE: Backend requested '+backendRequested);
    WJR_DEBUG && console.log('LIFECYCLE: Model requested '+PROC_activeModelSelection);
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
    if (modelConfig.preprocessing === 'n017') {
        PROC_PIXEL_SCALE_TENSOR = tf.scalar(255);
        PROC_MEAN_TENSOR = tf.tensor1d([0.485, 0.456, 0.406]);
        PROC_STD_TENSOR = tf.tensor1d([0.229, 0.224, 0.225]);
    } else {
        PROC_CLASSIC_SCALE_TENSOR = tf.scalar(127.5);
        PROC_CLASSIC_SHIFT_TENSOR = tf.scalar(1);
    }
    WJR_DEBUG && console.log('LIFECYCLE: Loading model...');
    PROC_wingman = await tf.loadGraphModel(modelConfig.path, { onProgress: procOnModelLoadProgress });
    WJR_DEBUG && console.log('LIFECYCLE: Model loaded: ' + PROC_activeModelSelection+' '+PROC_wingman+' at '+performance.now());

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

function prepareN017Image(c, imgElement) {
    const sourceWidth = imgElement.naturalWidth || imgElement.videoWidth || imgElement.width;
    const sourceHeight = imgElement.naturalHeight || imgElement.videoHeight || imgElement.height;
    const scale = Math.min(PROC_IMAGE_SIZE / sourceWidth, PROC_IMAGE_SIZE / sourceHeight);
    const targetWidth = sourceWidth * scale;
    const targetHeight = sourceHeight * scale;
    const targetX = (PROC_IMAGE_SIZE - targetWidth) / 2;
    const targetY = (PROC_IMAGE_SIZE - targetHeight) / 2;

    c.ctx.fillStyle = 'rgb(128, 128, 128)';
    c.ctx.fillRect(0, 0, PROC_IMAGE_SIZE, PROC_IMAGE_SIZE);
    c.ctx.drawImage(imgElement, 0, 0, sourceWidth, sourceHeight,
        targetX, targetY, targetWidth, targetHeight);
    WJR_DEBUG && console.log(`N017: Padded ${sourceWidth}x${sourceHeight} to ${PROC_IMAGE_SIZE}x${PROC_IMAGE_SIZE}`);
}

function prepareSqrxr112Image(c, imgElement) {
    const sourceWidth = imgElement.naturalWidth || imgElement.videoWidth || imgElement.width;
    const sourceHeight = imgElement.naturalHeight || imgElement.videoHeight || imgElement.height;
    c.ctx.clearRect(0, 0, PROC_IMAGE_SIZE, PROC_IMAGE_SIZE);
    if (sourceWidth >= sourceHeight) {
        let tileCount = Math.floor(sourceWidth / sourceHeight);
        tileCount = Math.ceil(Math.sqrt(tileCount));
        const destinationTileHeight = PROC_IMAGE_SIZE / tileCount;
        const sourceTileWidth = sourceWidth / tileCount;
        for (let index = 0; index < tileCount; index++) {
            c.ctx.drawImage(imgElement,
                index * sourceTileWidth, 0, sourceTileWidth, sourceHeight,
                0, index * destinationTileHeight, PROC_IMAGE_SIZE, destinationTileHeight);
        }
    } else {
        let tileCount = Math.floor(sourceHeight / sourceWidth);
        tileCount = Math.ceil(Math.sqrt(tileCount));
        const destinationTileWidth = PROC_IMAGE_SIZE / tileCount;
        const sourceTileHeight = sourceHeight / tileCount;
        for (let index = 0; index < tileCount; index++) {
            c.ctx.drawImage(imgElement,
                0, index * sourceTileHeight, sourceWidth, sourceTileHeight,
                index * destinationTileWidth, 0, destinationTileWidth, PROC_IMAGE_SIZE);
        }
    }
    WJR_DEBUG && console.log(`SQRXR 112: Tiled ${sourceWidth}x${sourceHeight} to ${PROC_IMAGE_SIZE}x${PROC_IMAGE_SIZE}`);
}

function drawImage(c, imgElement) {
    c.ctx.drawImage(imgElement, 0, 0, imgElement.width, imgElement.height, 0, 0, PROC_IMAGE_SIZE,PROC_IMAGE_SIZE);
}

async function procPredict(imgElement) {
    let c = procGetCtx();
    try {
        const drawStartTime = performance.now();
        if (PROC_activeModelSelection === 'sqrxr_112') {
            prepareSqrxr112Image(c, imgElement);
        } else {
            prepareN017Image(c, imgElement);
        }
        WJR_DEBUG && (await procCommonLogImg(c.canvas, `${PROC_activeModelSelection}: Input`));
        const totalDrawTime = performance.now() - drawStartTime;
        WJR_DEBUG && console.debug(`PERF: Draw time in ${Math.floor(totalDrawTime)}ms`);

        const startTime = performance.now();
        const syncedResult = tf.tidy(() => {
            const rightSizeImageDataTF = tf.browser.fromPixels(c.canvas);
            const floatImg = rightSizeImageDataTF.toFloat();
            let normalized;
            if (PROC_activeModelSelection === 'sqrxr_112') {
                const scaled = floatImg.div(PROC_CLASSIC_SCALE_TENSOR);
                normalized = scaled.sub(PROC_CLASSIC_SHIFT_TENSOR);
            } else {
                const scaled = floatImg.div(PROC_PIXEL_SCALE_TENSOR);
                const centered = scaled.sub(PROC_MEAN_TENSOR);
                normalized = centered.div(PROC_STD_TENSOR);
            }
            // Reshape to a single-element batch so we can pass it to predict.
            const batched = normalized.expandDims(0);
            const result = PROC_wingman.predict(batched, {batchSize: 1});
            return [result[0].dataSync(), result[1].dataSync()];
        });

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

const PROC_AUDIT_THUMBNAIL_SIZE = 128;
let PROC_auditCanvas = document.createElement('canvas');
PROC_auditCanvas.width = PROC_AUDIT_THUMBNAIL_SIZE;
PROC_auditCanvas.height = PROC_AUDIT_THUMBNAIL_SIZE;
let PROC_auditCtx = PROC_auditCanvas.getContext('2d', { alpha: false });
PROC_auditCtx.imageSmoothingEnabled = true;
let PROC_isAuditEnabled = false;

function procCreateAuditThumbnail(img) {
    const sourceWidth = img.naturalWidth || img.videoWidth || img.width;
    const sourceHeight = img.naturalHeight || img.videoHeight || img.height;
    const scale = Math.min(
        PROC_AUDIT_THUMBNAIL_SIZE / sourceWidth,
        PROC_AUDIT_THUMBNAIL_SIZE / sourceHeight
    );
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const x = Math.floor((PROC_AUDIT_THUMBNAIL_SIZE - width) / 2);
    const y = Math.floor((PROC_AUDIT_THUMBNAIL_SIZE - height) / 2);
    PROC_auditCtx.fillStyle = 'rgb(32, 36, 44)';
    PROC_auditCtx.fillRect(0, 0, PROC_AUDIT_THUMBNAIL_SIZE, PROC_AUDIT_THUMBNAIL_SIZE);
    PROC_auditCtx.drawImage(img, 0, 0, sourceWidth, sourceHeight, x, y, width, height);
    const rgba = PROC_auditCtx.getImageData(
        0,
        0,
        PROC_AUDIT_THUMBNAIL_SIZE,
        PROC_AUDIT_THUMBNAIL_SIZE
    ).data;
    const packed = new Uint8Array(PROC_AUDIT_THUMBNAIL_SIZE * PROC_AUDIT_THUMBNAIL_SIZE);
    for (let source = 0, target = 0; target < packed.length; source += 4, target++) {
        packed[target] = (rgba[source] & 0xE0)
            | ((rgba[source + 1] >> 3) & 0x1C)
            | ((rgba[source + 2] >> 6) & 0x03);
    }
    return packed.buffer;
}

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

async function procCommonCreateSvgFromBlob(img, sqrxrScore, blob, replacementContext = null)
{
    let dataURL = PROC_isInReviewMode ? await procReadFileAsDataURL(blob) : null;
    return procCommonCreateSvg(img, sqrxrScore, dataURL, replacementContext);
}

let PROC_iconDataURI = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAD6AAAA+gBtXtSawAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAGxSURBVFiF7dW9j0xRHMbxjz1m2ESWkChkiW0kGgSFnkbsJqvQTEMoRSFRydDsP6CiEoJibfQEW2hssSMKiUI2UcluY0Ui6y2M4pyJYzK7cxczFPeb3OSe+zzn+f3uyzmXkpKSf0zAIXzApz7X3oR9sB6PsLOPxXfgIQZbFw7iOQ70ofgePBOf/C9cwGsc7WHxw5hLtToyhXnUCoRVQ6VyJlQqp1Et4K+l7KmVTJvFV/Ee57sE1kMIoyGEY7jcxXsOi3iBLd06PYJ3+Iwry3jWYFa88yoaGFjGO4GP4k0Vfr0T+J6O21jbpp/C02w8g5NtnoDr+IZmyizMAO6nic10viHTH+NGNr6J6Ww8iHvZ/AepoVWxHa+ykGlswxi+oJ556+naGLamBlvz5jCy2uItaljKwhqpkSbGM9941mQj8y8ptqJW5FoW2DoWMZR5hvC2g+/qnxaHdXjSFjybtBM4ns4bbZ4ZcZv/K+zFmyx8EqPinj4iLq+7mb6gB9v6WfFDa+IWdmXabtxJ2tfk7QmTqcjFDtolP59Oz9gobqfDHbRhvBT/8z1l/29qJSUl/yc/AP3+b58RpkSuAAAAAElFTkSuQmCC";

let PROC_isSilentModeEnabled = true;
function procGetPrimaryScore(sqrxrScore) {
    return sqrxrScore[0][0];
}

function procGetAuditRating(sqrxrScore) {
    const ratings = sqrxrScore && sqrxrScore[1];
    if (!ratings || ratings.length < 4) {
        return null;
    }
    let bestIndex = 0;
    for (let index = 1; index < 4; index++) {
        if (ratings[index] > ratings[bestIndex]) {
            bestIndex = index;
        }
    }
    return ['safe', 'q', 'r', 'x'][bestIndex];
}

async function procCommonCreateSvg(img, sqrxrScore, dataURL, replacementContext = null)
{
    let threshold = procGetPrimaryScore(sqrxrScore);
    let confidence = rocFindConfidence(threshold);
    let visibleScore = Math.floor(confidence*100);
    if(PROC_isSilentModeEnabled) {
        return await SM_getReplacementSVG(img, visibleScore, dataURL, replacementContext);
    } else {
        let escapedDataUrl = dataURL ? dataURL.replace(/"/g, '&quot;') : null;
        let originalAttr = escapedDataUrl ? ` data-wingman-original-href="${escapedDataUrl}"` : '';
        let svgText = '<?xml version="1.0" standalone="no"?> <!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN"   "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"> <svg width="'+img.width+'" height="'+img.height+'" version="1.1"      xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"'+originalAttr+'>'
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
    return procGetPrimaryScore(sqrxrScore).toFixed(5) + ' ('+
        sqrxrScore[1][0].toFixed(2)+', '+
        sqrxrScore[1][1].toFixed(2)+', '+
        sqrxrScore[1][2].toFixed(2)+', '+
        sqrxrScore[1][3].toFixed(2)+')';
}

function procIsSafe(sqrxrScore, threshold) {
    return procGetPrimaryScore(sqrxrScore) < threshold;
}

const procLoadImagePromise = url => new Promise( (resolve, reject) => {
    const img = new Image()
    img.onerror = e => reject(e)
    img.onload = () => resolve(img)
    img.decoding = 'sync'
    img.src = url
});

const PROC_ANIMATED_WEBP_SAMPLE_COUNT = 4;
const PROC_ANIMATED_WEBP_SAMPLE_INTERVAL_MS = 500;

function procReadAscii(bytes, offset, length) {
    let result = '';
    for(let i = 0; i < length; i++) {
        result += String.fromCharCode(bytes[offset + i]);
    }
    return result;
}

function procReadUint32LE(bytes, offset) {
    return (
        bytes[offset]
        | (bytes[offset + 1] << 8)
        | (bytes[offset + 2] << 16)
        | (bytes[offset + 3] << 24)
    ) >>> 0;
}

function procConcatBufferViews(buffers) {
    let views = buffers.map(buffer => {
        return ArrayBuffer.isView(buffer)
            ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
            : new Uint8Array(buffer);
    });
    let byteLength = views.reduce((total, view) => total + view.byteLength, 0);
    let bytes = new Uint8Array(byteLength);
    let offset = 0;
    views.forEach(view => {
        bytes.set(view, offset);
        offset += view.byteLength;
    });
    return bytes;
}

function procIsAnimatedWebp(buffers) {
    let bytes = procConcatBufferViews(buffers);
    if(bytes.byteLength < 12
        || procReadAscii(bytes, 0, 4) !== 'RIFF'
        || procReadAscii(bytes, 8, 4) !== 'WEBP') {
        return false;
    }

    let offset = 12;
    while(offset + 8 <= bytes.byteLength) {
        let chunkType = procReadAscii(bytes, offset, 4);
        let chunkSize = procReadUint32LE(bytes, offset + 4);
        let chunkDataOffset = offset + 8;
        if(chunkType === 'ANIM' || chunkType === 'ANMF') {
            return true;
        }
        if(chunkType === 'VP8X' && chunkSize > 0
            && chunkDataOffset < bytes.byteLength
            && (bytes[chunkDataOffset] & 0x02) !== 0) {
            return true;
        }

        let nextOffset = chunkDataOffset + chunkSize + (chunkSize & 1);
        if(nextOffset <= offset || nextOffset > bytes.byteLength) {
            break;
        }
        offset = nextOffset;
    }
    return false;
}

function procWait(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function procPredictImageSamples(img, threshold, isAnimatedWebp) {
    let sampleCount = isAnimatedWebp ? PROC_ANIMATED_WEBP_SAMPLE_COUNT : 1;
    let worstScore = null;
    for(let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
        if(sampleIndex > 0) {
            await procWait(PROC_ANIMATED_WEBP_SAMPLE_INTERVAL_MS);
        }
        let score = await procPredict(img);
        if(worstScore === null
            || procGetPrimaryScore(score) > procGetPrimaryScore(worstScore)) {
            worstScore = score;
        }
        if(!procIsSafe(score, threshold)) {
            break;
        }
    }
    return worstScore;
}

async function procPerformFiltering(entry) {
    let dataEndTime = performance.now();
    WJR_DEBUG && console.info('WEBREQP: starting work for '+entry.requestId +' from '+entry.url);
    let result = {
        type: 'scan',
        requestId: entry.requestId,
        imageBytes: null,
        result: null,
        auditThumbnail: null,
        auditRating: null
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
                let isAnimatedWebp = entry.mimeType.toLowerCase().startsWith('image/webp')
                    && procIsAnimatedWebp(entry.buffers);
                if(isAnimatedWebp) {
                    WJR_DEBUG && console.debug('ML: Sampling animated WebP '+entry.requestId);
                }
                let sqrxrScore = await procPredictImageSamples(img, entry.threshold, isAnimatedWebp);
                result.adaptiveScore = procGetPrimaryScore(sqrxrScore);
                result.auditRating = procGetAuditRating(sqrxrScore);
                if(procIsSafe(sqrxrScore, entry.threshold)) {
                    WJR_DEBUG && console.log('ML: Passed: '+procScoreToStr(sqrxrScore)+' '+entry.requestId);
                    if (typeof SMR_observeSafeImage === 'function') {
                        SMR_observeSafeImage(img, sqrxrScore, entry.threshold, entry.reuseContext);
                    }
                    result.result = 'pass';
                    result.imageBytes = await blob.arrayBuffer();
                    result.sqrxrScore = sqrxrScore;
                } else {
                    WJR_DEBUG && console.log('ML: Blocked: '+procScoreToStr(sqrxrScore)+' '+entry.requestId);
                    let svgText = await procCommonCreateSvgFromBlob(img, sqrxrScore, blob, entry.reuseContext);
                    procCommonWarnImg(img, 'BLOCKED IMG '+procScoreToStr(sqrxrScore));
                    let encoder = new TextEncoder();
                    let encodedTypedBuffer = encoder.encode(svgText);
                    result.result = 'block';
                    if (PROC_isAuditEnabled) {
                        result.auditThumbnail = procCreateAuditThumbnail(img);
                    }
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
                    let adaptiveScore = procGetPrimaryScore(sqrxrScore);
                    let auditRating = procGetAuditRating(sqrxrScore);
                    WJR_DEBUG && console.debug('ML: base64 score: '+procScoreToStr(sqrxrScore));
                    let replacement = null; //safe
                    if(procIsSafe(sqrxrScore, b64Filter.threshold)) {
                        if (typeof SMR_observeSafeImage === 'function') {
                            const reuseContext = typeof SMR_withSourceSuffix === 'function'
                                ? SMR_withSourceSuffix(b64Filter.reuseContext, imageId)
                                : b64Filter.reuseContext;
                            SMR_observeSafeImage(img, sqrxrScore, b64Filter.threshold, reuseContext);
                        }
                        outputPort.postMessage({
                            type:'stat',
                            result:'pass',
                            requestId: b64Filter.requestId+'_'+imageId,
                            adaptiveContext: b64Filter.adaptiveContext,
                            auditContext: b64Filter.auditContext,
                            adaptiveScore: adaptiveScore,
                            auditRating: auditRating
                        });
                        WJR_DEBUG && console.log('ML: base64 filter Passed: '+procScoreToStr(sqrxrScore)+' '+b64Filter.requestId);
                    } else {
                        outputPort.postMessage({
                            type:'stat',
                            result:'block',
                            requestId: b64Filter.requestId+'_'+imageId,
                            adaptiveContext: b64Filter.adaptiveContext,
                            auditContext: b64Filter.auditContext,
                            adaptiveScore: adaptiveScore,
                            auditRating: auditRating,
                            auditThumbnail: PROC_isAuditEnabled
                                ? procCreateAuditThumbnail(img)
                                : null
                        });
                        const reuseContext = typeof SMR_withSourceSuffix === 'function'
                            ? SMR_withSourceSuffix(b64Filter.reuseContext, imageId)
                            : b64Filter.reuseContext;
                        let svgText = await procCommonCreateSvg(img,sqrxrScore,img.src,reuseContext);
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
                        requestId: b64Filter.requestId+'_'+imageId
                    });
                    WJR_DEBUG && console.debug('WEBREQ: base64 skipping image with small dimensions: '+imageId);
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
            const auditThumbnail = result.auditThumbnail;
            delete result.auditThumbnail;
            PROC_port.postMessage(result);
            PROC_port.postMessage({
                type:'stat',
                result: result.result,
                requestId: toProcess.requestId,
                adaptiveContext: toProcess.adaptiveContext,
                auditContext: toProcess.auditContext,
                adaptiveScore: result.adaptiveScore,
                auditRating: result.auditRating,
                auditThumbnail: auditThumbnail
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

const PROC_VIDEO_COMPOSITE_MAX_FRAMES = 4;

function procCreateVideoCompositeCanvas() {
    let canvas = document.createElement('canvas');
    canvas.width = PROC_IMAGE_SIZE;
    canvas.height = PROC_IMAGE_SIZE;
    let ctx = canvas.getContext('2d', { alpha: false });
    ctx.imageSmoothingEnabled = true;
    ctx.fillStyle = 'rgb(128, 128, 128)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return canvas;
}

function procDrawVideoCompositeFrame(canvas, video, frameIndex) {
    const columns = 2;
    const tileSize = PROC_IMAGE_SIZE / columns;
    const tileX = (frameIndex % columns) * tileSize;
    const tileY = Math.floor(frameIndex / columns) * tileSize;
    const sourceWidth = video.videoWidth || video.width;
    const sourceHeight = video.videoHeight || video.height;
    if(!sourceWidth || !sourceHeight) {
        throw new Error('Cannot compose a video frame without dimensions');
    }
    const scale = Math.min(tileSize / sourceWidth, tileSize / sourceHeight);
    const targetWidth = sourceWidth * scale;
    const targetHeight = sourceHeight * scale;
    const targetX = tileX + (tileSize - targetWidth) / 2;
    const targetY = tileY + (tileSize - targetHeight) / 2;
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.drawImage(video, 0, 0, sourceWidth, sourceHeight,
        targetX, targetY, targetWidth, targetHeight);
}

async function procEvaluateVideoComposite(
    canvas,
    frameTimes,
    scanResults,
    threshold,
    requestId,
    requestType,
    mimeType,
    videoChainId
) {
    WJR_DEBUG && console.debug('MLV: Composite scan predicting '+frameTimes.length+' combined frames for '+requestId+' in video group '+videoChainId);
    const sqrxrScore = await procPredict(canvas);
    scanResults.scanCount++;
    scanResults.sourceFrameCount += frameTimes.length;
    let frameStatus;
    if(procIsSafe(sqrxrScore, threshold)) {
        WJR_DEBUG && console.log('MLV: Composite scan PASS video score for '+frameTimes.length+' frames: '+procScoreToStr(sqrxrScore)+' type '+requestType+', MIME '+mimeType+' for video group '+videoChainId);
        await procCommonLogImg(canvas, 'MLV: Composite scan PASS VID '+procScoreToStr(sqrxrScore));
        frameStatus = 'pass';
    } else {
        WJR_DEBUG && console.log('MLV: Composite scan BLOCKED video score for '+frameTimes.length+' frames: '+procScoreToStr(sqrxrScore)+' type '+requestType+', MIME '+mimeType+' for video group '+videoChainId);
        await procCommonWarnImg(canvas, 'MLV: Composite scan BLOCKED VID '+procScoreToStr(sqrxrScore));
        frameStatus = 'block';
        scanResults.blockCount++;
    }
    scanResults.frames.push(...frameTimes.map(time => ({ 'time': time, 'status': frameStatus })));
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
    let inferenceVideo, videoUrl;

    let scanResults = {
        type: 'vid_scan',
        videoChainId: videoChainId,
        requestId: requestId,
        scanCount: 0,
        blockCount: 0,
        error: undefined,
        frames: [],
        sourceFrameCount: 0
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

        let compositeCanvas = procCreateVideoCompositeCanvas();
        let compositeFrameTimes = [];
        for(var i=0; i<scanMaxSteps; i++) {
            let seekTime = scanStart+scanStep*i;
            await procVideoLoadedData(inferenceVideo, videoUrl, seekTime);
            let maxTime = procGetMaxVideoTime(inferenceVideo); //important to do this AFTER loading
            WJR_DEBUG && console.log('MLV: SCAN max time '+maxTime+' vs seek time '+seekTime+' vs current time '+inferenceVideo.currentTime+' vs ranges '+procGetBufferedRangesString(inferenceVideo)+' vs readyState '+inferenceVideo.readyState+' vs seeking='+inferenceVideo.seeking+' for '+videoChainId+' at request '+requestId);
            if(maxTime < seekTime) {
                break; //invalid even though it tried to seek!
            }

            procDrawVideoCompositeFrame(compositeCanvas, inferenceVideo, compositeFrameTimes.length);
            compositeFrameTimes.push(seekTime);
            if(compositeFrameTimes.length < PROC_VIDEO_COMPOSITE_MAX_FRAMES) {
                continue;
            }
            await procEvaluateVideoComposite(
                compositeCanvas,
                compositeFrameTimes,
                scanResults,
                threshold,
                requestId,
                requestType,
                mimeType,
                videoChainId
            );
            compositeFrameTimes = [];
            if(scanResults.blockCount >= scanBlockBailCount) {
                WJR_DEBUG && console.log('MLV: Bailing on '+requestId+' for video chain '+videoChainId+' because of block count '+scanResults.blockCount);
                break;
            }
            compositeCanvas = procCreateVideoCompositeCanvas();
        }
        if(compositeFrameTimes.length > 0 && scanResults.blockCount < scanBlockBailCount) {
            await procEvaluateVideoComposite(
                compositeCanvas,
                compositeFrameTimes,
                scanResults,
                threshold,
                requestId,
                requestType,
                mimeType,
                videoChainId
            );
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
            PROC_isAuditEnabled = m.auditEnabled === true;
        }
        break;
        case 'start': {
            PROC_openRequests[m.requestId] = {
                requestId: m.requestId,
                url: m.url,
                mimeType: m.mimeType,
                threshold: m.threshold,
                adaptiveContext: m.adaptiveContext || null,
                auditContext: m.auditContext || null,
                reuseContext: m.reuseContext || null,
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
                result: gifScanResult.result,
                adaptiveScore: gifScanResult.adaptiveScore,
                auditRating: gifScanResult.auditRating,
                auditThumbnail: gifScanResult.auditThumbnail
            };
            PROC_port.postMessage(gifResponse);
        }
        break;
        case 'b64_start': {
            PROC_openB64Requests[m.requestId] = {
                requestId: m.requestId,
                threshold: m.threshold,
                adaptiveContext: m.adaptiveContext || null,
                auditContext: m.auditContext || null,
                reuseContext: m.reuseContext || null,
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
            delete PROC_openB64Requests[m.requestId];
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
