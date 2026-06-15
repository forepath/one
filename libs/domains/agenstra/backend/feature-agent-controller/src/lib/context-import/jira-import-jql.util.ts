/**
 * Resolves a stored board id to a positive integer for GET /rest/agile/1.0/board/{id}/issue.
 * Non-numeric, zero, negative, or missing values mean "no board scope" (use global JQL search instead).
 */
export function resolveJiraBoardIdForAgileApi(boardId: unknown): number | null {
  if (typeof boardId === 'number' && Number.isFinite(boardId)) {
    const n = Math.trunc(boardId);

    return n > 0 ? n : null;
  }

  if (typeof boardId === 'string') {
    const t = boardId.trim();
    const n = Number.parseInt(t, 10);

    if (Number.isFinite(n) && n > 0 && String(n) === t) {
      return n;
    }
  }

  return null;
}

/** JQL for POST /rest/api/3/search — stable ordering when the user omits ORDER BY. */
export function buildJiraIssueSearchJql(jqlRaw: string): string {
  const trimmed = jqlRaw.trim();

  if (!trimmed) {
    return '';
  }

  if (/\border\s+by\b/i.test(trimmed)) {
    return trimmed;
  }

  return `${trimmed} order by updated DESC`;
}
