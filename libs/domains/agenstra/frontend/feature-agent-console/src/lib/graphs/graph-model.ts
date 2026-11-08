/**
 * Main-thread graph model: the document as flat typed arrays (type codes, communities, edge endpoints) plus the id
 * lookup. Documents that extend the previous one (pages of "All", merged neighbors) only add their new tail, and the
 * work is resumable ({@link GraphModelBuilder.begin} / {@link GraphIngest.step}), so even millions of nodes are
 * taken in small time slices without blocking the UI.
 */
import type { AgentGraphDocument, AgentGraphNode } from '@forepath/agenstra/shared/util-opencode-config';

/** Immutable view of the model at one point in time (what a layout / scene was built from). */
export interface GraphSnapshot {
  count: number;
  edgeCount: number;
  ids: readonly string[];
  /** Document nodes by index (labels, paths). */
  nodes: readonly AgentGraphNode[];
  typeNames: readonly string[];
  types: Uint16Array;
  community: Int32Array;
  missing: Uint8Array;
  edgeSource: Int32Array;
  edgeTarget: Int32Array;
  /** Index of a node id (`-1` when the snapshot does not hold it). */
  indexOf(id: string): number;
}

/** Resumable intake of one document. */
export interface GraphIngest {
  /** The document extends the previous one (indices of known nodes are unchanged). */
  readonly extended: boolean;
  /** Works for about `budgetMs`; `true` once the document is fully taken. */
  step(budgetMs: number): boolean;
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function grow<T extends Uint16Array | Int32Array | Uint8Array>(array: T, needed: number): T {
  if (needed <= array.length) {
    return array;
  }

  const next = new (array.constructor as new (length: number) => T)(Math.max(needed, array.length * 2, 64));

  next.set(array);

  return next;
}

export class GraphModelBuilder {
  private ids: string[] = [];
  private indexById = new Map<string, number>();
  private typeNames: string[] = [];
  private typeCodes = new Map<string, number>();
  private types = new Uint16Array(0);
  private community = new Int32Array(0);
  private missing = new Uint8Array(0);
  private edgeSource = new Int32Array(0);
  private edgeTarget = new Int32Array(0);
  private count = 0;
  private edgeCount = 0;
  /** Document the model was built from (prefix checks of the next one). */
  private source: AgentGraphDocument | null = null;
  /** Document nodes / edges consumed (including skipped ones). */
  private consumedNodes = 0;
  private consumedEdges = 0;
  /** Model index equals document position (no duplicate ids so far). */
  private aligned = true;

  /** Updates the model for `document` at once (see {@link begin}). */
  update(document: AgentGraphDocument): boolean {
    const ingest = this.begin(document);

    while (!ingest.step(Infinity)) {
      // all at once
    }

    return ingest.extended;
  }

  /**
   * Starts taking `document`. `extended` tells whether it extends the previous document (positions by index stay
   * valid) or the model was reset. The model stays consistent between steps, so a newer document may begin before
   * this one finished.
   */
  begin(document: AgentGraphDocument): GraphIngest {
    const extended = this.extends(document);

    if (!extended) {
      this.reset();
    }

    this.source = document;

    const nodes = document.nodes;
    const edges = document.edges;

    this.types = grow(this.types, this.count + (nodes.length - this.consumedNodes));
    this.community = grow(this.community, this.types.length);
    this.missing = grow(this.missing, this.types.length);
    this.edgeSource = grow(this.edgeSource, this.edgeCount + (edges.length - this.consumedEdges));
    this.edgeTarget = grow(this.edgeTarget, this.edgeSource.length);

    return {
      extended,
      step: (budgetMs: number) => {
        const deadline = now() + budgetMs;

        while (this.consumedNodes < nodes.length) {
          const end = Math.min(nodes.length, this.consumedNodes + 2048);

          for (let p = this.consumedNodes; p < end; p++) {
            this.addNode(nodes[p]);
          }

          this.consumedNodes = end;

          if (now() > deadline) {
            return false;
          }
        }

        while (this.consumedEdges < edges.length) {
          const end = Math.min(edges.length, this.consumedEdges + 4096);

          for (let e = this.consumedEdges; e < end; e++) {
            this.addEdge(edges[e]);
          }

          this.consumedEdges = end;

          if (now() > deadline) {
            return this.consumedEdges >= edges.length;
          }
        }

        return true;
      },
    };
  }

