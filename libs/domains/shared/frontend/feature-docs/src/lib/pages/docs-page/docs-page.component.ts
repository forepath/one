import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Component, DestroyRef, effect, inject, LOCALE_ID, OnInit, PLATFORM_ID, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Meta, Title } from '@angular/platform-browser';
import { ActivatedRoute, NavigationEnd, Router, RouterModule } from '@angular/router';
import { ENVIRONMENT, type Environment } from '@forepath/shared/frontend/util-configuration';
import { DocMetadata, NavigationNode } from '@forepath/shared/frontend/util-docs-parser';
import {
  addPageMetaTags,
  applySocialPreviewMeta,
  createDocsPageDynamicMetaTagStubs,
  formatAgenstraMetaDescription,
  formatProductMetaTitle,
  removePageMetaTags,
  resolveSocialCanonicalUrl,
} from '@forepath/shared/frontend/util-meta';
import { catchError, filter, map, Observable, of, startWith, switchMap } from 'rxjs';

import { DocsBreadcrumbsComponent, DocsContentComponent, DocsTableOfContentsComponent } from '../../components';
import { DocsContentService, DocsNavigationService } from '../../services';
import { getDocsMetaDescriptionFallback, getDocsMetaKeywords } from '../../utils/docs-seo-metadata';

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

  private get contentRoot(): string {
    return this.environment.docs.contentRoot;
  }

  private get docsSiteOrigin(): string {
    return `https://docs.${this.contentRoot}.com`;
  }

  private buildPageTitle(pageName: string): string {
    return formatProductMetaTitle(pageName, this.environment.productName);
  }

  private get metaDescriptionFallback(): string {
    return getDocsMetaDescriptionFallback(this.contentRoot);
  }

  private get docsStaticMetaTags() {
    return [
      {
        name: 'keywords',
        content: getDocsMetaKeywords(this.contentRoot),
      },
      { name: 'author', content: 'IPvX UG (haftungsbeschränkt)' },
      { name: 'robots', content: 'index, follow' },
    ];
  }

  private readonly destroyRef = inject(DestroyRef);

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

        // Convert legacy /{contentRoot}/... to /docs/... to match navigation paths
        const contentRootPrefix = `/${this.contentRoot}/`;
        if (normalizedPath.startsWith(contentRootPrefix)) {
          normalizedPath = normalizedPath.replace(contentRootPrefix, '/docs/');
        } else if (normalizedPath === `/${this.contentRoot}`) {
          normalizedPath = '/docs';
        } else if (normalizedPath.startsWith('/agenstra/')) {
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

          if (url.startsWith(`/${this.contentRoot}/`)) {
            return url.replace(`/${this.contentRoot}/`, '/docs/');
          } else if (url === `/${this.contentRoot}`) {
            return '/docs';
          } else if (url.startsWith('/agenstra/')) {
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
    this.destroyRef.onDestroy(() =>
      removePageMetaTags(
        this.metaService,
        createDocsPageDynamicMetaTagStubs({
          docsSiteOrigin: this.docsSiteOrigin,
          imageUrl: this.environment.socialPreview.imageUrl,
          siteName: this.environment.productName,
        }),
      ),
    );

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

          // Remove content root prefix if present
          if (path.startsWith(`${this.contentRoot}/`)) {
            path = path.substring(this.contentRoot.length + 1);
          }

          path = path
            .replace(new RegExp(`^${this.contentRoot}/`), '')
            .replace(new RegExp(`/${this.contentRoot}/`, 'g'), '/');

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

          // Check if URL incorrectly includes content root in the path
          const docsContentRootPath = `/docs/${this.contentRoot}/`;
          if (currentUrl.includes(docsContentRootPath)) {
            const fixedPath = currentUrl
              .replace(docsContentRootPath, '/docs/')
              .replace(/\/README\.md$/, '')
              .replace(/\/README$/, '');

            console.warn(`URL incorrectly includes "${this.contentRoot}", fixing:`, currentUrl, '->', fixedPath);
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
    const title = pageTitle
      ? formatProductMetaTitle(pageTitle, this.environment.productName)
      : this.buildPageTitle($localize`:@@featureDocsPage-metaTitlePrefix:Documentation`);

    this.titleService.setTitle(title);

    const summary = metadata?.summary?.trim();
    const descriptionSource = summary || this.metaDescriptionFallback;
    const description = formatAgenstraMetaDescription(descriptionSource);
    const canonicalUrl = resolveSocialCanonicalUrl(
      `${this.docsSiteOrigin}${path}`,
      this.locale,
      this.environment.production,
    );

    this.metaService.updateTag({ name: 'description', content: description });
    this.metaService.updateTag({ name: 'canonical', content: canonicalUrl });
    applySocialPreviewMeta((tag) => this.metaService.updateTag(tag), {
      title,
      description: descriptionSource,
      canonicalUrl: `${this.docsSiteOrigin}${path}`,
      imageUrl: this.environment.socialPreview.imageUrl,
      localeId: this.locale,
      localizeCanonicalUrl: this.environment.production,
      type: 'article',
      siteName: this.environment.productName,
    });
  }

  /**
   * Load content with fallback logic using the configured docs content root.
   */
  private loadContentWithFallback(routePath: string): Observable<DocMetadata | null> {
    const contentRoot = this.contentRoot;
    let cleanPath = routePath.replace(/^\/+|\/+$/g, '');

    if (cleanPath.startsWith(`${contentRoot}/`)) {
      cleanPath = cleanPath.substring(contentRoot.length + 1);
    }

    cleanPath = cleanPath.replace(new RegExp(`^${contentRoot}/`), '').replace(new RegExp(`/${contentRoot}/`, 'g'), '/');
    cleanPath = cleanPath.replace(/\.md$/g, '');
    cleanPath = cleanPath.replace(/\/README\.md(\/README\.md)*$/g, '').replace(/README\.md(\/README\.md)*$/g, '');
    cleanPath = cleanPath.replace(/\/README(\/README)*$/g, '').replace(/README(\/README)*$/g, '');
    cleanPath = cleanPath.replace(/\/+/g, '/');

    if (!cleanPath) {
      return this.contentService
        .loadContent(`${contentRoot}/README.md`)
        .pipe(catchError(() => this.contentService.loadContent(`${contentRoot}/${contentRoot}.md`)));
    }

    const readmePath = `${contentRoot}/${cleanPath}/README.md`;
    const directPath = `${contentRoot}/${cleanPath}.md`;

    return this.contentService.loadContent(readmePath).pipe(
      switchMap((metadata) => {
        if (metadata) {
          return of(metadata);
        }

        return this.contentService.loadContent(directPath);
      }),
      catchError(() =>
        this.contentService.loadContent(directPath).pipe(
          catchError(() => {
            console.warn(`Failed to load documentation for path: ${routePath} (tried both README.md and direct file)`);

            return of(null);
          }),
        ),
      ),
    );
  }
}
