import {
  getParentPath,
  getPathBasename,
  getTopmostSelectedPaths,
  joinFileTreePath,
  suggestCopyBasename,
} from './file-tree-selection.util';

export type FileTreeClipboardMode = 'copy' | 'cut';

export interface FileTreeClipboardEntry {
  path: string;
  type: 'file' | 'directory';
}

export interface FileTreeClipboardState {
  mode: FileTreeClipboardMode;
  entries: FileTreeClipboardEntry[];
}

/** True when `path` is an exact clipboard entry (topmost root). */
export function isPathOnClipboard(state: FileTreeClipboardState | null | undefined, path: string): boolean {
  if (!state || !path) {
    return false;
  }

  return state.entries.some((entry) => entry.path === path);
}

/** Clipboard mode for a path, or null when it is not on the clipboard. */
export function getClipboardModeForPath(
  state: FileTreeClipboardState | null | undefined,
  path: string,
): FileTreeClipboardMode | null {
  if (!isPathOnClipboard(state, path) || !state) {
    return null;
  }

  return state.mode;
}

/** Build clipboard entries from selection, keeping only topmost roots. */
export function buildClipboardEntries(
  selectedPaths: Iterable<string>,
  resolveType: (path: string) => 'file' | 'directory' | null,
): FileTreeClipboardEntry[] {
  const roots = getTopmostSelectedPaths(selectedPaths);
  const entries: FileTreeClipboardEntry[] = [];

  for (const path of roots) {
    const type = resolveType(path);

    if (type) {
      entries.push({ path, type });
    }
  }

  return entries;
}

/**
 * Paste target directory: selected/focused directory, else parent of file, else workspace root.
 */
export function resolvePasteTargetDirectory(
  focusPath: string | null,
  resolveType: (path: string) => 'file' | 'directory' | null,
): string {
  if (!focusPath || focusPath === '.') {
    return '.';
  }

  const type = resolveType(focusPath);

  if (type === 'directory') {
    return focusPath;
  }

  return getParentPath(focusPath);
}

/** Destination basename for a pasted entry inside `targetDirectory` given existing sibling names. */
export function resolvePasteDestinationPath(
  entry: FileTreeClipboardEntry,
  targetDirectory: string,
  existingNames: Iterable<string>,
): string {
  const baseName = getPathBasename(entry.path);
  const uniqueName = suggestCopyBasename(baseName, existingNames);

  return joinFileTreePath(targetDirectory, uniqueName);
}

/** For cut+paste when names do not collide, keep original basename. */
export function resolveCutDestinationPath(
  entry: FileTreeClipboardEntry,
  targetDirectory: string,
  existingNames: Iterable<string>,
): string {
  const baseName = getPathBasename(entry.path);
  const existing = new Set([...existingNames].map((name) => name.toLowerCase()));
  const name = existing.has(baseName.toLowerCase()) ? suggestCopyBasename(baseName, existingNames) : baseName;

  return joinFileTreePath(targetDirectory, name);
}

/**
 * True when `path` is exactly `ancestor` or a nested path under it (segment-safe).
 * Avoids false positives like `app` matching `apps/...`.
 */
export function isPathEqualOrDescendant(path: string, ancestor: string): boolean {
  if (!path || !ancestor || ancestor === '.') {
    return false;
  }

  return path === ancestor || path.startsWith(`${ancestor}/`);
}

/** True when moving `sourceDirectory` into `targetDirectory` would nest it under itself. */
export function wouldMoveDirectoryIntoSelf(sourceDirectory: string, targetDirectory: string): boolean {
  if (!sourceDirectory || sourceDirectory === '.') {
    return false;
  }

  return isPathEqualOrDescendant(targetDirectory, sourceDirectory);
}

/**
 * Remap a path after a move/rename of `sourcePath` → `destinationPath`
 * (exact match or nested under a moved directory).
 */
export function remapPathAfterMove(path: string, sourcePath: string, destinationPath: string): string {
  if (path === sourcePath) {
    return destinationPath;
  }

  if (path.startsWith(`${sourcePath}/`)) {
    return `${destinationPath}${path.slice(sourcePath.length)}`;
  }

  return path;
}
