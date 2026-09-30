/** Classification of a path-list entry for edit / open actions. */
export type PathListValueKind = 'url' | 'local' | 'other';

/**
 * Classify a skills/instructions/plugins/reference value for UI actions.
 * URLs open externally; local paths and directory globs can open in the layer file editor.
 */
export function classifyPathListValue(value: string): PathListValueKind {
  const trimmed = value.trim();

  if (!trimmed) {
    return 'other';
  }

  if (/^https?:\/\//i.test(trimmed) || /^git@[^\s]+:/.test(trimmed)) {
    return 'url';
  }

  if (resolveLayerEditorPath(trimmed) !== null) {
    return 'local';
  }

  return 'other';
}

/**
 * Resolve a path-list value to the VFS path the layer editor should open.
 *
 * Globs open at the directory before the first wildcard segment:
 * - /opt/skills/* → /opt/skills
 * - /opt/skills/** → /opt/skills
 * - /opt/skills + recursive glob + /abc → /opt/skills
 * - /opt/skills + recursive glob + /*.md → /opt/skills
 *
 * Globs with no directory prefix and bare package ids return null.
 */
export function resolveLayerEditorPath(value: string): string | null {
  const trimmed = value.trim().replace(/\\/g, '/');

  if (!trimmed) {
    return null;
  }

  if (/^https?:\/\//i.test(trimmed) || /^git@[^\s]+:/.test(trimmed)) {
    return null;
  }

  const absolute = trimmed.startsWith('/');
  const parts = trimmed.split('/').filter((part) => part.length > 0);
  const globIndex = parts.findIndex((part) => /[[*?]/.test(part));

  if (globIndex === 0) {
    // Starts with a glob segment — no VFS folder to open.
    return null;
  }

  if (globIndex > 0) {
    const baseParts = parts.slice(0, globIndex);
    const base = absolute ? `/${baseParts.join('/')}` : baseParts.join('/');

    // Allow bare dir names as glob bases (`skills/**/abc` → `skills`).
    if (!isOpenableLocalPath(base, true)) {
      return null;
    }

    return normalizeEditorRoot(base);
  }

  // Bare package ids stay non-editable; require path-like shape.
  if (!isOpenableLocalPath(trimmed, false)) {
    return null;
  }

  return normalizeEditorRoot(trimmed);
}

/** True when the value resolves to a local file/folder the virtual editor can open. */
export function isLocalEditorPath(value: string): boolean {
  return resolveLayerEditorPath(value) !== null;
}

/** True when the value can be opened as a local file/folder in the virtual editor. */
export function isEditableLocalPath(value: string, inherited: boolean): boolean {
  return !inherited && isLocalEditorPath(value);
}

function isOpenableLocalPath(path: string, allowBareDir: boolean): boolean {
  if (!path || path.startsWith('@')) {
    return false;
  }

  if (path.startsWith('.') || path.startsWith('/') || path.startsWith('~') || path.includes('/')) {
    return true;
  }

  return allowBareDir && /^[A-Za-z0-9._-]+$/.test(path);
}

function normalizeEditorRoot(path: string): string {
  if (path === '/' || path === '.') {
    return path;
  }

  return path.replace(/\/+$/, '') || '.';
}
