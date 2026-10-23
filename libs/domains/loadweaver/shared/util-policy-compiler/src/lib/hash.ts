/** FNV-1a 32-bit; deterministic short ids for set and interface names (not security relevant). */
export function fnv1a(input: string): string {
  let hash = 0x811c9dc5;

  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash.toString(16).padStart(8, '0');
}

export function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}
