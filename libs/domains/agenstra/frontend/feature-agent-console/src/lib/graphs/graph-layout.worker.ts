/**
 * Web Worker of the graph viewer: runs layout and index jobs off the main thread (see `graph-compute.ts`).
 */
import { runGraphJob, type GraphJobRequest } from './graph-compute';

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<GraphJobRequest>) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
};

scope.onmessage = (event) => {
  void runGraphJob(event.data, (response, transfer) => scope.postMessage(response, transfer));
};