  snapshot(): GraphSnapshot {
    const count = this.count;
    const indexById = this.indexById;
    const nodes = this.aligned ? (this.source?.nodes ?? []) : this.alignedNodes();

    return {
      count,
      edgeCount: this.edgeCount,
      ids: this.ids,
      nodes,
      typeNames: this.typeNames.slice(),
      types: this.types.subarray(0, count),
      community: this.community.subarray(0, count),
      missing: this.missing.subarray(0, count),
      edgeSource: this.edgeSource.subarray(0, this.edgeCount),
      edgeTarget: this.edgeTarget.subarray(0, this.edgeCount),
      indexOf: (id: string) => {
        const index = indexById.get(id);

        return index !== undefined && index < count ? index : -1;
      },
    };
  }

  private extends(document: AgentGraphDocument): boolean {
    const previous = this.source;

    if (!previous || !this.aligned || document.nodes.length < this.consumedNodes) {
      return false;
    }

    // Nodes: same ids in the same order (labels may be new objects); edges: the same objects.
    for (let i = 0; i < this.consumedNodes; i++) {
      if (document.nodes[i].id !== this.ids[i]) {
        return false;
      }
    }

    if (document.edges.length < this.consumedEdges) {
      return false;
    }

    for (let e = 0; e < this.consumedEdges; e++) {
      if (document.edges[e] !== previous.edges[e]) {
        return false;
      }
    }

    return true;
  }

  private reset(): void {
    this.ids = [];
    this.indexById = new Map();
    this.typeNames = [];
    this.typeCodes = new Map();
    this.types = new Uint16Array(0);
    this.community = new Int32Array(0);
    this.missing = new Uint8Array(0);
    this.edgeSource = new Int32Array(0);
    this.edgeTarget = new Int32Array(0);
    this.count = 0;
    this.edgeCount = 0;
    this.consumedNodes = 0;
    this.consumedEdges = 0;
    this.aligned = true;
  }

  private addNode(node: AgentGraphNode): void {
    if (this.indexById.has(node.id)) {
      this.aligned = false;

      return;
    }

    const index = this.count++;
    let code = this.typeCodes.get(node.type);

    if (code === undefined) {
      code = this.typeNames.length;
      this.typeNames.push(node.type);
      this.typeCodes.set(node.type, code);
    }

    this.ids.push(node.id);
    this.indexById.set(node.id, index);
    this.types[index] = code;
    this.community[index] = node.community ?? -1;
    this.missing[index] = node.attrs?.['missing'] === true ? 1 : 0;
  }

  private addEdge(edge: AgentGraphDocument['edges'][number]): void {
    const source = this.indexById.get(edge.from);
    const target = this.indexById.get(edge.to);

    if (source === undefined || target === undefined || source === target) {
      return;
    }

    this.edgeSource[this.edgeCount] = source;
    this.edgeTarget[this.edgeCount] = target;
    this.edgeCount++;
  }

  /** Document nodes by model index when the document had duplicate ids. */
  private alignedNodes(): AgentGraphNode[] {
    const nodes: AgentGraphNode[] = new Array(this.count);
    const seen = new Uint8Array(this.count);

    for (const node of this.source?.nodes ?? []) {
      const index = this.indexById.get(node.id);

      if (index !== undefined && !seen[index]) {
        seen[index] = 1;
        nodes[index] = node;
      }
    }

    return nodes;
  }
}
