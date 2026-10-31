import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, OnInit, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import {
  ConsoleAccessFacade,
  ConsoleEndpointService,
  ConsoleSearchFacade,
  type SearchAction,
  type SearchResult,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcEmptyStateComponent,
  FpcPageHeaderComponent,
  FpcSearchFieldComponent,
  FpcSpinnerComponent,
} from '@forepath/shared/frontend/ui-components';
import { map } from 'rxjs';

import { LoadweaverSearchActionConfirmComponent } from './search-action-confirm.component';
import { favouritesAvailable } from '../access/access-format';
import {
  flattenSections,
  searchActionRoute,
  searchResultRoute,
  searchSections,
  splitItem,
  type SearchEntry,
} from './search-format';
import { LoadweaverSearchResultsComponent } from './search-results.component';
import { type SavedViewBinding } from '../views/saved-views';
import { LoadweaverSavedViewsComponent } from '../views/saved-views.component';

/** The API's maximum. */
export const SEARCH_PAGE_LIMIT = 50;

/** Full results of the global search (3.25): `/search?q=`, grouped like the palette. */
@Component({
  selector: 'loadweaver-search-page',
  imports: [
    LoadweaverSavedViewsComponent,
    CommonModule,
    FpcAlertComponent,
    FpcEmptyStateComponent,
    FpcPageHeaderComponent,
    FpcSearchFieldComponent,
    FpcSpinnerComponent,
    LoadweaverSearchActionConfirmComponent,
    LoadweaverSearchResultsComponent,
  ],
  templateUrl: './search-page.component.html',
  standalone: true,
})
export class LoadweaverSearchPageComponent implements OnInit {
  private readonly facade = inject(ConsoleSearchFacade);
  private readonly fleetMode = inject(ConsoleEndpointService).fleetMode;
  private readonly me = toSignal(inject(ConsoleAccessFacade).me$, { initialValue: null });
  /** Fleet mode: favourites are the person's — only when the cluster verifies this fleet (2026-10-27). */
  readonly favouritesAvailable = computed(() => favouritesAvailable(this.fleetMode, this.me()));
  /** Always the signed-in person's favourites (never a cached list of another session), once they are available. */
  private readonly loadFavouritesWhenAvailable = effect(() => {
    if (this.favouritesAvailable()) untracked(() => this.facade.loadFavourites());
  });
  readonly favouritesHint = $localize`:@@lwConsoleSearch-favouritesFleet:Favourites through the fleet need the cluster to trust this fleet. A fleet admin establishes trust on the fleet's cluster page.`;
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly results = toSignal(this.facade.results$, { initialValue: [] as SearchResult[] });
  readonly actions = toSignal(this.facade.actions$, { initialValue: [] as SearchAction[] });
  readonly favourites = toSignal(this.facade.favourites$, { initialValue: [] as string[] });
  readonly favouritesLoaded = toSignal(this.facade.favouritesLoaded$, { initialValue: false });
  readonly recent = toSignal(this.facade.recent$, { initialValue: [] as SearchResult[] });
  readonly loading = toSignal(this.facade.loading$, { initialValue: false });
  readonly error = toSignal(this.facade.error$, { initialValue: null });

  readonly query = signal('');
  readonly pendingAction = signal<SearchAction | null>(null);
  /** "Views ▾" (3.37): saved queries of "All results", per user (applying one searches again and updates `?q=`). */
  readonly views: SavedViewBinding = {
    state: computed(() => ({ query: this.query() })),
    apply: (state) => this.onQueryChange(typeof state['query'] === 'string' ? state['query'] : ''),
  };

  readonly sections = computed(() =>
    searchSections({
      query: this.query(),
      results: this.results(),
      actions: this.actions(),
      favourites: this.favourites(),
      recent: this.recent(),
    }),
  );
  readonly count = computed(() => flattenSections(this.sections()).length);

  readonly title = $localize`:@@lwConsoleSearch-title:Search`;
  readonly inputLabel = $localize`:@@lwConsoleSearch-inputLabel:Search the console`;
  /** 3.38 R11: placeholder = the field's label ("Search the console"). */
  readonly placeholder = this.inputLabel;

  ngOnInit(): void {
    this.route.queryParamMap
      .pipe(
        map((params) => params.get('q') ?? ''),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((q) => {
        if (q === this.query() && q) return;

        this.query.set(q);
        this.facade.search(q, SEARCH_PAGE_LIMIT);
      });
  }

  onQueryChange(query: string): void {
    this.query.set(query);
    this.facade.search(query, SEARCH_PAGE_LIMIT);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { q: query.trim() || null },
      replaceUrl: true,
    });
  }

  pick(entry: SearchEntry): void {
    switch (entry.type) {
      case 'result':
        this.facade.visit(entry.result);
        void this.router.navigateByUrl(searchResultRoute(entry.result));
        break;
      case 'favourite':
        this.onQueryChange(splitItem(entry.item).key);
        break;
      case 'action':
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
}
