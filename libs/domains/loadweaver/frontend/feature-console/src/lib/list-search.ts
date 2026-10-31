/**
 * Client-side list search shared by the console's list pages: case-insensitive substring match
 * over the fields a row shows. Lists are loaded completely, so filtering stays in the browser.
 */
export type SearchValue = string | number | null | undefined | readonly (string | null | undefined)[];

export function normalizeSearch(term: string | null | undefined): string {
  return (term ?? '').trim().toLowerCase();
}

/** `true` when `term` is empty or any of `values` contains it (case-insensitive). */
export function matchesSearch(term: string | null | undefined, values: readonly SearchValue[]): boolean {
  const needle = normalizeSearch(term);

  if (!needle) return true;

  return values.some((value) => {
    if (value === null || value === undefined) return false;

    if (Array.isArray(value)) {
      return value.some((entry) => typeof entry === 'string' && entry.toLowerCase().includes(needle));
    }

    return String(value).toLowerCase().includes(needle);
  });
}

/** Rows of `items` whose `fields` match `term`; returns `items` itself while `term` is empty. */
export function filterBySearch<T>(
  items: readonly T[],
  term: string | null | undefined,
  fields: (item: T) => readonly SearchValue[],
): readonly T[] {
  if (!normalizeSearch(term)) return items;

  return items.filter((item) => matchesSearch(term, fields(item)));
}

/**
 * Search syntax shared by the console's toolbars, the resource tree and the palette (3.37):
 * free text, `field:value`, `field:"quoted value"`, `-field:value` (exclude) and `"quoted text"`.
 * All terms must match (AND). Field values match case-insensitively as substrings.
 */
export interface SearchTerm {
  /** `null` for free text. */
  field: string | null;
  value: string;
  negated: boolean;
}

export interface ParsedSearch {
  terms: SearchTerm[];
  /** Free-text terms. */
  text: SearchTerm[];
  /** `field:value` terms. */
  filters: SearchTerm[];
}

/** Values a row exposes to the search: free text and named fields (`kind`, `project`, `status`, …). */
export interface SearchDocument {
  text: readonly SearchValue[];
  fields: Readonly<Record<string, SearchValue>>;
}

const FIELD_PATTERN = /^[a-z][a-z0-9_.-]*$/i;

