import {
  AGENT_CONFIG_TAB_LOCK_PATHS,
  isPathLocked,
  tabLockPointer,
  type AgentConfigTabId,
} from '@forepath/agenstra/shared/util-opencode-config';

export type AgentConfigEditorLayer = 'global' | 'workspace' | 'agent';

function normalizePointer(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

/** True when draft locks include the pointer or a tab lock that owns it. */
export function isDraftLockActive(draftLocks: readonly string[], pointer: string): boolean {
  const normalized = normalizePointer(pointer);

  if (isPathLocked(draftLocks, normalized)) {
    return true;
  }

  for (const lock of draftLocks) {
    if (!lock.startsWith('/tabs/')) {
      continue;
    }

    const tabId = lock.slice('/tabs/'.length) as AgentConfigTabId;
    const owned = AGENT_CONFIG_TAB_LOCK_PATHS[tabId];

    if (owned?.some((path) => normalized === path || normalized.startsWith(`${path}/`))) {
      return true;
    }
  }

  return false;
}

export function isTabLockedByParent(lockedPaths: readonly string[], tabId: string): boolean {
  return isPathLocked(lockedPaths, tabLockPointer(tabId)) || isPathLocked(lockedPaths, `/${tabId}`);
}

/**
 * Locked fields stay visible and read-only (disabled via `isLocked`).
 * Rows are never hidden solely because a parent locked the path.
 */
export function isRowVisible(_lockedPaths: readonly string[], _pointer: string): boolean {
  return true;
}

/** Tabs stay visible when locked; controls inside are read-only. */
export function isTabVisible(_layer: AgentConfigEditorLayer, _lockedPaths: readonly string[], _tabId: string): boolean {
  return true;
}

/**
 * Section headings stay when any owned path is still shown.
 * Locked paths remain visible, so a fully locked section keeps its heading.
 */
export function sectionVisible(lockedPaths: readonly string[], ...pointers: string[]): boolean {
  return pointers.some((pointer) => isRowVisible(lockedPaths, pointer));
}
