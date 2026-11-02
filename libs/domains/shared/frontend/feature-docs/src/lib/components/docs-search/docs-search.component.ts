import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import {
  FpcCommandPaletteComponent,
  type FpcCommandActivateEvent,
  type FpcCommandGroup,
} from '@forepath/shared/frontend/ui-components';
import { debounceTime, distinctUntilChanged, Subject } from 'rxjs';

import { DocsSearchService, SearchResult } from '../../services';

/**
 * Top-bar documentation search: a field-like trigger (`.fpc-top-bar__search`: icon, label, Ctrl K hint; icon only on
 * narrow bars) that opens a search palette with live results. Ctrl / ⌘ + K or "/" opens it from anywhere; the footer
 * leads to the full results page.
 */
@Component({
  selector: 'framework-docs-search',
  imports: [FpcCommandPaletteComponent],
  templateUrl: './docs-search.component.html',
  styleUrls: ['./docs-search.component.scss'],
  standalone: true,
  host: {
    class: 'docs-search',
    '(document:keydown)': 'onDocumentKeydown($event)',
  },
})
export class DocsSearchComponent {
  private readonly searchService = inject(DocsSearchService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly searchPlaceholder = $localize`:@@featureDocsSearch-searchPlaceholder:Search documentation`;
  readonly searchTitle = $localize`:@@featureDocsSearch-searchTitle:Search documentation (Ctrl / ⌘ + K)`;
  readonly searchLabel = $localize`:@@featureDocsSearch-searchLabel:Search`;
  readonly pagesLabel = $localize`:@@featureDocsSearch-pagesGroup:Pages`;
  readonly noResultsMessage = $localize`:@@featureDocsSearch-noResults:No search results`;
  readonly typeToSearchMessage = $localize`:@@featureDocsSearch-typeToSearch:Type to search the documentation.`;
  readonly viewAllResultsLabel = $localize`:@@featureDocsSearch-viewAllResults:View all results`;

  /** Whether the search palette is open. */
  readonly paletteOpen = signal(false);

  /** Palette query (the service's query follows it, debounced). */
  readonly searchQuery = signal('');

  readonly loading = signal(false);

  /** Results as one palette group: title, summary as hint. */
  readonly groups = computed<FpcCommandGroup<SearchResult>[]>(() => [
    {
      id: 'pages',
      label: this.pagesLabel,
      items: this.searchService.searchResults().map((result) => ({
        id: result.entry.path,
        label: result.entry.title,
        hint: result.entry.summary ?? null,
        icon: 'file-earmark-text',
        data: result,
      })),
    },
  ]);

  private readonly searchSubject = new Subject<string>();

  constructor() {
    this.searchSubject
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((query: string) => {
        this.searchService.searchQuery.set(query);

        if (query.trim().length > 0) {
          this.loading.set(true);
          this.searchService.loadSearchIndex().subscribe((index) => {
            if (index) {
              this.searchService.search(query, index);
            }

            this.loading.set(false);
          });
        } else {
          this.searchService.clearSearch();
          this.loading.set(false);
        }
      });
  }

  openPalette(): void {
    this.paletteOpen.set(true);
  }

  onQueryChange(value: string): void {
    this.searchQuery.set(value);
    this.searchSubject.next(value);
  }

  onPaletteOpenChange(open: boolean): void {
    this.paletteOpen.set(open);

    if (!open) this.reset();
  }

  onActivate(event: FpcCommandActivateEvent<SearchResult>): void {
    const path = event.item.data?.entry.path ?? event.item.id;

    if (event.newTab) {
      window.open(this.router.serializeUrl(this.router.createUrlTree([path])), '_blank', 'noopener');

      return;
    }

    void this.router.navigate([path]);
    this.onPaletteOpenChange(false);
  }

  onViewAllResults(): void {
    const query = this.searchQuery().trim();

    void this.router.navigate(['/search'], query ? { queryParams: { q: query } } : {});
    this.onPaletteOpenChange(false);
  }

  /** Ctrl / ⌘ + K anywhere, "/" outside text fields (like the console search). */
  onDocumentKeydown(event: KeyboardEvent): void {
    if (this.paletteOpen()) return;

    const isShortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k';
    const isSlash = event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !isTyping(event.target);

    if (isShortcut || isSlash) {
      event.preventDefault();
      this.openPalette();
    }
  }

  private reset(): void {
    this.searchQuery.set('');
    this.searchSubject.next('');
    this.searchService.clearSearch();
  }
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;

  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}
