import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NodesService, type NodePlatformComponent } from '@forepath/loadweaver/frontend/data-access-console';
import { FpcDataTableComponent, type FpcTableColumn, type FpcTableSort } from '@forepath/shared/frontend/ui-components';
import { retry, Subscription, throwError, timer } from 'rxjs';

import {
  filterPlatformRows,
  platformComponentLabel,
  platformRoleLabel,
  platformStateBadge,
} from '../node-platform-format';
import { savedViewBinding } from '../../views/saved-views';
import { LoadweaverSavedViewsComponent } from '../../views/saved-views.component';

/**
 * Node page "Workloads" → lane "Platform" (2026-10-30; a third of the width next to the user workloads lane, searchable): the platform components the node runs (etcd, Postgres, the
 * API replica, object store, registry, ingress …), read-only — no row menu, selection, links or drag; hidden while the
 * node runs none. Reloads with the Contents table's refresh (`reloadKey`).
 */
@Component({
  selector: 'loadweaver-node-platform',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FpcDataTableComponent, LoadweaverSavedViewsComponent],
  host: { class: 'd-flex flex-column flex-grow-1 min-h-0' },
  template: `
    <fpc-data-table
      class="flex-grow-1 min-h-0"
      data-testid="node-platform"
      [ariaLabel]="title"
      [columns]="columns"
      [rows]="visibleRows()"
      [rowId]="rowId"
      [(query)]="query"
      [searchPlaceholder]="searchLabel"
      persistKey="lw-node-platform"
      [(visibleColumns)]="columnsShown"
      [(sort)]="sort"
      [error]="error()"
      [loading]="loading() && rows().length === 0"
      refreshable
      (refresh)="reload()"
      emptyIcon="cpu"
      [labels]="{ empty: emptyTitle }"
    >
      <loadweaver-saved-views fpcDataTableToolbar scope="node-platform" [binding]="views" />
    </fpc-data-table>
  `,
})
export class LoadweaverNodePlatformComponent {
  private readonly nodes = inject(NodesService);
  private readonly destroyRef = inject(DestroyRef);

  readonly node = input.required<string>();
  /** Changes when the surrounding table is refreshed. */
  readonly reloadKey = input(0);
  /** Number of platform components, after each load (the Contents table words its empty state with it). */
  readonly loaded = output<number>();

  readonly rows = signal<NodePlatformComponent[]>([]);
  /** Search over component, role, state and detail (all words must match, case-insensitive). */
  readonly query = signal('');
  readonly visibleRows = computed(() => filterPlatformRows(this.rows(), this.query()));
  readonly columnsShown = signal<readonly string[] | null>(null);
  readonly sort = signal<FpcTableSort | null>(null);
  /** Saved views of this table (search, columns, sort), per user like the other lists. */
  readonly views = savedViewBinding({ query: this.query, columns: this.columnsShown, sort: this.sort });
  readonly error = signal<string | null>(null);
  /** Until the first answer (and on refresh while empty): the table's skeleton rows. */
  readonly loading = signal(true);

  readonly title = $localize`:@@lwConsoleNodePlatform-title:Platform`;
  readonly searchLabel = $localize`:@@lwConsoleNodePlatform-search:Search platform components`;
  readonly emptyTitle = $localize`:@@lwConsoleNodePlatform-empty:No platform components on this node`;
  private readonly loadError = $localize`:@@lwConsoleNodePlatform-loadError:The platform components couldn't be loaded. Reload to try again.`;
  readonly columns: FpcTableColumn<NodePlatformComponent>[] = [
    {
      id: 'state',
      label: $localize`:@@lwConsoleNodePlatform-state:State`,
      type: 'state',
      state: (r) => platformStateBadge(r.state),
    },
    {
      id: 'name',
      label: $localize`:@@lwConsoleNodePlatform-component:Component`,
      value: (r) => platformComponentLabel(r),
      required: true,
      priority: 1,
    },
    {
      id: 'role',
      label: $localize`:@@lwConsoleNodePlatform-role:Role`,
      value: (r) => platformRoleLabel(r.role),
      priority: 1,
    },
    { id: 'detail', label: $localize`:@@lwConsoleNodePlatform-detail:Detail`, value: (r) => r.detail ?? '—' },
  ];
  readonly rowId = (row: NodePlatformComponent) => row.id;

  private request: Subscription | null = null;

  constructor() {
    effect(() => {
      const name = this.node();

      this.reloadKey();
      untracked(() => this.load(name));
    });
    this.destroyRef.onDestroy(() => this.request?.unsubscribe());
  }

  /** The table's own refresh: reloads the platform components (the surrounding table has its own). */
  reload(): void {
    this.load(this.node());
  }

  private load(name: string): void {
    this.request?.unsubscribe();
    this.loading.set(true);
    this.request = this.nodes
      .platform(name)
      .pipe(
        // A control plane that is just restarting / briefly unreachable (fleet "socket hang up", 5xx, network 0):
        // retry twice before showing the error; 4xx (e.g. 404 from an older control plane) answer at once.
        retry({ count: 2, delay: (error: unknown) => (isTransient(error) ? timer(1500) : throwError(() => error)) }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (rows) => {
          this.rows.set(rows);
          this.error.set(null);
          this.loading.set(false);
          this.loaded.emit(rows.length);
        },
        error: (error: unknown) => {
          // Older control planes don't have the route (404): no Platform group rather than an error box.
          const missing = (error as { status?: number } | null)?.status === 404;

          this.rows.set([]);
          this.error.set(missing ? null : this.loadError);
          this.loading.set(false);
          this.loaded.emit(0);
        },
      });
  }
}

/** Worth retrying: no answer (status 0) or a server-side failure (5xx). */
function isTransient(error: unknown): boolean {
  const status = (error as { status?: number } | null)?.status ?? 0;

  return status === 0 || status >= 500;
}
