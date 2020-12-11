let openRequests = {};


const MODEL_PATH = 'sqrxr_62_graphopt/model.json'
const IMAGE_SIZE = 224;
const MIN_IMAGE_SIZE = 36;
const MIN_IMAGE_BYTES = 1024;

function onModelLoadProgress(percentage) {
    console.log('LIFECYCLE: Model load '+Math.round(percentage*100)+'% at '+performance.now());
}

let isInReviewMode = false;
let wingman;
const wingman_startup = async () => {
    console.log('LIFECYCLE: Launching TF.js!');
    console.log(tf.env().getFlags());
    tf.enableProdMode();
    await tf.ready();
    let loadedBackend = tf.getBackend();
    console.log('LIFECYCLE: TensorflowJS backend is: '+loadedBackend);
    if(loadedBackend == 'cpu') {
        console.log('LIFECYCLE: WARNING! Exiting because no fast predictor can be loaded!');
        wingman = null;
        return;
    }
    console.log('LIFECYCLE: Loading model...');
    wingman = await tf.loadGraphModel(MODEL_PATH, { onProgress: onModelLoadProgress });
    console.log('LIFECYCLE: Model loaded: ' + wingman+' at '+performance.now());

    console.log('LIFECYCLE: Warming up...');
    let dummy_data = tf.zeros([1, IMAGE_SIZE, IMAGE_SIZE, 3]);
    let warmup_result = null;
    let timingInfo = await tf.time(()=>warmup_result = wingman.predict(dummy_data));
    console.log(warmup_result);
    console.log('LIFECYCLE: TIMING LOADING: '+JSON.stringify(timingInfo));
    warmup_result.print();
    warmup_result.dispose();
    console.log('LIFECYCLE: Ready to go at '+performance.now()+'!');
    browser.browserAction.setTitle({title: "Wingman Jr."});
    browser.browserAction.setIcon({path: "icons/wingman_icon_32_neutral.png"});

};


/**
 * Given an image element, makes a prediction through wingman
 */
let inferenceTimeTotal = 0;
let inferenceCountTotal = 0;
let inferenceCanvas = document.createElement('canvas');
inferenceCanvas.width = IMAGE_SIZE;
inferenceCanvas.height = IMAGE_SIZE;
let inferenceCtx = inferenceCanvas.getContext('2d', { alpha: false, powerPreference: 'high-performance'});
console.log('LIFECYCLE: Inference context: '+inferenceCtx);
inferenceCtx.imageSmoothingEnabled = true;

let processingTimeTotal = 0;
let processingSinceDataEndTimeTotal = 0;
let processingSinceImageLoadTimeTotal = 0;
let processingCountTotal = 0;

async function predict(imgElement) {

  const drawStartTime = performance.now();
  inferenceCtx.drawImage(imgElement, 0, 0, imgElement.width, imgElement.height, 0, 0, IMAGE_SIZE,IMAGE_SIZE);
  const rightSizeImageData = inferenceCtx.getImageData(0, 0, IMAGE_SIZE, IMAGE_SIZE);
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
    const result = wingman.predict(batched, {batchSize: 1});

    return result;
  });

  let syncedResult = logits.dataSync();
  const totalTime = performance.now() - startTime;
  inferenceTimeTotal += totalTime;
  inferenceCountTotal++;
  const avgTime = inferenceTimeTotal / inferenceCountTotal;
  console.log(`PERF: Model inference in ${Math.floor(totalTime)}ms and avg of ${Math.floor(avgTime)}ms for ${inferenceCountTotal} scanned images`);

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
let logCanvas = document.createElement('canvas');
logCanvas.width = LOG_IMG_SIZE;
logCanvas.height = LOG_IMG_SIZE;
let logCtx = logCanvas.getContext('2d', { alpha: false});
logCanvas.imageSmoothingEnabled = true;
async function common_log_img(img, message)
{
    let maxSide = Math.max(img.width, img.height);
    let ratio = LOG_IMG_SIZE/maxSide;
    let newWidth = img.width*ratio;
    let newHeight = img.height*ratio;
    logCtx.clearRect(0,0,logCanvas.width,logCanvas.height);
    logCtx.drawImage(img, 0, 0, newWidth, newHeight);
    let logDataUrl = logCanvas.toDataURL('image/jpeg', 0.7);
    let blockedCSS = 'color: #00FF00; padding: 75px; line-height: 150px; background-image: url('+logDataUrl+'); background-size: contain; background-repeat: no-repeat;';
    console.log('%c '+message, blockedCSS);
}

async function common_create_svg_from_blob(img, threshold, blob)
{
    let dataURL = isInReviewMode ? await readFileAsDataURL(blob) : null;
    return common_create_svg(img, threshold, dataURL);
}

let iconDataURI = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAD6AAAA+gBtXtSawAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAGxSURBVFiF7dW9j0xRHMbxjz1m2ESWkChkiW0kGgSFnkbsJqvQTEMoRSFRydDsP6CiEoJibfQEW2hssSMKiUI2UcluY0Ui6y2M4pyJYzK7cxczFPeb3OSe+zzn+f3uyzmXkpKSf0zAIXzApz7X3oR9sB6PsLOPxXfgIQZbFw7iOQ70ofgePBOf/C9cwGsc7WHxw5hLtToyhXnUCoRVQ6VyJlQqp1Et4K+l7KmVTJvFV/Ee57sE1kMIoyGEY7jcxXsOi3iBLd06PYJ3+Iwry3jWYFa88yoaGFjGO4GP4k0Vfr0T+J6O21jbpp/C02w8g5NtnoDr+IZmyizMAO6nic10viHTH+NGNr6J6Ww8iHvZ/AepoVWxHa+ykGlswxi+oJ556+naGLamBlvz5jCy2uItaljKwhqpkSbGM9941mQj8y8ptqJW5FoW2DoWMZR5hvC2g+/qnxaHdXjSFjybtBM4ns4bbZ4ZcZv/K+zFmyx8EqPinj4iLq+7mb6gB9v6WfFDa+IWdmXabtxJ2tfk7QmTqcjFDtolP59Oz9gobqfDHbRhvBT/8z1l/29qJSUl/yc/AP3+b58RpkSuAAAAAElFTkSuQmCC";


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
    + (isInReviewMode ? '<image href="'+dataURL+'" x="0" y="0" height="'+img.height+'px" width="'+img.width+'px" opacity="0.2" />' : '')
    +'<text transform="translate(12 20)" font-size="20" fill="red">'+visibleScore+'</text>'
    +'</g>'
    +'</svg>';
    return svgText;
}

