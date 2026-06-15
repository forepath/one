import {
  confluenceAncestorChainForImport,
  isConfluencePageTypeAncestor,
  trimShallowestConfluenceAncestorForSingleResultBatch,
} from './atlassian-format-to-markdown';

export interface ConfluencePageLike {
  id: string;
  title?: string;
  body?: { storage?: { value?: string }; view?: { value?: string } };
  ancestors?: Array<{ id?: string; type?: string; title?: string }>;
}

/** Root → immediate parent chain after root slice and optional single-result trim. */
export function confluenceTrimmedImportChain(
  page: ConfluencePageLike,
  batchSize: number,
  rootPageId: string | null | undefined,
): Array<{ id?: string; type?: string; title?: string }> {
  return trimShallowestConfluenceAncestorForSingleResultBatch(
    batchSize,
    confluenceAncestorChainForImport(page.ancestors, rootPageId),
  );
}

/** Distance from import attachment (number of ancestor hops below trim/root). */
export function confluencePageImportDepth(
  page: ConfluencePageLike,
  batchSize: number,
  rootPageId: string | null | undefined,
): number {
  return confluenceTrimmedImportChain(page, batchSize, rootPageId).length;
}

export function sortConfluencePagesByImportDepthAsc(
  pages: readonly ConfluencePageLike[],
  rootPageId: string | null | undefined,
): ConfluencePageLike[] {
  const n = pages.length;

  return [...pages].sort(
    (a, b) =>
      confluencePageImportDepth(a, n, rootPageId) - confluencePageImportDepth(b, n, rootPageId) ||
      a.id.localeCompare(b.id),
  );
}

export function sortConfluencePagesByImportDepthDesc(
  pages: readonly ConfluencePageLike[],
  rootPageId: string | null | undefined,
): ConfluencePageLike[] {
  const n = pages.length;

  return [...pages].sort(
    (a, b) =>
      confluencePageImportDepth(b, n, rootPageId) - confluencePageImportDepth(a, n, rootPageId) ||
      a.id.localeCompare(b.id),
  );
}

/**
 * Collects Confluence page ids linked from storage/view HTML (internal page links).
 * Matches common Confluence Storage / XHTML patterns (ri:content-id, linked-resource-id).
 */
export function extractConfluenceInternalPageIdsFromHtml(html: string): string[] {
  if (!html) {
    return [];
  }

  const ids = new Set<string>();
  const patterns = [
    /ri:content-id="(\d+)"/gi,
    /ri:content-id='(\d+)'/gi,
    /data-linked-resource-id="(\d+)"/gi,
    /data-linked-resource-id='(\d+)'/gi,
  ];

  for (const re of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;

    while ((m = re.exec(html)) !== null) {
      ids.add(m[1]);
    }
  }

  return [...ids];
}

/** True if `ancestorId` is a page-type node on the trimmed import chain of `page`. */
export function confluenceTrimmedChainContainsPageAncestor(
  page: ConfluencePageLike,
  batchSize: number,
  rootPageId: string | null | undefined,
  ancestorId: string,
): boolean {
  return confluenceTrimmedImportChain(page, batchSize, rootPageId).some(
    (a) => isConfluencePageTypeAncestor(a) && a.id === ancestorId,
  );
}
