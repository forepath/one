/**
 * Row drag and drop of `fpc-data-table` (kanban lanes: one stacked table per lane, rows move between lanes).
 *
 * Native HTML5 drag and drop, not `@angular/cdk/drag-drop`: the ticket boards always used HTML5 DnD between lanes
 * (cross-component drops, the browser's own drag ghost and auto-scroll, no extra overlay); CDK drag-drop would need
 * `cdkDropList` on the `<tbody>`, `cdkDrag` on every `<tr>` of the split head / body table and connected ids across
 * separate table instances, and it fights the table's own virtual window. The drag payload stays in memory (below):
 * `dataTransfer` data cannot be read during `dragover`, so tables of one `dropGroup` share the active drag here.
 */

/** A row dropped on a table of the same `dropGroup` (`fromData` / `toData` = the tables' `dropData`). */
export interface FpcTableRowDropEvent<T = unknown> {
  row: T;
  fromData: unknown;
  toData: unknown;
  /** Index of the row in the source table's shown rows. */
  fromIndex: number;
  /** Insert position in the target table's shown rows (0 … length; same-table drops: before removal). */
  toIndex: number;
}

/** Decides whether a table accepts the dragged row (default: rows from a table with a different `dropData`). */
export type FpcTableDropPredicate<T = unknown> = (drag: { row: T; fromData: unknown; toData: unknown }) => boolean;

export interface FpcTableActiveDrag {
  group: string;
  row: unknown;
  fromData: unknown;
  fromIndex: number;
  /** The source table instance (same-table drops). */
  source: object;
  /** Ends the drag in the source table (its row may be gone before `dragend` fires, e.g. moved by the drop). */
  end: () => void;
}

let activeDrag: FpcTableActiveDrag | null = null;

/** The row being dragged right now (any table), or `null`. */
export function fpcActiveTableDrag(): FpcTableActiveDrag | null {
  return activeDrag;
}

export function fpcSetActiveTableDrag(drag: FpcTableActiveDrag | null): void {
  activeDrag = drag;
}

export const fpcDefaultDropPredicate: FpcTableDropPredicate = ({ fromData, toData }) => fromData !== toData;

/**
 * Insert position for a pointer at `clientY` over rows with these vertical bounds: before the first row whose middle
 * lies below the pointer, otherwise at the end.
 */
export function fpcDropIndex(rects: readonly { top: number; height: number }[], clientY: number): number {
  const index = rects.findIndex((rect) => clientY < rect.top + rect.height / 2);

  return index < 0 ? rects.length : index;
}
