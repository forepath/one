import { getTopmostSelectedIds, wouldMoveKnowledgeIntoSelf } from './knowledge-tree-selection.util';

export type KnowledgeTreeClipboardMode = 'copy' | 'cut';

export interface KnowledgeTreeClipboardEntry {
  id: string;
  nodeType: 'folder' | 'page';
  parentId: string | null;
  title: string;
}

export interface KnowledgeTreeClipboardState {
  mode: KnowledgeTreeClipboardMode;
  entries: KnowledgeTreeClipboardEntry[];
}

/** Build clipboard entries from selection, keeping only topmost roots. */
export function buildKnowledgeClipboardEntries(
  selectedIds: Iterable<string>,
  resolveNode: (id: string) => KnowledgeTreeClipboardEntry | null,
  resolveParentId: (id: string) => string | null | undefined,
): KnowledgeTreeClipboardEntry[] {
  const roots = getTopmostSelectedIds(selectedIds, resolveParentId);
  const entries: KnowledgeTreeClipboardEntry[] = [];

  for (const id of roots) {
    const entry = resolveNode(id);

    if (entry) {
      entries.push(entry);
    }
  }

  return entries;
}

/**
 * Paste target folder id: selected/focused folder, else parent of page, else workspace root (`null`).
 */
export function resolveKnowledgePasteTargetParentId(
  focusId: string | null,
  resolveNodeType: (id: string) => 'folder' | 'page' | null,
  resolveParentId: (id: string) => string | null | undefined,
): string | null {
  if (!focusId) {
    return null;
  }

  const type = resolveNodeType(focusId);

  if (type === 'folder') {
    return focusId;
  }

  if (type === 'page') {
    return resolveParentId(focusId) ?? null;
  }

  return null;
}

/** True when `id` is an exact clipboard entry. */
export function isKnowledgeIdOnClipboard(state: KnowledgeTreeClipboardState | null | undefined, id: string): boolean {
  if (!state || !id) {
    return false;
  }

  return state.entries.some((entry) => entry.id === id);
}

/** Clipboard mode for an id, or null when it is not on the clipboard. */
export function getKnowledgeClipboardModeForId(
  state: KnowledgeTreeClipboardState | null | undefined,
  id: string,
): KnowledgeTreeClipboardMode | null {
  if (!isKnowledgeIdOnClipboard(state, id) || !state) {
    return null;
  }

  return state.mode;
}

export { wouldMoveKnowledgeIntoSelf };
