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
 * Client for ObjectDetector TFLite Task Library.
 *
 * It is a wrapper around the underlying javascript API to make it more
 * convenient to use. See comments in the corresponding type declaration file in
 * src/types for more info.
 */
export class ObjectDetector extends BaseTaskLibraryClient {
    constructor(instance) {
        super(instance);
        this.instance = instance;
    }
    static async create(model, options) {
        const optionsProto = new tfliteWebAPIClient.tfweb.ObjectDetectorOptions();
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
        const instance = await tfliteWebAPIClient.tfweb.ObjectDetector.create(model, optionsProto);
        return new ObjectDetector(instance);
    }
    detect(input) {
        const result = this.instance.detect(input);
        if (!result) {
            return [];
        }
        const detections = [];
        if (result.getDetectionsList().length > 0) {
            result.getDetectionsList().forEach(detection => {
                const boundingBoxProto = detection.getBoundingBox();
                const boundingBox = {
                    originX: boundingBoxProto.getOriginX(),
                    originY: boundingBoxProto.getOriginY(),
                    width: boundingBoxProto.getWidth(),
                    height: boundingBoxProto.getHeight(),
                };
                const classes = convertProtoClassesToClasses(detection.getClassesList());
                detections.push({ boundingBox, classes });
            });
        }
        return detections;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoib2JqZWN0X2RldGVjdG9yLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vLi4vdGZqcy10ZmxpdGUvc3JjL3RmbGl0ZV90YXNrX2xpYnJhcnlfY2xpZW50L29iamVjdF9kZXRlY3Rvci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTs7Ozs7Ozs7Ozs7Ozs7O0dBZUc7QUFFSCxPQUFPLEtBQUssa0JBQWtCLE1BQU0sMEJBQTBCLENBQUM7QUFFL0QsT0FBTyxFQUFDLHFCQUFxQixFQUFtQyw0QkFBNEIsRUFBRSxvQkFBb0IsRUFBQyxNQUFNLFVBQVUsQ0FBQztBQStCcEk7Ozs7OztHQU1HO0FBQ0gsTUFBTSxPQUFPLGNBQWUsU0FBUSxxQkFBcUI7SUFDdkQsWUFBc0IsUUFBbUM7UUFDdkQsS0FBSyxDQUFDLFFBQVEsQ0FBQyxDQUFDO1FBREksYUFBUSxHQUFSLFFBQVEsQ0FBMkI7SUFFekQsQ0FBQztJQUVELE1BQU0sQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUNmLEtBQXlCLEVBQ3pCLE9BQStCO1FBQ2pDLE1BQU0sWUFBWSxHQUFHLElBQUksa0JBQWtCLENBQUMsS0FBSyxDQUFDLHFCQUFxQixFQUFFLENBQUM7UUFDMUUsSUFBSSxPQUFPLEVBQUU7WUFDWCxJQUFJLE9BQU8sQ0FBQyxVQUFVLEtBQUssU0FBUyxFQUFFO2dCQUNwQyxZQUFZLENBQUMsYUFBYSxDQUFDLE9BQU8sQ0FBQyxVQUFVLENBQUMsQ0FBQzthQUNoRDtZQUNELElBQUksT0FBTyxDQUFDLGNBQWMsS0FBSyxTQUFTLEVBQUU7Z0JBQ3hDLFlBQVksQ0FBQyxpQkFBaUIsQ0FBQyxPQUFPLENBQUMsY0FBYyxDQUFDLENBQUM7YUFDeEQ7WUFDRCxJQUFJLE9BQU8sQ0FBQyxVQUFVLEtBQUssU0FBUyxFQUFFO2dCQUNwQyxZQUFZLENBQUMsYUFBYSxDQUFDLE9BQU8sQ0FBQyxVQUFVLENBQUMsQ0FBQzthQUNoRDtTQUNGO1FBQ0QsSUFBSSxDQUFDLE9BQU8sSUFBSSxPQUFPLENBQUMsVUFBVSxLQUFLLFNBQVMsRUFBRTtZQUNoRCxZQUFZLENBQUMsYUFBYSxDQUFDLE1BQU0sb0JBQW9CLEVBQUUsQ0FBQyxDQUFDO1NBQzFEO1FBQ0QsTUFBTSxRQUFRLEdBQUcsTUFBTSxrQkFBa0IsQ0FBQyxLQUFLLENBQUMsY0FBYyxDQUFDLE1BQU0sQ0FDakUsS0FBSyxFQUFFLFlBQVksQ0FBQyxDQUFDO1FBQ3pCLE9BQU8sSUFBSSxjQUFjLENBQUMsUUFBUSxDQUFDLENBQUM7SUFDdEMsQ0FBQztJQUVELE1BQU0sQ0FBQyxLQUNnQjtRQUNyQixNQUFNLE1BQU0sR0FBRyxJQUFJLENBQUMsUUFBUSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQztRQUMzQyxJQUFJLENBQUMsTUFBTSxFQUFFO1lBQ1gsT0FBTyxFQUFFLENBQUM7U0FDWDtRQUVELE1BQU0sVUFBVSxHQUFnQixFQUFFLENBQUM7UUFDbkMsSUFBSSxNQUFNLENBQUMsaUJBQWlCLEVBQUUsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFO1lBQ3pDLE1BQU0sQ0FBQyxpQkFBaUIsRUFBRSxDQUFDLE9BQU8sQ0FBQyxTQUFTLENBQUMsRUFBRTtnQkFDN0MsTUFBTSxnQkFBZ0IsR0FBRyxTQUFTLENBQUMsY0FBYyxFQUFFLENBQUM7Z0JBQ3BELE1BQU0sV0FBVyxHQUFnQjtvQkFDL0IsT0FBTyxFQUFFLGdCQUFnQixDQUFDLFVBQVUsRUFBRTtvQkFDdEMsT0FBTyxFQUFFLGdCQUFnQixDQUFDLFVBQVUsRUFBRTtvQkFDdEMsS0FBSyxFQUFFLGdCQUFnQixDQUFDLFFBQVEsRUFBRTtvQkFDbEMsTUFBTSxFQUFFLGdCQUFnQixDQUFDLFNBQVMsRUFBRTtpQkFDckMsQ0FBQztnQkFDRixNQUFNLE9BQU8sR0FDVCw0QkFBNEIsQ0FBQyxTQUFTLENBQUMsY0FBYyxFQUFFLENBQUMsQ0FBQztnQkFDN0QsVUFBVSxDQUFDLElBQUksQ0FBQyxFQUFDLFdBQVcsRUFBRSxPQUFPLEVBQUMsQ0FBQyxDQUFDO1lBQzFDLENBQUMsQ0FBQyxDQUFDO1NBQ0o7UUFDRCxPQUFPLFVBQVUsQ0FBQztJQUNwQixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIEBsaWNlbnNlXG4gKiBDb3B5cmlnaHQgMjAyMSBHb29nbGUgTExDLiBBbGwgUmlnaHRzIFJlc2VydmVkLlxuICogTGljZW5zZWQgdW5kZXIgdGhlIEFwYWNoZSBMaWNlbnNlLCBWZXJzaW9uIDIuMCAodGhlIFwiTGljZW5zZVwiKTtcbiAqIHlvdSBtYXkgbm90IHVzZSB0aGlzIGZpbGUgZXhjZXB0IGluIGNvbXBsaWFuY2Ugd2l0aCB0aGUgTGljZW5zZS5cbiAqIFlvdSBtYXkgb2J0YWluIGEgY29weSBvZiB0aGUgTGljZW5zZSBhdFxuICpcbiAqIGh0dHA6Ly93d3cuYXBhY2hlLm9yZy9saWNlbnNlcy9MSUNFTlNFLTIuMFxuICpcbiAqIFVubGVzcyByZXF1aXJlZCBieSBhcHBsaWNhYmxlIGxhdyBvciBhZ3JlZWQgdG8gaW4gd3JpdGluZywgc29mdHdhcmVcbiAqIGRpc3RyaWJ1dGVkIHVuZGVyIHRoZSBMaWNlbnNlIGlzIGRpc3RyaWJ1dGVkIG9uIGFuIFwiQVMgSVNcIiBCQVNJUyxcbiAqIFdJVEhPVVQgV0FSUkFOVElFUyBPUiBDT05ESVRJT05TIE9GIEFOWSBLSU5ELCBlaXRoZXIgZXhwcmVzcyBvciBpbXBsaWVkLlxuICogU2VlIHRoZSBMaWNlbnNlIGZvciB0aGUgc3BlY2lmaWMgbGFuZ3VhZ2UgZ292ZXJuaW5nIHBlcm1pc3Npb25zIGFuZFxuICogbGltaXRhdGlvbnMgdW5kZXIgdGhlIExpY2Vuc2UuXG4gKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICovXG5cbmltcG9ydCAqIGFzIHRmbGl0ZVdlYkFQSUNsaWVudCBmcm9tICcuLi90ZmxpdGVfd2ViX2FwaV9jbGllbnQnO1xuaW1wb3J0IHtPYmplY3REZXRlY3RvciBhcyBUYXNrTGlicmFyeU9iamVjdERldGVjdG9yfSBmcm9tICcuLi90eXBlcy9vYmplY3RfZGV0ZWN0b3InO1xuaW1wb3J0IHtCYXNlVGFza0xpYnJhcnlDbGllbnQsIENsYXNzLCBDb21tb25UYXNrTGlicmFyeU9wdGlvbnMsIGNvbnZlcnRQcm90b0NsYXNzZXNUb0NsYXNzZXMsIGdldERlZmF1bHROdW1UaHJlYWRzfSBmcm9tICcuL2NvbW1vbic7XG5cbi8qKiBPYmplY3REZXRlY3RvciBvcHRpb25zLiAqL1xuZXhwb3J0IGludGVyZmFjZSBPYmplY3REZXRlY3Rvck9wdGlvbnMgZXh0ZW5kcyBDb21tb25UYXNrTGlicmFyeU9wdGlvbnMge1xuICAvKipcbiAgICogTWF4aW11bSBudW1iZXIgb2YgdG9wIHNjb3JlZCByZXN1bHRzIHRvIHJldHVybi4gSWYgPCAwLCBhbGwgcmVzdWx0cyB3aWxsXG4gICAqIGJlIHJldHVybmVkLiBJZiAwLCBhbiBpbnZhbGlkIGFyZ3VtZW50IGVycm9yIGlzIHJldHVybmVkLlxuICAgKi9cbiAgbWF4UmVzdWx0cz86IG51bWJlcjtcblxuICAvKipcbiAgICogU2NvcmUgdGhyZXNob2xkIGluIFswLDEpLCBvdmVycmlkZXMgdGhlIG9uZXMgcHJvdmlkZWQgaW4gdGhlIG1vZGVsIG1ldGFkYXRhXG4gICAqIChpZiBhbnkpLiBSZXN1bHRzIGJlbG93IHRoaXMgdmFsdWUgYXJlIHJlamVjdGVkLlxuICAgKi9cbiAgc2NvcmVUaHJlc2hvbGQ/OiBudW1iZXI7XG59XG5cbi8qKiBBIHNpbmdsZSBkZXRlY3RlZCBvYmplY3QgaW4gdGhlIHJlc3VsdC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgRGV0ZWN0aW9uIHtcbiAgYm91bmRpbmdCb3g6IEJvdW5kaW5nQm94O1xuICBjbGFzc2VzOiBDbGFzc1tdO1xufVxuXG4vKiogQSBib3VuZGluZyBib3ggZm9yIHRoZSBkZXRlY3RlZCBvYmplY3QuICovXG5leHBvcnQgaW50ZXJmYWNlIEJvdW5kaW5nQm94IHtcbiAgb3JpZ2luWDogbnVtYmVyO1xuICBvcmlnaW5ZOiBudW1iZXI7XG4gIHdpZHRoOiBudW1iZXI7XG4gIGhlaWdodDogbnVtYmVyO1xufVxuXG4vKipcbiAqIENsaWVudCBmb3IgT2JqZWN0RGV0ZWN0b3IgVEZMaXRlIFRhc2sgTGlicmFyeS5cbiAqXG4gKiBJdCBpcyBhIHdyYXBwZXIgYXJvdW5kIHRoZSB1bmRlcmx5aW5nIGphdmFzY3JpcHQgQVBJIHRvIG1ha2UgaXQgbW9yZVxuICogY29udmVuaWVudCB0byB1c2UuIFNlZSBjb21tZW50cyBpbiB0aGUgY29ycmVzcG9uZGluZyB0eXBlIGRlY2xhcmF0aW9uIGZpbGUgaW5cbiAqIHNyYy90eXBlcyBmb3IgbW9yZSBpbmZvLlxuICovXG5leHBvcnQgY2xhc3MgT2JqZWN0RGV0ZWN0b3IgZXh0ZW5kcyBCYXNlVGFza0xpYnJhcnlDbGllbnQge1xuICBjb25zdHJ1Y3Rvcihwcm90ZWN0ZWQgaW5zdGFuY2U6IFRhc2tMaWJyYXJ5T2JqZWN0RGV0ZWN0b3IpIHtcbiAgICBzdXBlcihpbnN0YW5jZSk7XG4gIH1cblxuICBzdGF0aWMgYXN5bmMgY3JlYXRlKFxuICAgICAgbW9kZWw6IHN0cmluZ3xBcnJheUJ1ZmZlcixcbiAgICAgIG9wdGlvbnM/OiBPYmplY3REZXRlY3Rvck9wdGlvbnMpOiBQcm9taXNlPE9iamVjdERldGVjdG9yPiB7XG4gICAgY29uc3Qgb3B0aW9uc1Byb3RvID0gbmV3IHRmbGl0ZVdlYkFQSUNsaWVudC50ZndlYi5PYmplY3REZXRlY3Rvck9wdGlvbnMoKTtcbiAgICBpZiAob3B0aW9ucykge1xuICAgICAgaWYgKG9wdGlvbnMubWF4UmVzdWx0cyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIG9wdGlvbnNQcm90by5zZXRNYXhSZXN1bHRzKG9wdGlvbnMubWF4UmVzdWx0cyk7XG4gICAgICB9XG4gICAgICBpZiAob3B0aW9ucy5zY29yZVRocmVzaG9sZCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIG9wdGlvbnNQcm90by5zZXRTY29yZVRocmVzaG9sZChvcHRpb25zLnNjb3JlVGhyZXNob2xkKTtcbiAgICAgIH1cbiAgICAgIGlmIChvcHRpb25zLm51bVRocmVhZHMgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBvcHRpb25zUHJvdG8uc2V0TnVtVGhyZWFkcyhvcHRpb25zLm51bVRocmVhZHMpO1xuICAgICAgfVxuICAgIH1cbiAgICBpZiAoIW9wdGlvbnMgfHwgb3B0aW9ucy5udW1UaHJlYWRzID09PSB1bmRlZmluZWQpIHtcbiAgICAgIG9wdGlvbnNQcm90by5zZXROdW1UaHJlYWRzKGF3YWl0IGdldERlZmF1bHROdW1UaHJlYWRzKCkpO1xuICAgIH1cbiAgICBjb25zdCBpbnN0YW5jZSA9IGF3YWl0IHRmbGl0ZVdlYkFQSUNsaWVudC50ZndlYi5PYmplY3REZXRlY3Rvci5jcmVhdGUoXG4gICAgICAgIG1vZGVsLCBvcHRpb25zUHJvdG8pO1xuICAgIHJldHVybiBuZXcgT2JqZWN0RGV0ZWN0b3IoaW5zdGFuY2UpO1xuICB9XG5cbiAgZGV0ZWN0KGlucHV0OiBJbWFnZURhdGF8SFRNTEltYWdlRWxlbWVudHxIVE1MQ2FudmFzRWxlbWVudHxcbiAgICAgICAgIEhUTUxWaWRlb0VsZW1lbnQpOiBEZXRlY3Rpb25bXSB7XG4gICAgY29uc3QgcmVzdWx0ID0gdGhpcy5pbnN0YW5jZS5kZXRlY3QoaW5wdXQpO1xuICAgIGlmICghcmVzdWx0KSB7XG4gICAgICByZXR1cm4gW107XG4gICAgfVxuXG4gICAgY29uc3QgZGV0ZWN0aW9uczogRGV0ZWN0aW9uW10gPSBbXTtcbiAgICBpZiAocmVzdWx0LmdldERldGVjdGlvbnNMaXN0KCkubGVuZ3RoID4gMCkge1xuICAgICAgcmVzdWx0LmdldERldGVjdGlvbnNMaXN0KCkuZm9yRWFjaChkZXRlY3Rpb24gPT4ge1xuICAgICAgICBjb25zdCBib3VuZGluZ0JveFByb3RvID0gZGV0ZWN0aW9uLmdldEJvdW5kaW5nQm94KCk7XG4gICAgICAgIGNvbnN0IGJvdW5kaW5nQm94OiBCb3VuZGluZ0JveCA9IHtcbiAgICAgICAgICBvcmlnaW5YOiBib3VuZGluZ0JveFByb3RvLmdldE9yaWdpblgoKSxcbiAgICAgICAgICBvcmlnaW5ZOiBib3VuZGluZ0JveFByb3RvLmdldE9yaWdpblkoKSxcbiAgICAgICAgICB3aWR0aDogYm91bmRpbmdCb3hQcm90by5nZXRXaWR0aCgpLFxuICAgICAgICAgIGhlaWdodDogYm91bmRpbmdCb3hQcm90by5nZXRIZWlnaHQoKSxcbiAgICAgICAgfTtcbiAgICAgICAgY29uc3QgY2xhc3NlcyA9XG4gICAgICAgICAgICBjb252ZXJ0UHJvdG9DbGFzc2VzVG9DbGFzc2VzKGRldGVjdGlvbi5nZXRDbGFzc2VzTGlzdCgpKTtcbiAgICAgICAgZGV0ZWN0aW9ucy5wdXNoKHtib3VuZGluZ0JveCwgY2xhc3Nlc30pO1xuICAgICAgfSk7XG4gICAgfVxuICAgIHJldHVybiBkZXRlY3Rpb25zO1xuICB9XG59XG4iXX0=