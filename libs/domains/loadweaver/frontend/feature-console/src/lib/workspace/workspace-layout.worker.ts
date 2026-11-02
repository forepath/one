import { workspaceLayout, type WorkspaceBox } from './workspace-layout';
import type { WorkspaceItem, WorkspaceModel } from './workspace-model';

/**
 * The grouped layout in a web worker (3.36 P5): large clusters lay out off the main thread. The worker is built from
 * `workspaceLayout`'s own source (it has no module-level references) as a Blob, so it needs no extra bundle entry;
 * without `Worker` (tests, old browsers) or on any worker error the layout runs synchronously.
 */
export function layoutWorkerSource(): string {
  return `const workspaceLayout = ${workspaceLayout.toString()};
self.onmessage = (event) => {
  const { key, items, visible, aspect, edges } = event.data;
  const byId = new Map(items.map((item) => [item.id, item]));
  const boxes = workspaceLayout({ items, byId, tray: [], edges }, new Set(visible), aspect);
  self.postMessage({ key, boxes: [...boxes] });
};`;
}

/** What the worker needs of an item (ids and containment). */
type LayoutItem = Pick<WorkspaceItem, 'id' | 'kind' | 'label' | 'project' | 'parent' | 'children'>;

export class WorkspaceLayoutWorker {
  private worker: Worker | null = null;
  private readonly pending = new Map<
    string,
    {
      resolve: (boxes: Map<string, WorkspaceBox>) => void;
      model: WorkspaceModel;
      visible: ReadonlySet<string>;
      aspect?: number;
    }
  >();

  constructor(enabled = typeof Worker !== 'undefined' && typeof Blob !== 'undefined') {
    if (!enabled) return;

    try {
      const url = URL.createObjectURL(new Blob([layoutWorkerSource()], { type: 'text/javascript' }));

      this.worker = new Worker(url);
      URL.revokeObjectURL(url);
      this.worker.onmessage = (event: MessageEvent<{ key: string; boxes: [string, WorkspaceBox][] }>) => {
        const waiting = this.pending.get(event.data.key);

        this.pending.delete(event.data.key);
        waiting?.resolve(new Map(event.data.boxes));
      };
      this.worker.onerror = () => this.fail();
    } catch {
      this.worker = null;
    }
  }

  get running(): boolean {
    return !!this.worker;
  }

  /**
   * The layout of the visible items; `key` identifies it (the same key gives the same layout). `aspect`: the viewport's
   * width / height for the star of sites (see `workspaceLayout`).
   */
  layout(
    model: WorkspaceModel,
    visible: ReadonlySet<string>,
    key: string,
    aspect?: number,
  ): Promise<Map<string, WorkspaceBox>> {
    if (!this.worker) return Promise.resolve(workspaceLayout(model, visible, aspect));

    return new Promise((resolve) => {
      this.pending.set(key, { resolve, model, visible, aspect });

      const items: LayoutItem[] = model.items.map((i) => ({
        id: i.id,
        kind: i.kind,
        label: i.label,
        project: i.project,
        parent: i.parent,
        children: i.children,
      }));

      // Only the endpoints of the edges: they order the star of sites.
      const edges = model.edges.map((e) => ({ source: e.source, target: e.target }));

      this.worker?.postMessage({ key, items, visible: [...visible], aspect, edges });
    });
  }

  terminate(): void {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
  }

  /** A broken worker: everything still waiting is laid out here. */
  private fail(): void {
    this.worker?.terminate();
    this.worker = null;

    for (const { resolve, model, visible, aspect } of this.pending.values())
      resolve(workspaceLayout(model, visible, aspect));

    this.pending.clear();
  }
}
