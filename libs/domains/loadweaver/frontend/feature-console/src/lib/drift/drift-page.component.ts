import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import {
  ConsoleAccessFacade,
  ConsoleDriftFacade,
  ConsoleGitFacade,
  gitCommitUrl,
  shortSha,
  type DelegatedContainer,
  type DriftContainer,
  type DriftInconsistency,
  type GitAheadEntry,
  type GitConnection,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  fpcCopyText,
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcPageHeaderComponent,
  FpcSectionRowComponent,
  FpcTableCellDirective,
  type FpcBadgeTone,
  type FpcMenuItem,
  type FpcTableColumn,
  FpcTabComponent,
  FpcTabGroupComponent,
  FpcTypeaheadSelectComponent,
} from '@forepath/shared/frontend/ui-components';
import { interval } from 'rxjs';

import { GIT_COMMIT_STATE_TONE, gitCommitStateLabel, gitScopeLabel } from '../git/git-format';
import { filterBySearch } from '../list-search';
import { dlCopyIdItem } from '../section/data-list';
import { LoadweaverLaneComponent } from '../section/lane.component';

/** A container's runtime state, readable (Docker states; unknown ones as they are). */
export function containerStateLabel(state: string): string {
  switch (state) {
    case 'running':
      return $localize`:@@lwConsoleDrift-stateRunning:Running`;
    case 'exited':
      return $localize`:@@lwConsoleDrift-stateExited:Exited`;
    case 'paused':
      return $localize`:@@lwConsoleDrift-statePaused:Paused`;
    case 'created':
      return $localize`:@@lwConsoleDrift-stateCreated:Created`;
    case 'restarting':
      return $localize`:@@lwConsoleDrift-stateRestarting:Restarting`;
    case 'dead':
      return $localize`:@@lwConsoleDrift-stateDead:Dead`;
    default:
      return state;
  }
}

/** Lanes of the drift page (phone lane tabs). */
export type DriftLane = 'git' | 'rollbacks' | 'containers' | 'delegated';

const REFRESH_MS = 60_000;
const NAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** A deployment name from a container name (lowercase, dashes, at most 63 characters). */
export function deploymentName(container: string): string {
  return (
    container
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 63)
      .replace(/-+$/g, '') || 'service'
  );
}

/**
 * Drift (3.8): containers on the nodes that Loadweaver doesn't manage, failed rollbacks whose configuration and
 * reality may differ, and Git scopes whose default branch is ahead of the cluster (3.29). A foreign container can be
 * turned into a proposed plan (reviewed and applied like any plan; a pull request in Git-authoritative scopes).
 */
@Component({
  selector: 'loadweaver-drift-page',
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcDataTableComponent,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcPageHeaderComponent,
    FpcSectionRowComponent,
    FpcTableCellDirective,
    FpcTabComponent,
    FpcTabGroupComponent,
    FpcTypeaheadSelectComponent,
    LoadweaverLaneComponent,
  ],
  templateUrl: './drift-page.component.html',
  standalone: true,
})
export class LoadweaverDriftPageComponent implements OnInit {
  private readonly facade = inject(ConsoleDriftFacade);
  private readonly access = inject(ConsoleAccessFacade);
  private readonly git = inject(ConsoleGitFacade);
  private readonly destroyRef = inject(DestroyRef);

