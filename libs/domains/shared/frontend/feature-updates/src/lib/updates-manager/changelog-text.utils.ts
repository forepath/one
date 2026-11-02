export type ChangelogTextPart = { kind: 'text'; value: string } | { kind: 'link'; label: string; href: string };

/** Markdown inline links only: `[label](https://...)` / `[label](http://...)`. */
const MARKDOWN_LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;

/**
 * Split changelog entry text into plain text and http(s) link parts for safe template rendering.
 * Non-http schemes and malformed markdown are left as plain text.
 */
export function parseChangelogMarkdownLinks(text: string): ChangelogTextPart[] {
  const source = text ?? '';
  const parts: ChangelogTextPart[] = [];
  let lastIndex = 0;

  for (const match of source.matchAll(MARKDOWN_LINK_RE)) {
    const matchIndex = match.index ?? 0;
    const [full, label, href] = match;

    if (matchIndex > lastIndex) {
      parts.push({ kind: 'text', value: source.slice(lastIndex, matchIndex) });
    }

    parts.push({ kind: 'link', label: label ?? '', href: href ?? '' });
    lastIndex = matchIndex + full.length;
  }

  if (lastIndex < source.length) {
    parts.push({ kind: 'text', value: source.slice(lastIndex) });
  }

  if (parts.length === 0 && source.length > 0) {
    return [{ kind: 'text', value: source }];
  }

  return parts;
}

/** A changelog entry as shown: the scope tag, the conventional-commit type (if the line had one), the readable text. */
export interface ChangelogEntryView {
  /** `shared` of `**shared:** …` / `fix(shared): …`; null without one. */
  scope: string | null;
  /** `fix`, `feat`, … of a raw conventional-commit line; null otherwise. */
  type: string | null;
  breaking: boolean;
  /** The text without list marker, scope prefix and `**` markers (links stay markdown for `parseChangelogMarkdownLinks`). */
  text: string;
}

const CONVENTIONAL_TYPES = new Set([
  'feat',
  'fix',
  'perf',
  'refactor',
  'docs',
  'style',
  'test',
  'tests',
  'build',
  'ci',
  'chore',
  'revert',
  'security',
  'deps',
]);

/**
 * Release notes list entries as `**scope:** text` (release tooling) or, where a note kept the raw commit, as
 * `type(scope)!: text`. Both become a scope tag and the plain text; the type is reported so a generic "Changes" entry can
 * be filed under its real category.
 */
export function parseChangelogEntry(raw: string): ChangelogEntryView {
  let text = (raw ?? '').trim().replace(/^[-*+]\s+/, '');
  let scope: string | null = null;
  let type: string | null = null;
  let breaking = false;

  const bold = /^\*\*([^*]+?)(?::\*\*|\*\*:)\s*(.*)$/s.exec(text);

  if (bold) {
    scope = bold[1].trim();
    text = bold[2];
  } else {
    const commit = /^([a-z]+)(?:\(([^)]+)\))?(!)?:\s+(.*)$/is.exec(text);

    if (commit && CONVENTIONAL_TYPES.has(commit[1].toLowerCase())) {
      type = commit[1].toLowerCase();
      scope = commit[2]?.trim() || null;
      breaking = !!commit[3];
      text = commit[4];
    }
  }

  // Older notes name the product as the first word ("decabill instant cancellations"): that is the scope.
  if (!scope) {
    const leading = /^(agenstra|decabill|loadweaver|forepath)\s+(.+)$/is.exec(text);

    if (leading) {
      scope = leading[1].toLowerCase();
      text = leading[2];
    }
  }

  return { scope, type, breaking, text: text.replace(/\*\*([^*]+)\*\*/g, '$1').trim() };
}

/** Categories that only say "a change": a parsed commit type tells more. */
const GENERIC_CATEGORIES = new Set(['', 'changes', 'change', 'other', 'others', 'misc', 'miscellaneous']);

/** A release-note section that lists breaking changes (`⚠ BREAKING CHANGES`), whatever their type. */
export function isBreakingCategory(category: string | null | undefined): boolean {
  return /^[^\p{L}\p{N}]*breaking/iu.test(category ?? '');
}

/**
 * The change type to show (user, 2026-10-29: the badge always names the type; "breaking" is a separate marker): the
 * line's own conventional-commit type where it has one and the section is generic or the breaking list, else the
 * section's type; a breaking note without a type is "other".
 */
export function changelogCategory(category: string | null | undefined, view: ChangelogEntryView): string | undefined {
  const own = (category ?? '').trim();

  if (isBreakingCategory(own)) return view.type ?? undefined;

  if (view.type && GENERIC_CATEGORIES.has(own.toLowerCase())) return view.type;

  return own || undefined;
}

/** Whether the entry is a breaking change: listed under the breaking section or marked `type!:`. */
export function changelogBreaking(category: string | null | undefined, view: ChangelogEntryView): boolean {
  return view.breaking || isBreakingCategory(category);
}

/** Product scopes of the monorepo: their entries belong to that product, never to the shared changelog. */
export const CHANGELOG_PRODUCT_SCOPES: ReadonlySet<string> = new Set([
  'agenstra',
  'decabill',
  'loadweaver',
  'forepath',
]);

/**
 * Splits the shared list the way the release notes mean it (user, 2026-10-29: shared = the `shared` scope and unscoped
 * entries): entries of the current product move to the product list, other products' entries are dropped. Also covers
 * control planes whose classifier didn't know the `**scope:**` format yet.
 */
export function splitSharedChangelog<T extends { text: string }>(
  shared: readonly T[],
  currentProduct: string | null,
): { shared: T[]; product: T[] } {
  const keep: T[] = [];
  const product: T[] = [];

  for (const entry of shared) {
    const scope = parseChangelogEntry(entry.text).scope?.toLowerCase() ?? null;

    if (scope && currentProduct && scope === currentProduct) product.push(entry);
    else if (!scope || !CHANGELOG_PRODUCT_SCOPES.has(scope)) keep.push(entry);
  }

  return { shared: keep, product };
}
