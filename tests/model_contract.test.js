const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const processorSource = fs.readFileSync(path.join(root, 'processor.js'), 'utf8');
const modelPathMatch = processorSource.match(/const PROC_MODEL_PATH = '([^']+)'/);
assert.ok(modelPathMatch, 'processor.js must declare PROC_MODEL_PATH');

const modelDirectory = path.join(root, path.dirname(modelPathMatch[1]));
const modelJson = JSON.parse(fs.readFileSync(path.join(modelDirectory, 'model.json'), 'utf8'));
const tf = require(path.join(root, 'libs', 'tfjs_3.11.0.js'));

function concatenateArrayBuffers(buffers) {
    const combined = Buffer.concat(buffers);
    return combined.buffer.slice(combined.byteOffset, combined.byteOffset + combined.byteLength);
}

async function loadLocalGraphModel() {
    const weightSpecs = [];
    const shards = [];
    for (const group of modelJson.weightsManifest) {
        weightSpecs.push(...group.weights);
        for (const shard of group.paths) {
            shards.push(fs.readFileSync(path.join(modelDirectory, shard)));
        }
    }

    return tf.loadGraphModel({
        load: async () => ({
            modelTopology: modelJson.modelTopology,
            weightSpecs,
            weightData: concatenateArrayBuffers(shards),
            format: modelJson.format,
            generatedBy: modelJson.generatedBy,
            convertedBy: modelJson.convertedBy,
            signature: modelJson.signature
        })
    });
}

(async () => {
    assert.strictEqual(tf.version.tfjs, '3.11.0', 'test must use the bundled add-on runtime');

    const inputShape = Object.values(modelJson.signature.inputs)[0]
        .tensorShape.dim.map(dimension => Number(dimension.size));
    assert.deepStrictEqual(inputShape, [-1, 224, 224, 3]);

    const model = await loadLocalGraphModel();
    const input = tf.zeros([1, 224, 224, 3]);
    const result = model.predict(input, { batchSize: 1 });

    assert.ok(Array.isArray(result), 'processor.js requires an output array');
    assert.strictEqual(result.length, 2, 'processor.js requires score and SQRX outputs');
    assert.deepStrictEqual(result[0].shape, [1, 1], 'output 0 must be the unsafe score');
    assert.deepStrictEqual(result[1].shape, [1, 4], 'output 1 must be S/Q/R/X');

    const score = Array.from(await result[0].data());
    const sqrx = Array.from(await result[1].data());
    assert.ok(score.every(Number.isFinite));
    assert.ok(sqrx.every(Number.isFinite));
    assert.ok(score[0] >= 0 && score[0] <= 1, 'unsafe score must be a probability');
    assert.ok(sqrx.every(value => value >= 0 && value <= 1), 'SQRX values must be probabilities');
    assert.ok(Math.abs(sqrx.reduce((sum, value) => sum + value, 0) - 1) < 1e-5,
        'SQRX probabilities must sum to one');

    result.forEach(tensor => tensor.dispose());
    input.dispose();
    model.dispose();
    console.log(`model contract test passed (${modelPathMatch[1]}, TF.js ${tf.version.tfjs})`);
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
