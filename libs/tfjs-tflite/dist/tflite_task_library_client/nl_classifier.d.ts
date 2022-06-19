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
/// <amd-module name="@tensorflow/tfjs-tflite/dist/tflite_task_library_client/nl_classifier" />
import { NLClassifier as TaskLibraryNLClassifier } from '../types/nl_classifier';
import { BaseTaskLibraryClient, Class } from './common';
/**
 * NLClassifier options.
 */
export declare interface NLClassifierOptions {
    /** Index of the input tensor. */
    inputTensorIndex: number;
    /** Index of the output score tensor. */
    outputScoreTensorIndex: number;
    /** Index of the output label tensor. */
    outputLabelTensorIndex: number;
    /** Name of the input tensor. */
    inputTensorName: string;
    /** Name of the output score tensor. */
    outputScoreTensorName: string;
    /** Name of the output label tensor. */
    outputLabelTensorName: string;
}
/**
 * Client for NLClassifier TFLite Task Library.
 *
 * It is a wrapper around the underlying javascript API to make it more
 * convenient to use. See comments in the corresponding type declaration file in
 * src/types for more info.
 */
export declare class NLClassifier extends BaseTaskLibraryClient {
    protected instance: TaskLibraryNLClassifier;
    constructor(instance: TaskLibraryNLClassifier);
    static create(model: string | ArrayBuffer, options?: NLClassifierOptions): Promise<NLClassifier>;
    classify(input: string): Class[] | undefined;
}
