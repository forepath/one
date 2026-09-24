import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, LOCALE_ID, OnInit, PLATFORM_ID, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Meta, Title } from '@angular/platform-browser';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import {
  FpcEmptyStateComponent,
  FpcListComponent,
  FpcListItemComponent,
  FpcPageHeaderComponent,
  FpcSearchFieldComponent,
  FpcSpinnerComponent,
} from '@forepath/shared/frontend/ui-components';
import { ENVIRONMENT, type Environment } from '@forepath/shared/frontend/util-configuration';
import { addPageMetaTags, buildPageMetaTags, formatProductMetaTitle } from '@forepath/shared/frontend/util-meta';
import { debounceTime, distinctUntilChanged, Subject } from 'rxjs';

import { DocsSearchService, SearchResult } from '../../services';
import { getDocsSearchMetaDescription } from '../../utils/docs-seo-metadata';

@Component({
  selector: 'framework-docs-search-page',
  imports: [
    CommonModule,
    RouterModule,
    FpcSearchFieldComponent,
    FpcSpinnerComponent,
    FpcEmptyStateComponent,
    FpcListComponent,
    FpcListItemComponent,
    FpcPageHeaderComponent,
  ],
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
  protected readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly pageTitle = $localize`:@@featureDocsSearchPage-title:Search Documentation`;
  readonly searchPlaceholder = $localize`:@@featureDocsSearch-searchPlaceholder:Search documentation...`;
  readonly enterQueryHint = $localize`:@@featureDocsSearchPage-enterQueryHint:No search query yet`;
  readonly resultsAriaLabel = $localize`:@@featureDocsSearchPage-resultsAriaLabel:Search results`;

  /** Bound search field value (kept in sync with the header via DocsSearchService). */
  readonly searchQuery = signal('');

  /** Search results from the shared docs search service. */
  readonly searchResults = computed(() => this.searchService.searchResults());

  /** Index / search in flight. */
  readonly loading = signal(true);

  private readonly searchSubject = new Subject<string>();

  private get docsSiteOrigin(): string {
    return `https://docs.${this.environment.docs.contentRoot}.com`;
  }

  constructor() {
    // Header typeahead writes the shared query; mirror it into the page field + URL.
    effect(() => {
      const query = this.searchService.searchQuery();

      if (this.searchQuery() === query) {
        return;
      }

      this.searchQuery.set(query);
      this.loading.set(false);
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: query.trim() ? { q: query } : {},
        replaceUrl: true,
      });
    });
  }

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

    this.searchSubject
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((query) => this.runSearch(query));

    const initialQuery = this.route.snapshot.queryParamMap.get('q') ?? '';

    this.searchQuery.set(initialQuery);
    this.runSearch(initialQuery);
  }

  onSearchValueChange(value: string): void {
    this.searchQuery.set(value);
    this.searchSubject.next(value);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: value.trim() ? { q: value } : {},
      replaceUrl: true,
    });
  }

  onSearchCleared(): void {
    this.onSearchValueChange('');
  }

  onResultClick(result: SearchResult): void {
    void this.router.navigate([result.entry.path]);
  }

  private runSearch(query: string): void {
    const trimmed = query.trim();

    this.searchService.searchQuery.set(trimmed);

    if (!trimmed) {
      this.searchService.clearSearch();
      this.loading.set(false);

      return;
    }

    this.loading.set(true);
    this.searchService.loadSearchIndex().subscribe((index) => {
      if (index) {
        this.searchService.search(trimmed, index);
      }

      this.loading.set(false);
    });
  }
}