function tokenize(query: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quoted = false;

  for (const char of query) {
    if (char === '"') {
      quoted = !quoted;
      current += char;
    } else if (/\s/.test(char) && !quoted) {
      if (current) tokens.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (current) tokens.push(current);

  return tokens;
}

function unquote(value: string): string {
  return value.replace(/^"/, '').replace(/"$/, '');
}

/**
 * Parses a query. With `fields`, only those names count as fields (`http://x` stays text); without,
 * any `name:value` does. A field with an empty value (`kind:`) is ignored while typing.
 */
export function parseSearch(query: string | null | undefined, fields?: readonly string[]): ParsedSearch {
  const known = fields ? new Set(fields.map((field) => field.toLowerCase())) : null;
  const terms: SearchTerm[] = [];

  for (const token of tokenize((query ?? '').trim())) {
    const negated = token.length > 1 && token.startsWith('-');
    const body = negated ? token.slice(1) : token;
    const colon = body.indexOf(':');
    const field = colon > 0 ? body.slice(0, colon).toLowerCase() : null;

    if (field && FIELD_PATTERN.test(field) && (!known || known.has(field))) {
      const value = unquote(body.slice(colon + 1));

      if (value) terms.push({ field, value, negated });
      continue;
    }

    const value = unquote(body);

    if (value) terms.push({ field: null, value, negated });
  }

  return {
    terms,
    text: terms.filter((term) => term.field === null),
    filters: terms.filter((term) => term.field !== null),
  };
}

/** One term back as query text (quoted when it contains spaces). */
export function formatSearchTerm(term: SearchTerm): string {
  const value = /\s/.test(term.value) ? `"${term.value}"` : term.value;

  return `${term.negated ? '-' : ''}${term.field ? `${term.field}:` : ''}${value}`;
}

export function formatSearch(terms: readonly SearchTerm[]): string {
  return terms.map(formatSearchTerm).join(' ');
}

function sameTerm(a: SearchTerm, b: SearchTerm): boolean {
  return a.field === b.field && a.negated === b.negated && a.value.toLowerCase() === b.value.toLowerCase();
}

/** `query` without `term` (e.g. a removed chip). */
export function removeSearchTerm(query: string, term: SearchTerm, fields?: readonly string[]): string {
  return formatSearch(parseSearch(query, fields).terms.filter((candidate) => !sameTerm(candidate, term)));
}

/** `query` with `field:value` set (replacing other values of that field unless `append`). */
export function setSearchFilter(
  query: string,
  field: string,
  value: string | null,
  options: { append?: boolean; negated?: boolean; fields?: readonly string[] } = {},
): string {
  const name = field.toLowerCase();
  const terms = parseSearch(query, options.fields).terms.filter((term) => options.append || term.field !== name);

  if (value) {
    const next: SearchTerm = { field: name, value, negated: !!options.negated };

    if (!terms.some((term) => sameTerm(term, next))) terms.push(next);
  }

  return formatSearch(terms);
}

/** Chip models for the `field:value` terms (`fpc-filter-chips`); the id identifies the term. */
export function searchChips(parsed: ParsedSearch): { id: string; field: string; value: string; negated: boolean }[] {
  return parsed.filters.map((term) => ({
    id: formatSearchTerm(term),
    field: term.field as string,
    value: term.value,
    negated: term.negated,
  }));
}

function valueMatches(value: SearchValue, needle: string): boolean {
  if (value === null || value === undefined) return false;

  if (Array.isArray(value)) {
    return value.some((entry) => typeof entry === 'string' && entry.toLowerCase().includes(needle));
  }

  return String(value).toLowerCase().includes(needle);
}

function termMatches(term: SearchTerm, doc: SearchDocument): boolean {
  const needle = term.value.toLowerCase();
  const hit =
    term.field === null
      ? doc.text.some((value) => valueMatches(value, needle)) ||
        Object.values(doc.fields).some((value) => valueMatches(value, needle))
      : valueMatches(doc.fields[term.field], needle);

  return term.negated ? !hit : hit;
}

/** `true` when every term of `parsed` matches `doc` (an empty query matches everything). */
export function matchesParsedSearch(parsed: ParsedSearch, doc: SearchDocument): boolean {
  return parsed.terms.every((term) => termMatches(term, doc));
}

/** Rows of `items` matching `query` in the search syntax; returns `items` itself for an empty query. */
export function filterBySearchSyntax<T>(
  items: readonly T[],
  query: string | null | undefined,
  document: (item: T) => SearchDocument,
  fields?: readonly string[],
): readonly T[] {
  const parsed = parseSearch(query, fields);

  if (parsed.terms.length === 0) return items;

  return items.filter((item) => matchesParsedSearch(parsed, document(item)));
}

/** Filter-panel state in the URL (`?f=kind=Node|VirtualMachine;status=ready`). */
export function encodeFilterParam(filters: Readonly<Record<string, readonly string[]>>): string | null {
  const parts = Object.keys(filters)
    .sort()
    .filter((key) => filters[key].length > 0)
    .map((key) => `${encodeURIComponent(key)}=${filters[key].map(encodeURIComponent).join('|')}`);

  return parts.length > 0 ? parts.join(';') : null;
}

export function decodeFilterParam(param: string | null | undefined): Record<string, string[]> {
  const filters: Record<string, string[]> = {};

  for (const part of (param ?? '').split(';')) {
    const [key, values] = part.split('=');

    if (!key || !values) continue;

    try {
      filters[decodeURIComponent(key)] = values.split('|').filter(Boolean).map(decodeURIComponent);
    } catch {
      // A malformed part is skipped.
    }
  }

  return filters;
}

/** Empty state of a list whose search (or filters) hides every row. */
export const NO_MATCHES_TITLE = $localize`:@@lwConsoleList-noMatches:No matches`;
export const NO_MATCHES_HINT = $localize`:@@lwConsoleList-noMatchesHint:Nothing matches the search. Try another term or clear the search.`;
