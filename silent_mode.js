const smLoadImagePromise = url => new Promise( (resolve, reject) => {
    const img = new Image()
    img.onerror = e => reject(e)
    img.onload = () => resolve(img)
    img.decoding = 'sync'
    img.src = url
});

const SM_CUSTOM_COLLECTIONS_KEY = 'silent_custom_collections';
const SM_CUSTOM_ACTIVE_KEY = 'silent_custom_active_collection_id';
const SM_BUILTIN_COLLECTION_ID = 'builtin';

let SM_customCollections = [];
let SM_activeCollectionId = SM_BUILTIN_COLLECTION_ID;
let SM_collectionIndexes = new Map();

async function SM_loadCustomCollections() {
    try {
        let result = await browser.storage.local.get([SM_CUSTOM_COLLECTIONS_KEY, SM_CUSTOM_ACTIVE_KEY]);
        SM_customCollections = result[SM_CUSTOM_COLLECTIONS_KEY] || [];
        SM_activeCollectionId = result[SM_CUSTOM_ACTIVE_KEY] || SM_BUILTIN_COLLECTION_ID;
    } catch (error) {
        WJR_DEBUG && console.warn(`SILENT: Failed to load custom collections: ${error}`);
        SM_customCollections = [];
        SM_activeCollectionId = SM_BUILTIN_COLLECTION_ID;
    }
}

if (typeof browser !== 'undefined' && browser.storage && browser.storage.onChanged) {
    browser.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') {
            return;
        }
        if (changes[SM_CUSTOM_COLLECTIONS_KEY] || changes[SM_CUSTOM_ACTIVE_KEY]) {
            SM_loadCustomCollections();
        }
    });
}

SM_loadCustomCollections();

function SM_getNextIndex(collectionId, length) {
    if (!length) {
        return 0;
    }
    let current = SM_collectionIndexes.get(collectionId);
    if (current === undefined) {
        current = -1;
    }
    current = (current + 1) % length;
    SM_collectionIndexes.set(collectionId, current);
    return current;
}

function SM_getActiveCollection() {
    if (SM_activeCollectionId === SM_BUILTIN_COLLECTION_ID) {
        return null;
    }
    return SM_customCollections.find(collection => collection.id === SM_activeCollectionId) || null;
}

function SM_pickReplacementSource() {
    const customCollection = SM_getActiveCollection();
    if (customCollection && customCollection.images && customCollection.images.length > 0) {
        const index = SM_getNextIndex(customCollection.id, customCollection.images.length);
        const entry = customCollection.images[index];
        return {
            src: entry.dataUrl,
            label: `custom-${customCollection.name}`
        };
    }

    const index = SM_getNextIndex(SM_BUILTIN_COLLECTION_ID, SM_DATA.length);
    const entry = SM_DATA[index];
    return {
        src: entry.file,
        label: entry.file
    };
}

//Do best to format the image with matching dimensions
async function smFormatImage(srcImg, targetWidth, targetHeight, id) {
    let targetCanvas = document.createElement('canvas');
    targetCanvas.width = targetWidth;
    targetCanvas.height = targetHeight;
    let targetCtx = targetCanvas.getContext('2d');
    targetCtx.imageSmoothingEnabled = true;

    targetCtx.clearRect(0,0,targetWidth,targetHeight);

    let scale = Math.max(targetWidth / srcImg.width, targetHeight / srcImg.height);
    let scaledWidth = srcImg.width * scale;
    let scaledHeight = srcImg.height * scale;
    let offsetX = (targetWidth - scaledWidth) / 2.0;
    let offsetY = (targetHeight - scaledHeight) / 2.0;
    WJR_DEBUG && console.debug(`SILENT: Format image, id ${id}, src ${srcImg.width}x${srcImg.height} target ${targetWidth}x${targetHeight}`);
    targetCtx.drawImage(srcImg, offsetX, offsetY, scaledWidth, scaledHeight);

    return targetCanvas.toDataURL();
}

async function SM_getReplacementSVG(img, visibleScore, originalDataURL) {
    WJR_DEBUG && console.log(`SILENT: Creating replacement for image ${img.width}x${img.height} score ${visibleScore}`);

    let replacementSource = SM_pickReplacementSource();
    let replacementRawImage = await smLoadImagePromise(replacementSource.src);
    let replacementImageDataURL = await smFormatImage(replacementRawImage, img.width, img.height, visibleScore);

    let fontSize = Math.round(img.height*0.08);

    let escapedDataUrl = originalDataURL ? originalDataURL.replace(/"/g, '&quot;') : null;
    let originalAttr = escapedDataUrl ? ` data-wingman-original-href="${escapedDataUrl}"` : '';
    let svgText = '<?xml version="1.0" standalone="no"?> <!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN"   "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"> <svg width="'+img.width+'" height="'+img.height+'" version="1.1"      xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"'+originalAttr+'>'
    +'<g>'
    + '<image href="'+replacementImageDataURL+'" x="0" y="0" height="'+img.height+'px" width="'+img.width+'px" />'
    +' <text transform="translate('+(img.width/2.0)+' '+(img.height/2.0)+')" font-size="'+fontSize+'" fill="grey" opacity="0.35">W'+visibleScore+'</text>'
    +'</g>'
    +'</svg>';
    return svgText;
}
