const MODEL_PATH = 'sqrx48_NoSpatialDropout2D/model.json'
const IMAGE_SIZE = 224;

//Swish activation
class Swish extends tf.layers.Layer {
    constructor() {
      super({});
    }
    computeOutputShape(inputShape) { console.log('Swish input shape: '+JSON.stringify(inputShape)); return inputShape; }
    call(rawInput, kwargs) { 
        const input = rawInput[0];
        //tf.print(input);
        //tf.print(tf.sigmoid(input));
        const output = tf.mul(input, tf.sigmoid(input));
        //tf.print(output);
        return output; }
    getClassName() { return 'Swish'; }
   }
Swish.className = 'Swish';

//The lambda layer of EfficientNet's Keras port
class Lambda extends tf.layers.Layer {
    constructor() {
      super({});
    }
    computeOutputShape(inputShape) {
        console.log('Lambda input shape: '+JSON.stringify(inputShape));
        return [inputShape[0], 1, 1, inputShape[3]]; /*scalar - is that what we want? */ }
    call(rawInput, kwargs) {
        const input = rawInput[0];
        return tf.mean(input, [1,2] /*spatial dims, channels last*/, true /*keep dims*/);}
    getClassName() { return 'Lambda'; }
   }
Lambda.className = 'Lambda';

//Placeholder for swish activation
class DropConnect extends tf.layers.Layer {
    constructor() {
      super({});
    }
    computeOutputShape(inputShape) { return inputShape; }
    call(input, kwargs) { return input; }
    getClassName() { return 'DropConnect'; }
   }
DropConnect.className = 'DropConnect';


//const MODEL_PATH = 'sqrx_50_efficientnet/model.json'
//const IMAGE_SIZE = 260;


const MIN_IMAGE_SIZE = 36;
const MIN_IMAGE_BYTES = 1024;

