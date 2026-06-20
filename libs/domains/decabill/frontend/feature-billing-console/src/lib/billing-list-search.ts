export function normalizeSearchTerm(term: string): string {
  return term.trim().toLowerCase();
}

export function filterItemsBySearch<T>(items: T[], term: string, toHaystack: (item: T) => string): T[] {
  const normalized = normalizeSearchTerm(term);

  if (!normalized) {
    return items;
  }

  return items.filter((item) => toHaystack(item).toLowerCase().includes(normalized));
}
