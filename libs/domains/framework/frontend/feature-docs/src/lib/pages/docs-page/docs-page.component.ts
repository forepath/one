import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Component, DestroyRef, effect, inject, LOCALE_ID, OnInit, PLATFORM_ID, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Meta, Title } from '@angular/platform-browser';
import { ActivatedRoute, NavigationEnd, Router, RouterModule } from '@angular/router';
import { ENVIRONMENT, type Environment } from '@forepath/framework/frontend/util-configuration';
import { DocMetadata, NavigationNode } from '@forepath/framework/frontend/util-docs-parser';
import {
  addPageMetaTags,
  applySocialPreviewMeta,
  DOCS_PAGE_DYNAMIC_META_TAG_STUBS,
  formatAgenstraMetaDescription,
  formatAgenstraMetaTitle,
  removePageMetaTags,
  resolveSocialCanonicalUrl,
} from '@forepath/framework/frontend/util-meta';
import { catchError, filter, map, Observable, of, startWith, switchMap } from 'rxjs';

import { DocsBreadcrumbsComponent, DocsContentComponent, DocsTableOfContentsComponent } from '../../components';
import { DocsContentService, DocsNavigationService } from '../../services';

@Component({
  selector: 'framework-docs-page',
  imports: [CommonModule, RouterModule, DocsBreadcrumbsComponent, DocsContentComponent, DocsTableOfContentsComponent],
  templateUrl: './docs-page.component.html',
  styleUrls: ['./docs-page.component.scss'],
  standalone: true,
})
export class DocsPageComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly contentService = inject(DocsContentService);
  private readonly navigationService = inject(DocsNavigationService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly titleService = inject(Title);
  private readonly metaService = inject(Meta);
  private readonly environment = inject<Environment>(ENVIRONMENT);
  private readonly locale = inject(LOCALE_ID);

  private readonly metaTitleFallback = $localize`:@@featureDocsPage-metaTitleFallback:Documentation :: Agenstra`;
  private readonly metaDescriptionFallback = $localize`:@@featureDocsPage-metaDescriptionFallback:Official Agenstra documentation: install, deploy, secure, and operate agent hosts, workspaces, tickets, APIs, and integrations for platform teams.`;
  private readonly destroyRef = inject(DestroyRef);
  private readonly docsStaticMetaTags = [
    {
      name: 'keywords',
      content: $localize`:@@featureDocsPage-metaKeywords:Agenstra, AI agents, agent management, distributed systems, AI agent infrastructure, agent platform, AI agent console, container management, WebSocket agents, Docker agents`,
    },
    { name: 'author', content: 'IPvX UG (haftungsbeschränkt)' },
    { name: 'robots', content: 'index, follow' },
  ];

  constructor() {
    // Update active path whenever currentPath changes
    effect(() => {
      const path = this.currentPath();

      this.navigationService.setActivePath(path || '/docs');
    });

    effect(() => {
      this.applyPageMeta(this.metadata(), this.currentPath());
    });
  }

  /**
   * Current documentation metadata
   */
  readonly metadata = signal<DocMetadata | null>(null);

  /**
   * Navigation nodes
   */
  readonly navigationNodes = toSignal(this.navigationService.loadNavigation(), {
    initialValue: [] as NavigationNode[],
  });

  /**
   * Loading state
   */
  readonly loading = signal<boolean>(true);

  /**
   * Error state
   */
  readonly error = signal<string | null>(null);

  /**
   * Current path from route (reactive)
   * Converts route paths (/agenstra/... or /framework/...) to navigation paths (/docs/...)
   */
  readonly currentPath = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => {
        // Get current URL from router
        const url = this.router.url;
        // Remove query params and hash
        const path = url.split('?')[0].split('#')[0];
        // Normalize the path to match navigation.json format
        let normalizedPath = path;

        // Convert /agenstra/... to /docs/... to match navigation paths
        if (normalizedPath.startsWith('/agenstra/')) {
          normalizedPath = normalizedPath.replace('/agenstra/', '/docs/');
        } else if (normalizedPath === '/agenstra') {
          normalizedPath = '/docs';
        } else if (normalizedPath.startsWith('/framework/')) {
          normalizedPath = normalizedPath.replace('/framework/', '/docs/');
        } else if (normalizedPath === '/framework') {
          normalizedPath = '/docs';
        } else if (!normalizedPath.startsWith('/docs')) {
          // Default to /docs if path doesn't match expected patterns
          normalizedPath = '/docs';
        }

        // Remove any README that might have been appended
        normalizedPath = normalizedPath.replace(/\/README$/g, '').replace(/README$/g, '');

        return normalizedPath;
      }),
      startWith(
        (() => {
          // Initial value based on current router URL
          const url = this.router.url.split('?')[0].split('#')[0];

          if (url.startsWith('/agenstra/')) {
            return url.replace('/agenstra/', '/docs/');
          } else if (url === '/agenstra') {
            return '/docs';
          } else if (url.startsWith('/framework/')) {
            return url.replace('/framework/', '/docs/');
          } else if (url === '/framework') {
            return '/docs';
          }

          return url.startsWith('/docs') ? url : '/docs';
        })(),
      ),
    ),
    {
      initialValue: '/docs',
    },
  );

  ngOnInit(): void {
    this.destroyRef.onDestroy(addPageMetaTags(this.metaService, this.docsStaticMetaTags));
    this.destroyRef.onDestroy(() => removePageMetaTags(this.metaService, DOCS_PAGE_DYNAMIC_META_TAG_STUBS));

    // During SSR, skip content loading to avoid loops and timeout issues
    // Content will be loaded on the client side
    if (!isPlatformBrowser(this.platformId)) {
      this.loading.set(false);
      this.error.set(null);

      // Don't set metadata during SSR - let client-side hydration handle it
      return;
    }

    // Load content based on route
    // For wildcard routes (**), use the full URL path
    this.route.url
      .pipe(
        map((url) => {
          // Get the full path from URL segments
          // For wildcard route, this will include all segments
          let path = url
            .map((s) => s.path)
            .filter((p) => p && p !== 'docs')
            .join('/');

          // Remove any .md extensions or README.md/README that might have been incorrectly added (handle multiple occurrences)
          path = path
            .replace(/\.md$/g, '')
            .replace(/\/README\.md(\/README\.md)*$/g, '')
            .replace(/README\.md(\/README\.md)*$/g, '');
          path = path.replace(/\/README(\/README)*$/g, '').replace(/README(\/README)*$/g, '');

          // Remove 'agenstra' prefix if present (shouldn't happen, but handle it)
          if (path.startsWith('agenstra/')) {
            path = path.substring('agenstra/'.length);
          }

          path = path.replace(/^agenstra\//, '').replace(/\/agenstra\//g, '/');

          // Remove duplicate slashes
          path = path.replace(/\/+/g, '/');

          return path;
        }),
        switchMap((path) => {
          this.loading.set(true);
          this.error.set(null);

          // Load content with fallback logic
          return this.loadContentWithFallback(path).pipe(
            catchError((err) => {
              this.error.set('Failed to load documentation');
              console.error('Error loading content:', err);

              return of(null);
            }),
          );
        }),
      )
      .subscribe((metadata) => {
        this.metadata.set(metadata);
        this.loading.set(false);

        if (!metadata) {
          // During SSR, don't perform redirects to avoid loops
          if (!isPlatformBrowser(this.platformId)) {
            this.error.set('Documentation page not found');

            return;
          }

          const currentUrl = this.router.url;

          // Check if URL has malformed patterns that indicate a loop
          if (
            currentUrl.includes('/README/README') ||
            currentUrl.includes('/README.md/README') ||
            currentUrl.match(/\/README(\.md)?\/README/)
          ) {
            // Malformed URL detected - navigate to home and show error
            console.error('Detected malformed URL pattern, redirecting to home:', currentUrl);
            this.router.navigate(['/docs'], { replaceUrl: true });
            this.error.set('Invalid documentation path. Redirected to home.');

            return;
          }

          // Check if URL incorrectly includes "agenstra" in the path
          if (currentUrl.includes('/docs/agenstra/')) {
            // Fix the URL by removing "agenstra" from the path
            const fixedPath = currentUrl
              .replace('/docs/agenstra/', '/docs/')
              .replace(/\/README\.md$/, '')
              .replace(/\/README$/, '');

            console.warn('URL incorrectly includes "agenstra", fixing:', currentUrl, '->', fixedPath);
            this.router.navigate([fixedPath], { replaceUrl: true });

            return;
          }

          // If we're at a subpath and content failed to load, show error instead of redirecting
          if (currentUrl !== '/docs' && currentUrl.startsWith('/docs/')) {
            this.error.set('Documentation page not found');
          } else if (currentUrl !== '/docs') {
            // Invalid URL pattern - redirect to home
            this.router.navigate(['/docs'], { replaceUrl: true });
            this.error.set('Invalid documentation path. Redirected to home.');
          }
        }
      });
  }

  private applyPageMeta(metadata: DocMetadata | null, path: string): void {
    const pageTitle = metadata?.title?.trim();
    const title = pageTitle ? formatAgenstraMetaTitle(pageTitle) : this.metaTitleFallback;

    this.titleService.setTitle(title);

    const summary = metadata?.summary?.trim();
    const descriptionSource = summary || this.metaDescriptionFallback;
    const description = formatAgenstraMetaDescription(descriptionSource);
    const canonicalUrl = resolveSocialCanonicalUrl(
      `https://docs.agenstra.com${path}`,
      this.locale,
      this.environment.production,
    );

    this.metaService.updateTag({ name: 'description', content: description });
    this.metaService.updateTag({ name: 'canonical', content: canonicalUrl });
    applySocialPreviewMeta((tag) => this.metaService.updateTag(tag), {
      title,
      description: descriptionSource,
      canonicalUrl: `https://docs.agenstra.com${path}`,
      imageUrl: this.environment.socialPreview.imageUrl,
      localeId: this.locale,
      localizeCanonicalUrl: this.environment.production,
      type: 'article',
    });
  }

  /**
   * Load content with fallback logic:
   * Always assumes "agenstra" subfolder.
   * For path /docs (empty):
   * 1. Check if there is agenstra/README.md to load
   * 2. Check if there is agenstra/agenstra.md
   * For path /docs/:path:
   * 1. Try agenstra/:path/README.md (directory with README)
   * 2. Try agenstra/:path.md (direct file)
   */
  private loadContentWithFallback(routePath: string): Observable<DocMetadata | null> {
    // Normalize the path: remove leading/trailing slashes
    let cleanPath = routePath.replace(/^\/+|\/+$/g, '');

    // Remove 'agenstra/' prefix if present (shouldn't happen with correct routes, but handle it)
    if (cleanPath.startsWith('agenstra/')) {
      cleanPath = cleanPath.substring('agenstra/'.length);
    }

    cleanPath = cleanPath.replace(/^agenstra\//, '').replace(/\/agenstra\//g, '/');

    // Remove any .md extensions that might have been incorrectly added
    cleanPath = cleanPath.replace(/\.md$/g, '');

    // Remove any README.md or README that might have been incorrectly appended (multiple times)
    cleanPath = cleanPath.replace(/\/README\.md(\/README\.md)*$/g, '').replace(/README\.md(\/README\.md)*$/g, '');
    cleanPath = cleanPath.replace(/\/README(\/README)*$/g, '').replace(/README(\/README)*$/g, '');

    // Remove any duplicate slashes
    cleanPath = cleanPath.replace(/\/+/g, '/');

    const pathWithoutAgenstra = cleanPath;

    // Always use "agenstra" as the base folder
    // If empty path, try README.md first, then agenstra.md
    if (!pathWithoutAgenstra) {
      return this.contentService.loadContent('agenstra/README.md').pipe(
        catchError(() => {
          // Fallback to agenstra.md
          return this.contentService.loadContent('agenstra/agenstra.md');
        }),
      );
    }

    // For paths like /docs/getting-started:
    // 1. Try agenstra/getting-started/README.md (directory with README)
    // 2. Try agenstra/getting-started.md (direct file)
    const readmePath = `agenstra/${pathWithoutAgenstra}/README.md`;
    const directPath = `agenstra/${pathWithoutAgenstra}.md`;

    // Try README.md first, then fallback to direct .md file
    // Use switchMap to ensure the first request completes (or fails) before trying the fallback
    return this.contentService.loadContent(readmePath).pipe(
      switchMap((metadata) => {
        // If README.md was found, return it
        if (metadata) {
          return of(metadata);
        }

        // If README.md returned null (not found), try the direct file
        return this.contentService.loadContent(directPath);
      }),
      catchError(() => {
        // If README.md request failed (timeout, network error, etc.), try the direct file
        return this.contentService.loadContent(directPath).pipe(
          catchError(() => {
            // If both fail, return null to prevent infinite loops
            console.warn(`Failed to load documentation for path: ${routePath} (tried both README.md and direct file)`);

            return of(null);
          }),
        );
      }),
    );
  }
}
