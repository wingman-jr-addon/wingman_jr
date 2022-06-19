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
/// <amd-module name="@tensorflow/tfjs-tflite/dist/tflite_task_library_client/common" />
import { BaseTaskLibrary, Class as ProtoClass } from '../types/common';
/** Common options for all task library tasks. */
export interface CommonTaskLibraryOptions {
    /**
     * The number of threads to be used for TFLite ops that support
     * multi-threading when running inference with CPU. num_threads should be
     * greater than 0 or equal to -1. Setting num_threads to -1 has the effect to
     * let TFLite runtime set the value.
     *
     * Default to number of physical CPU cores, or -1 if WASM multi-threading is
     * not supported by user's browser.
     */
    numThreads?: number;
}
/** A single class in the classification result. */
export interface Class {
    /** The name of the class. */
    className: string;
    /** The probability/score of the class. */
    probability: number;
}
/** Convert proto Class array to our own Class array. */
export declare function convertProtoClassesToClasses(protoClasses: ProtoClass[]): Class[];
/** The global function to set WASM path. */
export declare const setWasmPath: (path: string) => void;
/** The global function to get supported WASM features */
export declare const getWasmFeatures: () => Promise<import("@tensorflow/tfjs-tflite/dist/types/common").WasmFeatures>;
/** The base class for all task library clients. */
export declare class BaseTaskLibraryClient {
    protected instance: BaseTaskLibrary;
    constructor(instance: BaseTaskLibrary);
    cleanUp(): void;
}
/** Gets the number of threads for best performance. */
export declare function getDefaultNumThreads(): Promise<number>;
