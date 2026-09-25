/** Minimal node shape used by knowledge-tree selection helpers. */
export interface KnowledgeTreeSelectableNode {
  id: string;
  nodeType: 'folder' | 'page';
  parentId?: string | null;
  children?: KnowledgeTreeSelectableNode[];
  expanded?: boolean;
}

export type KnowledgeTreeSelectionGesture = 'plain' | 'ctrl' | 'shift';

export interface KnowledgeTreeSelectionResult {
  selectedIds: Set<string>;
  /** Anchor for the next Shift-range; updated on plain and Ctrl (not Shift). */
  selectionAnchorId: string | null;
}

/** True when `nodeId` is a strict descendant of `ancestorId` via parent links. */
export function isStrictKnowledgeDescendant(
  nodeId: string,
  ancestorId: string,
  resolveParentId: (id: string) => string | null | undefined,
): boolean {
  if (!nodeId || !ancestorId || nodeId === ancestorId) {
    return false;
  }

  let current: string | null | undefined = resolveParentId(nodeId);
  const seen = new Set<string>();

  while (current) {
    if (current === ancestorId) {
      return true;
    }

    if (seen.has(current)) {
      return false;
    }

    seen.add(current);
    current = resolveParentId(current);
  }

  return false;
}

/**
 * Depth-first flatten of currently rendered nodes (expanded folders only expose children).
 */
export function flattenVisibleKnowledgeNodes(nodes: KnowledgeTreeSelectableNode[]): KnowledgeTreeSelectableNode[] {
  const result: KnowledgeTreeSelectableNode[] = [];

  const walk = (list: KnowledgeTreeSelectableNode[]): void => {
    for (const node of list) {
      result.push(node);

      if (node.nodeType === 'folder' && node.expanded && node.children?.length) {
        walk(node.children);
      }
    }
  };

  walk(nodes);

  return result;
}

/** Ids of currently visible descendants of an expanded folder (not including the folder). */
export function collectVisibleDescendantIds(node: KnowledgeTreeSelectableNode): string[] {
  const ids: string[] = [];

  if (node.nodeType !== 'folder' || !node.expanded || !node.children?.length) {
    return ids;
  }

  for (const child of node.children) {
    ids.push(child.id);
    ids.push(...collectVisibleDescendantIds(child));
  }

  return ids;
}

/**
 * Drop any selected id that is a descendant of another selected id
 * (delete/copy/cut once at topmost roots).
 */
export function getTopmostSelectedIds(
  selectedIds: Iterable<string>,
  resolveParentId: (id: string) => string | null | undefined,
): string[] {
  const ids = [...new Set(selectedIds)];
  const roots: string[] = [];

  for (const id of ids) {
    const covered = roots.some((root) => id === root || isStrictKnowledgeDescendant(id, root, resolveParentId));

    if (!covered) {
      // Drop roots that this id covers (ancestor selected after a descendant).
      for (let i = roots.length - 1; i >= 0; i--) {
        if (isStrictKnowledgeDescendant(roots[i], id, resolveParentId)) {
          roots.splice(i, 1);
        }
      }

      roots.push(id);
    }
  }

  return roots;
}

/** After collapsing `collapsedId`, drop selected descendants that are no longer visible. */
export function pruneSelectionAfterCollapse(
  selectedIds: Set<string>,
  collapsedId: string,
  resolveParentId: (id: string) => string | null | undefined,
): Set<string> {
  const next = new Set<string>();

  for (const id of selectedIds) {
    if (!isStrictKnowledgeDescendant(id, collapsedId, resolveParentId)) {
      next.add(id);
    }
  }

  return next;
}

function addFolderWithVisibleDescendants(target: Set<string>, node: KnowledgeTreeSelectableNode): void {
  target.add(node.id);

  for (const descendantId of collectVisibleDescendantIds(node)) {
    target.add(descendantId);
  }
}

function removeFolderWithVisibleDescendants(target: Set<string>, node: KnowledgeTreeSelectableNode): void {
  target.delete(node.id);

  for (const descendantId of collectVisibleDescendantIds(node)) {
    target.delete(descendantId);
  }
}

/**
 * Apply a selection gesture against the current set.
 * Shift uses `selectionAnchorId` and the flat visible list for range selection.
 */
export function applyKnowledgeTreeSelectionGesture(options: {
  gesture: KnowledgeTreeSelectionGesture;
  node: KnowledgeTreeSelectableNode;
  visibleNodes: KnowledgeTreeSelectableNode[];
  previousSelected: Set<string>;
  selectionAnchorId: string | null;
}): KnowledgeTreeSelectionResult {
  const { gesture, node, visibleNodes, previousSelected, selectionAnchorId } = options;

  if (gesture === 'plain') {
    const next = new Set<string>();

    addFolderWithVisibleDescendants(next, node);

    return { selectedIds: next, selectionAnchorId: node.id };
  }

  if (gesture === 'ctrl') {
    const next = new Set(previousSelected);
    const isSelected = next.has(node.id);

    if (isSelected) {
      removeFolderWithVisibleDescendants(next, node);
    } else {
      addFolderWithVisibleDescendants(next, node);
    }

    return { selectedIds: next, selectionAnchorId: node.id };
  }

  const flat = visibleNodes;
  const anchor = selectionAnchorId ?? node.id;
  const anchorIndex = flat.findIndex((entry) => entry.id === anchor);
  const targetIndex = flat.findIndex((entry) => entry.id === node.id);

  if (anchorIndex < 0 || targetIndex < 0) {
    const next = new Set<string>();

    addFolderWithVisibleDescendants(next, node);

    return { selectedIds: next, selectionAnchorId: selectionAnchorId ?? node.id };
  }

  const from = Math.min(anchorIndex, targetIndex);
  const to = Math.max(anchorIndex, targetIndex);
  const next = new Set<string>();

  for (let i = from; i <= to; i++) {
    const entry = flat[i];

    if (entry) {
      next.add(entry.id);
    }
  }

  return { selectedIds: next, selectionAnchorId };
}

/** True when moving `sourceId` under `targetParentId` would nest it under itself. */
export function wouldMoveKnowledgeIntoSelf(
  sourceId: string,
  targetParentId: string | null,
  resolveParentId: (id: string) => string | null | undefined,
): boolean {
  if (!targetParentId) {
    return false;
  }

  return targetParentId === sourceId || isStrictKnowledgeDescendant(targetParentId, sourceId, resolveParentId);
}
