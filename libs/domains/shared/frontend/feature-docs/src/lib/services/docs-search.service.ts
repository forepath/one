import { HttpClient } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { SearchIndex, SearchIndexEntry } from '@forepath/shared/frontend/util-docs-parser';
import { catchError, Observable, of, shareReplay } from 'rxjs';

export interface SearchResult {
  entry: SearchIndexEntry;
  score: number;
  highlights: string[];
}

/**
 * Service for search functionality
 */
@Injectable({
  providedIn: 'root',
})
export class DocsSearchService {
  private readonly http = inject(HttpClient);

  private searchIndexCache: Observable<SearchIndex | null> | null = null;

  /**
   * Current search query
   */
  readonly searchQuery = signal<string>('');

  /**
   * Current search results
   */
  readonly searchResults = signal<SearchResult[]>([]);

  /**
   * Load search index
   */
  loadSearchIndex(): Observable<SearchIndex | null> {
    if (this.searchIndexCache) {
      return this.searchIndexCache;
    }

    this.searchIndexCache = this.http.get<SearchIndex>('/assets/docs/index.json').pipe(
      catchError((error) => {
        console.error('Failed to load search index', error);

        return of(null);
      }),
      shareReplay(1),
    );

    return this.searchIndexCache;
  }

  /**
   * Perform search
   */
  search(query: string, index: SearchIndex): SearchResult[] {
    if (!query || query.trim().length === 0) {
      this.searchResults.set([]);

      return [];
    }

    const searchTerms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((term) => term.length > 0);
    const results: SearchResult[] = [];

    for (const entry of index.entries) {
      let score = 0;
      const highlights: string[] = [];
      // Search in title (highest weight)
      const titleLower = entry.title.toLowerCase();

      for (const term of searchTerms) {
        if (titleLower.includes(term)) {
          score += 10;
          highlights.push(`Title: ${this.highlightTerm(entry.title, term)}`);
        }
      }

      // Search in headings
      for (const heading of entry.headings) {
        const headingLower = heading.toLowerCase();

        for (const term of searchTerms) {
          if (headingLower.includes(term)) {
            score += 5;
            highlights.push(`Heading: ${this.highlightTerm(heading, term)}`);
          }
        }
      }

      // Search in content
      const contentLower = entry.content.toLowerCase();

      for (const term of searchTerms) {
        if (contentLower.includes(term)) {
          score += 1;
          const contentSnippet = this.extractSnippet(entry.content, term, 100);

          highlights.push(`Content: ${this.highlightTerm(contentSnippet, term)}`);
        }
      }

      // Search in summary
      const summaryLower = entry.summary.toLowerCase();

      for (const term of searchTerms) {
        if (summaryLower.includes(term)) {
          score += 3;
          highlights.push(`Summary: ${this.highlightTerm(entry.summary, term)}`);
        }
      }

      if (score > 0) {
        results.push({
          entry,
          score,
          highlights: highlights.slice(0, 3), // Limit highlights
        });
      }
    }

    // Sort by score (descending)
    results.sort((a, b) => b.score - a.score);

    // Limit results
    const limitedResults = results.slice(0, 20);

    this.searchResults.set(limitedResults);

    return limitedResults;
  }

  /**
   * Highlight search term in text
   */
  private highlightTerm(text: string, term: string): string {
    const regex = new RegExp(`(${term})`, 'gi');

    return text.replace(regex, '<mark>$1</mark>');
  }

  /**
   * Extract snippet around search term
   */
  private extractSnippet(content: string, term: string, maxLength: number): string {
    const index = content.toLowerCase().indexOf(term.toLowerCase());

    if (index === -1) {
      return content.substring(0, maxLength);
    }

    const start = Math.max(0, index - maxLength / 2);
    const end = Math.min(content.length, index + term.length + maxLength / 2);
    let snippet = content.substring(start, end);

    if (start > 0) {
      snippet = '...' + snippet;
    }

    if (end < content.length) {
      snippet = snippet + '...';
    }

    return snippet;
  }

  /**
   * Clear search
   */
  clearSearch(): void {
    this.searchQuery.set('');
    this.searchResults.set([]);
  }
}
