/** Before / after of a resource as YAML-like text and a line diff (read-only review, no editor). */

export interface DiffLine {
  type: 'same' | 'added' | 'removed';
  text: string;
}

const PLAIN = /^[A-Za-z0-9_./@:-][A-Za-z0-9 _./@:+=-]*$/;
const RESERVED = /^(true|false|null|yes|no|on|off|~|-?\d+(\.\d+)?([eE][+-]?\d+)?)$/i;

function scalar(value: unknown): string {
  if (value === null || value === undefined) return 'null';

  if (typeof value === 'string')
    return PLAIN.test(value) && !RESERVED.test(value) && !value.endsWith(' ') && !value.includes(': ')
      ? value
      : JSON.stringify(value);

  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  return JSON.stringify(value);
}

function isCollection(value: unknown): value is Record<string, unknown> | unknown[] {
  return value !== null && typeof value === 'object';
}

function isEmpty(value: Record<string, unknown> | unknown[]): boolean {
  return Array.isArray(value) ? value.length === 0 : Object.keys(value).length === 0;
}

function yamlLines(value: unknown): string[] {
  if (Array.isArray(value)) {
    if (value.length === 0) return ['[]'];

    return value.flatMap((item) => {
      const inner = yamlLines(item);

      return [`- ${inner[0]}`, ...inner.slice(1).map((line) => `  ${line}`)];
    });
  }

  if (isCollection(value)) {
    const entries = Object.entries(value);

    if (entries.length === 0) return ['{}'];

    return entries.flatMap(([key, item]) =>
      isCollection(item) && !isEmpty(item)
        ? [`${scalar(key)}:`, ...yamlLines(item).map((line) => `  ${line}`)]
        : [`${scalar(key)}: ${yamlLines(item)[0]}`],
    );
  }

  return [scalar(value)];
}

/** A resource as YAML (block style); `null` (resource doesn't exist) is no text. */
export function toYaml(value: unknown): string {
  return value === null || value === undefined ? '' : yamlLines(value).join('\n');
}

/** Above this many line pairs the diff shows everything removed and added instead of the LCS. */
const MAX_DIFF_CELLS = 4_000_000;

/** Line diff (longest common subsequence) of two texts. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before ? before.split('\n') : [];
  const b = after ? after.split('\n') : [];

  if (a.length * b.length > MAX_DIFF_CELLS)
    return [
      ...a.map((text) => ({ type: 'removed' as const, text })),
      ...b.map((text) => ({ type: 'added' as const, text })),
    ];

  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));

  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ type: 'same', text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ type: 'removed', text: a[i++] });
    } else {
      out.push({ type: 'added', text: b[j++] });
    }
  }

  while (i < a.length) out.push({ type: 'removed', text: a[i++] });

  while (j < b.length) out.push({ type: 'added', text: b[j++] });

  return out;
}
