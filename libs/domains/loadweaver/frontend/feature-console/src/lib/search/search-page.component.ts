import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import {
  ConsoleSearchFacade,
  type SearchAction,
  type SearchResult,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcEmptyStateComponent,
  FpcPageHeaderComponent,
  FpcSpinnerComponent,
} from '@forepath/shared/frontend/ui-components';
import { map } from 'rxjs';

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

/** The API's maximum. */
export const SEARCH_PAGE_LIMIT = 50;

/** Full results of the global search (3.25): `/search?q=`, grouped like the palette. */
@Component({
  selector: 'loadweaver-search-page',
  imports: [
    CommonModule,
    FpcAlertComponent,
    FpcEmptyStateComponent,
    FpcPageHeaderComponent,
    FpcSpinnerComponent,
    LoadweaverSearchActionConfirmComponent,
    LoadweaverSearchResultsComponent,
  ],
  templateUrl: './search-page.component.html',
  standalone: true,
})
export class LoadweaverSearchPageComponent implements OnInit {
  private readonly facade = inject(ConsoleSearchFacade);
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
  readonly placeholder = $localize`:@@lwConsoleSearch-pagePlaceholder:Search projects, deployments, services, nodes, plans, alerts …`;

  ngOnInit(): void {
    // Always the signed-in user's favourites (never a cached list of another session).
    this.facade.loadFavourites();

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
