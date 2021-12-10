const SM_THUMB_SIZE = 16;
let SM_thumbCanvas = document.createElement('canvas');
SM_thumbCanvas.width = SM_THUMB_SIZE;
SM_thumbCanvas.height = SM_THUMB_SIZE;
let SM_thumbCtx = SM_thumbCanvas.getContext('2d', { alpha: false});
SM_thumbCtx.imageSmoothingEnabled = true;
SM_thumbCtx.globalCompositeOperation = "copy";

const smLoadImagePromise = url => new Promise( (resolve, reject) => {
    const img = new Image()
    img.onerror = e => reject(e)
    img.onload = () => resolve(img)
    img.decoding = 'sync'
    img.src = url
});

let SM_bestMatchHistory = [];

async function SM_findBestMatchImage(img) {
    let startTime = performance.now();

    //Generate thumb
    SM_thumbCtx.drawImage(img, 0, 0, SM_THUMB_SIZE, SM_THUMB_SIZE);
    let data = SM_thumbCtx.getImageData(0,0,SM_THUMB_SIZE,SM_THUMB_SIZE).data;
    let greyThumb = [];
    let colorThumb = [];

    for(let y=0; y<SM_THUMB_SIZE; y++) {
        for(let x=0; x<SM_THUMB_SIZE; x++) {
            let i = ((y*SM_THUMB_SIZE)+x)*4;
            let r = data[i+0];
            let g = data[i+1];
            let b = data[i+2];

            colorThumb.push([r,g,b]);
            let grey = 0.30*r + 0.59*g + 0.11*b; //float in [0-255], input is int [0-255]
            greyThumb.push(grey);
        }
    }

    //Find best match
    let isLandscape = img.width > img.height;

    let bestMatch = null;
    let bestScore = 99999999999999999999;

    for(let smi = 0; smi < SM_DATA.length; smi++) {
        let match = SM_DATA[smi];
        let isMatchLandscape = match.w > match.h;
        if(isLandscape != isMatchLandscape) {
            continue;
        }

        if(SM_bestMatchHistory.indexOf(match) != -1) {
            continue;
        }

        let greyScore = 0;
        let colorScore = 0;
        for(let y=0; y<SM_THUMB_SIZE; y++) {
            for(let x=0; x<SM_THUMB_SIZE; x++) {
                let i = y*SM_THUMB_SIZE+x;
                let greyDiff = greyThumb[i] - match.greyThumb[i];
                greyScore += greyDiff*greyDiff;
                let colorDiffR = colorThumb[i][0] - match.colorThumb[i][0];
                let colorDiffG = colorThumb[i][1] - match.colorThumb[i][1];
                let colorDiffB = colorThumb[i][2] - match.colorThumb[i][2];
                colorScore += colorDiffR*colorDiffR + colorDiffG*colorDiffG + colorDiffB*colorDiffB;
            }
        }

        greyScore = Math.sqrt(greyScore);
        colorScore = Math.sqrt(colorScore) / 3; //Normalize by channel count so grey and color start on even footing

        let totalScore = greyScore*0.7 + colorScore*0.3;
        if(totalScore < bestScore) {
            bestScore = totalScore;
            bestMatch = match;
        }
    }

    SM_bestMatchHistory.push(bestMatch);
    if(SM_bestMatchHistory.length > 10) {
        SM_bestMatchHistory.shift();
    }

    let totalTimeMs = performance.now()-startTime;
    WJR_DEBUG && console.debug(`SILENT: Found best match in ${totalTimeMs}ms for image ${img.width}x${img.height} using best match ${bestMatch.w}x${bestMatch.h} of name ${bestMatch.file}`);

    return bestMatch;
}

