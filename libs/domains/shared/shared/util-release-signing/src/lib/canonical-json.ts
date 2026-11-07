/**
 * Canonical JSON of a signed release document: object keys sorted by code unit, no whitespace, `undefined` members
 * dropped, numbers as JavaScript prints them (release documents contain integers only). A signature covers exactly
 * these bytes, so every producer (CI, scripts) and every verifier agree on them.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('canonical JSON: non-finite number');

    if (typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol')
      throw new Error(`canonical JSON: unsupported ${typeof value}`);

    return JSON.stringify(value ?? null);
  }

  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}
