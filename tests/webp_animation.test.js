const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const processorSource = fs.readFileSync(path.join(root, 'processor.js'), 'utf8');
const helperStart = processorSource.indexOf('const PROC_ANIMATED_WEBP_SAMPLE_COUNT');
const helperEnd = processorSource.indexOf('async function procPerformFiltering', helperStart);

let predictions = [];
let predictionCalls = 0;
const context = {
    ArrayBuffer,
    Uint8Array,
    String,
    setTimeout(callback) { callback(); },
    procGetPrimaryScore(score) { return score; },
    procIsSafe(score, threshold) { return score < threshold; },
    async procPredict() {
        return predictions[predictionCalls++];
    }
};
vm.createContext(context);
vm.runInContext(processorSource.slice(helperStart, helperEnd) + `
    this.isAnimatedWebp = procIsAnimatedWebp;
    this.predictImageSamples = procPredictImageSamples;
`, context);

function ascii(value) {
    return Array.from(value, character => character.charCodeAt(0));
}

function uint32le(value) {
    return [
        value & 0xff,
        (value >>> 8) & 0xff,
        (value >>> 16) & 0xff,
        (value >>> 24) & 0xff
    ];
}

function webpWithChunk(chunkType, chunkData) {
    const padding = chunkData.length & 1 ? [0] : [];
    const payload = [
        ...ascii('WEBP'),
        ...ascii(chunkType),
        ...uint32le(chunkData.length),
        ...chunkData,
        ...padding
    ];
    return Uint8Array.from([
        ...ascii('RIFF'),
        ...uint32le(payload.length),
        ...payload
    ]).buffer;
}

assert.strictEqual(context.isAnimatedWebp([webpWithChunk('VP8 ', [0])]), false,
    'a static WebP must remain on the single-image scan path');
assert.strictEqual(context.isAnimatedWebp([webpWithChunk('VP8X', [0x02])]), true,
    'the VP8X animation flag must identify animated WebP');
assert.strictEqual(context.isAnimatedWebp([webpWithChunk('ANIM', [0, 0, 0, 0, 0, 0])]), true,
    'an ANIM chunk must identify animated WebP');

(async () => {
    predictions = [0.1, 0.2, 0.8, 0.1];
    predictionCalls = 0;
    const animatedScore = await context.predictImageSamples({}, 0.5, true);
    assert.strictEqual(animatedScore, 0.8);
    assert.strictEqual(predictionCalls, 3,
        'animated WebP sampling must stop as soon as a frame is blocked');

    predictions = [0.2, 0.9];
    predictionCalls = 0;
    const staticScore = await context.predictImageSamples({}, 0.5, false);
    assert.strictEqual(staticScore, 0.2);
    assert.strictEqual(predictionCalls, 1,
        'static images must still receive exactly one prediction');

    console.log('animated WebP tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
