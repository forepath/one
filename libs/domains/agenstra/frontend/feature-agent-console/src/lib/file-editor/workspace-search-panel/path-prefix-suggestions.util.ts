/**
 * Builds directory path-prefix autocomplete options from file-search hit paths.
 * Only parent directories are suggested (never file paths). Excludes the exact draft
 * (shown separately as “Add …”) and already-selected chips.
 */
export function buildPathPrefixSuggestions(
  hitPaths: string[],
  query: string,
  alreadySelected: string[],
  limit = 12,
): string[] {
  const draft = query.replace(/^\/+/, '').replace(/\\/g, '/').trim();
  const needle = draft.toLowerCase();

  if (!needle) {
    return [];
  }

  const selected = new Set(alreadySelected);
  const candidates = new Set<string>();

  for (const rawPath of hitPaths) {
    const path = rawPath.replace(/^\/+/, '').replace(/\\/g, '/').trim();

    if (!path) {
      continue;
    }

    const parts = path.split('/').filter(Boolean);

    // Drop the file leaf; only directory prefixes are suggested.
    for (let index = 1; index < parts.length; index++) {
      const prefix = parts.slice(0, index).join('/');

      if (prefix.toLowerCase().includes(needle)) {
        candidates.add(prefix);
      }
    }
  }

  return [...candidates]
    .filter((path) => path !== draft && !selected.has(path))
    .sort((left, right) => {
      const leftStarts = left.toLowerCase().startsWith(needle) ? 0 : 1;
      const rightStarts = right.toLowerCase().startsWith(needle) ? 0 : 1;

      if (leftStarts !== rightStarts) {
        return leftStarts - rightStarts;
      }

      if (left.length !== right.length) {
        return left.length - right.length;
      }

      return left.localeCompare(right);
    })
    .slice(0, limit);
}
