import { CommonModule } from '@angular/common';
import { Component, computed, ElementRef, inject, input, model, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import {
  ConsoleSearchFacade,
  type SearchAction,
  type SearchActionResult,
  type SearchResult,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcModalComponent,
  FpcSpinnerComponent,
  FpcToastComponent,
  FpcToastContainerComponent,
} from '@forepath/shared/frontend/ui-components';

import { LoadweaverSearchActionConfirmComponent } from './search-action-confirm.component';
import {
  flattenSections,
  searchActionRoute,
  searchResultRoute,
  searchSections,
  splitItem,
  type SearchEntry,
} from './search-format';
import { LoadweaverSearchResultsComponent } from './search-results.component';

/** Results in the palette; the search page shows more. */
export const PALETTE_LIMIT = 15;

/**
 * Global search and command palette (3.25), opened from the top bar or with Ctrl / Cmd + K: results grouped by kind
 * (favourites first), recently opened items and favourites without a query, and actions — links navigate, API
 * actions run after a confirmation.
 */
@Component({
  selector: 'loadweaver-search-palette',
  imports: [
    CommonModule,
    FpcAlertComponent,
    FpcModalComponent,
    FpcSpinnerComponent,
    FpcToastComponent,
    FpcToastContainerComponent,
    LoadweaverSearchActionConfirmComponent,
    LoadweaverSearchResultsComponent,
  ],
  templateUrl: './search-palette.component.html',
  host: { '(document:keydown)': 'onDocumentKeydown($event)' },
  standalone: true,
})
export class LoadweaverSearchPaletteComponent {
  private readonly facade = inject(ConsoleSearchFacade);
  private readonly router = inject(Router);

  readonly open = model(false);
  /** Off without a session (sign-in pages): the shortcut does nothing. */
  readonly enabled = input(true);

  private readonly input = viewChild<ElementRef<HTMLInputElement>>('searchInput');

  readonly results = toSignal(this.facade.results$, { initialValue: [] as SearchResult[] });
  readonly actions = toSignal(this.facade.actions$, { initialValue: [] as SearchAction[] });
  readonly favourites = toSignal(this.facade.favourites$, { initialValue: [] as string[] });
  readonly favouritesLoaded = toSignal(this.facade.favouritesLoaded$, { initialValue: false });
  readonly recent = toSignal(this.facade.recent$, { initialValue: [] as SearchResult[] });
  readonly loading = toSignal(this.facade.loading$, { initialValue: false });
  readonly error = toSignal(this.facade.error$, { initialValue: null });
  readonly actionResult = toSignal(this.facade.actionResult$, { initialValue: null as SearchActionResult | null });

  readonly query = signal('');
  readonly activeIndex = signal(0);
  readonly pendingAction = signal<SearchAction | null>(null);

  readonly sections = computed(() =>
    searchSections({
      query: this.query(),
      results: this.results(),
      actions: this.actions(),
      favourites: this.favourites(),
      recent: this.recent(),
    }),
  );
  readonly entries = computed(() => flattenSections(this.sections()));
  readonly activeEntry = computed<SearchEntry | null>(() => this.entries()[this.activeIndex()] ?? null);

  readonly title = $localize`:@@lwConsoleSearch-paletteTitle:Search`;
  readonly placeholder = $localize`:@@lwConsoleSearch-placeholder:Search projects, deployments, nodes, plans … or type a command (drain n2, logs api)`;
  readonly inputLabel = $localize`:@@lwConsoleSearch-inputLabel:Search the console`;
  readonly actionDone = $localize`:@@lwConsoleSearch-actionDone:Done`;
  readonly actionFailed = $localize`:@@lwConsoleSearch-actionFailed:Failed`;

  show(): void {
    if (!this.enabled()) return;

    this.open.set(true);
    this.activeIndex.set(0);

    // Every time: favourites are the signed-in user's and never reused across users / sessions.
    this.facade.loadFavourites();

    // The store may hold another query (the search page): ask again for the palette's.
    if (this.query().trim()) this.facade.search(this.query(), PALETTE_LIMIT);

    setTimeout(() => this.input()?.nativeElement.focus());
  }

  close(): void {
    this.open.set(false);
  }

  onDocumentKeydown(event: KeyboardEvent): void {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 'k') return;

    event.preventDefault();

    if (this.open()) this.close();
    else this.show();
  }

  onQueryChange(query: string): void {
    this.query.set(query);
    this.activeIndex.set(0);
    this.facade.search(query, PALETTE_LIMIT);
  }

  onInputKeydown(event: KeyboardEvent): void {
    const count = this.entries().length;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();

        if (count > 0) this.activeIndex.set((this.activeIndex() + 1) % count);

        break;
      case 'ArrowUp':
        event.preventDefault();

        if (count > 0) this.activeIndex.set((this.activeIndex() - 1 + count) % count);

        break;
      case 'Enter': {
        // Not to the confirm dialog, which would take the same Enter as its confirmation.
        event.preventDefault();
        event.stopPropagation();

        const entry = this.activeEntry();

        if (entry) this.pick(entry);

        break;
      }
    }
  }

  pick(entry: SearchEntry): void {
    switch (entry.type) {
      case 'result':
        this.facade.visit(entry.result);
        this.close();
        void this.router.navigateByUrl(searchResultRoute(entry.result));
        break;
      case 'favourite':
        this.onQueryChange(splitItem(entry.item).key);
        break;
      case 'action':
        this.close();

        if (entry.action.kind === 'api') {
          this.pendingAction.set(entry.action);
        } else {
          const route = searchActionRoute(entry.action);

          if (route) void this.router.navigateByUrl(route);
        }

        break;
    }
  }

  star(result: SearchResult): void {
    this.facade.setFavourite(result.id, !result.favourite);
  }

  showAll(): void {
    const q = this.query().trim();

    this.close();
    void this.router.navigate(['/search'], { queryParams: q ? { q } : {} });
  }

  dismissActionResult(): void {
    this.facade.clearActionResult();
  }
}
