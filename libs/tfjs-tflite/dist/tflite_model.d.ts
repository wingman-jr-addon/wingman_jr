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
/// <amd-module name="@tensorflow/tfjs-tflite/dist/tflite_model" />
import { DataType, InferenceModel, ModelPredictConfig, ModelTensorInfo, NamedTensorMap, Tensor } from '@tensorflow/tfjs-core';
import { ProfileItem, TFLiteDataType, TFLiteWebModelRunner, TFLiteWebModelRunnerOptions } from './types/tflite_web_model_runner';
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
export declare class TFLiteModel implements InferenceModel {
    private readonly modelRunner;
    constructor(modelRunner: TFLiteWebModelRunner);
    readonly inputs: ModelTensorInfo[];
    readonly outputs: ModelTensorInfo[];
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
    predict(inputs: Tensor | Tensor[] | NamedTensorMap, config?: ModelPredictConfig): Tensor | Tensor[] | NamedTensorMap;
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
    execute(inputs: Tensor | Tensor[] | NamedTensorMap, outputs: string | string[]): Tensor | Tensor[];
    getProfilingResults(): ProfileItem[];
    getProfilingSummary(): string;
    private setModelInputFromTensor;
    private convertTFLiteTensorInfos;
    private checkMapInputs;
    private getShapeFromTFLiteTensorInfo;
    private getDataTypeMismatchError;
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
export declare function loadTFLiteModel(model: string | ArrayBuffer, options?: TFLiteWebModelRunnerOptions): Promise<TFLiteModel>;
/**
 * Returns the compatible tfjs DataType from the given TFLite data type.
 *
 * @param tfliteType The type in TFLite.
 *
 * @doc {heading: 'Models', subheading: 'Utilities'}
 */
export declare function getDTypeFromTFLiteType(tfliteType: TFLiteDataType): DataType;
