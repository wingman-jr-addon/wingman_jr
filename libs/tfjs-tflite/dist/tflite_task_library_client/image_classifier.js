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
import * as tfliteWebAPIClient from '../tflite_web_api_client';
import { BaseTaskLibraryClient, convertProtoClassesToClasses, getDefaultNumThreads } from './common';
/**
 * Client for ImageClassifier TFLite Task Library.
 *
 * It is a wrapper around the underlying javascript API to make it more
 * convenient to use. See comments in the corresponding type declaration file in
 * src/types for more info.
 */
export class ImageClassifier extends BaseTaskLibraryClient {
    constructor(instance) {
        super(instance);
        this.instance = instance;
    }
    static async create(model, options) {
        const optionsProto = new tfliteWebAPIClient.tfweb.ImageClassifierOptions();
        if (options) {
            if (options.maxResults !== undefined) {
                optionsProto.setMaxResults(options.maxResults);
            }
            if (options.scoreThreshold !== undefined) {
                optionsProto.setScoreThreshold(options.scoreThreshold);
            }
            if (options.numThreads !== undefined) {
                optionsProto.setNumThreads(options.numThreads);
            }
        }
        if (!options || options.numThreads === undefined) {
            optionsProto.setNumThreads(await getDefaultNumThreads());
        }
        const instance = await tfliteWebAPIClient.tfweb.ImageClassifier.create(model, optionsProto);
        return new ImageClassifier(instance);
    }
    classify(input) {
        const result = this.instance.classify(input);
        if (!result) {
            return [];
        }
        let classes = [];
        if (result.getClassificationsList().length > 0) {
            classes = convertProtoClassesToClasses(result.getClassificationsList()[0].getClassesList());
        }
        return classes;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW1hZ2VfY2xhc3NpZmllci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uLy4uL3RmanMtdGZsaXRlL3NyYy90ZmxpdGVfdGFza19saWJyYXJ5X2NsaWVudC9pbWFnZV9jbGFzc2lmaWVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBOzs7Ozs7Ozs7Ozs7Ozs7R0FlRztBQUVILE9BQU8sS0FBSyxrQkFBa0IsTUFBTSwwQkFBMEIsQ0FBQztBQUcvRCxPQUFPLEVBQUMscUJBQXFCLEVBQW1DLDRCQUE0QixFQUFFLG9CQUFvQixFQUFDLE1BQU0sVUFBVSxDQUFDO0FBaUJwSTs7Ozs7O0dBTUc7QUFDSCxNQUFNLE9BQU8sZUFBZ0IsU0FBUSxxQkFBcUI7SUFDeEQsWUFBc0IsUUFBb0M7UUFDeEQsS0FBSyxDQUFDLFFBQVEsQ0FBQyxDQUFDO1FBREksYUFBUSxHQUFSLFFBQVEsQ0FBNEI7SUFFMUQsQ0FBQztJQUVELE1BQU0sQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUNmLEtBQXlCLEVBQ3pCLE9BQWdDO1FBQ2xDLE1BQU0sWUFBWSxHQUFHLElBQUksa0JBQWtCLENBQUMsS0FBSyxDQUFDLHNCQUFzQixFQUFFLENBQUM7UUFDM0UsSUFBSSxPQUFPLEVBQUU7WUFDWCxJQUFJLE9BQU8sQ0FBQyxVQUFVLEtBQUssU0FBUyxFQUFFO2dCQUNwQyxZQUFZLENBQUMsYUFBYSxDQUFDLE9BQU8sQ0FBQyxVQUFVLENBQUMsQ0FBQzthQUNoRDtZQUNELElBQUksT0FBTyxDQUFDLGNBQWMsS0FBSyxTQUFTLEVBQUU7Z0JBQ3hDLFlBQVksQ0FBQyxpQkFBaUIsQ0FBQyxPQUFPLENBQUMsY0FBYyxDQUFDLENBQUM7YUFDeEQ7WUFDRCxJQUFJLE9BQU8sQ0FBQyxVQUFVLEtBQUssU0FBUyxFQUFFO2dCQUNwQyxZQUFZLENBQUMsYUFBYSxDQUFDLE9BQU8sQ0FBQyxVQUFVLENBQUMsQ0FBQzthQUNoRDtTQUNGO1FBQ0QsSUFBSSxDQUFDLE9BQU8sSUFBSSxPQUFPLENBQUMsVUFBVSxLQUFLLFNBQVMsRUFBRTtZQUNoRCxZQUFZLENBQUMsYUFBYSxDQUFDLE1BQU0sb0JBQW9CLEVBQUUsQ0FBQyxDQUFDO1NBQzFEO1FBQ0QsTUFBTSxRQUFRLEdBQUcsTUFBTSxrQkFBa0IsQ0FBQyxLQUFLLENBQUMsZUFBZSxDQUFDLE1BQU0sQ0FDbEUsS0FBSyxFQUFFLFlBQVksQ0FBQyxDQUFDO1FBQ3pCLE9BQU8sSUFBSSxlQUFlLENBQUMsUUFBUSxDQUFDLENBQUM7SUFDdkMsQ0FBQztJQUVELFFBQVEsQ0FBQyxLQUNnQjtRQUN2QixNQUFNLE1BQU0sR0FBRyxJQUFJLENBQUMsUUFBUSxDQUFDLFFBQVEsQ0FBQyxLQUFLLENBQUMsQ0FBQztRQUM3QyxJQUFJLENBQUMsTUFBTSxFQUFFO1lBQ1gsT0FBTyxFQUFFLENBQUM7U0FDWDtRQUVELElBQUksT0FBTyxHQUFZLEVBQUUsQ0FBQztRQUMxQixJQUFJLE1BQU0sQ0FBQyxzQkFBc0IsRUFBRSxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUU7WUFDOUMsT0FBTyxHQUFHLDRCQUE0QixDQUNsQyxNQUFNLENBQUMsc0JBQXNCLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxjQUFjLEVBQUUsQ0FBQyxDQUFDO1NBQzFEO1FBQ0QsT0FBTyxPQUFPLENBQUM7SUFDakIsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBAbGljZW5zZVxuICogQ29weXJpZ2h0IDIwMjEgR29vZ2xlIExMQy4gQWxsIFJpZ2h0cyBSZXNlcnZlZC5cbiAqIExpY2Vuc2VkIHVuZGVyIHRoZSBBcGFjaGUgTGljZW5zZSwgVmVyc2lvbiAyLjAgKHRoZSBcIkxpY2Vuc2VcIik7XG4gKiB5b3UgbWF5IG5vdCB1c2UgdGhpcyBmaWxlIGV4Y2VwdCBpbiBjb21wbGlhbmNlIHdpdGggdGhlIExpY2Vuc2UuXG4gKiBZb3UgbWF5IG9idGFpbiBhIGNvcHkgb2YgdGhlIExpY2Vuc2UgYXRcbiAqXG4gKiBodHRwOi8vd3d3LmFwYWNoZS5vcmcvbGljZW5zZXMvTElDRU5TRS0yLjBcbiAqXG4gKiBVbmxlc3MgcmVxdWlyZWQgYnkgYXBwbGljYWJsZSBsYXcgb3IgYWdyZWVkIHRvIGluIHdyaXRpbmcsIHNvZnR3YXJlXG4gKiBkaXN0cmlidXRlZCB1bmRlciB0aGUgTGljZW5zZSBpcyBkaXN0cmlidXRlZCBvbiBhbiBcIkFTIElTXCIgQkFTSVMsXG4gKiBXSVRIT1VUIFdBUlJBTlRJRVMgT1IgQ09ORElUSU9OUyBPRiBBTlkgS0lORCwgZWl0aGVyIGV4cHJlc3Mgb3IgaW1wbGllZC5cbiAqIFNlZSB0aGUgTGljZW5zZSBmb3IgdGhlIHNwZWNpZmljIGxhbmd1YWdlIGdvdmVybmluZyBwZXJtaXNzaW9ucyBhbmRcbiAqIGxpbWl0YXRpb25zIHVuZGVyIHRoZSBMaWNlbnNlLlxuICogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAqL1xuXG5pbXBvcnQgKiBhcyB0ZmxpdGVXZWJBUElDbGllbnQgZnJvbSAnLi4vdGZsaXRlX3dlYl9hcGlfY2xpZW50JztcbmltcG9ydCB7SW1hZ2VDbGFzc2lmaWVyIGFzIFRhc2tMaWJyYXJ5SW1hZ2VDbGFzc2lmaWVyfSBmcm9tICcuLi90eXBlcy9pbWFnZV9jbGFzc2lmaWVyJztcblxuaW1wb3J0IHtCYXNlVGFza0xpYnJhcnlDbGllbnQsIENsYXNzLCBDb21tb25UYXNrTGlicmFyeU9wdGlvbnMsIGNvbnZlcnRQcm90b0NsYXNzZXNUb0NsYXNzZXMsIGdldERlZmF1bHROdW1UaHJlYWRzfSBmcm9tICcuL2NvbW1vbic7XG5cbi8qKiBJbWFnZUNsYXNzaWZpZXIgb3B0aW9ucy4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgSW1hZ2VDbGFzc2lmaWVyT3B0aW9ucyBleHRlbmRzIENvbW1vblRhc2tMaWJyYXJ5T3B0aW9ucyB7XG4gIC8qKlxuICAgKiBNYXhpbXVtIG51bWJlciBvZiB0b3Agc2NvcmVkIHJlc3VsdHMgdG8gcmV0dXJuLiBJZiA8IDAsIGFsbCByZXN1bHRzIHdpbGxcbiAgICogYmUgcmV0dXJuZWQuIElmIDAsIGFuIGludmFsaWQgYXJndW1lbnQgZXJyb3IgaXMgcmV0dXJuZWQuXG4gICAqL1xuICBtYXhSZXN1bHRzPzogbnVtYmVyO1xuXG4gIC8qKlxuICAgKiBTY29yZSB0aHJlc2hvbGQgaW4gWzAsMSksIG92ZXJyaWRlcyB0aGUgb25lcyBwcm92aWRlZCBpbiB0aGUgbW9kZWwgbWV0YWRhdGFcbiAgICogKGlmIGFueSkuIFJlc3VsdHMgYmVsb3cgdGhpcyB2YWx1ZSBhcmUgcmVqZWN0ZWQuXG4gICAqL1xuICBzY29yZVRocmVzaG9sZD86IG51bWJlcjtcbn1cblxuLyoqXG4gKiBDbGllbnQgZm9yIEltYWdlQ2xhc3NpZmllciBURkxpdGUgVGFzayBMaWJyYXJ5LlxuICpcbiAqIEl0IGlzIGEgd3JhcHBlciBhcm91bmQgdGhlIHVuZGVybHlpbmcgamF2YXNjcmlwdCBBUEkgdG8gbWFrZSBpdCBtb3JlXG4gKiBjb252ZW5pZW50IHRvIHVzZS4gU2VlIGNvbW1lbnRzIGluIHRoZSBjb3JyZXNwb25kaW5nIHR5cGUgZGVjbGFyYXRpb24gZmlsZSBpblxuICogc3JjL3R5cGVzIGZvciBtb3JlIGluZm8uXG4gKi9cbmV4cG9ydCBjbGFzcyBJbWFnZUNsYXNzaWZpZXIgZXh0ZW5kcyBCYXNlVGFza0xpYnJhcnlDbGllbnQge1xuICBjb25zdHJ1Y3Rvcihwcm90ZWN0ZWQgaW5zdGFuY2U6IFRhc2tMaWJyYXJ5SW1hZ2VDbGFzc2lmaWVyKSB7XG4gICAgc3VwZXIoaW5zdGFuY2UpO1xuICB9XG5cbiAgc3RhdGljIGFzeW5jIGNyZWF0ZShcbiAgICAgIG1vZGVsOiBzdHJpbmd8QXJyYXlCdWZmZXIsXG4gICAgICBvcHRpb25zPzogSW1hZ2VDbGFzc2lmaWVyT3B0aW9ucyk6IFByb21pc2U8SW1hZ2VDbGFzc2lmaWVyPiB7XG4gICAgY29uc3Qgb3B0aW9uc1Byb3RvID0gbmV3IHRmbGl0ZVdlYkFQSUNsaWVudC50ZndlYi5JbWFnZUNsYXNzaWZpZXJPcHRpb25zKCk7XG4gICAgaWYgKG9wdGlvbnMpIHtcbiAgICAgIGlmIChvcHRpb25zLm1heFJlc3VsdHMgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBvcHRpb25zUHJvdG8uc2V0TWF4UmVzdWx0cyhvcHRpb25zLm1heFJlc3VsdHMpO1xuICAgICAgfVxuICAgICAgaWYgKG9wdGlvbnMuc2NvcmVUaHJlc2hvbGQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBvcHRpb25zUHJvdG8uc2V0U2NvcmVUaHJlc2hvbGQob3B0aW9ucy5zY29yZVRocmVzaG9sZCk7XG4gICAgICB9XG4gICAgICBpZiAob3B0aW9ucy5udW1UaHJlYWRzICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgb3B0aW9uc1Byb3RvLnNldE51bVRocmVhZHMob3B0aW9ucy5udW1UaHJlYWRzKTtcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKCFvcHRpb25zIHx8IG9wdGlvbnMubnVtVGhyZWFkcyA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICBvcHRpb25zUHJvdG8uc2V0TnVtVGhyZWFkcyhhd2FpdCBnZXREZWZhdWx0TnVtVGhyZWFkcygpKTtcbiAgICB9XG4gICAgY29uc3QgaW5zdGFuY2UgPSBhd2FpdCB0ZmxpdGVXZWJBUElDbGllbnQudGZ3ZWIuSW1hZ2VDbGFzc2lmaWVyLmNyZWF0ZShcbiAgICAgICAgbW9kZWwsIG9wdGlvbnNQcm90byk7XG4gICAgcmV0dXJuIG5ldyBJbWFnZUNsYXNzaWZpZXIoaW5zdGFuY2UpO1xuICB9XG5cbiAgY2xhc3NpZnkoaW5wdXQ6IEltYWdlRGF0YXxIVE1MSW1hZ2VFbGVtZW50fEhUTUxDYW52YXNFbGVtZW50fFxuICAgICAgICAgICBIVE1MVmlkZW9FbGVtZW50KTogQ2xhc3NbXSB7XG4gICAgY29uc3QgcmVzdWx0ID0gdGhpcy5pbnN0YW5jZS5jbGFzc2lmeShpbnB1dCk7XG4gICAgaWYgKCFyZXN1bHQpIHtcbiAgICAgIHJldHVybiBbXTtcbiAgICB9XG5cbiAgICBsZXQgY2xhc3NlczogQ2xhc3NbXSA9IFtdO1xuICAgIGlmIChyZXN1bHQuZ2V0Q2xhc3NpZmljYXRpb25zTGlzdCgpLmxlbmd0aCA+IDApIHtcbiAgICAgIGNsYXNzZXMgPSBjb252ZXJ0UHJvdG9DbGFzc2VzVG9DbGFzc2VzKFxuICAgICAgICAgIHJlc3VsdC5nZXRDbGFzc2lmaWNhdGlvbnNMaXN0KClbMF0uZ2V0Q2xhc3Nlc0xpc3QoKSk7XG4gICAgfVxuICAgIHJldHVybiBjbGFzc2VzO1xuICB9XG59XG4iXX0=