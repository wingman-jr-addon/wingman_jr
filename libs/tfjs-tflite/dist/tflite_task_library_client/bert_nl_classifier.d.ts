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
/// <amd-module name="@tensorflow/tfjs-tflite/dist/tflite_task_library_client/bert_nl_classifier" />
import { BertNLClassifier as TaskLibraryBertNLClassifier } from '../types/bert_nl_classifier';
import { BaseTaskLibraryClient, Class } from './common';
export interface BertNLClassifierOptions {
    /**
     * Max number of tokens to pass to the model.
     *
     * Default to 128.
     */
    maxSeqLen?: number;
}
/**
 * Client for BertNLClassifier TFLite Task Library.
 *
 * It is a wrapper around the underlying javascript API to make it more
 * convenient to use. See comments in the corresponding type declaration file in
 * src/types for more info.
 */
export declare class BertNLClassifier extends BaseTaskLibraryClient {
    protected instance: TaskLibraryBertNLClassifier;
    constructor(instance: TaskLibraryBertNLClassifier);
    static create(model: string | ArrayBuffer, options?: BertNLClassifierOptions): Promise<BertNLClassifier>;
    classify(input: string): Class[];
}