let isInReviewMode = false;
let isBlockingQuestionable = true;
let wingman;
const wingman_startup = async () => {
    tf.ENV.set('WEBGL_PACK',false);
    console.log('!!!Registering custom layer');
    tf.serialization.registerClass(Swish);
    tf.serialization.registerClass(Lambda);
    tf.serialization.registerClass(DropConnect);
    console.log('TensorflowJS backend is: '+tf.getBackend());
    console.log('Loading model...');
    wingman = await tf.loadLayersModel(MODEL_PATH);
    console.log('Model: ' + wingman);

    console.log('Warming up...');
    let dummy_data = tf.zeros([1, IMAGE_SIZE, IMAGE_SIZE, 3]);
    let warmup_result = wingman.predict(dummy_data);
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

/**
 * Given an image element, makes a prediction through wingman
 */
let inferenceTimeTotal = 0;
let inferenceCountTotal = 0;
async function predict(imgElement) {
  const startTime = performance.now();
  const logits = tf.tidy(() => {
    const img = tf.browser.fromPixels(imgElement);
    const rightSizeImage = tf.image.resizeBilinear(img, [IMAGE_SIZE,IMAGE_SIZE]);
    const floatImg = rightSizeImage.toFloat();
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
  console.log('Prediction: '+syncedResult[0]+','+syncedResult[1]);
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

async function common_create_svg(img, unsafeScore, dataURL)
{
    let visibleScore = Math.floor(unsafeScore*100);
    let svgText = '<?xml version="1.0" standalone="no"?> <!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN"   "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"> <svg width="'+img.width+'" height="'+img.height+'" version="1.1"      xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">'
    + (isInReviewMode ? '<image href="'+dataURL+'" x="0" y="0" height="'+img.height+'px" width="'+img.width+'px" opacity="0.2" />' : '')
    +'<text x="20%" y="20%" font-size="40" text-anchor="middle" fill="red">'+visibleScore+'</text>'
    +'</svg>';
    return svgText;
}

function getUnsafeScore(sqrxScore) {
	if(isBlockingQuestionable) {
		let sqrx = 1*sqrxScore[1]+2*sqrxScore[2]+3*sqrxScore[3];
		return sqrx/3.0 + 0.085;// + 0.17;
	} else {
		let sqrx = 1*sqrxScore[2]+2*sqrxScore[3];
		return sqrx/2.0;
	}
}

async function fast_filter(filter,img,allData,sqrxScore, url, blob, shouldBlockSilently) {
    try
    {
		let unsafeScore = getUnsafeScore(sqrxScore);
        let safeScore = 1.0-unsafeScore;
        if(safeScore >= unsafeScore) {
            console.log('Passed: '+sqrxScore[0]+','+sqrxScore[1]+','+sqrxScore[2]+','+sqrxScore[3]+' '+url);
            for(let i=0; i<allData.length; i++) {
                filter.write(allData[i]);
            }
            filter.close();
            URL.revokeObjectURL(img.src);
        } else {
            let blockType = shouldBlockSilently ? 'silently' : 'with SVG'
            console.log('Blocked '+blockType+': '+sqrxScore[0]+','+sqrxScore[1]+','+sqrxScore[2]+','+sqrxScore[3]+' '+url);
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
            if(mimeType == 'image/svg+xml') {
                return; //Skip SVG
            }
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
                        let score = 0;
                        if(img.width>=MIN_IMAGE_SIZE && img.height>=MIN_IMAGE_SIZE){ //there's a lot of 1x1 pictures in the world that don't need filtering!
                            console.log('predict '+details.requestId+' size '+img.width+'x'+img.height+', materialization occured with '+byteCount+' bytes');
                            sqrxScore = await predict(img);
                            await fast_filter(filter,img,allData,sqrxScore,details.url,blob, shouldBlockSilently);
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

async function base64_fast_filter(img,sqrxScore, url) {
    console.log('base64 fast filter!');
	let unsafeScore = getUnsafeScore(sqrxScore);
	let safeScore = 1.0-unsafeScore;
    if(safeScore >= unsafeScore) {
        console.log('base64 filter Passed: '+sqrxScore[0]+','+sqrxScore[1]+','+sqrxScore[2]+','+sqrxScore[3]+' '+url);
        return null;
    } else {
        incrementBlockCount();
        console.log('base64 filter Blocked: '+sqrxScore[0]+','+sqrxScore[1]+','+sqrxScore[2]+','+sqrxScore[3]+' '+url);
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
            console.log('base64 stop');
            incrementCheckCount();

            //Unfortunately, str.replace cannot accept a promise as a function,
            //so we simply set 'em up and knock 'em down.
            //That funky bit at the end is to catch = encoded as \x3d
            let dataURIMatcher = /data:image\/[a-z]+;base64,[A-Za-z0-9=+\/ \-]+(\\x3[dD])*/g;
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
                let imageDataURI = rawImageDataURI.replace(/\\x3[dD]/g,'=');
                let imageId = imageDataURI.slice(-20);
                console.debug('base64 image loading: '+imageId);
                let byteCount = imageDataURI.length*3/4;

                if(byteCount >= MIN_IMAGE_BYTES) {
                    let img = new Image();

                    img.onload = async function(e) {
                        console.log('base64 image loaded: '+imageId);
                        let score = 0;
                        try
                        {
                            if(img.width>=MIN_IMAGE_SIZE && img.height>=MIN_IMAGE_SIZE){ //there's a lot of 1x1 pictures in the world that don't need filtering!
                                console.log('base64 predict '+imageId+' size '+img.width+'x'+img.height+', materialization occured with '+byteCount+' bytes');
                                sqrxScore = await predict(img);
                                console.log('base64 score: '+sqrxScore);
                                let replacement = await base64_fast_filter(img, sqrxScore, details.url);
                                const totalTime = performance.now() - startTime;
                                console.log(`Total processing in ${Math.floor(totalTime)}ms`);
                                if(replacement !== null) {
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
  
 browser.menus.create({
    id: "toggle-questionable-mode",
    title: "Toggle Questionable Mode"
  });

browser.menus.onClicked.addListener((info, tab) => {
    switch (info.menuItemId) {
      case "toggle-review-mode":
        isInReviewMode = !isInReviewMode;
        console.log('Review mode? '+isInReviewMode);
        break;
	  case "toggle-questionable-mode":
		isBlockingQuestionable = !isBlockingQuestionable;
		console.log('Are questionable images being blocked?'+isBlockingQuestionable);
		break;
      case "report-good":
        console.log('Good: '+info.srcUrl);
        break;
      case "report-bad":
        console.log('Bad: '+info.srcUrl);
        break;
    }
  });

////////////////////////Actual Startup//////////////////////////////
wingman_startup();