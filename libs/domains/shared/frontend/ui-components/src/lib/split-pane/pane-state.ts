/** Persisted size / collapse state of a resizable pane (`fpc-split-pane`, `fpc-dock-panel`). */
export interface FpcPaneState {
  size: number;
  collapsed: boolean;
}

export function fpcClampSize(size: number, min: number, max: number): number {
  if (!Number.isFinite(size)) return min;

  return Math.round(Math.min(Math.max(size, min), Math.max(min, max)));
}

/** Reads `{ size, collapsed }` from `localStorage[key]`; `null` when missing or malformed. */
export function fpcReadPaneState(storage: Storage | null | undefined, key: string | null): FpcPaneState | null {
  if (!storage || !key) return null;

  try {
    const raw = JSON.parse(storage.getItem(key) ?? 'null') as Partial<FpcPaneState> | null;

    if (!raw || typeof raw.size !== 'number' || !Number.isFinite(raw.size)) return null;

    return { size: raw.size, collapsed: raw.collapsed === true };
  } catch {
    return null;
  }
}

export function fpcWritePaneState(storage: Storage | null | undefined, key: string | null, state: FpcPaneState): void {
  if (!storage || !key) return;

  try {
    storage.setItem(key, JSON.stringify(state));
  } catch {
    // Storage may be full or unavailable; the in-memory state still applies.
  }
}

/** Size change for a keyboard step on a separator (`Arrow*`, `Home`, `End`); `null` for other keys. */
export function fpcSeparatorKeySize(
  key: string,
  size: number,
  min: number,
  max: number,
  step: number,
  growKeys: readonly string[],
  shrinkKeys: readonly string[],
): number | null {
  if (growKeys.includes(key)) return fpcClampSize(size + step, min, max);
  if (shrinkKeys.includes(key)) return fpcClampSize(size - step, min, max);
  if (key === 'Home') return min;
  if (key === 'End') return max;

  return null;
}
