/**
 * Layout / index jobs of the viewer and their transport: a Web Worker when available (nothing heavy runs on the main
 * thread), else the same code inline in time slices (tests, environments without workers). The worker entry
 * (`graph-layout.worker.ts`) only forwards messages to {@link runGraphJob}.
 */
import { prepareLayout, type GraphTopology, type LayoutJobInput } from './graph-engine';
import { buildSceneIndex, sceneIndexBuffers, type IndexInput, type SceneIndex } from './graph-index';

/** Fresh layouts of at least this many nodes also publish their seeded (community star) positions right away. */
export const SEED_PREVIEW_MIN_NODES = 5000;
const PROGRESS_INTERVAL_MS = 250;
/** Milliseconds of inline work per animation frame (fallback without workers). */
const INLINE_FRAME_BUDGET_MS = 12;

export interface LayoutRequest {
  kind: 'layout';
  job: number;
  input: LayoutJobInput;
  /** Drawn subset for the index built with the result (`null`: every node). */
  mask: Uint8Array | null;
}

export interface IndexRequest {
  kind: 'index';
  job: number;
  input: IndexInput;
}

export type GraphJobRequest = LayoutRequest | IndexRequest;

export interface LayoutResult {
  positions: Float32Array;
  topology: GraphTopology;
  index: SceneIndex;
}

export type GraphJobResponse =
  | ({ kind: 'seeded'; job: number } & LayoutResult)
  | { kind: 'progress'; job: number; progress: number }
  | ({ kind: 'layout'; job: number } & LayoutResult)
  | { kind: 'index'; job: number; index: SceneIndex }
  | { kind: 'error'; job: number; message: string };

type Post = (response: GraphJobResponse, transfer: ArrayBuffer[]) => void;

function topologyBuffers(topology: GraphTopology): ArrayBuffer[] {
  return [
    topology.adjacencyStart,
    topology.adjacency,
    topology.degree,
    topology.radius,
    topology.edgeOffset,
    topology.incidentStart,
    topology.incident,
  ].map((array) => array.buffer as ArrayBuffer);
}

function cloneTopology(topology: GraphTopology): GraphTopology {
  return {
    adjacencyStart: topology.adjacencyStart.slice(),
    adjacency: topology.adjacency.slice(),
    degree: topology.degree.slice(),
    radius: topology.radius.slice(),
    edgeOffset: topology.edgeOffset.slice(),
    incidentStart: topology.incidentStart.slice(),
    incident: topology.incident.slice(),
  };
}

function indexInput(input: LayoutJobInput, topology: GraphTopology, positions: Float32Array, mask: Uint8Array | null) {
  return {
    count: input.count,
    positions,
    mask,
    types: input.types,
    typeTotal: input.typeNames.length,
    degree: topology.degree,
    radius: topology.radius,
    edgeSource: input.edgeSource,
    edgeTarget: input.edgeTarget,
  };
}

/**
 * Runs one job to completion (worker side). `yieldControl` lets the inline fallback pause between force steps;
 * `cancelled` stops it.
 */
export async function runGraphJob(
  request: GraphJobRequest,
  post: Post,
  yieldControl: () => Promise<void> = () => Promise.resolve(),
  cancelled: () => boolean = () => false,
): Promise<void> {
  try {
    if (request.kind === 'index') {
      const index = buildSceneIndex(request.input);

      post({ kind: 'index', job: request.job, index }, sceneIndexBuffers(index));

      return;
    }

    const { input, mask, job } = request;
    const { topology, positions, engine, fresh } = prepareLayout(input);

    if (fresh && input.count >= SEED_PREVIEW_MIN_NODES && !engine.done) {
      const seeded = positions.slice();
      const index = buildSceneIndex(indexInput(input, topology, seeded, mask));
      const copy = cloneTopology(topology);

      post({ kind: 'seeded', job, positions: seeded, topology: copy, index }, [
        seeded.buffer as ArrayBuffer,
        ...topologyBuffers(copy),
        ...sceneIndexBuffers(index),
      ]);
    }

    let lastProgress = performance.now();
    let sliceStart = performance.now();

    while (!engine.step(1)) {
      if (cancelled()) {
        return;
      }

      const now = performance.now();

      if (now - lastProgress > PROGRESS_INTERVAL_MS) {
        lastProgress = now;
        post({ kind: 'progress', job, progress: engine.progress }, []);
      }

      if (now - sliceStart > INLINE_FRAME_BUDGET_MS) {
        await yieldControl();
        sliceStart = performance.now();
      }
    }

    if (cancelled()) {
      return;
    }

    const index = buildSceneIndex(indexInput(input, topology, positions, mask));

    post({ kind: 'layout', job, positions, topology, index }, [
      positions.buffer as ArrayBuffer,
      ...topologyBuffers(topology),
      ...sceneIndexBuffers(index),
    ]);
  } catch (error) {
    post({ kind: 'error', job: request.job, message: error instanceof Error ? error.message : String(error) }, []);
  }
}