  private readonly router = inject(Router);
  readonly report = toSignal(this.facade.report$, { initialValue: null });
  readonly loading = toSignal(this.facade.loading$, { initialValue: false });
  readonly error = toSignal(this.facade.error$, { initialValue: null });
  readonly proposing = toSignal(this.facade.proposing$, { initialValue: false });
  readonly proposeError = toSignal(this.facade.proposeError$, { initialValue: null });
  readonly projects = toSignal(this.access.projects$, { initialValue: [] as string[] });
  private readonly gitConnections = toSignal(this.git.connections$, { initialValue: [] as GitConnection[] });
  readonly gitAhead = computed(() => this.report()?.gitAhead ?? []);
  readonly containerSearch = signal('');
  readonly filteredContainers = computed(() =>
    filterBySearch(this.report()?.containers ?? [], this.containerSearch(), (c) => [
      c.name,
      c.image,
      c.node,
      c.id,
      c.ports,
    ]),
  );
  /** Lane searches (3.38: every list lane that can grow). */
  readonly rollbackSearch = signal('');
  readonly delegatedSearch = signal('');
  readonly filteredRollbacks = computed(() =>
    filterBySearch(this.report()?.inconsistent ?? [], this.rollbackSearch(), (i) => [
      i.error,
      i.fixForward ? this.openFixForwardLabel : '',
    ]),
  );
  readonly filteredDelegated = computed(() =>
    filterBySearch(this.report()?.delegated ?? [], this.delegatedSearch(), (c) => [
      c.name,
      c.image,
      c.node,
      c.id,
      c.delegatedTo,
    ]),
  );
  /** The visible lanes (Git ahead / delegated only when there are entries). */
  readonly lanes = computed<{ id: DriftLane; label: string }[]>(() => {
    const report = this.report();

    return [
      ...(this.gitAhead().length > 0 ? [{ id: 'git' as const, label: this.gitAheadTitle }] : []),
      { id: 'rollbacks' as const, label: this.inconsistentTitle },
      { id: 'containers' as const, label: this.containersTitle },
      ...((report?.delegated ?? []).length > 0 ? [{ id: 'delegated' as const, label: this.delegatedTitle }] : []),
    ];
  });
  readonly lane = signal<DriftLane>('containers');
  /** The phone lane: the chosen one while visible, else the first. */
  readonly activeLane = computed<DriftLane>(() => {
    const lanes = this.lanes();

    return lanes.some((l) => l.id === this.lane()) ? this.lane() : lanes[0].id;
  });

  readonly stateTone = GIT_COMMIT_STATE_TONE;
  readonly stateLabel = gitCommitStateLabel;
  readonly scopeLabel = (scope: string) => gitScopeLabel(scope === 'cluster' ? null : scope);
  readonly shortSha = shortSha;

  readonly openFixForwardLabel = $localize`:@@lwConsoleDrift-openFixForward:Open the fix-forward plan`;
  readonly openFailedPlanLabel = $localize`:@@lwConsoleDrift-openFailedPlan:Open the plan`;

  /** Git ahead: State (commit state) · Scope (link to the connection) · commit · reason · since. */
  readonly gitColumns: FpcTableColumn<GitAheadEntry>[] = [
    {
      id: 'state',
      label: $localize`:@@lwConsoleDrift-colState:Status`,
      type: 'state',
      state: (e) => ({ label: gitCommitStateLabel(e.state), tone: GIT_COMMIT_STATE_TONE[e.state] }),
    },
    {
      id: 'scope',
      label: $localize`:@@lwConsoleDrift-colScope:Scope`,
      value: (e) => this.scopeLabel(e.scope),
      required: true,
      priority: 1,
    },
    { id: 'commit', label: $localize`:@@lwConsoleGitDrift-commit:Commit`, value: (e) => e.commit, priority: 1 },
    { id: 'reason', label: $localize`:@@lwConsoleDrift-colReason:Reason`, priority: 2 },
    { id: 'since', label: $localize`:@@lwConsoleDrift-colSince:Since`, value: (e) => e.since, priority: 2 },
  ];
  readonly gitId = (e: GitAheadEntry): string => e.connection;
  readonly gitLink = (e: GitAheadEntry): string => `/delivery/git/${encodeURIComponent(e.connection)}`;
  readonly gitMenu = (e: GitAheadEntry): FpcMenuItem[] => [
    ...(e.planId ? [{ id: 'plan', label: this.openPlanLabel, icon: 'file-diff' }] : []),
    { id: 'connection', label: this.openConnectionLabel, icon: 'git' },
  ];

