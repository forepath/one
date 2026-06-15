import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { debounceTime, distinctUntilChanged, Subject } from 'rxjs';

import { DocsSearchService } from '../../services';

@Component({
  selector: 'framework-docs-search',
  imports: [CommonModule, FormsModule],
  templateUrl: './docs-search.component.html',
  styleUrls: ['./docs-search.component.scss'],
  standalone: true,
})
export class DocsSearchComponent {
  readonly searchField = input<boolean>(true);

  private readonly searchService = inject(DocsSearchService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
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
    // Debounce search input
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

    // Sync with service
    effect(() => {
      const query = this.searchService.searchQuery();

      this.searchQuery.set(query);
    });
  }

  /**
   * Handle search input
   */
  onSearchInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;

    this.searchQuery.set(value);
    this.searchSubject.next(value);
    this.showResults.set(value.trim().length > 0);
  }

  /**
   * Handle search result click
   */
  onResultClick(result: { entry: { path: string } }): void {
    this.router.navigate([result.entry.path]);
    this.showResults.set(false);
    this.searchQuery.set('');
    this.searchService.clearSearch();
  }

  /**
   * Handle search button click
   */
  onSearchClick(): void {
    const query = this.searchQuery().trim();

    if (query.length > 0) {
      this.router.navigate(['/search'], { queryParams: { q: query } });
      this.showResults.set(false);
    } else {
      this.router.navigate(['/search']);
      this.showResults.set(false);
    }
  }

  /**
   * Handle focus
   */
  onFocus(): void {
    if (this.searchQuery().trim().length > 0) {
      this.showResults.set(true);
    }
  }

  /**
   * Handle blur
   */
  onBlur(): void {
    // Delay to allow click events to fire
    setTimeout(() => {
      this.showResults.set(false);
    }, 200);
  }
}