//Do best to format the image with matching dimensions
async function smFormatImage(srcImg, targetWidth, targetHeight, id) {
    let targetCanvas = document.createElement('canvas');
    targetCanvas.width = targetWidth;
    targetCanvas.height = targetHeight;
    let targetCtx = targetCanvas.getContext('2d');
    targetCtx.imageSmoothingEnabled = true;

    targetCtx.clearRect(0,0,targetWidth,targetHeight);

    let isSrcLandscape = srcImg.width > srcImg.height;
    let isTargetLandscape = targetWidth > targetHeight;
    if(isSrcLandscape != isTargetLandscape) {
        throw 'Expected images to be same orientation';
    }

    //Now make the long sides match in proportion and let the rest of the image be clipped or empty
    if(isSrcLandscape) {
        let scale = targetWidth / srcImg.width;
        let targetSrcHeight = targetHeight / scale;
        let srcTargetHeight = srcImg.height * scale;
        //Source height is greater
        if(srcImg.height > targetSrcHeight) {
            WJR_DEBUG && console.debug(`SILENT: Format Landscape, src height greater, id ${id}, src ${srcImg.width}x${srcImg.height} target ${targetWidth}x${targetHeight}`);
            let srcHeightDiff = srcImg.height - targetSrcHeight;
            targetCtx.drawImage(srcImg, 0, srcHeightDiff/2.0, srcImg.width, srcImg.height-srcHeightDiff, 0, 0, targetWidth, targetHeight);
        } else {
            WJR_DEBUG && console.debug(`SILENT: Format Landscape, target height greater, id ${id}, src ${srcImg.width}x${srcImg.height} target ${targetWidth}x${targetHeight}`);
            let targetHeightDiff = targetHeight - srcTargetHeight;
            targetCtx.drawImage(srcImg, 0, targetHeightDiff/2.0, targetWidth, targetHeight - targetHeightDiff); 
        }
    } else {
        let scale = targetHeight / srcImg.height;
        let targetSrcWidth = targetWidth / scale;
        let srcTargetWidth = srcImg.width * scale;
        if(srcImg.width > targetSrcWidth) {
            WJR_DEBUG && console.debug(`SILENT: Format portrait, src width greater, id ${id}, src ${srcImg.width}x${srcImg.height} target ${targetWidth}x${targetHeight}`);
            let srcWidthDiff = srcImg.width - targetSrcWidth;
            targetCtx.drawImage(srcImg, srcWidthDiff/2.0, 0, srcImg.width-srcWidthDiff, srcImg.height, 0, 0, targetWidth, targetHeight);
        } else {
            WJR_DEBUG && console.debug(`SILENT: Format portrait, target width greater, id ${id}, src ${srcImg.width}x${srcImg.height} target ${targetWidth}x${targetHeight}`);
            let targetWidthDiff = targetWidth - srcTargetWidth;
            targetCtx.drawImage(srcImg, targetWidthDiff/2.0, 0, targetWidth-targetWidthDiff, targetHeight);
        }
    }

    return targetCanvas.toDataURL();
}

async function SM_getReplacementSVG(img, visibleScore) {
    WJR_DEBUG && console.log(`SILENT: Creating replacement for image ${img.width}x${img.height} score ${visibleScore}`);

    let bestMatch = await SM_findBestMatchImage(img);
    let replacementRawImage = await smLoadImagePromise(bestMatch.file);
    let replacementImageDataURL = await smFormatImage(replacementRawImage, img.width, img.height, visibleScore);

    let fontSize = Math.round(img.height*0.08);

    let svgText = '<?xml version="1.0" standalone="no"?> <!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN"   "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"> <svg width="'+img.width+'" height="'+img.height+'" version="1.1"      xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">'
    +'<g>'
    + '<image href="'+replacementImageDataURL+'" x="0" y="0" height="'+img.height+'px" width="'+img.width+'px" />'
    +' <text transform="translate('+(img.width/2.0)+' '+(img.height/2.0)+')" font-size="'+fontSize+'" fill="grey" opacity="0.35">W'+visibleScore+'</text>'
    +'</g>'
    +'</svg>';
    return svgText;
}