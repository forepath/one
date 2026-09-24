import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { FpcButtonComponent, FpcTypeaheadSelectComponent } from '@forepath/shared/frontend/ui-components';
import { debounceTime, distinctUntilChanged, Subject } from 'rxjs';

import { DocsSearchService, SearchResult } from '../../services';

@Component({
  selector: 'framework-docs-search',
  imports: [CommonModule, FpcTypeaheadSelectComponent, FpcButtonComponent],
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
  readonly viewAllResultsLabel = $localize`:@@featureDocsSearch-viewAllResults:View all results`;

  /** Search input value. */
  readonly searchQuery = signal<string>('');

  /** Whether the typeahead suggestion menu is open. */
  readonly suggestionsOpen = signal<boolean>(false);

  /** Search results. */
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
    this.suggestionsOpen.set(value.trim().length > 0);
  }

  onSuggestionsOpenChange(open: boolean): void {
    if (!open) {
      this.suggestionsOpen.set(false);

      return;
    }

    this.suggestionsOpen.set(this.searchQuery().trim().length > 0);
  }

  onCleared(): void {
    this.searchQuery.set('');
    this.searchService.clearSearch();
    this.suggestionsOpen.set(false);
  }

  onResultClick(result: SearchResult, event: MouseEvent): void {
    event.preventDefault();
    void this.router.navigate([result.entry.path]);
    this.suggestionsOpen.set(false);
    this.searchQuery.set('');
    this.searchService.clearSearch();
  }

  onSearchClick(event?: MouseEvent): void {
    event?.preventDefault();

    const query = this.searchQuery().trim();

    if (query.length > 0) {
      void this.router.navigate(['/search'], { queryParams: { q: query } });
    } else {
      void this.router.navigate(['/search']);
    }

    this.suggestionsOpen.set(false);
  }
}