  /** Failed rollbacks: State · Failed rollback (error, link to the plan) · fix-forward. No plan ids (D11). */
  readonly rollbackColumns: FpcTableColumn<DriftInconsistency>[] = [
    {
      id: 'state',
      label: $localize`:@@lwConsoleDrift-colState:Status`,
      type: 'state',
      state: () => ({ label: $localize`:@@lwConsoleDrift-rollbackFailed:Rollback failed`, tone: 'danger' }),
    },
    {
      id: 'error',
      label: $localize`:@@lwConsoleDrift-colRollback:Failed rollback`,
      value: (i) => i.error ?? this.openFailedPlanLabel,
      required: true,
      priority: 1,
    },
    {
      id: 'fixForward',
      label: $localize`:@@lwConsoleDrift-colFixForward:Fix-forward`,
      value: (i) => (i.fixForward ? 1 : 0),
      priority: 1,
    },
  ];
  readonly rollbackId = (i: DriftInconsistency): string => i.planId;
  readonly rollbackLink = (i: DriftInconsistency): string => `/activity/plans/${encodeURIComponent(i.planId)}`;
  readonly rollbackMenu = (i: DriftInconsistency): FpcMenuItem[] => [
    { id: 'open', label: this.openFailedPlanLabel, icon: 'box-arrow-up-right' },
    ...(i.fixForward ? [{ id: 'fix-forward', label: this.openFixForwardLabel, icon: 'bandaid' }] : []),
    dlCopyIdItem(),
  ];

  /** Foreign / delegated containers: State (runtime state, readable) · Container · image · node · …; no container ids. */
  readonly containerId = (c: DriftContainer): string => `${c.node}/${c.id}`;
  private readonly containerState = (c: DriftContainer) => ({
    label: containerStateLabel(c.state),
    tone: (c.state === 'running'
      ? 'success'
      : c.state === 'restarting' || c.state === 'dead'
        ? 'warning'
        : 'neutral') as FpcBadgeTone,
  });
  readonly containerColumns: FpcTableColumn<DriftContainer>[] = [
    { id: 'state', label: $localize`:@@lwConsoleDrift-colState:Status`, type: 'state', state: this.containerState },
    {
      id: 'name',
      label: $localize`:@@lwConsoleDrift-colContainer:Container`,
      value: (c) => c.name,
      required: true,
      priority: 1,
    },
    { id: 'image', label: $localize`:@@lwConsoleDrift-colImage:Image`, value: (c) => c.image, mono: true, priority: 1 },
    { id: 'node', label: $localize`:@@lwConsoleDrift-colNode:Node`, value: (c) => c.node, priority: 2 },
    {
      id: 'ports',
      label: $localize`:@@lwConsoleDrift-colPorts:Ports`,
      value: (c) => c.ports.join(', '),
      mono: true,
      priority: 3,
    },
    {
      id: 'reported',
      label: $localize`:@@lwConsoleDrift-colReported:Reported`,
      value: (c) => c.reportedAt,
      priority: 3,
    },
  ];
  readonly delegatedColumns: FpcTableColumn<DelegatedContainer>[] = [
    { id: 'state', label: $localize`:@@lwConsoleDrift-colState:Status`, type: 'state', state: this.containerState },
    {
      id: 'name',
      label: $localize`:@@lwConsoleDrift-colContainer:Container`,
      value: (c) => c.name,
      required: true,
      priority: 1,
    },
    {
      id: 'delegatedTo',
      label: $localize`:@@lwConsoleDrift-colDelegatedTo:Started by`,
      value: (c) => c.delegatedTo,
      mono: true,
      priority: 1,
    },
    { id: 'image', label: $localize`:@@lwConsoleDrift-colImage:Image`, value: (c) => c.image, mono: true, priority: 2 },
    { id: 'node', label: $localize`:@@lwConsoleDrift-colNode:Node`, value: (c) => c.node, priority: 2 },
  ];
  readonly containerMenu = (): FpcMenuItem[] => [
    { id: 'propose', label: this.proposeLabel, icon: 'file-earmark-plus' },
    dlCopyIdItem(),
  ];
  readonly delegatedMenu = (): FpcMenuItem[] => [dlCopyIdItem()];

  readonly proposeFor = signal<DriftContainer | null>(null);
  readonly invalid = signal(false);
  readonly projectSuggestionsOpen = signal(false);
  project = '';
  deployment = '';

