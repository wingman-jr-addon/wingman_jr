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
 * Client for BertNLClassifier TFLite Task Library.
 *
 * It is a wrapper around the underlying javascript API to make it more
 * convenient to use. See comments in the corresponding type declaration file in
 * src/types for more info.
 */
export class BertNLClassifier extends BaseTaskLibraryClient {
    constructor(instance) {
        super(instance);
        this.instance = instance;
    }
    static async create(model, options) {
        const protoOptions = new tfliteWebAPIClient.tfweb.BertNLClassifierOptions();
        if (options) {
            if (options.maxSeqLen) {
                protoOptions.setMaxSeqLen(options.maxSeqLen);
            }
        }
        const instance = await tfliteWebAPIClient.tfweb.BertNLClassifier.create(model, protoOptions);
        return new BertNLClassifier(instance);
    }
    classify(input) {
        return this.instance.classify(input).map(category => {
            return {
                probability: category.score,
                className: category.className,
            };
        });
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmVydF9ubF9jbGFzc2lmaWVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vLi4vdGZqcy10ZmxpdGUvc3JjL3RmbGl0ZV90YXNrX2xpYnJhcnlfY2xpZW50L2JlcnRfbmxfY2xhc3NpZmllci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTs7Ozs7Ozs7Ozs7Ozs7O0dBZUc7QUFFSCxPQUFPLEtBQUssa0JBQWtCLE1BQU0sMEJBQTBCLENBQUM7QUFFL0QsT0FBTyxFQUFDLHFCQUFxQixFQUFRLE1BQU0sVUFBVSxDQUFDO0FBV3REOzs7Ozs7R0FNRztBQUNILE1BQU0sT0FBTyxnQkFBaUIsU0FBUSxxQkFBcUI7SUFDekQsWUFBc0IsUUFBcUM7UUFDekQsS0FBSyxDQUFDLFFBQVEsQ0FBQyxDQUFDO1FBREksYUFBUSxHQUFSLFFBQVEsQ0FBNkI7SUFFM0QsQ0FBQztJQUVELE1BQU0sQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUNmLEtBQXlCLEVBQ3pCLE9BQWlDO1FBQ25DLE1BQU0sWUFBWSxHQUFHLElBQUksa0JBQWtCLENBQUMsS0FBSyxDQUFDLHVCQUF1QixFQUFFLENBQUM7UUFDNUUsSUFBSSxPQUFPLEVBQUU7WUFDWCxJQUFJLE9BQU8sQ0FBQyxTQUFTLEVBQUU7Z0JBQ3JCLFlBQVksQ0FBQyxZQUFZLENBQUMsT0FBTyxDQUFDLFNBQVMsQ0FBQyxDQUFDO2FBQzlDO1NBQ0Y7UUFDRCxNQUFNLFFBQVEsR0FBRyxNQUFNLGtCQUFrQixDQUFDLEtBQUssQ0FBQyxnQkFBZ0IsQ0FBQyxNQUFNLENBQ25FLEtBQUssRUFBRSxZQUFZLENBQUMsQ0FBQztRQUN6QixPQUFPLElBQUksZ0JBQWdCLENBQUMsUUFBUSxDQUFDLENBQUM7SUFDeEMsQ0FBQztJQUVELFFBQVEsQ0FBQyxLQUFhO1FBQ3BCLE9BQU8sSUFBSSxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUMsS0FBSyxDQUFDLENBQUMsR0FBRyxDQUFDLFFBQVEsQ0FBQyxFQUFFO1lBQ2xELE9BQU87Z0JBQ0wsV0FBVyxFQUFFLFFBQVEsQ0FBQyxLQUFLO2dCQUMzQixTQUFTLEVBQUUsUUFBUSxDQUFDLFNBQVM7YUFDOUIsQ0FBQztRQUNKLENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBAbGljZW5zZVxuICogQ29weXJpZ2h0IDIwMjEgR29vZ2xlIExMQy4gQWxsIFJpZ2h0cyBSZXNlcnZlZC5cbiAqIExpY2Vuc2VkIHVuZGVyIHRoZSBBcGFjaGUgTGljZW5zZSwgVmVyc2lvbiAyLjAgKHRoZSBcIkxpY2Vuc2VcIik7XG4gKiB5b3UgbWF5IG5vdCB1c2UgdGhpcyBmaWxlIGV4Y2VwdCBpbiBjb21wbGlhbmNlIHdpdGggdGhlIExpY2Vuc2UuXG4gKiBZb3UgbWF5IG9idGFpbiBhIGNvcHkgb2YgdGhlIExpY2Vuc2UgYXRcbiAqXG4gKiBodHRwOi8vd3d3LmFwYWNoZS5vcmcvbGljZW5zZXMvTElDRU5TRS0yLjBcbiAqXG4gKiBVbmxlc3MgcmVxdWlyZWQgYnkgYXBwbGljYWJsZSBsYXcgb3IgYWdyZWVkIHRvIGluIHdyaXRpbmcsIHNvZnR3YXJlXG4gKiBkaXN0cmlidXRlZCB1bmRlciB0aGUgTGljZW5zZSBpcyBkaXN0cmlidXRlZCBvbiBhbiBcIkFTIElTXCIgQkFTSVMsXG4gKiBXSVRIT1VUIFdBUlJBTlRJRVMgT1IgQ09ORElUSU9OUyBPRiBBTlkgS0lORCwgZWl0aGVyIGV4cHJlc3Mgb3IgaW1wbGllZC5cbiAqIFNlZSB0aGUgTGljZW5zZSBmb3IgdGhlIHNwZWNpZmljIGxhbmd1YWdlIGdvdmVybmluZyBwZXJtaXNzaW9ucyBhbmRcbiAqIGxpbWl0YXRpb25zIHVuZGVyIHRoZSBMaWNlbnNlLlxuICogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAqL1xuXG5pbXBvcnQgKiBhcyB0ZmxpdGVXZWJBUElDbGllbnQgZnJvbSAnLi4vdGZsaXRlX3dlYl9hcGlfY2xpZW50JztcbmltcG9ydCB7QmVydE5MQ2xhc3NpZmllciBhcyBUYXNrTGlicmFyeUJlcnROTENsYXNzaWZpZXJ9IGZyb20gJy4uL3R5cGVzL2JlcnRfbmxfY2xhc3NpZmllcic7XG5pbXBvcnQge0Jhc2VUYXNrTGlicmFyeUNsaWVudCwgQ2xhc3N9IGZyb20gJy4vY29tbW9uJztcblxuZXhwb3J0IGludGVyZmFjZSBCZXJ0TkxDbGFzc2lmaWVyT3B0aW9ucyB7XG4gIC8qKlxuICAgKiBNYXggbnVtYmVyIG9mIHRva2VucyB0byBwYXNzIHRvIHRoZSBtb2RlbC5cbiAgICpcbiAgICogRGVmYXVsdCB0byAxMjguXG4gICAqL1xuICBtYXhTZXFMZW4/OiBudW1iZXI7XG59XG5cbi8qKlxuICogQ2xpZW50IGZvciBCZXJ0TkxDbGFzc2lmaWVyIFRGTGl0ZSBUYXNrIExpYnJhcnkuXG4gKlxuICogSXQgaXMgYSB3cmFwcGVyIGFyb3VuZCB0aGUgdW5kZXJseWluZyBqYXZhc2NyaXB0IEFQSSB0byBtYWtlIGl0IG1vcmVcbiAqIGNvbnZlbmllbnQgdG8gdXNlLiBTZWUgY29tbWVudHMgaW4gdGhlIGNvcnJlc3BvbmRpbmcgdHlwZSBkZWNsYXJhdGlvbiBmaWxlIGluXG4gKiBzcmMvdHlwZXMgZm9yIG1vcmUgaW5mby5cbiAqL1xuZXhwb3J0IGNsYXNzIEJlcnROTENsYXNzaWZpZXIgZXh0ZW5kcyBCYXNlVGFza0xpYnJhcnlDbGllbnQge1xuICBjb25zdHJ1Y3Rvcihwcm90ZWN0ZWQgaW5zdGFuY2U6IFRhc2tMaWJyYXJ5QmVydE5MQ2xhc3NpZmllcikge1xuICAgIHN1cGVyKGluc3RhbmNlKTtcbiAgfVxuXG4gIHN0YXRpYyBhc3luYyBjcmVhdGUoXG4gICAgICBtb2RlbDogc3RyaW5nfEFycmF5QnVmZmVyLFxuICAgICAgb3B0aW9ucz86IEJlcnROTENsYXNzaWZpZXJPcHRpb25zKTogUHJvbWlzZTxCZXJ0TkxDbGFzc2lmaWVyPiB7XG4gICAgY29uc3QgcHJvdG9PcHRpb25zID0gbmV3IHRmbGl0ZVdlYkFQSUNsaWVudC50ZndlYi5CZXJ0TkxDbGFzc2lmaWVyT3B0aW9ucygpO1xuICAgIGlmIChvcHRpb25zKSB7XG4gICAgICBpZiAob3B0aW9ucy5tYXhTZXFMZW4pIHtcbiAgICAgICAgcHJvdG9PcHRpb25zLnNldE1heFNlcUxlbihvcHRpb25zLm1heFNlcUxlbik7XG4gICAgICB9XG4gICAgfVxuICAgIGNvbnN0IGluc3RhbmNlID0gYXdhaXQgdGZsaXRlV2ViQVBJQ2xpZW50LnRmd2ViLkJlcnROTENsYXNzaWZpZXIuY3JlYXRlKFxuICAgICAgICBtb2RlbCwgcHJvdG9PcHRpb25zKTtcbiAgICByZXR1cm4gbmV3IEJlcnROTENsYXNzaWZpZXIoaW5zdGFuY2UpO1xuICB9XG5cbiAgY2xhc3NpZnkoaW5wdXQ6IHN0cmluZyk6IENsYXNzW10ge1xuICAgIHJldHVybiB0aGlzLmluc3RhbmNlLmNsYXNzaWZ5KGlucHV0KS5tYXAoY2F0ZWdvcnkgPT4ge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgcHJvYmFiaWxpdHk6IGNhdGVnb3J5LnNjb3JlLFxuICAgICAgICBjbGFzc05hbWU6IGNhdGVnb3J5LmNsYXNzTmFtZSxcbiAgICAgIH07XG4gICAgfSk7XG4gIH1cbn1cbiJdfQ==