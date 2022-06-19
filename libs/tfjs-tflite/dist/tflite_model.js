/**
 * @license
 * Copyright 2021 Google LLC. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * =============================================================================
 */
import { tensor, Tensor } from '@tensorflow/tfjs-core';
import * as tfliteWebAPIClient from './tflite_web_api_client';
const TFHUB_SEARCH_PARAM = '?lite-format=tflite';
/**
 * A `tflite.TFLiteModel` is built from a TFLite model flatbuffer and executable
 * on TFLite interpreter. To load it, use the `loadTFLiteModel` function below.
 *
 * Sample usage:
 *
 * ```js
 * // Load the MobilenetV2 tflite model from tfhub.
 * const tfliteModel = tflite.loadTFLiteModel(
 *     'https://tfhub.dev/tensorflow/lite-model/mobilenet_v2_1.0_224/1/metadata/1');
 *
 * const outputTensor = tf.tidy(() => {
 *    // Get pixels data from an image.
 *    const img = tf.browser.fromPixels(document.querySelector('img'));
 *    // Normalize (might also do resize here if necessary).
 *    const input = tf.sub(tf.div(tf.expandDims(img), 127.5), 1);
 *    // Run the inference.
 *    let outputTensor = tfliteModel.predict(input) as tf.Tensor;
 *    // De-normalize the result.
 *    return tf.mul(tf.add(outputTensor, 1), 127.5)
 *  });
 * console.log(outputTensor);
 *
 * ```
 *
 * @doc {heading: 'Models', subheading: 'Classes'}
 */
export class TFLiteModel {
    constructor(modelRunner) {
        this.modelRunner = modelRunner;
    }
    get inputs() {
        const modelInputs = this.modelRunner.getInputs();
        return this.convertTFLiteTensorInfos(modelInputs);
    }
    get outputs() {
        const modelOutputs = this.modelRunner.getOutputs();
        return this.convertTFLiteTensorInfos(modelOutputs);
    }
    /**
     * Execute the inference for the input tensors.
     *
     * @param inputs The input tensors, when there is single input for the model,
     *     inputs param should be a Tensor. For models with multiple inputs,
     *     inputs params should be in either Tensor[] if the input order is fixed,
     *     or otherwise NamedTensorMap format.
     *
     * @param config Prediction configuration for specifying the batch size.
     *     Currently this field is not used, and batch inference is not supported.
     *
     * @returns Inference result tensors. The output would be single Tensor if
     *     model has single output node, otherwise NamedTensorMap will be returned
     *     for model with multiple outputs. Tensor[] is not used.
     *
     * @doc {heading: 'Models', subheading: 'Classes'}
     */
    predict(inputs, config) {
        const modelInputs = this.modelRunner.getInputs();
        const modelOutputs = this.modelRunner.getOutputs();
        // Set model inputs from the given tensors.
        // A single tensor or a tensor array.
        if (inputs instanceof Tensor || Array.isArray(inputs)) {
            let inputTensors;
            if (inputs instanceof Tensor) {
                inputTensors = [inputs];
            }
            else {
                inputTensors = inputs;
            }
            if (modelInputs.length !== inputTensors.length) {
                throw new Error(`The size of TFLite model inputs (${modelInputs
                    .length}) does not match the size of the input tensors (${inputTensors.length})`);
            }
            for (let i = 0; i < modelInputs.length; i++) {
                this.setModelInputFromTensor(modelInputs[i], inputTensors[i]);
            }
        }
        // Named tensors.
        else {
            const inputTensorNames = Object.keys(inputs);
            const modelInputMap = {};
            modelInputs.forEach(modelInput => {
                modelInputMap[modelInput.name] = modelInput;
            });
            const modelInputNames = Object.keys(modelInputMap);
            this.checkMapInputs(inputTensorNames, modelInputNames);
            for (const name of inputTensorNames) {
                this.setModelInputFromTensor(modelInputMap[name], inputs[name]);
            }
        }
        // Run inference.
        const success = this.modelRunner.infer();
        if (!success) {
            throw new Error('Failed running inference');
        }
        // Convert model outputs to tensors.
        const outputTensors = {};
        for (let i = 0; i < modelOutputs.length; i++) {
            const modelOutput = modelOutputs[i];
            let data = modelOutput.data();
            // Convert TFLite tensor types that are not supported by TFJS to
            // compatible types.
            switch (modelOutput.dataType) {
                case 'int8':
                case 'int16':
                case 'uint32':
                    data = Int32Array.from(data);
                    break;
                case 'float64':
                    console.warn(`WARNING: converting output tensor from 'float64' to 'float32'`);
                    data = Float32Array.from(data);
                    break;
                default:
                    break;
            }
            const outputTensor = tensor(data, this.getShapeFromTFLiteTensorInfo(modelOutput));
            outputTensors[modelOutput.name] = outputTensor;
        }
        const names = Object.keys(outputTensors);
        return names.length === 1 ? outputTensors[names[0]] : outputTensors;
    }
    /**
     * Execute the inference for the input tensors and return activation
     * values for specified output node names without batching.
     *
     * @param inputs The input tensors, when there is single input for the model,
     *     inputs param should be a Tensor. For models with multiple inputs,
     *     inputs params should be in either Tensor[] if the input order is fixed,
     *     or otherwise NamedTensorMap format.
     *
     * @param outputs string|string[]. List of output node names to retrieve
     *     activation from.
     *
     * @returns Activation values for the output nodes result tensors. The return
     *     type matches specified parameter outputs type. The output would be
     *     single Tensor if single output is specified, otherwise Tensor[] for
     *     multiple outputs.
     */
    execute(inputs, outputs) {
        throw new Error('execute() of TFLiteModel is not supported yet.');
    }
    getProfilingResults() {
        return this.modelRunner.getProfilingResults();
    }
    getProfilingSummary() {
        return this.modelRunner.getProfilingSummary();
    }
    setModelInputFromTensor(modelInput, tensor) {
        // String and complex tensors are not supported.
        if (tensor.dtype === 'string' || tensor.dtype === 'complex64') {
            throw new Error(`Data type '${tensor.dtype}' not supported.`);
        }
        // Check shape.
        //
        // At this point, we've already checked that input tensors and model inputs
        // have the same size.
        const modelInputShape = modelInput.shape.split(',').map(dim => Number(dim));
        if (!tensor.shape.every((dim, index) => modelInputShape[index] === -1 ||
            modelInputShape[index] === dim)) {
            throw new Error(`Input tensor shape mismatch: expect '${modelInput.shape}', got '${tensor.shape.join(',')}'.`);
        }
        // Check types.
        switch (modelInput.dataType) {
            // All 'bool' and 'int' tflite types accpet 'bool' or 'int32' tfjs types.
            // Will throw error for 'float32' tfjs type.
            case 'bool':
            case 'int8':
            case 'uint8':
            case 'int16':
            case 'uint32':
            case 'int32':
                if (tensor.dtype === 'float32') {
                    throw this.getDataTypeMismatchError(modelInput.dataType, tensor.dtype);
                }
                else if (modelInput.dataType !== tensor.dtype) {
                    console.warn(`WARNING: converting '${tensor.dtype}' to '${modelInput.dataType}'`);
                }
                break;
            // All 'float' tflite types accept all tfjs types.
            case 'float32':
            case 'float64':
                if (modelInput.dataType !== tensor.dtype) {
                    console.warn(`WARNING: converting '${tensor.dtype}' to '${modelInput.dataType}'`);
                }
                break;
            default:
                break;
        }
        const modelInputBuffer = modelInput.data();
        switch (modelInput.dataType) {
            case 'int8':
                modelInputBuffer.set(Int8Array.from(tensor.dataSync()));
                break;
            case 'uint8':
            case 'bool':
                modelInputBuffer.set(Uint8Array.from(tensor.dataSync()));
                break;
            case 'int16':
                modelInputBuffer.set(Int16Array.from(tensor.dataSync()));
                break;
            case 'int32':
                modelInputBuffer.set(Int32Array.from(tensor.dataSync()));
                break;
            case 'uint32':
                modelInputBuffer.set(Uint32Array.from(tensor.dataSync()));
                break;
            case 'float32':
                modelInputBuffer.set(Float32Array.from(tensor.dataSync()));
                break;
            case 'float64':
                modelInputBuffer.set(Float64Array.from(tensor.dataSync()));
                break;
            default:
                break;
        }
    }
    convertTFLiteTensorInfos(infos) {
        return infos.map(info => {
            const dtype = getDTypeFromTFLiteType(info.dataType);
            return {
                name: info.name,
                shape: this.getShapeFromTFLiteTensorInfo(info),
                dtype,
            };
        });
    }
    checkMapInputs(inputTensorNames, modelInputNames) {
        const notInModel = inputTensorNames.filter(name => !modelInputNames.includes(name));
        const notInInput = modelInputNames.filter(name => !inputTensorNames.includes(name));
        if (notInModel.length === 0 && notInInput.length === 0) {
            return;
        }
        const msgParts = ['The model input names don\'t match the model input names.'];
        if (notInModel.length > 0) {
            msgParts.push(`Names in input but missing in model: [${notInModel}].`);
        }
        if (notInInput.length > 0) {
            msgParts.push(`Names in model but missing in inputs: [${notInInput}].`);
        }
        throw new Error(msgParts.join(' '));
    }
    getShapeFromTFLiteTensorInfo(info) {
        return info.shape.split(',').map(s => Number(s));
    }
    getDataTypeMismatchError(expected, got) {
        return new Error(`Data type mismatch: input tensor expects '${expected}', got '${got}'`);
    }
}
/**
 * Loads a TFLiteModel from the given model url.
 *
 * @param model The path to the model (string), or the model content in memory
 *     (ArrayBuffer).
 * @param options Options related to model inference.
 *
 * @doc {heading: 'Models', subheading: 'Loading'}
 */
