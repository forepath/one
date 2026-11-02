import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, OnInit, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import {
  ConsoleAccessFacade,
  ConsoleAccessManagementFacade,
  ConsoleEndpointService,
  ConsoleGitFacade,
  GitService,
  shortSha,
  type GitConnection,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  fpcCopyText,
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  FpcPageHeaderComponent,
  fpcRunBulk,
  FpcTableCellDirective,
  type FpcMenuItem,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';
import { combineLatest, firstValueFrom, interval } from 'rxjs';

import { filterBySearch } from '../list-search';
import { dlBulkSummary, dlCopyIdItem, dlOpenItem } from '../section/data-list';
import { MasterDetailState } from '../section/master-detail.component';
import { injectSectionScope, sectionParams$, sectionQuery$ } from '../section/section-scope';
import { savedViewBinding } from '../views/saved-views';
import { LoadweaverSavedViewsComponent } from '../views/saved-views.component';
import { LoadweaverGitConnectionModalComponent } from './git-connection-modal.component';
import {
  GIT_PROVIDER_ICON,
  gitFleetIdentityGap,
  gitModeLabel,
  gitProviderLabel,
  gitScopeLabel,
  mayAdministerGitScope,
} from './git-format';

const REFRESH_MS = 60_000;

/** The connection a route points at: `/delivery/git/<id>` (inbox links) or `/delivery/git?connection=<id>`. */
export function routeConnectionId(
  params: { get(name: string): string | null },
  query: { get(name: string): string | null },
) {
  return params.get('id') || query.get('connection') || null;
}

/**
 * Git connections (3.29): per scope (the cluster, each project) the repository, branch, path, mode and sync status.
 * 3.38: the list lane of the Git master-detail shell; a connection opens as the detail route `/delivery/git/<id>`
 * (`LoadweaverGitConnectionPageComponent`; the old `?connection=<id>` redirects there). Embedded in a project's Git tab
 * (`LW_SECTION_SCOPE`, `project`) the list shows that project's connection only (client-side), without the header and
 * without URL writes; Connect / Refresh sit in the toolbar strip.
 */
@Component({
  selector: 'loadweaver-git-page',
  imports: [
    LoadweaverSavedViewsComponent,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcDataTableComponent,
    FpcEmptyStateComponent,
    FpcPageHeaderComponent,
    FpcTableCellDirective,
    CommonModule,
    RouterModule,
    LoadweaverGitConnectionModalComponent,
  ],
  templateUrl: './git-page.component.html',
  standalone: true,
})
export class LoadweaverGitPageComponent implements OnInit {
  private readonly facade = inject(ConsoleGitFacade);
  private readonly access = inject(ConsoleAccessFacade);
  private readonly accessManagement = inject(ConsoleAccessManagementFacade);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly gitService = inject(GitService);
  private readonly fleetMode = inject(ConsoleEndpointService).fleetMode;
  private readonly masterDetail = inject(MasterDetailState, { optional: true });
  readonly scope = injectSectionScope();
  /** The project the embedding object fixes (`null`: all scopes). */
  readonly scopeProject = this.scope?.params()['project'] ?? null;

  readonly connections = toSignal(this.facade.connections$, { initialValue: [] as GitConnection[] });
  /** The connections of this view: all, or the embedding project's (client-side: the API lists every scope). */
  readonly scoped = computed(() =>
    this.scopeProject === null ? this.connections() : this.connections().filter((c) => c.project === this.scopeProject),
  );
  readonly search = signal('');
  /** "Views ▾" (3.37): saved search / filters of this list, per user. */
  readonly views = savedViewBinding({ search: this.search });
  readonly filtered = computed(() =>
    filterBySearch(this.scoped(), this.search(), (c) => [
      this.scopeLabel(c.project),
      c.repoUrl,
      c.branch,
      c.path,
      this.modeLabel(c.mode),
      c.lastSyncedCommit,
    ]),
  );
  readonly loading = toSignal(this.facade.loading$, { initialValue: false });
  readonly error = toSignal(this.facade.error$, { initialValue: null });
  readonly deleteError = toSignal(this.facade.deleteError$, { initialValue: null });
  private readonly me = toSignal(this.access.me$, { initialValue: null });
  private readonly allProjects = toSignal(this.accessManagement.projects$, { initialValue: [] as string[] });

  readonly openId = computed(() => this.masterDetail?.selectedId() ?? null);
  readonly isClusterAdmin = computed(() => this.me()?.clusterRole === 'cluster-admin');
  /**
   * Fleet mode (3.41): project grants reach Git connections only as the signed person — what's missing while the
   * cluster doesn't verify this fleet's identity (`read`: the list, `manage`: the caller's project connections).
   */
  readonly fleetGap = computed(() => gitFleetIdentityGap(this.fleetMode, this.me()));
  readonly fleetGapHint = computed(() =>
    this.fleetGap() === 'read'
      ? $localize`:@@lwConsoleGit-fleetReadHint:Your project grants reach Git connections through the fleet only as you personally, so the cluster has to verify this fleet's identity first. A fleet admin establishes trust on the fleet's cluster page; until then use the cluster's own console.`
      : $localize`:@@lwConsoleGit-fleetManageHint:Managing your projects' Git connections through the fleet needs the cluster to verify this fleet's identity (you act as yourself there). A fleet admin establishes trust on the fleet's cluster page; until then use the cluster's own console.`,
  );
  /** Scopes the caller may connect that have no connection yet ('' = the cluster scope; embedded: that project). */
  readonly freeScopes = computed(() => {
    const me = this.me();
    const taken = new Set(this.connections().map((c) => c.project ?? ''));
    const projects = this.isClusterAdmin()
      ? this.allProjects()
      : Object.keys(me?.projects ?? {}).filter((p) => mayAdministerGitScope(me, p, this.fleetMode));
    const scopes = [...(this.isClusterAdmin() ? [''] : []), ...[...projects].sort()];
    const free = scopes.filter((s) => !taken.has(s));

    return this.scopeProject === null ? free : free.filter((s) => s === this.scopeProject);
  });

  readonly editOpen = signal(false);

  readonly providerIcon = GIT_PROVIDER_ICON;
  readonly modeLabel = gitModeLabel;
  readonly scopeLabel = gitScopeLabel;
  readonly shortSha = shortSha;

  readonly title = $localize`:@@lwConsoleGit-title:Git`;
  readonly refreshLabel = $localize`:@@lwConsoleGit-refresh:Refresh`;
  readonly connectLabel = $localize`:@@lwConsoleGit-connect:Connect repository`;
  readonly searchLabel = $localize`:@@lwConsoleGit-search:Search connections`;
  readonly loadingLabel = $localize`:@@lwConsoleGit-loading:Loading connections`;
  readonly syncLabel = $localize`:@@lwConsoleGit-bulkSync:Sync now`;
  readonly providerLabel = gitProviderLabel;
  readonly providerIconOf = (connection: GitConnection) => GIT_PROVIDER_ICON[connection.provider];

  /** 3.38 D1: State (sync) · Scope (link) · mode · provider · repository · branch · last commit · last sync. */
  readonly columns: FpcTableColumn<GitConnection>[] = [
    {
      id: 'status',
      label: $localize`:@@lwConsoleGit-colStatus:Status`,
      type: 'state',
      state: (c) =>
        c.lastError
          ? { label: $localize`:@@lwConsoleGit-errorBadge:Error`, tone: 'danger' }
          : c.lastSyncAt
            ? { label: $localize`:@@lwConsoleGit-stateSynced:Synced`, tone: 'success' }
            : { label: $localize`:@@lwConsoleGit-neverSynced:Not synced yet`, tone: 'neutral' },
    },
    {
      id: 'scope',
      label: $localize`:@@lwConsoleGit-colScope:Scope`,
      value: (c) => gitScopeLabel(c.project),
      required: true,
      priority: 1,
    },
    { id: 'mode', label: $localize`:@@lwConsoleGit-colMode:Mode`, value: (c) => gitModeLabel(c.mode), priority: 2 },
    {
      id: 'provider',
      label: $localize`:@@lwConsoleGit-colProvider:Provider`,
      value: (c) => gitProviderLabel(c.provider),
      priority: 3,
    },
    {
      id: 'repo',
      label: $localize`:@@lwConsoleGit-colRepository:Repository`,
      value: (c) => c.repoUrl,
      mono: true,
      priority: 1,
    },
    { id: 'branch', label: $localize`:@@lwConsoleGit-colBranch:Branch`, value: (c) => c.branch, priority: 2 },
    {
      id: 'commit',
      label: $localize`:@@lwConsoleGit-colLastCommit:Last commit`,
      value: (c) => (c.lastSyncedCommit ? shortSha(c.lastSyncedCommit) : ''),
      mono: true,
      priority: 3,
    },
    {
      id: 'lastSync',
      label: $localize`:@@lwConsoleGit-colLastSync:Last sync`,
      value: (c) => c.lastSyncAt ?? '',
      priority: 2,
    },
  ];

  readonly selected = signal<readonly string[]>([]);
  readonly bulkResult = signal<{ tone: 'success' | 'warning' | 'danger'; message: string } | null>(null);
  /** The selected connections of scopes the caller administers (the server checks each one again). */
  readonly syncable = computed(() => {
    const ids = new Set(this.selected());

    return this.scoped().filter((c) => ids.has(c.id) && mayAdministerGitScope(this.me(), c.project, this.fleetMode));
  });
  readonly connectionLink = (c: GitConnection): string => `/delivery/git/${encodeURIComponent(c.id)}`;
  readonly rowMenu = (c: GitConnection): FpcMenuItem[] => [
    dlOpenItem(),
    ...(mayAdministerGitScope(this.me(), c.project, this.fleetMode)
      ? [{ id: 'sync', label: this.syncLabel, icon: 'arrow-repeat', dividerBefore: true }]
      : []),
    dlCopyIdItem(),
  ];

  constructor() {
    // Cluster admins may connect any project.
    effect(() => {
      if (this.isClusterAdmin()) untracked(() => this.accessManagement.loadProjects());
    });

    // Old deep links `?connection=<id>` open the detail route (routed list only).
    if (!this.scope) {
      combineLatest([sectionParams$(this.route, null), sectionQuery$(this.route, null)])
        .pipe(takeUntilDestroyed())
        .subscribe(([params, query]) => {
          const id = query.get('connection');

          if (id && !params.get('id'))
            void this.router.navigate(['/delivery/git', routeConnectionId(params, query)], { replaceUrl: true });
        });
    }
  }

  ngOnInit(): void {
    this.access.load();
    this.facade.load();
    interval(REFRESH_MS)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.facade.load(true));
  }

  refresh(): void {
    this.facade.load();
  }

  select(connection: GitConnection): void {
    this.facade.hideWebhookSecret();
    this.facade.clearActionResult();
    void this.router.navigate(['/delivery/git', connection.id]);
  }

  onRowAction(connection: GitConnection, action: string): void {
    if (action === 'open') this.select(connection);
    else if (action === 'sync') this.facade.run(connection.id, 'sync');
    else if (action === 'copy-id') fpcCopyText(connection.id);
  }

  /** Bulk Sync: one call per connection (same endpoint + authorization as the detail action), per-connection result. */
  async syncSelected(): Promise<void> {
    const connections = this.syncable();

    if (connections.length === 0) return;

    const result = await fpcRunBulk(connections, (c) => firstValueFrom(this.gitService.sync(c.id)));

    this.bulkResult.set(dlBulkSummary(result, (c) => gitScopeLabel(c.project)));
    this.selected.set([]);
    this.facade.load(true);
  }

  openCreate(): void {
    this.editOpen.set(true);
  }

  dismissError(): void {
    this.facade.clearActionResult();
  }
}
