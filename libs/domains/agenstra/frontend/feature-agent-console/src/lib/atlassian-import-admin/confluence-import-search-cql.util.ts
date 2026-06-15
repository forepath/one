/**
 * Mirrors backend `buildConfluenceImportSearchCql` in
 * `feature-agent-controller/.../confluence-import-cql.util.ts` — keep in sync when that logic changes.
 */

function splitCqlMainAndOrder(trimmed: string): { main: string; order: string | null } {
  const idx = trimmed.search(/\s+order\s+by\b/i);

  if (idx === -1) {
    return { main: trimmed, order: null };
  }

  return {
    main: trimmed.slice(0, idx).trim(),
    order: trimmed.slice(idx).trim(),
  };
}

function cqlQuotedString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function cqlPageIdLiteral(id: string): string {
  if (/^\d+$/.test(id)) {
    return id;
  }

  return cqlQuotedString(id);
}

export function buildConfluenceImportSearchCql(
  cqlRaw: string,
  spaceKey: string | null | undefined,
  rootPageId: string | null | undefined,
): string {
  const trimmed = cqlRaw.trim();

  if (!trimmed) {
    return '';
  }

  // eslint-disable-next-line prefer-const
  let { main, order } = splitCqlMainAndOrder(trimmed);

  if (!order) {
    order = 'order by lastModified desc';
  }

  const constraints: string[] = [];
  const sk = spaceKey?.trim();

  if (sk) {
    constraints.push(`space = ${cqlQuotedString(sk)}`);
  }

  const rp = rootPageId?.trim();

  if (rp) {
    const idLit = cqlPageIdLiteral(rp);

    constraints.push(`(id = ${idLit} OR ancestor = ${idLit})`);
  }

  if (constraints.length === 0) {
    return `${main} ${order}`.trim();
  }

  return `(${main}) AND ${constraints.join(' AND ')} ${order}`.trim();
}
