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
/// <amd-module name="@tensorflow/tfjs-tflite/dist/tflite_task_library_client/image_classifier" />
import { ImageClassifier as TaskLibraryImageClassifier } from '../types/image_classifier';
import { BaseTaskLibraryClient, Class, CommonTaskLibraryOptions } from './common';
/** ImageClassifier options. */
export interface ImageClassifierOptions extends CommonTaskLibraryOptions {
    /**
     * Maximum number of top scored results to return. If < 0, all results will
     * be returned. If 0, an invalid argument error is returned.
     */
    maxResults?: number;
    /**
     * Score threshold in [0,1), overrides the ones provided in the model metadata
     * (if any). Results below this value are rejected.
     */
    scoreThreshold?: number;
}
/**
 * Client for ImageClassifier TFLite Task Library.
 *
 * It is a wrapper around the underlying javascript API to make it more
 * convenient to use. See comments in the corresponding type declaration file in
 * src/types for more info.
 */
export declare class ImageClassifier extends BaseTaskLibraryClient {
    protected instance: TaskLibraryImageClassifier;
    constructor(instance: TaskLibraryImageClassifier);
    static create(model: string | ArrayBuffer, options?: ImageClassifierOptions): Promise<ImageClassifier>;
    classify(input: ImageData | HTMLImageElement | HTMLCanvasElement | HTMLVideoElement): Class[];
}
