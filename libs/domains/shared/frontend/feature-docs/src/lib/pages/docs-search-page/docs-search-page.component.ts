import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, inject, LOCALE_ID, OnInit, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Meta, Title } from '@angular/platform-browser';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { ENVIRONMENT, type Environment } from '@forepath/shared/frontend/util-configuration';
import { addPageMetaTags, buildPageMetaTags, formatProductMetaTitle } from '@forepath/shared/frontend/util-meta';
import { filter, map } from 'rxjs';

import { DocsSearchComponent } from '../../components';
import { DocsSearchService, SearchResult } from '../../services';
import { getDocsSearchMetaDescription } from '../../utils/docs-seo-metadata';

@Component({
  selector: 'framework-docs-search-page',
  imports: [CommonModule, RouterModule, DocsSearchComponent],
  templateUrl: './docs-search-page.component.html',
  styleUrls: ['./docs-search-page.component.scss'],
  standalone: true,
})
export class DocsSearchPageComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly searchService = inject(DocsSearchService);
  private readonly titleService = inject(Title);
  private readonly metaService = inject(Meta);
  private readonly environment = inject<Environment>(ENVIRONMENT);
  private readonly locale = inject(LOCALE_ID);
  private readonly destroyRef = inject(DestroyRef);

  private get docsSiteOrigin(): string {
    return `https://docs.${this.environment.docs.contentRoot}.com`;
  }

  /**
   * Search query from route
   */
  readonly searchQuery = toSignal(
    this.route.queryParams.pipe(
      map((params) => params['q'] || ''),
      filter((q) => q.length > 0),
    ),
    { initialValue: '' },
  );

  /**
   * Search results
   */
  readonly searchResults = computed(() => this.searchService.searchResults());

  /**
   * Loading state
   */
  readonly loading = signal<boolean>(true);

  ngOnInit(): void {
    const metaTitle = formatProductMetaTitle(
      $localize`:@@featureDocsSearchPage-metaTitlePrefix:Search Documentation`,
      this.environment.productName,
    );
    const metaDescription = getDocsSearchMetaDescription(this.environment.docs.contentRoot);

    this.titleService.setTitle(metaTitle);
    this.destroyRef.onDestroy(
      addPageMetaTags(
        this.metaService,
        buildPageMetaTags({
          description: metaDescription,
          robots: 'noindex, follow',
          canonicalUrl: `${this.docsSiteOrigin}/search`,
          socialTitle: metaTitle,
          socialDescription: metaDescription,
          socialImageUrl: this.environment.socialPreview.imageUrl,
          localeId: this.locale,
          localizeCanonicalUrl: this.environment.production,
          siteName: this.environment.productName,
        }),
      ),
    );

    const query = this.searchQuery();

    if (query) {
      this.searchService.searchQuery.set(query);
      this.searchService.loadSearchIndex().subscribe((index) => {
        if (index) {
          this.searchService.search(query, index);
        }

        this.loading.set(false);
      });
    } else {
      this.loading.set(false);
    }
  }

  /**
   * Get formatted results count message
   */
  getResultsCountMessage(count: number, query: string): string {
    if (count === 1) {
      return $localize`:@@featureDocsSearchPage-foundOneResult:Found ${count} result for "${query}"`;
    }

    return $localize`:@@featureDocsSearchPage-foundResults:Found ${count} results for "${query}"`;
  }

  /**
   * Handle result click
   */
  onResultClick(result: SearchResult): void {
    this.router.navigate([result.entry.path]);
  }
}
