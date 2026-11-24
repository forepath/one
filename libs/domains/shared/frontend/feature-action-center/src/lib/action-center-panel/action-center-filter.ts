import type {
  ActionCenterGroup,
  ActionCenterItem,
  ActionCenterSeverity,
  ActionCenterSilence,
} from '@forepath/shared/frontend/data-access-action-center';

/** Search term and filters of the panel (applied to the Open and the Silenced tab alike). */
export interface ActionCenterFilter {
  search: string;
  category: string | null;
  severity: ActionCenterSeverity | null;
}

/** Display texts of a group / record, as rendered (presenters), so search matches what the user sees. */
export interface ActionCenterSearchTexts {
  group: (group: ActionCenterGroup) => readonly (string | null)[];
  item: (group: ActionCenterGroup, item: ActionCenterItem) => readonly (string | null)[];
}

export function isActionCenterFilterActive(filter: ActionCenterFilter): boolean {
  return filter.search.trim().length > 0 || filter.category !== null || filter.severity !== null;
}

function normalize(value: string): string {
  return value
    .toLocaleLowerCase()
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '');
}

/** Every whitespace-separated term must occur in one of the texts. */
function matches(terms: readonly string[], texts: readonly (string | null)[]): boolean {
  const haystack = normalize(texts.filter(Boolean).join(' '));

  return terms.every((term) => haystack.includes(term));
}

function searchTerms(search: string): string[] {
  return normalize(search).split(/\s+/).filter(Boolean);
}

/**
 * Filters groups: area / priority by group; the search keeps a group with all records when the group itself matches,
 * otherwise only its matching records (the group then counts just those).
 */
export function filterActionCenterGroups(
  groups: readonly ActionCenterGroup[],
  filter: ActionCenterFilter,
  texts: ActionCenterSearchTexts,
): ActionCenterGroup[] {
  const terms = searchTerms(filter.search);

  return groups.flatMap((group) => {
    if (
      (filter.category && group.category !== filter.category) ||
      (filter.severity && group.severity !== filter.severity)
    ) {
      return [];
    }

    if (terms.length === 0 || matches(terms, texts.group(group))) {
      return [group];
    }

    const items = group.items.filter((item) => item.silencedBy === null && matches(terms, texts.item(group, item)));

    return items.length > 0 ? [{ ...group, items, openCount: items.length }] : [];
  });
}

/**
 * Filters silences: area / priority via the silenced type's group (silences of types without open records only match
 * without those filters), search via the silence's display texts.
 */
export function filterActionCenterSilences(
  silences: readonly ActionCenterSilence[],
  groups: readonly ActionCenterGroup[],
  filter: ActionCenterFilter,
  texts: (silence: ActionCenterSilence) => readonly (string | null)[],
): ActionCenterSilence[] {
  const terms = searchTerms(filter.search);
  const byType = new Map(groups.map((group) => [group.type, group]));

  return silences.filter((silence) => {
    const group = byType.get(silence.itemType);

    if (filter.category && group?.category !== filter.category) {
      return false;
    }

    if (filter.severity && group?.severity !== filter.severity) {
      return false;
    }

    return terms.length === 0 || matches(terms, texts(silence));
  });
}
