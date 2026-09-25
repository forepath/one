/** Minimal node shape used by selection helpers (matches file-tree TreeNode). */
export interface FileTreeSelectableNode {
  path: string;
  type: 'file' | 'directory';
  children?: FileTreeSelectableNode[];
  expanded?: boolean;
}

export type FileTreeSelectionGesture = 'plain' | 'ctrl' | 'shift';

export interface FileTreeSelectionResult {
  selectedPaths: Set<string>;
  /** Anchor for the next Shift-range; updated on plain and Ctrl (not Shift). */
  selectionAnchorPath: string | null;
}

/** True when `path` is a strict descendant of `ancestorPath`. */
export function isStrictPathDescendant(path: string, ancestorPath: string): boolean {
  if (!ancestorPath || ancestorPath === '.' || ancestorPath === path) {
    return false;
  }

  const prefix = ancestorPath.endsWith('/') ? ancestorPath : `${ancestorPath}/`;

  return path.startsWith(prefix);
}

/** Parent directory path (`.` for workspace root children). */
export function getParentPath(path: string): string {
  const normalized = path.replace(/\/+$/, '');
  const idx = normalized.lastIndexOf('/');

  if (idx <= 0) {
    return '.';
  }

  return normalized.slice(0, idx);
}

/** Basename of a path. */
export function getPathBasename(path: string): string {
  const normalized = path.replace(/\/+$/, '');
  const idx = normalized.lastIndexOf('/');

  return idx >= 0 ? normalized.slice(idx + 1) : normalized;
}

/**
 * Depth-first flatten of currently rendered nodes (expanded directories only expose children).
 */
export function flattenVisibleTreeNodes(nodes: FileTreeSelectableNode[]): FileTreeSelectableNode[] {
  const result: FileTreeSelectableNode[] = [];

  const walk = (list: FileTreeSelectableNode[]): void => {
    for (const node of list) {
      result.push(node);

      if (node.type === 'directory' && node.expanded && node.children?.length) {
        walk(node.children);
      }
    }
  };

  walk(nodes);

  return result;
}

/** Paths of currently visible descendants of `folderPath` (not including the folder). */
export function getVisibleDescendantPaths(folderPath: string, visibleNodes: FileTreeSelectableNode[]): string[] {
  return visibleNodes.filter((node) => isStrictPathDescendant(node.path, folderPath)).map((node) => node.path);
}

/**
 * Drop any selected path that is a descendant of another selected path
 * (delete/copy/cut once at topmost roots).
 */
export function getTopmostSelectedPaths(selectedPaths: Iterable<string>): string[] {
  const paths = [...new Set(selectedPaths)].sort((a, b) => a.length - b.length || a.localeCompare(b));
  const roots: string[] = [];

  for (const path of paths) {
    const covered = roots.some((root) => path === root || isStrictPathDescendant(path, root));

    if (!covered) {
      roots.push(path);
    }
  }

  return roots;
}

/** After collapsing `collapsedPath`, drop selected descendants that are no longer visible. */
export function pruneSelectionAfterCollapse(selectedPaths: Set<string>, collapsedPath: string): Set<string> {
  const next = new Set<string>();

  for (const path of selectedPaths) {
    if (!isStrictPathDescendant(path, collapsedPath)) {
      next.add(path);
    }
  }

  return next;
}

function addFolderWithVisibleDescendants(
  target: Set<string>,
  node: FileTreeSelectableNode,
  visibleNodes: FileTreeSelectableNode[],
): void {
  target.add(node.path);

  if (node.type === 'directory') {
    for (const descendant of getVisibleDescendantPaths(node.path, visibleNodes)) {
      target.add(descendant);
    }
  }
}

function removeFolderWithVisibleDescendants(
  target: Set<string>,
  node: FileTreeSelectableNode,
  visibleNodes: FileTreeSelectableNode[],
): void {
  target.delete(node.path);

  if (node.type === 'directory') {
    for (const descendant of getVisibleDescendantPaths(node.path, visibleNodes)) {
      target.delete(descendant);
    }
  }
}

/**
 * Apply a selection gesture against the current set.
 * Shift uses `selectionAnchorPath` and the flat visible list for range selection.
 */
export function applyFileTreeSelectionGesture(options: {
  gesture: FileTreeSelectionGesture;
  node: FileTreeSelectableNode;
  visibleNodes: FileTreeSelectableNode[];
  previousSelected: Set<string>;
  selectionAnchorPath: string | null;
}): FileTreeSelectionResult {
  const { gesture, node, visibleNodes, previousSelected, selectionAnchorPath } = options;

  if (gesture === 'plain') {
    const next = new Set<string>();

    addFolderWithVisibleDescendants(next, node, visibleNodes);

    return { selectedPaths: next, selectionAnchorPath: node.path };
  }

  if (gesture === 'ctrl') {
    const next = new Set(previousSelected);
    const isSelected = next.has(node.path);

    if (isSelected) {
      removeFolderWithVisibleDescendants(next, node, visibleNodes);
    } else {
      addFolderWithVisibleDescendants(next, node, visibleNodes);
    }

    return { selectedPaths: next, selectionAnchorPath: node.path };
  }

  // Shift-range
  const flat = visibleNodes;
  const anchor = selectionAnchorPath ?? node.path;
  const anchorIndex = flat.findIndex((entry) => entry.path === anchor);
  const targetIndex = flat.findIndex((entry) => entry.path === node.path);

  if (anchorIndex < 0 || targetIndex < 0) {
    const next = new Set<string>();

    addFolderWithVisibleDescendants(next, node, visibleNodes);

    return { selectedPaths: next, selectionAnchorPath: selectionAnchorPath ?? node.path };
  }

  const from = Math.min(anchorIndex, targetIndex);
  const to = Math.max(anchorIndex, targetIndex);
  const next = new Set<string>();

  for (let i = from; i <= to; i++) {
    const entry = flat[i];

    if (entry) {
      next.add(entry.path);
    }
  }

  return { selectedPaths: next, selectionAnchorPath };
}

/** Suggest a non-colliding basename when pasting into a directory that already has `baseName`. */
export function suggestCopyBasename(baseName: string, existingNames: Iterable<string>): string {
  const existing = new Set([...existingNames].map((name) => name.toLowerCase()));

  if (!existing.has(baseName.toLowerCase())) {
    return baseName;
  }

  const dot = baseName.lastIndexOf('.');
  const hasExt = dot > 0 && baseName.slice(dot + 1).indexOf('/') < 0;
  const stem = hasExt ? baseName.slice(0, dot) : baseName;
  const ext = hasExt ? baseName.slice(dot) : '';

  let n = 1;
  let candidate = `${stem} (${n})${ext}`;

  while (existing.has(candidate.toLowerCase())) {
    n += 1;
    candidate = `${stem} (${n})${ext}`;
  }

  return candidate;
}

/**
 * Suggest a non-colliding title for knowledge nodes (no file extension).
 * Collision → `Title (1)`, `Title (2)`, …
 */
export function suggestNumberedTitle(title: string, existingTitles: Iterable<string>): string {
  return suggestCopyBasename(title, existingTitles);
}

/** Join parent + child path segments for the files API (`.` parent → child only). */
export function joinFileTreePath(parentPath: string, childName: string): string {
  if (!parentPath || parentPath === '.' || parentPath === '/') {
    return childName;
  }

  return `${parentPath.replace(/\/+$/, '')}/${childName}`;
}
