export function normalizeProjectDescription(description: string): string {
  return description.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Maps a prompt to a stable unsigned 32-bit seed for WebLLM requests. */
export function hashStringToSeed(value: string): number {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}