function isSafe(sqrxrScore) {
    //TODO zone stuff is not plumbed in
    return sqrxrScore[0] < 0.9977756;
}

let timingInfoDumpCount = 0;

async function performFiltering(entry, responsePort) {
    let dataEndTime = performance.now();
    console.log('WEBREQP: starting work for '+entry.requestId +' from '+entry.url);
    let result = {
        type: 'scan',
        requestId: entry.requestId,
        imageBytes: null,
        wasSafe: null
    };
    let byteCount = 0;
    for(let i=0; i<entry.buffers.length; i++) {
        byteCount += entry.buffers[i].byteLength;
    }
    let blob = new Blob(entry.buffers, {type: entry.mimeType});
    let url = null;
    try
    {
        if(byteCount >= MIN_IMAGE_BYTES) { //only scan if the image is complex enough to be objectionable
            url = URL.createObjectURL(blob);
            let img = new Image();

            img.onload = async function(e) {
                console.log('img loaded '+entry.requestId)
                if(img.width>=MIN_IMAGE_SIZE && img.height>=MIN_IMAGE_SIZE){ //there's a lot of 1x1 pictures in the world that don't need filtering!
                    console.log('ML: predict '+entry.requestId+' size '+img.width+'x'+img.height+', materialization occured with '+byteCount+' bytes');
                    let imgLoadTime = performance.now();
                    let sqrxrScore = [0];
                    if(timingInfoDumpCount<10) {
                        timingInfoDumpCount++;
                        let timingInfo = await tf.time(async ()=>sqrxrScore=await predict(img));
                        console.log('PERF: TIMING NORMAL: '+JSON.stringify(timingInfo));
                    } else {
                        sqrxrScore = await predict(img);
                    }
                    if(isSafe(sqrxrScore)) {
                        console.log('ML: Passed: '+sqrxrScore[0]+' '+entry.requestId);
                        result.wasSafe = true
                        result.imageBytes = await blob.arrayBuffer();
                    } else {
                        console.log('ML: Blocked: '+sqrxrScore[0]+' '+entry.requestId);
                        let svgText = await common_create_svg_from_blob(img, sqrxrScore[0], blob);
                        common_log_img(img, 'BLOCKED IMG '+sqrxrScore);
                        let encoder = new TextEncoder();
                        let encodedTypedBuffer = encoder.encode(svgText);
                        result.imageBytes = encodedTypedBuffer.buffer;
                    }
                    const endTime = performance.now();
                    const totalTime = endTime - entry.startTime;
                    const totalSinceDataEndTime = endTime - dataEndTime;
                    const totalSinceImageLoadTime = endTime - imgLoadTime;
                    processingTimeTotal += totalTime;
                    processingSinceDataEndTimeTotal += totalSinceDataEndTime;
                    processingSinceImageLoadTimeTotal += totalSinceImageLoadTime;
                    processingCountTotal++;
                    console.log('PERF: Processed in '+totalTime
                        +' (' +totalSinceDataEndTime+' data end, '
                        +totalSinceImageLoadTime+' img load) with an avg of '
                        +Math.round(processingTimeTotal/processingCountTotal)
                        +' ('+Math.round(processingSinceDataEndTimeTotal/processingCountTotal)
                        +' data end, ' + Math.round(processingSinceImageLoadTimeTotal/processingCountTotal)
                        +' img load) at a count of '+processingCountTotal);
                    console.log('WEBREQ: Finishing '+entry.requestId);
                }
                responsePort.postMessage(result);
                URL.revokeObjectURL(url);
                
            }
            console.log('setting image source '+entry.requestId)
            img.decoding = 'sync'
            img.src = url;
        } else {
            URL.revokeObjectURL(url);
            result.imageBytes = await blob.arrayBuffer();
            responsePort.postMessage(result);
        }
    } catch(e) {
        console.log('WEBREQP: Error for '+details.url+': '+e);
        if(url != null) {
            URL.revokeObjectURL(url);
        }
        result.imageBytes = result.imageBytes || await blob.arrayBuffer();
        responsePort.postMessage(result);
    } finally {
        console.log('WEBREQP: Finishing '+entry.requestId);
    }
}

wingman_startup();

let port = browser.runtime.connect();
port.onMessage.addListener(async function(m) {
    switch(m.type) {
        case 'start': {
            openRequests[m.requestId] = {
                requestId: m.requestId,
                url: m.url,
                mimeType: m.mimeType,
                startTime: performance.now(),
                buffers: []
            };
        }
        break;
        case 'ondata': {
            openRequests[m.requestId].buffers.push(m.data);
        }
        break;
        case 'onerror': {
            delete openRequests[m.requestId];
        }
        break;
        case 'onstop': {
            let result = await performFiltering(openRequests[m.requestId], port);
            delete openRequests[m.requestId];
            port.postMessage(result);
        }
    }
});