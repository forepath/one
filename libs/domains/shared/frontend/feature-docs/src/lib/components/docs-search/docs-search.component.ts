import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import {
  FpcButtonComponent,
  FpcEmptyStateComponent,
  FpcListComponent,
  FpcListItemComponent,
  FpcSearchFieldComponent,
} from '@forepath/shared/frontend/ui-components';
import { debounceTime, distinctUntilChanged, Subject } from 'rxjs';

import { DocsSearchService } from '../../services';

@Component({
  selector: 'framework-docs-search',
  imports: [
    CommonModule,
    FpcSearchFieldComponent,
    FpcButtonComponent,
    FpcListComponent,
    FpcListItemComponent,
    FpcEmptyStateComponent,
  ],
  templateUrl: './docs-search.component.html',
  styleUrls: ['./docs-search.component.scss'],
  standalone: true,
})
export class DocsSearchComponent {
  readonly searchField = input<boolean>(true);

  private readonly searchService = inject(DocsSearchService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly searchPlaceholder = $localize`:@@featureDocsSearch-searchPlaceholder:Search documentation...`;
  readonly noResultsMessage = $localize`:@@featureDocsSearch-noResults:No search results`;
  readonly searchResultsAriaLabel = $localize`:@@featureDocsSearch-resultsAriaLabel:Search results`;

  /**
   * Search input value
   */
  readonly searchQuery = signal<string>('');

  /**
   * Whether search dropdown is visible
   */
  readonly showResults = signal<boolean>(false);

  /**
   * Search results
   */
  readonly searchResults = computed(() => this.searchService.searchResults());

  private readonly searchSubject = new Subject<string>();

  constructor() {
    this.searchSubject
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((query: string) => {
        this.searchService.searchQuery.set(query);

        if (query.trim().length > 0) {
          this.searchService.loadSearchIndex().subscribe((index) => {
            if (index) {
              this.searchService.search(query, index);
            }
          });
        } else {
          this.searchService.clearSearch();
        }
      });

    effect(() => {
      const query = this.searchService.searchQuery();

      this.searchQuery.set(query);
    });
  }

  onSearchValueChange(value: string): void {
    this.searchQuery.set(value);
    this.searchSubject.next(value);
    this.showResults.set(value.trim().length > 0);
  }

  /**
   * Handle search result click
   */
  onResultClick(result: { entry: { path: string } }): void {
    void this.router.navigate([result.entry.path]);
    this.showResults.set(false);
    this.searchQuery.set('');
    this.searchService.clearSearch();
  }

  /**
   * Handle search button click / Enter
   */
  onSearchClick(): void {
    const query = this.searchQuery().trim();

    if (query.length > 0) {
      void this.router.navigate(['/search'], { queryParams: { q: query } });
      this.showResults.set(false);
    } else {
      void this.router.navigate(['/search']);
      this.showResults.set(false);
    }
  }

  onFocus(): void {
    if (this.searchQuery().trim().length > 0) {
      this.showResults.set(true);
    }
  }

  onBlur(): void {
    // Delay so list-item click can fire before the dropdown closes.
    setTimeout(() => {
      this.showResults.set(false);
    }, 200);
  }
}
