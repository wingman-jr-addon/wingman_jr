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
import { BaseTaskLibraryClient } from './common';
/**
 * Client for BertQA TFLite Task Library.
 *
 * It is a wrapper around the underlying javascript API to make it more
 * convenient to use. See comments in the corresponding type declaration file in
 * src/types for more info.
 */
export class BertQuestionAnswerer extends BaseTaskLibraryClient {
    constructor(instance) {
        super(instance);
        this.instance = instance;
    }
    static async create(model) {
        const instance = await tfliteWebAPIClient.tfweb.BertQuestionAnswerer.create(model);
        return new BertQuestionAnswerer(instance);
    }
    answer(context, question) {
        const result = this.instance.answer(context, question);
        if (!result) {
            return [];
        }
        return result.map(answer => {
            return {
                text: answer.text,
                pos: answer.pos,
            };
        });
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmVydF9xYS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uLy4uL3RmanMtdGZsaXRlL3NyYy90ZmxpdGVfdGFza19saWJyYXJ5X2NsaWVudC9iZXJ0X3FhLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBOzs7Ozs7Ozs7Ozs7Ozs7R0FlRztBQUVILE9BQU8sS0FBSyxrQkFBa0IsTUFBTSwwQkFBMEIsQ0FBQztBQUUvRCxPQUFPLEVBQUMscUJBQXFCLEVBQUMsTUFBTSxVQUFVLENBQUM7QUFvQi9DOzs7Ozs7R0FNRztBQUNILE1BQU0sT0FBTyxvQkFBcUIsU0FBUSxxQkFBcUI7SUFDN0QsWUFBc0IsUUFBeUM7UUFDN0QsS0FBSyxDQUFDLFFBQVEsQ0FBQyxDQUFDO1FBREksYUFBUSxHQUFSLFFBQVEsQ0FBaUM7SUFFL0QsQ0FBQztJQUVELE1BQU0sQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLEtBQ1c7UUFDN0IsTUFBTSxRQUFRLEdBQ1YsTUFBTSxrQkFBa0IsQ0FBQyxLQUFLLENBQUMsb0JBQW9CLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDO1FBQ3RFLE9BQU8sSUFBSSxvQkFBb0IsQ0FBQyxRQUFRLENBQUMsQ0FBQztJQUM1QyxDQUFDO0lBRUQsTUFBTSxDQUFDLE9BQWUsRUFBRSxRQUFnQjtRQUN0QyxNQUFNLE1BQU0sR0FBRyxJQUFJLENBQUMsUUFBUSxDQUFDLE1BQU0sQ0FBQyxPQUFPLEVBQUUsUUFBUSxDQUFDLENBQUM7UUFDdkQsSUFBSSxDQUFDLE1BQU0sRUFBRTtZQUNYLE9BQU8sRUFBRSxDQUFDO1NBQ1g7UUFFRCxPQUFPLE1BQU0sQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDLEVBQUU7WUFDekIsT0FBTztnQkFDTCxJQUFJLEVBQUUsTUFBTSxDQUFDLElBQUk7Z0JBQ2pCLEdBQUcsRUFBRSxNQUFNLENBQUMsR0FBRzthQUNoQixDQUFDO1FBQ0osQ0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIEBsaWNlbnNlXG4gKiBDb3B5cmlnaHQgMjAyMSBHb29nbGUgTExDLiBBbGwgUmlnaHRzIFJlc2VydmVkLlxuICogTGljZW5zZWQgdW5kZXIgdGhlIEFwYWNoZSBMaWNlbnNlLCBWZXJzaW9uIDIuMCAodGhlIFwiTGljZW5zZVwiKTtcbiAqIHlvdSBtYXkgbm90IHVzZSB0aGlzIGZpbGUgZXhjZXB0IGluIGNvbXBsaWFuY2Ugd2l0aCB0aGUgTGljZW5zZS5cbiAqIFlvdSBtYXkgb2J0YWluIGEgY29weSBvZiB0aGUgTGljZW5zZSBhdFxuICpcbiAqIGh0dHA6Ly93d3cuYXBhY2hlLm9yZy9saWNlbnNlcy9MSUNFTlNFLTIuMFxuICpcbiAqIFVubGVzcyByZXF1aXJlZCBieSBhcHBsaWNhYmxlIGxhdyBvciBhZ3JlZWQgdG8gaW4gd3JpdGluZywgc29mdHdhcmVcbiAqIGRpc3RyaWJ1dGVkIHVuZGVyIHRoZSBMaWNlbnNlIGlzIGRpc3RyaWJ1dGVkIG9uIGFuIFwiQVMgSVNcIiBCQVNJUyxcbiAqIFdJVEhPVVQgV0FSUkFOVElFUyBPUiBDT05ESVRJT05TIE9GIEFOWSBLSU5ELCBlaXRoZXIgZXhwcmVzcyBvciBpbXBsaWVkLlxuICogU2VlIHRoZSBMaWNlbnNlIGZvciB0aGUgc3BlY2lmaWMgbGFuZ3VhZ2UgZ292ZXJuaW5nIHBlcm1pc3Npb25zIGFuZFxuICogbGltaXRhdGlvbnMgdW5kZXIgdGhlIExpY2Vuc2UuXG4gKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICovXG5cbmltcG9ydCAqIGFzIHRmbGl0ZVdlYkFQSUNsaWVudCBmcm9tICcuLi90ZmxpdGVfd2ViX2FwaV9jbGllbnQnO1xuaW1wb3J0IHtCZXJ0UXVlc3Rpb25BbnN3ZXJlciBhcyBUYXNrTGlicmFyeUJlcnRRdWVzdGlvbkFuc3dlcmVyfSBmcm9tICcuLi90eXBlcy9iZXJ0X3FhJztcbmltcG9ydCB7QmFzZVRhc2tMaWJyYXJ5Q2xpZW50fSBmcm9tICcuL2NvbW1vbic7XG5cbi8qKiBBIHNpbmdsZSBhbnN3ZXIuICovXG5leHBvcnQgaW50ZXJmYWNlIFFhQW5zd2VyIHtcbiAgLyoqIFRoZSB0ZXh0IG9mIHRoZSBhbnN3ZXIuICovXG4gIHRleHQ6IHN0cmluZztcbiAgLyoqIFRoZSBwb3NpdGlvbiBhbmQgbG9naXQgb2YgdGhlIGFuc3dlci4gKi9cbiAgcG9zOiBQb3M7XG59XG5cbi8qKiBBbnN3ZXIgcG9zaXRpb24uICovXG5leHBvcnQgaW50ZXJmYWNlIFBvcyB7XG4gIC8qKiBUaGUgc3RhcnQgcG9zaXRpb24uICovXG4gIHN0YXJ0OiBudW1iZXI7XG4gIC8qKiBUaGUgZW5kIHBvc2l0aW9uLiAqL1xuICBlbmQ6IG51bWJlcjtcbiAgLyoqIFRoZSBsb2dpdC4gKi9cbiAgbG9naXQ6IG51bWJlcjtcbn1cblxuLyoqXG4gKiBDbGllbnQgZm9yIEJlcnRRQSBURkxpdGUgVGFzayBMaWJyYXJ5LlxuICpcbiAqIEl0IGlzIGEgd3JhcHBlciBhcm91bmQgdGhlIHVuZGVybHlpbmcgamF2YXNjcmlwdCBBUEkgdG8gbWFrZSBpdCBtb3JlXG4gKiBjb252ZW5pZW50IHRvIHVzZS4gU2VlIGNvbW1lbnRzIGluIHRoZSBjb3JyZXNwb25kaW5nIHR5cGUgZGVjbGFyYXRpb24gZmlsZSBpblxuICogc3JjL3R5cGVzIGZvciBtb3JlIGluZm8uXG4gKi9cbmV4cG9ydCBjbGFzcyBCZXJ0UXVlc3Rpb25BbnN3ZXJlciBleHRlbmRzIEJhc2VUYXNrTGlicmFyeUNsaWVudCB7XG4gIGNvbnN0cnVjdG9yKHByb3RlY3RlZCBpbnN0YW5jZTogVGFza0xpYnJhcnlCZXJ0UXVlc3Rpb25BbnN3ZXJlcikge1xuICAgIHN1cGVyKGluc3RhbmNlKTtcbiAgfVxuXG4gIHN0YXRpYyBhc3luYyBjcmVhdGUobW9kZWw6IHN0cmluZ3xcbiAgICAgICAgICAgICAgICAgICAgICBBcnJheUJ1ZmZlcik6IFByb21pc2U8QmVydFF1ZXN0aW9uQW5zd2VyZXI+IHtcbiAgICBjb25zdCBpbnN0YW5jZSA9XG4gICAgICAgIGF3YWl0IHRmbGl0ZVdlYkFQSUNsaWVudC50ZndlYi5CZXJ0UXVlc3Rpb25BbnN3ZXJlci5jcmVhdGUobW9kZWwpO1xuICAgIHJldHVybiBuZXcgQmVydFF1ZXN0aW9uQW5zd2VyZXIoaW5zdGFuY2UpO1xuICB9XG5cbiAgYW5zd2VyKGNvbnRleHQ6IHN0cmluZywgcXVlc3Rpb246IHN0cmluZyk6IFFhQW5zd2VyW10ge1xuICAgIGNvbnN0IHJlc3VsdCA9IHRoaXMuaW5zdGFuY2UuYW5zd2VyKGNvbnRleHQsIHF1ZXN0aW9uKTtcbiAgICBpZiAoIXJlc3VsdCkge1xuICAgICAgcmV0dXJuIFtdO1xuICAgIH1cblxuICAgIHJldHVybiByZXN1bHQubWFwKGFuc3dlciA9PiB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICB0ZXh0OiBhbnN3ZXIudGV4dCxcbiAgICAgICAgcG9zOiBhbnN3ZXIucG9zLFxuICAgICAgfTtcbiAgICB9KTtcbiAgfVxufVxuIl19