export async function loadTFLiteModel(model, options) {
    // Handle tfhub links.
    if (typeof model === 'string' && model.includes('tfhub.dev') &&
        model.includes('lite-model') && !model.endsWith(TFHUB_SEARCH_PARAM)) {
        model = `${model}${TFHUB_SEARCH_PARAM}`;
    }
    const tfliteModelRunner = await tfliteWebAPIClient.tfweb.TFLiteWebModelRunner.create(model, options);
    return new TFLiteModel(tfliteModelRunner);
}
/**
 * Returns the compatible tfjs DataType from the given TFLite data type.
 *
 * @param tfliteType The type in TFLite.
 *
 * @doc {heading: 'Models', subheading: 'Utilities'}
 */
export function getDTypeFromTFLiteType(tfliteType) {
    let dtype;
    switch (tfliteType) {
        case 'float32':
        case 'float64':
            dtype = 'float32';
            break;
        case 'int8':
        case 'uint8':
        case 'int16':
        case 'int32':
        case 'uint32':
            dtype = 'int32';
            break;
        case 'bool':
            dtype = 'bool';
            break;
        default:
            break;
    }
    return dtype;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGZsaXRlX21vZGVsLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vdGZqcy10ZmxpdGUvc3JjL3RmbGl0ZV9tb2RlbC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTs7Ozs7Ozs7Ozs7Ozs7O0dBZUc7QUFFSCxPQUFPLEVBQWdGLE1BQU0sRUFBRSxNQUFNLEVBQUMsTUFBTSx1QkFBdUIsQ0FBQztBQUVwSSxPQUFPLEtBQUssa0JBQWtCLE1BQU0seUJBQXlCLENBQUM7QUFHOUQsTUFBTSxrQkFBa0IsR0FBRyxxQkFBcUIsQ0FBQztBQUVqRDs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0EwQkc7QUFDSCxNQUFNLE9BQU8sV0FBVztJQUN0QixZQUE2QixXQUFpQztRQUFqQyxnQkFBVyxHQUFYLFdBQVcsQ0FBc0I7SUFBRyxDQUFDO0lBRWxFLElBQUksTUFBTTtRQUNSLE1BQU0sV0FBVyxHQUFHLElBQUksQ0FBQyxXQUFXLENBQUMsU0FBUyxFQUFFLENBQUM7UUFDakQsT0FBTyxJQUFJLENBQUMsd0JBQXdCLENBQUMsV0FBVyxDQUFDLENBQUM7SUFDcEQsQ0FBQztJQUVELElBQUksT0FBTztRQUNULE1BQU0sWUFBWSxHQUFHLElBQUksQ0FBQyxXQUFXLENBQUMsVUFBVSxFQUFFLENBQUM7UUFDbkQsT0FBTyxJQUFJLENBQUMsd0JBQXdCLENBQUMsWUFBWSxDQUFDLENBQUM7SUFDckQsQ0FBQztJQUVEOzs7Ozs7Ozs7Ozs7Ozs7O09BZ0JHO0lBQ0gsT0FBTyxDQUFDLE1BQXNDLEVBQUUsTUFBMkI7UUFFekUsTUFBTSxXQUFXLEdBQUcsSUFBSSxDQUFDLFdBQVcsQ0FBQyxTQUFTLEVBQUUsQ0FBQztRQUNqRCxNQUFNLFlBQVksR0FBRyxJQUFJLENBQUMsV0FBVyxDQUFDLFVBQVUsRUFBRSxDQUFDO1FBRW5ELDJDQUEyQztRQUUzQyxxQ0FBcUM7UUFDckMsSUFBSSxNQUFNLFlBQVksTUFBTSxJQUFJLEtBQUssQ0FBQyxP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QUFHLE9BQU8sQ0FBQztZQUNoQixNQUFNO1FBQ1IsS0FBSyxNQUFNO1lBQ1QsS0FBSyxHQUFHLE1BQU0sQ0FBQztZQUNmLE1BQU07UUFDUjtZQUNFLE1BQU07S0FDVDtJQUNELE9BQU8sS0FBSyxDQUFDO0FBQ2YsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogQGxpY2Vuc2VcbiAqIENvcHlyaWdodCAyMDIxIEdvb2dsZSBMTEMuIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG4gKiBMaWNlbnNlZCB1bmRlciB0aGUgQXBhY2hlIExpY2Vuc2UsIFZlcnNpb24gMi4wICh0aGUgXCJMaWNlbnNlXCIpO1xuICogeW91IG1heSBub3QgdXNlIHRoaXMgZmlsZSBleGNlcHQgaW4gY29tcGxpYW5jZSB3aXRoIHRoZSBMaWNlbnNlLlxuICogWW91IG1heSBvYnRhaW4gYSBjb3B5IG9mIHRoZSBMaWNlbnNlIGF0XG4gKlxuICogaHR0cDovL3d3dy5hcGFjaGUub3JnL2xpY2Vuc2VzL0xJQ0VOU0UtMi4wXG4gKlxuICogVW5sZXNzIHJlcXVpcmVkIGJ5IGFwcGxpY2FibGUgbGF3IG9yIGFncmVlZCB0byBpbiB3cml0aW5nLCBzb2Z0d2FyZVxuICogZGlzdHJpYnV0ZWQgdW5kZXIgdGhlIExpY2Vuc2UgaXMgZGlzdHJpYnV0ZWQgb24gYW4gXCJBUyBJU1wiIEJBU0lTLFxuICogV0lUSE9VVCBXQVJSQU5USUVTIE9SIENPTkRJVElPTlMgT0YgQU5ZIEtJTkQsIGVpdGhlciBleHByZXNzIG9yIGltcGxpZWQuXG4gKiBTZWUgdGhlIExpY2Vuc2UgZm9yIHRoZSBzcGVjaWZpYyBsYW5ndWFnZSBnb3Zlcm5pbmcgcGVybWlzc2lvbnMgYW5kXG4gKiBsaW1pdGF0aW9ucyB1bmRlciB0aGUgTGljZW5zZS5cbiAqID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gKi9cblxuaW1wb3J0IHtEYXRhVHlwZSwgSW5mZXJlbmNlTW9kZWwsIE1vZGVsUHJlZGljdENvbmZpZywgTW9kZWxUZW5zb3JJbmZvLCBOYW1lZFRlbnNvck1hcCwgdGVuc29yLCBUZW5zb3J9IGZyb20gJ0B0ZW5zb3JmbG93L3RmanMtY29yZSc7XG5cbmltcG9ydCAqIGFzIHRmbGl0ZVdlYkFQSUNsaWVudCBmcm9tICcuL3RmbGl0ZV93ZWJfYXBpX2NsaWVudCc7XG5pbXBvcnQge1Byb2ZpbGVJdGVtLCBURkxpdGVEYXRhVHlwZSwgVEZMaXRlV2ViTW9kZWxSdW5uZXIsIFRGTGl0ZVdlYk1vZGVsUnVubmVyT3B0aW9ucywgVEZMaXRlV2ViTW9kZWxSdW5uZXJUZW5zb3JJbmZvfSBmcm9tICcuL3R5cGVzL3RmbGl0ZV93ZWJfbW9kZWxfcnVubmVyJztcblxuY29uc3QgVEZIVUJfU0VBUkNIX1BBUkFNID0gJz9saXRlLWZvcm1hdD10ZmxpdGUnO1xuXG4vKipcbiAqIEEgYHRmbGl0ZS5URkxpdGVNb2RlbGAgaXMgYnVpbHQgZnJvbSBhIFRGTGl0ZSBtb2RlbCBmbGF0YnVmZmVyIGFuZCBleGVjdXRhYmxlXG4gKiBvbiBURkxpdGUgaW50ZXJwcmV0ZXIuIFRvIGxvYWQgaXQsIHVzZSB0aGUgYGxvYWRURkxpdGVNb2RlbGAgZnVuY3Rpb24gYmVsb3cuXG4gKlxuICogU2FtcGxlIHVzYWdlOlxuICpcbiAqIGBgYGpzXG4gKiAvLyBMb2FkIHRoZSBNb2JpbGVuZXRWMiB0ZmxpdGUgbW9kZWwgZnJvbSB0Zmh1Yi5cbiAqIGNvbnN0IHRmbGl0ZU1vZGVsID0gdGZsaXRlLmxvYWRURkxpdGVNb2RlbChcbiAqICAgICAnaHR0cHM6Ly90Zmh1Yi5kZXYvdGVuc29yZmxvdy9saXRlLW1vZGVsL21vYmlsZW5ldF92Ml8xLjBfMjI0LzEvbWV0YWRhdGEvMScpO1xuICpcbiAqIGNvbnN0IG91dHB1dFRlbnNvciA9IHRmLnRpZHkoKCkgPT4ge1xuICogICAgLy8gR2V0IHBpeGVscyBkYXRhIGZyb20gYW4gaW1hZ2UuXG4gKiAgICBjb25zdCBpbWcgPSB0Zi5icm93c2VyLmZyb21QaXhlbHMoZG9jdW1lbnQucXVlcnlTZWxlY3RvcignaW1nJykpO1xuICogICAgLy8gTm9ybWFsaXplIChtaWdodCBhbHNvIGRvIHJlc2l6ZSBoZXJlIGlmIG5lY2Vzc2FyeSkuXG4gKiAgICBjb25zdCBpbnB1dCA9IHRmLnN1Yih0Zi5kaXYodGYuZXhwYW5kRGltcyhpbWcpLCAxMjcuNSksIDEpO1xuICogICAgLy8gUnVuIHRoZSBpbmZlcmVuY2UuXG4gKiAgICBsZXQgb3V0cHV0VGVuc29yID0gdGZsaXRlTW9kZWwucHJlZGljdChpbnB1dCkgYXMgdGYuVGVuc29yO1xuICogICAgLy8gRGUtbm9ybWFsaXplIHRoZSByZXN1bHQuXG4gKiAgICByZXR1cm4gdGYubXVsKHRmLmFkZChvdXRwdXRUZW5zb3IsIDEpLCAxMjcuNSlcbiAqICB9KTtcbiAqIGNvbnNvbGUubG9nKG91dHB1dFRlbnNvcik7XG4gKlxuICogYGBgXG4gKlxuICogQGRvYyB7aGVhZGluZzogJ01vZGVscycsIHN1YmhlYWRpbmc6ICdDbGFzc2VzJ31cbiAqL1xuZXhwb3J0IGNsYXNzIFRGTGl0ZU1vZGVsIGltcGxlbWVudHMgSW5mZXJlbmNlTW9kZWwge1xuICBjb25zdHJ1Y3Rvcihwcml2YXRlIHJlYWRvbmx5IG1vZGVsUnVubmVyOiBURkxpdGVXZWJNb2RlbFJ1bm5lcikge31cblxuICBnZXQgaW5wdXRzKCk6IE1vZGVsVGVuc29ySW5mb1tdIHtcbiAgICBjb25zdCBtb2RlbElucHV0cyA9IHRoaXMubW9kZWxSdW5uZXIuZ2V0SW5wdXRzKCk7XG4gICAgcmV0dXJuIHRoaXMuY29udmVydFRGTGl0ZVRlbnNvckluZm9zKG1vZGVsSW5wdXRzKTtcbiAgfVxuXG4gIGdldCBvdXRwdXRzKCk6IE1vZGVsVGVuc29ySW5mb1tdIHtcbiAgICBjb25zdCBtb2RlbE91dHB1dHMgPSB0aGlzLm1vZGVsUnVubmVyLmdldE91dHB1dHMoKTtcbiAgICByZXR1cm4gdGhpcy5jb252ZXJ0VEZMaXRlVGVuc29ySW5mb3MobW9kZWxPdXRwdXRzKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBFeGVjdXRlIHRoZSBpbmZlcmVuY2UgZm9yIHRoZSBpbnB1dCB0ZW5zb3JzLlxuICAgKlxuICAgKiBAcGFyYW0gaW5wdXRzIFRoZSBpbnB1dCB0ZW5zb3JzLCB3aGVuIHRoZXJlIGlzIHNpbmdsZSBpbnB1dCBmb3IgdGhlIG1vZGVsLFxuICAgKiAgICAgaW5wdXRzIHBhcmFtIHNob3VsZCBiZSBhIFRlbnNvci4gRm9yIG1vZGVscyB3aXRoIG11bHRpcGxlIGlucHV0cyxcbiAgICogICAgIGlucHV0cyBwYXJhbXMgc2hvdWxkIGJlIGluIGVpdGhlciBUZW5zb3JbXSBpZiB0aGUgaW5wdXQgb3JkZXIgaXMgZml4ZWQsXG4gICAqICAgICBvciBvdGhlcndpc2UgTmFtZWRUZW5zb3JNYXAgZm9ybWF0LlxuICAgKlxuICAgKiBAcGFyYW0gY29uZmlnIFByZWRpY3Rpb24gY29uZmlndXJhdGlvbiBmb3Igc3BlY2lmeWluZyB0aGUgYmF0Y2ggc2l6ZS5cbiAgICogICAgIEN1cnJlbnRseSB0aGlzIGZpZWxkIGlzIG5vdCB1c2VkLCBhbmQgYmF0Y2ggaW5mZXJlbmNlIGlzIG5vdCBzdXBwb3J0ZWQuXG4gICAqXG4gICAqIEByZXR1cm5zIEluZmVyZW5jZSByZXN1bHQgdGVuc29ycy4gVGhlIG91dHB1dCB3b3VsZCBiZSBzaW5nbGUgVGVuc29yIGlmXG4gICAqICAgICBtb2RlbCBoYXMgc2luZ2xlIG91dHB1dCBub2RlLCBvdGhlcndpc2UgTmFtZWRUZW5zb3JNYXAgd2lsbCBiZSByZXR1cm5lZFxuICAgKiAgICAgZm9yIG1vZGVsIHdpdGggbXVsdGlwbGUgb3V0cHV0cy4gVGVuc29yW10gaXMgbm90IHVzZWQuXG4gICAqXG4gICAqIEBkb2Mge2hlYWRpbmc6ICdNb2RlbHMnLCBzdWJoZWFkaW5nOiAnQ2xhc3Nlcyd9XG4gICAqL1xuICBwcmVkaWN0KGlucHV0czogVGVuc29yfFRlbnNvcltdfE5hbWVkVGVuc29yTWFwLCBjb25maWc/OiBNb2RlbFByZWRpY3RDb25maWcpOlxuICAgICAgVGVuc29yfFRlbnNvcltdfE5hbWVkVGVuc29yTWFwIHtcbiAgICBjb25zdCBtb2RlbElucHV0cyA9IHRoaXMubW9kZWxSdW5uZXIuZ2V0SW5wdXRzKCk7XG4gICAgY29uc3QgbW9kZWxPdXRwdXRzID0gdGhpcy5tb2RlbFJ1bm5lci5nZXRPdXRwdXRzKCk7XG5cbiAgICAvLyBTZXQgbW9kZWwgaW5wdXRzIGZyb20gdGhlIGdpdmVuIHRlbnNvcnMuXG5cbiAgICAvLyBBIHNpbmdsZSB0ZW5zb3Igb3IgYSB0ZW5zb3IgYXJyYXkuXG4gICAgaWYgKGlucHV0cyBpbnN0YW5jZW9mIFRlbnNvciB8fCBBcnJheS5pc0FycmF5KGlucHV0cykpIHtcbiAgICAgIGxldCBpbnB1dFRlbnNvcnM6IFRlbnNvcltdO1xuICAgICAgaWYgKGlucHV0cyBpbnN0YW5jZW9mIFRlbnNvcikge1xuICAgICAgICBpbnB1dFRlbnNvcnMgPSBbaW5wdXRzXTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGlucHV0VGVuc29ycyA9IGlucHV0cztcbiAgICAgIH1cbiAgICAgIGlmIChtb2RlbElucHV0cy5sZW5ndGggIT09IGlucHV0VGVuc29ycy5sZW5ndGgpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBUaGUgc2l6ZSBvZiBURkxpdGUgbW9kZWwgaW5wdXRzICgke1xuICAgICAgICAgICAgbW9kZWxJbnB1dHNcbiAgICAgICAgICAgICAgICAubGVuZ3RofSkgZG9lcyBub3QgbWF0Y2ggdGhlIHNpemUgb2YgdGhlIGlucHV0IHRlbnNvcnMgKCR7XG4gICAgICAgICAgICBpbnB1dFRlbnNvcnMubGVuZ3RofSlgKTtcbiAgICAgIH1cbiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgbW9kZWxJbnB1dHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgdGhpcy5zZXRNb2RlbElucHV0RnJvbVRlbnNvcihtb2RlbElucHV0c1tpXSwgaW5wdXRUZW5zb3JzW2ldKTtcbiAgICAgIH1cbiAgICB9XG4gICAgLy8gTmFtZWQgdGVuc29ycy5cbiAgICBlbHNlIHtcbiAgICAgIGNvbnN0IGlucHV0VGVuc29yTmFtZXMgPSBPYmplY3Qua2V5cyhpbnB1dHMpO1xuICAgICAgY29uc3QgbW9kZWxJbnB1dE1hcDpcbiAgICAgICAgICB7W25hbWU6IHN0cmluZ106IFRGTGl0ZVdlYk1vZGVsUnVubmVyVGVuc29ySW5mb30gPSB7fTtcbiAgICAgIG1vZGVsSW5wdXRzLmZvckVhY2gobW9kZWxJbnB1dCA9PiB7XG4gICAgICAgIG1vZGVsSW5wdXRNYXBbbW9kZWxJbnB1dC5uYW1lXSA9IG1vZGVsSW5wdXQ7XG4gICAgICB9KTtcbiAgICAgIGNvbnN0IG1vZGVsSW5wdXROYW1lcyA9IE9iamVjdC5rZXlzKG1vZGVsSW5wdXRNYXApO1xuICAgICAgdGhpcy5jaGVja01hcElucHV0cyhpbnB1dFRlbnNvck5hbWVzLCBtb2RlbElucHV0TmFtZXMpO1xuICAgICAgZm9yIChjb25zdCBuYW1lIG9mIGlucHV0VGVuc29yTmFtZXMpIHtcbiAgICAgICAgdGhpcy5zZXRNb2RlbElucHV0RnJvbVRlbnNvcihtb2RlbElucHV0TWFwW25hbWVdLCBpbnB1dHNbbmFtZV0pO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIFJ1biBpbmZlcmVuY2UuXG4gICAgY29uc3Qgc3VjY2VzcyA9IHRoaXMubW9kZWxSdW5uZXIuaW5mZXIoKTtcbiAgICBpZiAoIXN1Y2Nlc3MpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignRmFpbGVkIHJ1bm5pbmcgaW5mZXJlbmNlJyk7XG4gICAgfVxuXG4gICAgLy8gQ29udmVydCBtb2RlbCBvdXRwdXRzIHRvIHRlbnNvcnMuXG4gICAgY29uc3Qgb3V0cHV0VGVuc29yczogTmFtZWRUZW5zb3JNYXAgPSB7fTtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IG1vZGVsT3V0cHV0cy5sZW5ndGg7IGkrKykge1xuICAgICAgY29uc3QgbW9kZWxPdXRwdXQgPSBtb2RlbE91dHB1dHNbaV07XG4gICAgICBsZXQgZGF0YSA9IG1vZGVsT3V0cHV0LmRhdGEoKTtcblxuICAgICAgLy8gQ29udmVydCBURkxpdGUgdGVuc29yIHR5cGVzIHRoYXQgYXJlIG5vdCBzdXBwb3J0ZWQgYnkgVEZKUyB0b1xuICAgICAgLy8gY29tcGF0aWJsZSB0eXBlcy5cbiAgICAgIHN3aXRjaCAobW9kZWxPdXRwdXQuZGF0YVR5cGUpIHtcbiAgICAgICAgY2FzZSAnaW50OCc6XG4gICAgICAgIGNhc2UgJ2ludDE2JzpcbiAgICAgICAgY2FzZSAndWludDMyJzpcbiAgICAgICAgICBkYXRhID0gSW50MzJBcnJheS5mcm9tKGRhdGEpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlICdmbG9hdDY0JzpcbiAgICAgICAgICBjb25zb2xlLndhcm4oXG4gICAgICAgICAgICAgIGBXQVJOSU5HOiBjb252ZXJ0aW5nIG91dHB1dCB0ZW5zb3IgZnJvbSAnZmxvYXQ2NCcgdG8gJ2Zsb2F0MzInYCk7XG4gICAgICAgICAgZGF0YSA9IEZsb2F0MzJBcnJheS5mcm9tKGRhdGEpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgICAgY29uc3Qgb3V0cHV0VGVuc29yID1cbiAgICAgICAgICB0ZW5zb3IoZGF0YSwgdGhpcy5nZXRTaGFwZUZyb21URkxpdGVUZW5zb3JJbmZvKG1vZGVsT3V0cHV0KSk7XG4gICAgICBvdXRwdXRUZW5zb3JzW21vZGVsT3V0cHV0Lm5hbWVdID0gb3V0cHV0VGVuc29yO1xuICAgIH1cbiAgICBjb25zdCBuYW1lcyA9IE9iamVjdC5rZXlzKG91dHB1dFRlbnNvcnMpO1xuICAgIHJldHVybiBuYW1lcy5sZW5ndGggPT09IDEgPyBvdXRwdXRUZW5zb3JzW25hbWVzWzBdXSA6IG91dHB1dFRlbnNvcnM7XG4gIH1cblxuICAvKipcbiAgICogRXhlY3V0ZSB0aGUgaW5mZXJlbmNlIGZvciB0aGUgaW5wdXQgdGVuc29ycyBhbmQgcmV0dXJuIGFjdGl2YXRpb25cbiAgICogdmFsdWVzIGZvciBzcGVjaWZpZWQgb3V0cHV0IG5vZGUgbmFtZXMgd2l0aG91dCBiYXRjaGluZy5cbiAgICpcbiAgICogQHBhcmFtIGlucHV0cyBUaGUgaW5wdXQgdGVuc29ycywgd2hlbiB0aGVyZSBpcyBzaW5nbGUgaW5wdXQgZm9yIHRoZSBtb2RlbCxcbiAgICogICAgIGlucHV0cyBwYXJhbSBzaG91bGQgYmUgYSBUZW5zb3IuIEZvciBtb2RlbHMgd2l0aCBtdWx0aXBsZSBpbnB1dHMsXG4gICAqICAgICBpbnB1dHMgcGFyYW1zIHNob3VsZCBiZSBpbiBlaXRoZXIgVGVuc29yW10gaWYgdGhlIGlucHV0IG9yZGVyIGlzIGZpeGVkLFxuICAgKiAgICAgb3Igb3RoZXJ3aXNlIE5hbWVkVGVuc29yTWFwIGZvcm1hdC5cbiAgICpcbiAgICogQHBhcmFtIG91dHB1dHMgc3RyaW5nfHN0cmluZ1tdLiBMaXN0IG9mIG91dHB1dCBub2RlIG5hbWVzIHRvIHJldHJpZXZlXG4gICAqICAgICBhY3RpdmF0aW9uIGZyb20uXG4gICAqXG4gICAqIEByZXR1cm5zIEFjdGl2YXRpb24gdmFsdWVzIGZvciB0aGUgb3V0cHV0IG5vZGVzIHJlc3VsdCB0ZW5zb3JzLiBUaGUgcmV0dXJuXG4gICAqICAgICB0eXBlIG1hdGNoZXMgc3BlY2lmaWVkIHBhcmFtZXRlciBvdXRwdXRzIHR5cGUuIFRoZSBvdXRwdXQgd291bGQgYmVcbiAgICogICAgIHNpbmdsZSBUZW5zb3IgaWYgc2luZ2xlIG91dHB1dCBpcyBzcGVjaWZpZWQsIG90aGVyd2lzZSBUZW5zb3JbXSBmb3JcbiAgICogICAgIG11bHRpcGxlIG91dHB1dHMuXG4gICAqL1xuICBleGVjdXRlKGlucHV0czogVGVuc29yfFRlbnNvcltdfE5hbWVkVGVuc29yTWFwLCBvdXRwdXRzOiBzdHJpbmd8c3RyaW5nW10pOlxuICAgICAgVGVuc29yfFRlbnNvcltdIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ2V4ZWN1dGUoKSBvZiBURkxpdGVNb2RlbCBpcyBub3Qgc3VwcG9ydGVkIHlldC4nKTtcbiAgfVxuXG4gIGdldFByb2ZpbGluZ1Jlc3VsdHMoKTogUHJvZmlsZUl0ZW1bXSB7XG4gICAgcmV0dXJuIHRoaXMubW9kZWxSdW5uZXIuZ2V0UHJvZmlsaW5nUmVzdWx0cygpO1xuICB9XG5cbiAgZ2V0UHJvZmlsaW5nU3VtbWFyeSgpOiBzdHJpbmcge1xuICAgIHJldHVybiB0aGlzLm1vZGVsUnVubmVyLmdldFByb2ZpbGluZ1N1bW1hcnkoKTtcbiAgfVxuXG4gIHByaXZhdGUgc2V0TW9kZWxJbnB1dEZyb21UZW5zb3IoXG4gICAgICBtb2RlbElucHV0OiBURkxpdGVXZWJNb2RlbFJ1bm5lclRlbnNvckluZm8sIHRlbnNvcjogVGVuc29yKSB7XG4gICAgLy8gU3RyaW5nIGFuZCBjb21wbGV4IHRlbnNvcnMgYXJlIG5vdCBzdXBwb3J0ZWQuXG4gICAgaWYgKHRlbnNvci5kdHlwZSA9PT0gJ3N0cmluZycgfHwgdGVuc29yLmR0eXBlID09PSAnY29tcGxleDY0Jykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBEYXRhIHR5cGUgJyR7dGVuc29yLmR0eXBlfScgbm90IHN1cHBvcnRlZC5gKTtcbiAgICB9XG5cbiAgICAvLyBDaGVjayBzaGFwZS5cbiAgICAvL1xuICAgIC8vIEF0IHRoaXMgcG9pbnQsIHdlJ3ZlIGFscmVhZHkgY2hlY2tlZCB0aGF0IGlucHV0IHRlbnNvcnMgYW5kIG1vZGVsIGlucHV0c1xuICAgIC8vIGhhdmUgdGhlIHNhbWUgc2l6ZS5cbiAgICBjb25zdCBtb2RlbElucHV0U2hhcGUgPSBtb2RlbElucHV0LnNoYXBlLnNwbGl0KCcsJykubWFwKGRpbSA9PiBOdW1iZXIoZGltKSk7XG4gICAgaWYgKCF0ZW5zb3Iuc2hhcGUuZXZlcnkoXG4gICAgICAgICAgICAoZGltLCBpbmRleCkgPT4gbW9kZWxJbnB1dFNoYXBlW2luZGV4XSA9PT0gLTEgfHxcbiAgICAgICAgICAgICAgICBtb2RlbElucHV0U2hhcGVbaW5kZXhdID09PSBkaW0pKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYElucHV0IHRlbnNvciBzaGFwZSBtaXNtYXRjaDogZXhwZWN0ICcke1xuICAgICAgICAgIG1vZGVsSW5wdXQuc2hhcGV9JywgZ290ICcke3RlbnNvci5zaGFwZS5qb2luKCcsJyl9Jy5gKTtcbiAgICB9XG5cbiAgICAvLyBDaGVjayB0eXBlcy5cbiAgICBzd2l0Y2ggKG1vZGVsSW5wdXQuZGF0YVR5cGUpIHtcbiAgICAgIC8vIEFsbCAnYm9vbCcgYW5kICdpbnQnIHRmbGl0ZSB0eXBlcyBhY2NwZXQgJ2Jvb2wnIG9yICdpbnQzMicgdGZqcyB0eXBlcy5cbiAgICAgIC8vIFdpbGwgdGhyb3cgZXJyb3IgZm9yICdmbG9hdDMyJyB0ZmpzIHR5cGUuXG4gICAgICBjYXNlICdib29sJzpcbiAgICAgIGNhc2UgJ2ludDgnOlxuICAgICAgY2FzZSAndWludDgnOlxuICAgICAgY2FzZSAnaW50MTYnOlxuICAgICAgY2FzZSAndWludDMyJzpcbiAgICAgIGNhc2UgJ2ludDMyJzpcbiAgICAgICAgaWYgKHRlbnNvci5kdHlwZSA9PT0gJ2Zsb2F0MzInKSB7XG4gICAgICAgICAgdGhyb3cgdGhpcy5nZXREYXRhVHlwZU1pc21hdGNoRXJyb3IoXG4gICAgICAgICAgICAgIG1vZGVsSW5wdXQuZGF0YVR5cGUsIHRlbnNvci5kdHlwZSk7XG4gICAgICAgIH0gZWxzZSBpZiAobW9kZWxJbnB1dC5kYXRhVHlwZSAhPT0gdGVuc29yLmR0eXBlKSB7XG4gICAgICAgICAgY29uc29sZS53YXJuKGBXQVJOSU5HOiBjb252ZXJ0aW5nICcke3RlbnNvci5kdHlwZX0nIHRvICcke1xuICAgICAgICAgICAgICBtb2RlbElucHV0LmRhdGFUeXBlfSdgKTtcbiAgICAgICAgfVxuICAgICAgICBicmVhaztcbiAgICAgIC8vIEFsbCAnZmxvYXQnIHRmbGl0ZSB0eXBlcyBhY2NlcHQgYWxsIHRmanMgdHlwZXMuXG4gICAgICBjYXNlICdmbG9hdDMyJzpcbiAgICAgIGNhc2UgJ2Zsb2F0NjQnOlxuICAgICAgICBpZiAobW9kZWxJbnB1dC5kYXRhVHlwZSAhPT0gdGVuc29yLmR0eXBlKSB7XG4gICAgICAgICAgY29uc29sZS53YXJuKGBXQVJOSU5HOiBjb252ZXJ0aW5nICcke3RlbnNvci5kdHlwZX0nIHRvICcke1xuICAgICAgICAgICAgICBtb2RlbElucHV0LmRhdGFUeXBlfSdgKTtcbiAgICAgICAgfVxuICAgICAgICBicmVhaztcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIGJyZWFrO1xuICAgIH1cblxuICAgIGNvbnN0IG1vZGVsSW5wdXRCdWZmZXIgPSBtb2RlbElucHV0LmRhdGEoKTtcbiAgICBzd2l0Y2ggKG1vZGVsSW5wdXQuZGF0YVR5cGUpIHtcbiAgICAgIGNhc2UgJ2ludDgnOlxuICAgICAgICBtb2RlbElucHV0QnVmZmVyLnNldChJbnQ4QXJyYXkuZnJvbSh0ZW5zb3IuZGF0YVN5bmMoKSkpO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ3VpbnQ4JzpcbiAgICAgIGNhc2UgJ2Jvb2wnOlxuICAgICAgICBtb2RlbElucHV0QnVmZmVyLnNldChVaW50OEFycmF5LmZyb20odGVuc29yLmRhdGFTeW5jKCkpKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdpbnQxNic6XG4gICAgICAgIG1vZGVsSW5wdXRCdWZmZXIuc2V0KEludDE2QXJyYXkuZnJvbSh0ZW5zb3IuZGF0YVN5bmMoKSkpO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ2ludDMyJzpcbiAgICAgICAgbW9kZWxJbnB1dEJ1ZmZlci5zZXQoSW50MzJBcnJheS5mcm9tKHRlbnNvci5kYXRhU3luYygpKSk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAndWludDMyJzpcbiAgICAgICAgbW9kZWxJbnB1dEJ1ZmZlci5zZXQoVWludDMyQXJyYXkuZnJvbSh0ZW5zb3IuZGF0YVN5bmMoKSkpO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ2Zsb2F0MzInOlxuICAgICAgICBtb2RlbElucHV0QnVmZmVyLnNldChGbG9hdDMyQXJyYXkuZnJvbSh0ZW5zb3IuZGF0YVN5bmMoKSkpO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ2Zsb2F0NjQnOlxuICAgICAgICBtb2RlbElucHV0QnVmZmVyLnNldChGbG9hdDY0QXJyYXkuZnJvbSh0ZW5zb3IuZGF0YVN5bmMoKSkpO1xuICAgICAgICBicmVhaztcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIGJyZWFrO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgY29udmVydFRGTGl0ZVRlbnNvckluZm9zKGluZm9zOiBURkxpdGVXZWJNb2RlbFJ1bm5lclRlbnNvckluZm9bXSk6XG4gICAgICBNb2RlbFRlbnNvckluZm9bXSB7XG4gICAgcmV0dXJuIGluZm9zLm1hcChpbmZvID0+IHtcbiAgICAgIGNvbnN0IGR0eXBlID0gZ2V0RFR5cGVGcm9tVEZMaXRlVHlwZShpbmZvLmRhdGFUeXBlKTtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIG5hbWU6IGluZm8ubmFtZSxcbiAgICAgICAgc2hhcGU6IHRoaXMuZ2V0U2hhcGVGcm9tVEZMaXRlVGVuc29ySW5mbyhpbmZvKSxcbiAgICAgICAgZHR5cGUsXG4gICAgICB9O1xuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBjaGVja01hcElucHV0cyhcbiAgICAgIGlucHV0VGVuc29yTmFtZXM6IHN0cmluZ1tdLCBtb2RlbElucHV0TmFtZXM6IHN0cmluZ1tdKSB7XG4gICAgY29uc3Qgbm90SW5Nb2RlbCA9XG4gICAgICAgIGlucHV0VGVuc29yTmFtZXMuZmlsdGVyKG5hbWUgPT4gIW1vZGVsSW5wdXROYW1lcy5pbmNsdWRlcyhuYW1lKSk7XG4gICAgY29uc3Qgbm90SW5JbnB1dCA9XG4gICAgICAgIG1vZGVsSW5wdXROYW1lcy5maWx0ZXIobmFtZSA9PiAhaW5wdXRUZW5zb3JOYW1lcy5pbmNsdWRlcyhuYW1lKSk7XG4gICAgaWYgKG5vdEluTW9kZWwubGVuZ3RoID09PSAwICYmIG5vdEluSW5wdXQubGVuZ3RoID09PSAwKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgbXNnUGFydHMgPVxuICAgICAgICBbJ1RoZSBtb2RlbCBpbnB1dCBuYW1lcyBkb25cXCd0IG1hdGNoIHRoZSBtb2RlbCBpbnB1dCBuYW1lcy4nXTtcbiAgICBpZiAobm90SW5Nb2RlbC5sZW5ndGggPiAwKSB7XG4gICAgICBtc2dQYXJ0cy5wdXNoKGBOYW1lcyBpbiBpbnB1dCBidXQgbWlzc2luZyBpbiBtb2RlbDogWyR7bm90SW5Nb2RlbH1dLmApO1xuICAgIH1cbiAgICBpZiAobm90SW5JbnB1dC5sZW5ndGggPiAwKSB7XG4gICAgICBtc2dQYXJ0cy5wdXNoKGBOYW1lcyBpbiBtb2RlbCBidXQgbWlzc2luZyBpbiBpbnB1dHM6IFske25vdEluSW5wdXR9XS5gKTtcbiAgICB9XG4gICAgdGhyb3cgbmV3IEVycm9yKG1zZ1BhcnRzLmpvaW4oJyAnKSk7XG4gIH1cblxuICBwcml2YXRlIGdldFNoYXBlRnJvbVRGTGl0ZVRlbnNvckluZm8oaW5mbzogVEZMaXRlV2ViTW9kZWxSdW5uZXJUZW5zb3JJbmZvKSB7XG4gICAgcmV0dXJuIGluZm8uc2hhcGUuc3BsaXQoJywnKS5tYXAocyA9PiBOdW1iZXIocykpO1xuICB9XG5cbiAgcHJpdmF0ZSBnZXREYXRhVHlwZU1pc21hdGNoRXJyb3IoZXhwZWN0ZWQ6IHN0cmluZywgZ290OiBzdHJpbmcpIHtcbiAgICByZXR1cm4gbmV3IEVycm9yKFxuICAgICAgICBgRGF0YSB0eXBlIG1pc21hdGNoOiBpbnB1dCB0ZW5zb3IgZXhwZWN0cyAnJHtleHBlY3RlZH0nLCBnb3QgJyR7Z290fSdgKTtcbiAgfVxufVxuXG4vKipcbiAqIExvYWRzIGEgVEZMaXRlTW9kZWwgZnJvbSB0aGUgZ2l2ZW4gbW9kZWwgdXJsLlxuICpcbiAqIEBwYXJhbSBtb2RlbCBUaGUgcGF0aCB0byB0aGUgbW9kZWwgKHN0cmluZyksIG9yIHRoZSBtb2RlbCBjb250ZW50IGluIG1lbW9yeVxuICogICAgIChBcnJheUJ1ZmZlcikuXG4gKiBAcGFyYW0gb3B0aW9ucyBPcHRpb25zIHJlbGF0ZWQgdG8gbW9kZWwgaW5mZXJlbmNlLlxuICpcbiAqIEBkb2Mge2hlYWRpbmc6ICdNb2RlbHMnLCBzdWJoZWFkaW5nOiAnTG9hZGluZyd9XG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBsb2FkVEZMaXRlTW9kZWwoXG4gICAgbW9kZWw6IHN0cmluZ3xBcnJheUJ1ZmZlcixcbiAgICBvcHRpb25zPzogVEZMaXRlV2ViTW9kZWxSdW5uZXJPcHRpb25zKTogUHJvbWlzZTxURkxpdGVNb2RlbD4ge1xuICAvLyBIYW5kbGUgdGZodWIgbGlua3MuXG4gIGlmICh0eXBlb2YgbW9kZWwgPT09ICdzdHJpbmcnICYmIG1vZGVsLmluY2x1ZGVzKCd0Zmh1Yi5kZXYnKSAmJlxuICAgICAgbW9kZWwuaW5jbHVkZXMoJ2xpdGUtbW9kZWwnKSAmJiAhbW9kZWwuZW5kc1dpdGgoVEZIVUJfU0VBUkNIX1BBUkFNKSkge1xuICAgIG1vZGVsID0gYCR7bW9kZWx9JHtURkhVQl9TRUFSQ0hfUEFSQU19YDtcbiAgfVxuXG4gIGNvbnN0IHRmbGl0ZU1vZGVsUnVubmVyID1cbiAgICAgIGF3YWl0IHRmbGl0ZVdlYkFQSUNsaWVudC50ZndlYi5URkxpdGVXZWJNb2RlbFJ1bm5lci5jcmVhdGUoXG4gICAgICAgICAgbW9kZWwsIG9wdGlvbnMpO1xuICByZXR1cm4gbmV3IFRGTGl0ZU1vZGVsKHRmbGl0ZU1vZGVsUnVubmVyKTtcbn1cblxuLyoqXG4gKiBSZXR1cm5zIHRoZSBjb21wYXRpYmxlIHRmanMgRGF0YVR5cGUgZnJvbSB0aGUgZ2l2ZW4gVEZMaXRlIGRhdGEgdHlwZS5cbiAqXG4gKiBAcGFyYW0gdGZsaXRlVHlwZSBUaGUgdHlwZSBpbiBURkxpdGUuXG4gKlxuICogQGRvYyB7aGVhZGluZzogJ01vZGVscycsIHN1YmhlYWRpbmc6ICdVdGlsaXRpZXMnfVxuICovXG5leHBvcnQgZnVuY3Rpb24gZ2V0RFR5cGVGcm9tVEZMaXRlVHlwZSh0ZmxpdGVUeXBlOiBURkxpdGVEYXRhVHlwZSk6IERhdGFUeXBlIHtcbiAgbGV0IGR0eXBlOiBEYXRhVHlwZTtcbiAgc3dpdGNoICh0ZmxpdGVUeXBlKSB7XG4gICAgY2FzZSAnZmxvYXQzMic6XG4gICAgY2FzZSAnZmxvYXQ2NCc6XG4gICAgICBkdHlwZSA9ICdmbG9hdDMyJztcbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJ2ludDgnOlxuICAgIGNhc2UgJ3VpbnQ4JzpcbiAgICBjYXNlICdpbnQxNic6XG4gICAgY2FzZSAnaW50MzInOlxuICAgIGNhc2UgJ3VpbnQzMic6XG4gICAgICBkdHlwZSA9ICdpbnQzMic7XG4gICAgICBicmVhaztcbiAgICBjYXNlICdib29sJzpcbiAgICAgIGR0eXBlID0gJ2Jvb2wnO1xuICAgICAgYnJlYWs7XG4gICAgZGVmYXVsdDpcbiAgICAgIGJyZWFrO1xuICB9XG4gIHJldHVybiBkdHlwZTtcbn1cbiJdfQ==