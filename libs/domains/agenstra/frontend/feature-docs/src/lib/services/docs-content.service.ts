import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { DocMetadata, MarkdownParserService } from '@forepath/agenstra/frontend/util-docs-parser';
import { catchError, from, Observable, of, shareReplay, switchMap, timeout } from 'rxjs';

/**
 * Service for loading and caching documentation content
 */
@Injectable({
  providedIn: 'root',
})
export class DocsContentService {
  private readonly http = inject(HttpClient);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly markdownParser = inject(MarkdownParserService);

  private readonly cache = new Map<string, DocMetadata>();
  private readonly loadingCache = new Map<string, Observable<DocMetadata | null>>();

  /**
   * Load documentation content by file path
   */
  loadContent(filePath: string): Observable<DocMetadata | null> {
    // Check cache first
    const cached = this.cache.get(filePath);

    if (cached) {
      return of(cached);
    }

    // Check if already loading
    const loading = this.loadingCache.get(filePath);

    if (loading) {
      return loading;
    }

    // Load from assets (markdown files are served directly)
    // Convert file path to asset path: agenstra/getting-started.md -> /docs/agenstra/getting-started.md
    const assetPath = `/docs/${filePath}`;
    const load$ = this.http.get(assetPath, { responseType: 'text', observe: 'response' }).pipe(
      timeout(10000), // 10 second timeout to prevent hanging requests
      switchMap((response) => {
        // Check if response is actually successful and has content
        // Also check content-type to ensure it's not HTML (which might be a fallback page)
        const contentType = response.headers.get('content-type') || '';
        const isHtml = contentType.includes('text/html');

        if (response.status !== 200 || !response.body || response.body.trim().length === 0 || isHtml) {
          // Return null if response is empty, not successful, or is HTML (likely a fallback page)
          if (isHtml) {
            console.warn(`Received HTML response instead of markdown for: ${filePath} (likely file doesn't exist)`);
          }

          return of(null);
        }

        // Parse markdown asynchronously
        return from(this.markdownParser.parseMarkdown(response.body, filePath));
      }),
      catchError((error) => {
        // Handle timeout and other errors
        if (error.name === 'TimeoutError' || error.message?.includes('timeout')) {
          console.warn(`Request timeout for documentation: ${filePath}`);
        } else if (error.status === 404) {
          // 404 is expected for files that don't exist - don't log as error
          return of(null);
        } else {
          // Log other errors
          console.error(`Failed to load documentation: ${filePath}`, error);
        }

        return of(null);
      }),
      shareReplay(1),
    );

    // Cache the loading observable
    this.loadingCache.set(filePath, load$);

    // Cache the result when loaded
    load$.subscribe((metadata) => {
      if (metadata) {
        this.cache.set(filePath, metadata);
        this.loadingCache.delete(filePath);
      }
    });

    return load$;
  }

  /**
   * Get cached content if available
   */
  getCachedContent(filePath: string): DocMetadata | null {
    return this.cache.get(filePath) || null;
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
    this.loadingCache.clear();
  }

  /**
   * Sanitize HTML content
   */
  sanitizeHtml(html: string): SafeHtml {
    return this.sanitizer.sanitize(1, html) || '';
  }
}
