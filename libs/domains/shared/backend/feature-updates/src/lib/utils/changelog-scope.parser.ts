import type { ChangelogEntry, ProductScope, ScopedChangelog } from '../interfaces/updates.interfaces';

const BULLET_LINE_PATTERN = /^\s*(?:[-*]|\d+\.)\s+(.+)$/;

const CONVENTIONAL_SCOPE_PATTERN = /(?:^|\s)(?:\w+)?\((agenstra|decabill|loadweaver)\)/i;

const LEADING_PRODUCT_PATTERN = /^(agenstra|decabill|loadweaver)\b/i;

/** Release-tool lines: `**scope:** text` / `**scope**: text`. */
const BOLD_SCOPE_PATTERN = /^\*\*([a-z0-9_-]+)(?::\*\*|\*\*:)/i;

/** Conventional-commit lines: `type(scope)!: text`. */
const COMMIT_SCOPE_PATTERN = /^[a-z]+\(([a-z0-9_-]+)\)!?:/i;

/**
 * Products of the monorepo besides the three update-scoped ones: their entries belong to no product's changelog and
 * never to "shared" (user, 2026-10-29: the shared changelog shows the `shared` scope and unscoped entries only).
 */
const OTHER_PRODUCTS = new Set(['forepath']);

const SECTION_HEADER_PATTERN = /^#{1,6}\s+(.+)$/;

function normalizeProduct(value: string): ProductScope | undefined {
  const normalized = value.trim().toLowerCase();

  if (normalized === 'agenstra' || normalized === 'decabill' || normalized === 'loadweaver') {
    return normalized;
  }

  return undefined;
}

function classifyChangelogLine(text: string): Pick<ChangelogEntry, 'scope' | 'product'> {
  const explicit = (text.match(BOLD_SCOPE_PATTERN) ?? text.match(COMMIT_SCOPE_PATTERN))?.[1]?.toLowerCase();

  if (explicit) {
    const product = normalizeProduct(explicit);

    if (product) return { scope: 'product', product };

    // Another product's entry: no product changelog shows it (no `product`), and it isn't shared either.
    if (OTHER_PRODUCTS.has(explicit)) return { scope: 'product' };
  }

  const conventionalMatch = text.match(CONVENTIONAL_SCOPE_PATTERN);
  const conventionalProduct = conventionalMatch?.[1] ? normalizeProduct(conventionalMatch[1]) : undefined;

  if (conventionalProduct) {
    return { scope: 'product', product: conventionalProduct };
  }

  // Another product named as the line's first word ("forepath landingpage …"): not shared either.
  if (OTHER_PRODUCTS.has((text.match(/^([a-z0-9_-]+)\b/i)?.[1] ?? '').toLowerCase())) return { scope: 'product' };

  const leadingMatch = text.match(LEADING_PRODUCT_PATTERN);
  const leadingProduct = leadingMatch?.[1] ? normalizeProduct(leadingMatch[1]) : undefined;

  if (leadingProduct) {
    return { scope: 'product', product: leadingProduct };
  }

  return { scope: 'shared' };
}

function normalizeSectionCategory(sectionTitle: string): string | undefined {
  const normalized = sectionTitle.trim().toLowerCase();

  if (normalized.length === 0) {
    return undefined;
  }

  return normalized.replace(/\s+/g, ' ');
}

export function parseChangelogMarkdown(body: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  let currentCategory: string | undefined;

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (line.length === 0) {
      continue;
    }

    const sectionMatch = line.match(SECTION_HEADER_PATTERN);

    if (sectionMatch?.[1]) {
      currentCategory = normalizeSectionCategory(sectionMatch[1]);
      continue;
    }

    const bulletMatch = line.match(BULLET_LINE_PATTERN);

    if (!bulletMatch?.[1]) {
      continue;
    }

    const text = bulletMatch[1].trim();
    const classification = classifyChangelogLine(text);

    entries.push({
      text,
      ...classification,
      ...(currentCategory ? { category: currentCategory } : {}),
    });
  }

  return entries;
}

export function filterChangelogForProduct(entries: ChangelogEntry[], productScope: ProductScope): ScopedChangelog {
  const product: ChangelogEntry[] = [];
  const shared: ChangelogEntry[] = [];

  for (const entry of entries) {
    if (entry.scope === 'shared') {
      shared.push(entry);
      continue;
    }

    if (entry.product === productScope) {
      product.push(entry);
    }
  }

  return { product, shared };
}

export function scopeChangelogEntries(entries: ChangelogEntry[], productScope: ProductScope): ScopedChangelog {
  return filterChangelogForProduct(entries, productScope);
}
