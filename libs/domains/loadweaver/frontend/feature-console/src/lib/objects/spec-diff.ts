import type { FpcCodeLineHighlight } from '@forepath/shared/frontend/ui-components';

/** How a field / line of the edited (draft) document differs from the live one. */
export type SpecChange = 'added' | 'removed' | 'changed';

function unset(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

function sameValue(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/** The change of one field from the live value to the edited one (null = unchanged). */
export function fieldChange(live: unknown, edited: unknown): SpecChange | null {
  if (unset(live) && unset(edited)) return null;
  if (unset(live)) return 'added';
  if (unset(edited)) return 'removed';

  return sameValue(live, edited) ? null : 'changed';
}

/** A field value for a tooltip / label ("(not set)" handled by the caller). */
export function fieldValueText(value: unknown): string {
  if (unset(value)) return '';

  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

/** Line highlights of both sides of a "Draft vs live" comparison. */
export interface SpecLineDiff {
  live: FpcCodeLineHighlight[];
  draft: FpcCodeLineHighlight[];
}

/** Above this many line pairs the LCS table is skipped (line-by-line comparison instead). */
const MAX_LCS_CELLS = 4_000_000;

type Op = { type: 'same' | 'del' | 'add'; live?: number; draft?: number };

function lcsOps(a: readonly string[], b: readonly string[]): Op[] {
  const n = a.length;
  const m = b.length;
  // Lengths of the LCS of the suffixes a[i..] / b[j..].
  const table: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const ops: Op[] = [];
  let i = 0;
  let j = 0;

  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: 'same', live: i++, draft: j++ });
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      ops.push({ type: 'del', live: i++ });
    } else {
      ops.push({ type: 'add', draft: j++ });
    }
  }

  while (i < n) ops.push({ type: 'del', live: i++ });
  while (j < m) ops.push({ type: 'add', draft: j++ });

  return ops;
}

function indexOps(a: readonly string[], b: readonly string[]): Op[] {
  const ops: Op[] = [];

  for (let k = 0; k < Math.max(a.length, b.length); k++) {
    if (k < a.length && k < b.length && a[k] === b[k]) ops.push({ type: 'same', live: k, draft: k });
    else {
      if (k < a.length) ops.push({ type: 'del', live: k });
      if (k < b.length) ops.push({ type: 'add', draft: k });
    }
  }

  return ops;
}

function ranges(lines: readonly number[], kind: SpecChange): FpcCodeLineHighlight[] {
  const out: FpcCodeLineHighlight[] = [];

  for (const line of lines) {
    const last = out[out.length - 1];

    if (last && (last.endLine ?? last.line) === line) last.endLine = line + 1;
    else out.push({ line: line + 1, kind });
  }

  return out;
}

/**
 * Line diff of the live and the edited YAML (3.37 Spec tab "Draft vs live"): a hunk with removed and added lines is
 * "changed" on both sides, a hunk with only added lines "added" on the draft side, only removed lines "removed" on
 * the live side. Line numbers are 1-based.
 */
export function specLineDiff(live: string, draft: string): SpecLineDiff {
  const a = live.split('\n');
  const b = draft.split('\n');
  const ops = a.length * b.length > MAX_LCS_CELLS ? indexOps(a, b) : lcsOps(a, b);
  const result: SpecLineDiff = { live: [], draft: [] };
  let dels: number[] = [];
  let adds: number[] = [];

  const flush = (): void => {
    const changed = dels.length > 0 && adds.length > 0;

    result.live.push(...ranges(dels, changed ? 'changed' : 'removed'));
    result.draft.push(...ranges(adds, changed ? 'changed' : 'added'));
    dels = [];
    adds = [];
  };

  for (const op of ops) {
    if (op.type === 'same') flush();
    else if (op.type === 'del') dels.push(op.live as number);
    else adds.push(op.draft as number);
  }

  flush();

  return result;
}
