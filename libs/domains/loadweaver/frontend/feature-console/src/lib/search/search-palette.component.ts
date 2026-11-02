import { CommonModule } from '@angular/common';
import { Component, computed, inject, input, model, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import {
  ConsoleAccessFacade,
  ConsoleEndpointService,
  ConsoleSearchFacade,
  type SearchAction,
  type SearchActionResult,
  type SearchResult,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcButtonComponent,
  type FpcCommandActivateEvent,
  FpcCommandPaletteComponent,
  FpcToastComponent,
  FpcToastContainerComponent,
} from '@forepath/shared/frontend/ui-components';

import { LoadweaverSearchActionConfirmComponent } from './search-action-confirm.component';
import { favouritesAvailable } from '../access/access-format';
import { ConsoleNavService } from '../nav/console-nav.service';
import { objectRefFromUrl } from '../objects/object-route';
import { objectTabs } from '../objects/object-tabs';
import {
  paletteGroups,
  parsePaletteQuery,
  scopedResults,
  searchActionRoute,
  searchResultRoute,
  searchSections,
  splitItem,
  type PaletteEntry,
  type SearchEntry,
} from './search-format';

/** Results in the palette; the search page shows more. */
export const PALETTE_LIMIT = 15;

/**
 * Global search and command palette (3.25, on the `fpc-command-palette` shell since 3.37), opened from the top bar or
 * with Ctrl / Cmd + K: results grouped by kind (favourites first, starred on the "All results" page), recently opened
 * items and favourites without a query, actions (links navigate, API actions run after a confirmation), scope tokens
 * (`in:project/shop`, `kind:VirtualMachine`) and "go to tab" commands of the open object page. Results open their
 * object page, which reveals them in the resource tree.
 */
@Component({
  selector: 'loadweaver-search-palette',
  imports: [
    CommonModule,
    FpcAlertComponent,
    FpcButtonComponent,
    FpcCommandPaletteComponent,
    FpcToastComponent,
    FpcToastContainerComponent,
    LoadweaverSearchActionConfirmComponent,
  ],
  templateUrl: './search-palette.component.html',
  host: { '(document:keydown)': 'onDocumentKeydown($event)' },
  standalone: true,
})
export class LoadweaverSearchPaletteComponent {
  private readonly facade = inject(ConsoleSearchFacade);
  private readonly fleetMode = inject(ConsoleEndpointService).fleetMode;
  private readonly me = toSignal(inject(ConsoleAccessFacade).me$, { initialValue: null });
  /** Fleet mode: favourites are the person's — only when the cluster verifies this fleet (2026-10-27). */
  readonly favouritesAvailable = computed(() => favouritesAvailable(this.fleetMode, this.me()));
  readonly favouritesHint = $localize`:@@lwConsoleSearch-favouritesFleet:Favourites through the fleet need the cluster to trust this fleet. A fleet admin establishes trust on the fleet's cluster page.`;
  private readonly router = inject(Router);

  readonly open = model(false);
  /** Off without a session (sign-in pages): the shortcut does nothing. */
  readonly enabled = input(true);

  private readonly navigation = inject(ConsoleNavService);

  readonly results = toSignal(this.facade.results$, { initialValue: [] as SearchResult[] });
  readonly actions = toSignal(this.facade.actions$, { initialValue: [] as SearchAction[] });
  readonly favourites = toSignal(this.facade.favourites$, { initialValue: [] as string[] });
  readonly favouritesLoaded = toSignal(this.facade.favouritesLoaded$, { initialValue: false });
  readonly recent = toSignal(this.facade.recent$, { initialValue: [] as SearchResult[] });
  readonly loading = toSignal(this.facade.loading$, { initialValue: false });
  readonly error = toSignal(this.facade.error$, { initialValue: null });
  readonly actionResult = toSignal(this.facade.actionResult$, { initialValue: null as SearchActionResult | null });

  readonly query = signal('');
  readonly pendingAction = signal<SearchAction | null>(null);

  readonly scope = computed(() => parsePaletteQuery(this.query()));
  readonly sections = computed(() =>
    searchSections({
      query: this.query(),
      results: scopedResults(this.results(), this.scope()),
      actions: this.actions(),
      favourites: this.favourites(),
      recent: this.recent(),
    }),
  );
  /** "Go to tab" commands of the open object page. */
  readonly tabs = computed(() => {
    const ref = objectRefFromUrl(this.navigation.url());
    const me = this.me();

    return ref
      ? objectTabs(ref.kind, {
          infrastructure: !!me?.clusterRole,
          clusterAdmin: me?.clusterRole === 'cluster-admin',
          fleetMode: this.fleetMode,
        })
      : [];
  });
  readonly groups = computed(() =>
    paletteGroups(this.sections(), this.tabs(), this.query(), {
      tabs: this.tabsLabel,
      goToTab: this.goToTabLabel,
      favourite: '★',
      action: this.actionLabel,
    }),
  );

  readonly title = $localize`:@@lwConsoleSearch-paletteTitle:Search`;
  /** 3.38 R11: the shared palette wording; the examples moved into the empty hint. */
  readonly placeholder = $localize`:@@lwConsoleSearch-placeholder:Search or type a command`;
  readonly inputLabel = $localize`:@@lwConsoleSearch-inputLabel:Search the console`;
  readonly actionDone = $localize`:@@lwConsoleSearch-actionDone:Done`;
  readonly tabsLabel = $localize`:@@lwConsoleSearch-tabs:Go to tab`;
  readonly goToTabLabel = $localize`:@@lwConsoleSearch-goToTab:Tab`;
  readonly actionLabel = $localize`:@@lwConsoleSearch-actionBadge:Action`;
  readonly actionFailed = $localize`:@@lwConsoleSearch-actionFailed:Failed`;

  show(): void {
    if (!this.enabled()) return;

    this.open.set(true);

    // Every time: favourites are the signed-in user's and never reused across users / sessions.
    if (this.favouritesAvailable()) this.facade.loadFavourites();

    // The store may hold another query (the search page): ask again for the palette's.
    if (this.query().trim()) this.search(this.query());
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
    this.search(query);
  }

  /** Asks the index for the text part (scope tokens filter the results here). */
  private search(query: string): void {
    const text = parsePaletteQuery(query).text;

    this.facade.search(text || query, PALETTE_LIMIT);
  }

  onActivate(event: FpcCommandActivateEvent<PaletteEntry>): void {
    const entry = event.item.data;

    if (!entry) return;

    if (entry.type === 'tab') {
      this.close();
      void this.router.navigate([], { queryParams: { tab: entry.tab === 'summary' ? null : entry.tab } });

      return;
    }

    if (entry.type === 'all') {
      this.showAll();

      return;
    }

    if (entry.type === 'result' && event.newTab) {
      this.facade.visit(entry.result);
      window.open(searchResultRoute(entry.result), '_blank', 'noopener');

      return;
    }

    this.pick(entry);
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
