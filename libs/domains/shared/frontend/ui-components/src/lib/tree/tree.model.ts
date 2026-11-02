/** Health tone of a tree node (a coloured dot before the label). */
export type FpcTreeStatus = 'success' | 'warning' | 'danger' | 'info' | 'secondary';

/** One node of `fpc-tree`. Children may load lazily: set `hasChildren` and leave `children` undefined. */
export interface FpcTreeNode<T = unknown> {
  id: string;
  label: string;
  /** Bootstrap icon name without `bi-`. */
  icon?: string;
  status?: FpcTreeStatus | null;
  /** Accessible text for the status dot (e.g. "Degraded"). */
  statusLabel?: string;
  /** Count / short badge after the label. */
  badge?: string | number | null;
  /** A pending change (e.g. in a draft): a `●` mark after the label. */
  mark?: boolean;
  markLabel?: string;
  /** Secondary text after the label (muted). */
  hint?: string | null;
  children?: readonly FpcTreeNode<T>[];
  /** Expandable although `children` is not loaded yet (the tree emits `expandRequest`). */
  hasChildren?: boolean;
  disabled?: boolean;
  data?: T;
}

/** A visible row of the flattened tree. */
export interface FpcTreeRow<T = unknown> {
  node: FpcTreeNode<T>;
  /** 1-based (`aria-level`). */
  level: number;
  expandable: boolean;
  expanded: boolean;
  parentId: string | null;
  /** `aria-setsize` / `aria-posinset`. */
  setSize: number;
  posInSet: number;
}

export function fpcTreeExpandable(node: FpcTreeNode): boolean {
  return (node.children?.length ?? 0) > 0 || (!!node.hasChildren && node.children === undefined);
}

/** The rows a user sees: depth-first, children only below expanded nodes. */
export function fpcFlattenTree<T>(nodes: readonly FpcTreeNode<T>[], expanded: ReadonlySet<string>): FpcTreeRow<T>[] {
  const rows: FpcTreeRow<T>[] = [];

  const walk = (list: readonly FpcTreeNode<T>[], level: number, parentId: string | null): void => {
    list.forEach((node, index) => {
      const expandable = fpcTreeExpandable(node);
      const isExpanded = expandable && expanded.has(node.id);

      rows.push({ node, level, expandable, expanded: isExpanded, parentId, setSize: list.length, posInSet: index + 1 });
      if (isExpanded && node.children) {
        walk(node.children, level + 1, node.id);
      }
    });
  };

  walk(nodes, 1, null);

  return rows;
}

/**
 * Nodes matching `predicate` plus their ancestors (search keeps the path visible). A matching node keeps
 * all its children so it can still be expanded; non-matching ancestors keep only matching branches.
 */
export function fpcFilterTree<T>(
  nodes: readonly FpcTreeNode<T>[],
  predicate: (node: FpcTreeNode<T>) => boolean,
): FpcTreeNode<T>[] {
  const result: FpcTreeNode<T>[] = [];

  for (const node of nodes) {
    if (predicate(node)) {
      result.push(node);
      continue;
    }

    const children = node.children ? fpcFilterTree(node.children, predicate) : [];

    if (children.length > 0) {
      result.push({ ...node, children });
    }
  }

  return result;
}

/** Ids of every node that has children in `nodes` (to expand a filtered tree completely). */
export function fpcTreeBranchIds(nodes: readonly FpcTreeNode[]): string[] {
  const ids: string[] = [];
  const walk = (list: readonly FpcTreeNode[]): void => {
    for (const node of list) {
      if (node.children?.length) {
        ids.push(node.id);
        walk(node.children);
      }
    }
  };

  walk(nodes);

  return ids;
}

/** The path from a root to the node with `id` (inclusive), or `[]` when it is not in the tree. */
export function fpcTreePath<T>(nodes: readonly FpcTreeNode<T>[], id: string): FpcTreeNode<T>[] {
  for (const node of nodes) {
    if (node.id === id) return [node];

    if (node.children) {
      const path = fpcTreePath(node.children, id);

      if (path.length > 0) return [node, ...path];
    }
  }

  return [];
}

/** The window of rows to render for a virtualized list (with `overscan` rows before and after). */
export function fpcVirtualWindow(
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  total: number,
  overscan = 8,
): { start: number; end: number } {
  if (total === 0 || rowHeight <= 0) return { start: 0, end: 0 };

  const first = Math.floor(Math.max(0, scrollTop) / rowHeight);
  const visible = Math.ceil(Math.max(viewportHeight, rowHeight) / rowHeight);
  const start = Math.max(0, first - overscan);
  const end = Math.min(total, first + visible + overscan);

  return { start, end };
}

/** The `scrollTop` that brings row `index` into view (unchanged when it is already visible). */
export function fpcScrollIntoView(index: number, scrollTop: number, viewportHeight: number, rowHeight: number): number {
  const top = index * rowHeight;
  const bottom = top + rowHeight;

  if (top < scrollTop) return top;
  if (bottom > scrollTop + viewportHeight) return Math.max(0, bottom - viewportHeight);

  return scrollTop;
}