  readonly title = $localize`:@@lwConsoleDrift-title:Drift`;
  readonly refreshLabel = $localize`:@@lwConsoleDrift-refresh:Refresh`;
  readonly containersTitle = $localize`:@@lwConsoleDrift-containers:Foreign containers`;
  readonly delegatedTitle = $localize`:@@lwConsoleDrift-delegatedTitle:Delegated containers`;
  readonly inconsistentTitle = $localize`:@@lwConsoleDrift-inconsistent:Failed rollbacks`;
  readonly gitAheadTitle = $localize`:@@lwConsoleGitDrift-aheadTitle:Default branch ahead of the cluster`;
  readonly proposeTitle = $localize`:@@lwConsoleDrift-proposeTitle:Propose a plan`;
  readonly containerSearchLabel = $localize`:@@lwConsoleDrift-containerSearch:Search containers`;
  readonly rollbackSearchLabel = $localize`:@@lwConsoleDrift-rollbackSearch:Search rollbacks`;
  readonly delegatedSearchLabel = $localize`:@@lwConsoleDrift-delegatedSearch:Search delegated containers`;
  readonly loadingLabel = $localize`:@@lwConsoleDrift-loading:Loading drift`;
  readonly proposeLabel = $localize`:@@lwConsoleDrift-propose:Propose plan`;
  readonly openPlanLabel = $localize`:@@lwConsoleGitDrift-openPlan:Open plan`;
  readonly openConnectionLabel = $localize`:@@lwConsoleGitDrift-openConnection:Connection`;

  ngOnInit(): void {
    this.facade.load();
    this.git.load(true);
    interval(REFRESH_MS)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.facade.load(true));
  }

  refresh(): void {
    this.facade.load();
  }

  openPropose(container: DriftContainer): void {
    this.project = this.projects()[0] ?? '';
    this.deployment = deploymentName(container.name);
    this.invalid.set(false);
    this.facade.clearProposeError();
    this.proposeFor.set(container);
  }

  /** The caller's projects matching the typed project (free text stays allowed). */
  projectSuggestions(): string[] {
    const query = this.project.trim().toLowerCase();

    return this.projects().filter((p) => !query || p.toLowerCase().includes(query));
  }

  pickProject(project: string, event: Event): void {
    // `mousedown` keeps the focus in the input until the pick is done.
    event.preventDefault();
    this.project = project;
    this.projectSuggestionsOpen.set(false);
  }

  onProposeOpenChange(open: boolean): void {
    if (!open) this.proposeFor.set(null);
  }

  /** On success the console opens the proposed plan. */
  propose(): void {
    const container = this.proposeFor();

    if (!container) return;

    if (!NAME.test(this.project) || !NAME.test(this.deployment)) {
      this.invalid.set(true);

      return;
    }

    this.invalid.set(false);
    this.facade.propose({
      node: container.node,
      container: container.id,
      project: this.project,
      deployment: this.deployment,
    });
  }

  /** The commit on the provider, where the connection is readable. */
  commitUrl(entry: GitAheadEntry): string | null {
    const connection = this.gitConnections().find((c) => c.id === entry.connection);

    return connection ? gitCommitUrl(connection, entry.commit) : null;
  }

  onGitAction(entry: GitAheadEntry, action: string): void {
    if (action === 'plan' && entry.planId) void this.router.navigate(['/activity/plans', entry.planId]);
    else if (action === 'connection') void this.router.navigate(['/delivery/git', entry.connection]);
  }

  onRollbackAction(item: DriftInconsistency, action: string): void {
    if (action === 'open') void this.router.navigate(['/activity/plans', item.planId]);
    else if (action === 'fix-forward' && item.fixForward)
      void this.router.navigate(['/activity/plans', item.fixForward]);
    else if (action === 'copy-id') fpcCopyText(item.planId);
  }

  onContainerAction(container: DriftContainer, action: string): void {
    if (action === 'propose') this.openPropose(container);
    else if (action === 'copy-id') fpcCopyText(container.id);
  }
}
