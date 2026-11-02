const DECODER_WORKER_IMAGE_SIZE = 224;

function decoderWorkerGetFrameWidth(frame) {
    return frame.displayWidth || frame.codedWidth;
}

function decoderWorkerGetFrameHeight(frame) {
    return frame.displayHeight || frame.codedHeight;
}

function decoderWorkerPrepareN017(context, frame, sourceWidth, sourceHeight) {
    const scale = Math.min(
        DECODER_WORKER_IMAGE_SIZE / sourceWidth,
        DECODER_WORKER_IMAGE_SIZE / sourceHeight
    );
    const targetWidth = sourceWidth * scale;
    const targetHeight = sourceHeight * scale;
    const targetX = (DECODER_WORKER_IMAGE_SIZE - targetWidth) / 2;
    const targetY = (DECODER_WORKER_IMAGE_SIZE - targetHeight) / 2;

    context.fillStyle = 'rgb(128, 128, 128)';
    context.fillRect(
        0,
        0,
        DECODER_WORKER_IMAGE_SIZE,
        DECODER_WORKER_IMAGE_SIZE
    );
    context.drawImage(
        frame,
        0,
        0,
        sourceWidth,
        sourceHeight,
        targetX,
        targetY,
        targetWidth,
        targetHeight
    );
}

function decoderWorkerPrepareSqrxr112(context, frame, sourceWidth, sourceHeight) {
    context.clearRect(
        0,
        0,
        DECODER_WORKER_IMAGE_SIZE,
        DECODER_WORKER_IMAGE_SIZE
    );
    if(sourceWidth >= sourceHeight) {
        let tileCount = Math.floor(sourceWidth / sourceHeight);
        tileCount = Math.ceil(Math.sqrt(tileCount));
        const destinationTileHeight = DECODER_WORKER_IMAGE_SIZE / tileCount;
        const sourceTileWidth = sourceWidth / tileCount;
        for(let index = 0; index < tileCount; index++) {
            context.drawImage(
                frame,
                index * sourceTileWidth,
                0,
                sourceTileWidth,
                sourceHeight,
                0,
                index * destinationTileHeight,
                DECODER_WORKER_IMAGE_SIZE,
                destinationTileHeight
            );
        }
    } else {
        let tileCount = Math.floor(sourceHeight / sourceWidth);
        tileCount = Math.ceil(Math.sqrt(tileCount));
        const destinationTileWidth = DECODER_WORKER_IMAGE_SIZE / tileCount;
        const sourceTileHeight = sourceHeight / tileCount;
        for(let index = 0; index < tileCount; index++) {
            context.drawImage(
                frame,
                0,
                index * sourceTileHeight,
                sourceWidth,
                sourceTileHeight,
                index * destinationTileWidth,
                0,
                destinationTileWidth,
                DECODER_WORKER_IMAGE_SIZE
            );
        }
    }
}

async function decoderWorkerDecode(message) {
    const totalStartedAt = performance.now();
    if(typeof ImageDecoder === 'undefined'
        || typeof OffscreenCanvas === 'undefined') {
        return {
            ok: false,
            unsupported: true,
            error: 'Worker ImageDecoder or OffscreenCanvas unavailable'
        };
    }
    if(!await ImageDecoder.isTypeSupported(message.mimeType)) {
        return {
            ok: false,
            unsupported: true,
            error: `Unsupported worker image MIME type ${message.mimeType}`
        };
    }

    let decoder = null;
    let frame = null;
    try {
        decoder = new ImageDecoder({
            type: message.mimeType,
            data: new Uint8Array(message.imageBytes),
            transfer: [message.imageBytes],
            preferAnimation: false
        });
        const decodeStartedAt = performance.now();
        const decoded = await decoder.decode({ frameIndex: 0 });
        const decodeMs = performance.now() - decodeStartedAt;
        frame = decoded.image;
        const width = decoderWorkerGetFrameWidth(frame);
        const height = decoderWorkerGetFrameHeight(frame);

        const canvas = new OffscreenCanvas(
            DECODER_WORKER_IMAGE_SIZE,
            DECODER_WORKER_IMAGE_SIZE
        );
        const context = canvas.getContext('2d', { alpha: false });
        if(!context) {
            throw new Error('Unable to create worker 2D canvas context');
        }
        context.imageSmoothingEnabled = true;

        const resizeStartedAt = performance.now();
        if(message.preprocessing === 'sqrxr_112') {
            decoderWorkerPrepareSqrxr112(context, frame, width, height);
        } else {
            decoderWorkerPrepareN017(context, frame, width, height);
        }
        const resizeMs = performance.now() - resizeStartedAt;

        const readbackStartedAt = performance.now();
        const pixels = context.getImageData(
            0,
            0,
            DECODER_WORKER_IMAGE_SIZE,
            DECODER_WORKER_IMAGE_SIZE
        ).data.buffer;
        const readbackMs = performance.now() - readbackStartedAt;

        return {
            ok: true,
            width: width,
            height: height,
            pixels: pixels,
            decodeMs: decodeMs,
            resizeMs: resizeMs,
            readbackMs: readbackMs,
            totalMs: performance.now() - totalStartedAt
        };
    } finally {
        frame?.close();
        decoder?.close();
    }
}

self.onmessage = async event => {
    const requestId = event.data.requestId;
    let result;
    try {
        result = await decoderWorkerDecode(event.data);
    } catch(error) {
        result = {
            ok: false,
            unsupported: false,
            error: `${error?.name || 'Error'}: ${error?.message || error}`
        };
    }
    result.type = 'decode_result';
    result.requestId = requestId;
    if(result.pixels) {
        self.postMessage(result, [result.pixels]);
    } else {
        self.postMessage(result);
    }
};
