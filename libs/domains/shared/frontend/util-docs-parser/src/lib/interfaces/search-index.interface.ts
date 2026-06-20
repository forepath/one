/**
 * Search index entry for a documentation page
 */
export interface SearchIndexEntry {
  /** Route path */
  path: string;
  /** Page title */
  title: string;
  /** Page summary */
  summary: string;
  /** Full text content for searching */
  content: string;
  /** Headings for context in search results */
  headings: string[];
}

/**
 * Complete search index
 */
export interface SearchIndex {
  /** All searchable entries */
  entries: SearchIndexEntry[];
}