export type WorkerFactory = () => Worker;

/**
 * One job slot (latest wins): a new request terminates the running one. Uses a dedicated worker per slot (layout and
 * index jobs never wait for each other), recreated after a termination.
 */
export class GraphJobSlot {
  private worker: Worker | null = null;
  private job = 0;
  private running = false;
  private inlineCancel: (() => void) | null = null;

  constructor(
    private readonly factory: WorkerFactory | null,
    private readonly onResponse: (response: GraphJobResponse) => void,
  ) {}

  get busy(): boolean {
    return this.running;
  }

  /** Starts a job (cancelling a running one); returns its id. */
  run(request: Omit<LayoutRequest, 'job'> | Omit<IndexRequest, 'job'>): number {
    this.cancel();

    const job = ++this.job;
    const full = { ...request, job } as GraphJobRequest;
    const transfer = transferList(full);

    this.running = true;

    const worker = this.ensureWorker();

    if (worker) {
      worker.postMessage(full, transfer);
    } else {
      this.runInline(full);
    }

    return job;
  }

  cancel(): void {
    if (this.running) {
      if (this.worker) {
        this.worker.terminate();
        this.worker = null;
      }

      this.inlineCancel?.();
      this.inlineCancel = null;
      this.running = false;
    }
  }

  destroy(): void {
    this.cancel();
    this.worker?.terminate();
    this.worker = null;
  }

  private handle(response: GraphJobResponse): void {
    if (response.job !== this.job) {
      return;
    }

    if (response.kind === 'layout' || response.kind === 'index' || response.kind === 'error') {
      this.running = false;
    }

    this.onResponse(response);
  }

  private ensureWorker(): Worker | null {
    if (this.worker || !this.factory) {
      return this.worker;
    }

    try {
      const worker = this.factory();

      worker.onmessage = (event: MessageEvent<GraphJobResponse>) => this.handle(event.data);

      worker.onerror = (event) => {
        event.preventDefault?.();
        this.handle({ kind: 'error', job: this.job, message: event.message || 'Graph worker failed' });
      };

      this.worker = worker;
    } catch {
      this.worker = null;
    }

    return this.worker;
  }

  private runInline(request: GraphJobRequest): void {
    let cancelled = false;

    this.inlineCancel = () => (cancelled = true);

    const yieldControl = () =>
      new Promise<void>((resolve) =>
        typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => resolve()) : setTimeout(resolve, 0),
      );

    // Starts after the caller returned (same order as a worker reply).
    void Promise.resolve().then(() =>
      runGraphJob(
        request,
        (response) => {
          if (!cancelled) {
            this.handle(response);
          }
        },
        yieldControl,
        () => cancelled,
      ),
    );
  }
}

/** Buffers of a request that the main thread hands over (copies; the caller keeps its own arrays). */
function transferList(request: GraphJobRequest): ArrayBuffer[] {
  const arrays: ArrayBufferView[] = [];

  if (request.kind === 'layout') {
    const { input } = request;

    arrays.push(input.types, input.community, input.edgeSource, input.edgeTarget, input.positions, input.known);

    if (request.mask) {
      arrays.push(request.mask);
    }
  } else {
    const { input } = request;

    arrays.push(input.positions, input.types, input.degree, input.radius, input.edgeSource, input.edgeTarget);

    if (input.mask) {
      arrays.push(input.mask);
    }
  }

  return [...new Set(arrays.map((array) => array.buffer as ArrayBuffer))];
}
