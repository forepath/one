import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, OnInit, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import {
  ConsoleAccessFacade,
  ConsoleEndpointService,
  ConsoleGitFacade,
  gitCommitUrl,
  gitPullRequestUrl,
  gitRepoWebUrl,
  parseGitRepoUrl,
  shortRef,
  shortSha,
  type GitCommit,
  type GitCommitState,
  type GitConnection,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcConfirmDialogComponent,
  fpcCopyText,
  FpcDataTableComponent,
  FpcDropdownComponent,
  FpcDropdownItemComponent,
  FpcEmptyStateComponent,
  FpcFormCheckComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcInputGroupComponent,
  FpcKeyValueDirective,
  type FpcBadgeTone,
  type FpcKeyValueItem,
  FpcKeyValueListComponent,
  type FpcMenuItem,
  FpcListHeaderComponent,
  FpcPageHeaderComponent,
  FpcSectionRowComponent,
  FpcTabComponent,
  FpcTabGroupComponent,
  FpcTableCellDirective,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';
import { interval, map } from 'rxjs';

import { dlCopyIdItem } from '../section/data-list';
import { LoadweaverLaneComponent } from '../section/lane.component';
import { LoadweaverGitConnectionModalComponent } from './git-connection-modal.component';
import {
  GIT_COMMIT_STATE_TONE,
  GIT_PROVIDER_ICON,
  gitCommitKindLabel,
  gitCommitStateLabel,
  gitModeHint,
  gitModeLabel,
  gitProviderLabel,
  gitScopeLabel,
  mayAdministerGitScope,
  webhookSecretHint,
} from './git-format';

const REFRESH_MS = 60_000;

/**
 * One Git connection (3.29; 3.38: the detail route `/delivery/git/<id>` of the Git master-detail shell): lanes
 * Connection (facts, webhook, actions) | Commits (the commits Loadweaver synced or wrote with their plans). Scope admins
 * test, sync, edit and (in More ▾) export the scope, reset a pinned SSH host key, disconnect, and read or rotate the
 * webhook secret.
 */
@Component({
  selector: 'loadweaver-git-connection-page',
  imports: [
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcConfirmDialogComponent,
    FpcDataTableComponent,
    FpcDropdownComponent,
    FpcDropdownItemComponent,
    FpcEmptyStateComponent,
    FpcFormCheckComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcInputGroupComponent,
    FpcKeyValueDirective,
    FpcKeyValueListComponent,
    FpcListHeaderComponent,
    FpcPageHeaderComponent,
    FpcSectionRowComponent,
    FpcTabComponent,
    FpcTabGroupComponent,
    FpcTableCellDirective,
    LoadweaverLaneComponent,
    CommonModule,
    FormsModule,
    RouterModule,
    LoadweaverGitConnectionModalComponent,
  ],
  templateUrl: './git-connection-page.component.html',
  standalone: true,
})
export class LoadweaverGitConnectionPageComponent implements OnInit {
  private readonly facade = inject(ConsoleGitFacade);
  private readonly access = inject(ConsoleAccessFacade);
  private readonly endpoints = inject(ConsoleEndpointService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly connections = toSignal(this.facade.connections$, { initialValue: [] as GitConnection[] });
  readonly loaded = toSignal(this.facade.loaded$, { initialValue: false });
  readonly loading = toSignal(this.facade.loading$, { initialValue: false });
  readonly error = toSignal(this.facade.error$, { initialValue: null });
  readonly allCommits = toSignal(this.facade.commits$, { initialValue: {} as Record<string, GitCommit[]> });
  readonly commitsLoading = toSignal(this.facade.commitsLoading$, { initialValue: null });
  readonly commitsError = toSignal(this.facade.commitsError$, { initialValue: null });
  readonly deleting = toSignal(this.facade.deleting$, { initialValue: null });
  readonly deleteError = toSignal(this.facade.deleteError$, { initialValue: null });
  readonly acting = toSignal(this.facade.acting$, { initialValue: null });
  readonly actionError = toSignal(this.facade.actionError$, { initialValue: null });
  readonly actionResult = toSignal(this.facade.actionResult$, { initialValue: null });
  readonly webhookSecret = toSignal(this.facade.webhookSecret$, { initialValue: null });
  readonly webhookSecretLoading = toSignal(this.facade.webhookSecretLoading$, { initialValue: null });
  readonly webhookSecretRotating = toSignal(this.facade.webhookSecretRotating$, { initialValue: null });
  readonly webhookSecretError = toSignal(this.facade.webhookSecretError$, { initialValue: null });
  private readonly me = toSignal(this.access.me$, { initialValue: null });
  readonly routeId = toSignal(this.route.paramMap.pipe(map((params) => params.get('id'))), {
    initialValue: this.route.snapshot?.paramMap.get('id') ?? null,
  });

  readonly isClusterAdmin = computed(() => this.me()?.clusterRole === 'cluster-admin');
  /** The routed connection. */
  readonly selected = computed(() => {
    const id = this.routeId();

    return id ? (this.connections().find((c) => c.id === id) ?? null) : null;
  });
  readonly routedMissing = computed(() => !!this.routeId() && this.loaded() && !this.loading() && !this.selected());
  readonly commits = computed(() => {
    const selected = this.selected();

    return selected ? (this.allCommits()[selected.id] ?? []) : [];
  });
  readonly canAdminSelected = computed(() => {
    const selected = this.selected();

    // Fleet mode (3.41): project admins manage their project's connection as the signed person only.
    return !!selected && mayAdministerGitScope(this.me(), selected.project, this.endpoints.fleetMode);
  });
  readonly selectedWebhookUrl = computed(() => {
    const selected = this.selected();

    return selected ? this.facade.webhookUrl(selected) : '';
  });
  readonly selectedIsSsh = computed(() => parseGitRepoUrl(this.selected()?.repoUrl ?? '')?.transport === 'ssh');
  readonly shownSecret = computed(() => {
    const secret = this.webhookSecret();

    return secret && secret.id === this.selected()?.id ? secret.secret : null;
  });
  /** The shown secret is a new one: the provider still has the old, now refused one. */
  readonly shownSecretRotated = computed(() => {
    const secret = this.webhookSecret();

    return !!secret && secret.id === this.selected()?.id && secret.rotated === true;
  });
  readonly result = computed(() => {
    const result = this.actionResult();

    return result && result.id === this.selected()?.id ? result.outcome : null;
  });
  readonly selectedActionError = computed(() => {
    const error = this.actionError();

    return error && error.id === this.selected()?.id ? error.error : null;
  });
  /** Phone lane tab: Connection | Commits. */
  readonly activeLane = signal<string | null>('connection');
  readonly facts = computed<FpcKeyValueItem[]>(() => {
    const c = this.selected();

    if (!c) return [];

    return [
      { key: 'repository', label: $localize`:@@lwConsoleGit-repository:Repository` },
      { key: 'branchPath', label: $localize`:@@lwConsoleGit-branchPath:Branch and path` },
      { key: 'mode', label: $localize`:@@lwConsoleGit-mode:Mode` },
      { key: 'trigger', label: $localize`:@@lwConsoleGit-trigger:Trigger`, value: this.triggerText(c) },
      { key: 'credentials', label: $localize`:@@lwConsoleGit-credentials:Credentials` },
      { key: 'options', label: $localize`:@@lwConsoleGit-optionsTitle:Options` },
      { key: 'lastSynced', label: $localize`:@@lwConsoleGit-lastSynced:Last synced commit` },
      ...(this.selectedIsSsh() || c.hostKey
        ? [{ key: 'hostKey', label: $localize`:@@lwConsoleGit-hostKey:SSH host key` }]
        : []),
    ];
  });
  /** 3.38 D1: State · Commit (short SHA, linked) · kind · reason · plan · author · time; ⋮ Copy ID. */
  readonly commitColumns: FpcTableColumn<GitCommit>[] = [
    {
      id: 'state',
      label: $localize`:@@lwConsoleGit-colState:State`,
      type: 'state',
      state: (k) => ({ label: this.stateLabel(k.state), tone: GIT_COMMIT_STATE_TONE[k.state] }),
    },
    {
      id: 'commit',
      label: $localize`:@@lwConsoleGit-colCommit:Commit`,
      value: (k) => k.sha,
      required: true,
      priority: 1,
    },
    { id: 'kind', label: $localize`:@@lwConsoleGit-colKind:Kind`, value: (k) => this.kindLabel(k.kind), priority: 2 },
    { id: 'reason', label: $localize`:@@lwConsoleGit-colReason:Details`, priority: 2 },
    { id: 'plan', label: $localize`:@@lwConsoleGit-colPlan:Plan`, value: (k) => (k.planId ? 1 : 0), priority: 3 },
    {
      id: 'author',
      label: $localize`:@@lwConsoleGit-colAuthor:Author and message`,
      value: (k) => `${k.author ?? ''} ${k.message ?? ''}`.trim(),
      priority: 3,
    },
    { id: 'time', label: $localize`:@@lwConsoleGit-colTime:Time`, value: (k) => k.createdAt, priority: 1 },
  ];
  readonly openPlanLabel = $localize`:@@lwConsoleGit-syncOpenPlan:Open the plan`;
  readonly commitMenu = (): FpcMenuItem[] => [dlCopyIdItem()];
  readonly commitId = (k: GitCommit) => k.id;

  onCommitAction(commit: GitCommit, action: string): void {
    if (action === 'copy-id') fpcCopyText(commit.sha);
  }

  readonly editOpen = signal(false);
  readonly deleteFor = signal<GitConnection | null>(null);
  readonly exportFor = signal<GitConnection | null>(null);
  readonly exportForce = signal(false);
  readonly resetFor = signal<GitConnection | null>(null);
  readonly revealFor = signal<GitConnection | null>(null);
  readonly rotateFor = signal<GitConnection | null>(null);

  readonly providerIcon = GIT_PROVIDER_ICON;
  readonly providerLabel = gitProviderLabel;
  readonly modeLabel = gitModeLabel;
  readonly modeHint = gitModeHint;
  readonly scopeLabel = gitScopeLabel;
  /** Tone per commit state (a function so untyped table-cell contexts can call it under strict templates). */
  readonly stateTone = (state: GitCommitState): FpcBadgeTone => GIT_COMMIT_STATE_TONE[state];
  readonly stateLabel = gitCommitStateLabel;
  readonly kindLabel = gitCommitKindLabel;
  readonly webhookHint = webhookSecretHint;
  readonly shortSha = shortSha;
  readonly shortRef = shortRef;
  readonly repoWebUrl = gitRepoWebUrl;

  readonly title = $localize`:@@lwConsoleGit-title:Git`;
  readonly backLabel = $localize`:@@lwConsoleMasterDetail-back:Back to the list`;
  readonly moreLabel = $localize`:@@lwConsoleGit-more:More actions`;
  readonly connectionLane = $localize`:@@lwConsoleGit-connectionLane:Connection`;
  readonly loadingLabel = $localize`:@@lwConsoleGit-loading:Loading connections`;
  readonly commitsLoadingLabel = $localize`:@@lwConsoleGit-commitsLoading:Loading commits`;
  readonly testLabel = $localize`:@@lwConsoleGit-test:Test connection`;
  readonly syncLabel = $localize`:@@lwConsoleGit-sync:Sync now`;
  readonly exportLabel = $localize`:@@lwConsoleGit-export:Export to repository`;
  readonly resetHostKeyLabel = $localize`:@@lwConsoleGit-resetHostKey:Reset SSH host key`;
  readonly editLabel = $localize`:@@lwConsoleGit-edit:Edit`;
  readonly deleteLabel = $localize`:@@lwConsoleGit-delete:Disconnect`;
  readonly commitsTitle = $localize`:@@lwConsoleGit-commits:Commits`;
  readonly webhookTitle = $localize`:@@lwConsoleGit-webhook:Webhook`;
  readonly deleteTitle = $localize`:@@lwConsoleGit-deleteTitle:Disconnect the repository?`;
  readonly deleteMessage = $localize`:@@lwConsoleGit-deleteMessage:Loadweaver stops syncing this scope and forgets its commits. The repository and the resources in the cluster stay as they are.`;
  readonly deleteConfirm = $localize`:@@lwConsoleGit-deleteConfirm:Disconnect`;
  readonly exportTitle = $localize`:@@lwConsoleGit-exportTitle:Export the scope to the repository?`;
  readonly exportMessage = $localize`:@@lwConsoleGit-exportMessage:Writes the scope's current state as one commit, one file per resource below the path. The commit becomes the synced state.`;
  readonly exportConfirm = $localize`:@@lwConsoleGit-exportConfirm:Export`;
  readonly resetTitle = $localize`:@@lwConsoleGit-resetTitle:Reset the pinned SSH host key?`;
  readonly resetMessage = $localize`:@@lwConsoleGit-resetMessage:The next contact pins whatever key the server presents. Only do this after a legitimate key rotation you verified.`;
  readonly resetConfirm = $localize`:@@lwConsoleGit-resetConfirm:Reset host key`;
  readonly revealTitle = $localize`:@@lwConsoleGit-revealTitle:Show the webhook secret?`;
  readonly revealMessage = $localize`:@@lwConsoleGit-revealMessage:The secret is sensitive: whoever has it can trigger syncs. Reading it is recorded in the audit log.`;
  readonly revealConfirm = $localize`:@@lwConsoleGit-revealConfirm:Show secret`;
  readonly rotateTitle = $localize`:@@lwConsoleGit-rotateTitle:Rotate the webhook secret?`;
  readonly rotateMessage = $localize`:@@lwConsoleGit-rotateMessage:The current secret stops working immediately: update the webhook secret at the provider afterwards, deliveries signed with the old one are refused until then. The new secret is shown once; rotating is recorded in the audit log.`;
  readonly rotateConfirm = $localize`:@@lwConsoleGit-rotateConfirm:Rotate secret`;
  readonly keepLabel = $localize`:@@lwConsoleGit-keep:Cancel`;

  constructor() {
    // The shown connection's commits.
    effect(() => {
      const id = this.selected()?.id;

      if (id) untracked(() => this.facade.loadCommits(id));
    });
  }

  ngOnInit(): void {
    this.access.load();

    if (!this.loaded()) this.facade.load();

    interval(REFRESH_MS)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        const id = this.selected()?.id;

        if (id) this.facade.loadCommits(id, true);
      });
    // A secret read on demand never outlives the page.
    this.destroyRef.onDestroy(() => {
      this.facade.hideWebhookSecret();
      this.facade.clearActionResult();
    });
  }

  openEdit(): void {
    this.editOpen.set(true);
  }

  run(connection: GitConnection, action: 'test' | 'sync'): void {
    this.facade.run(connection.id, action);
  }

  openExport(connection: GitConnection): void {
    this.exportForce.set(false);
    this.exportFor.set(connection);
  }

  confirmExport(): void {
    const connection = this.exportFor();

    this.exportFor.set(null);

    if (connection) this.facade.run(connection.id, 'export', this.exportForce());
  }

  confirmReset(): void {
    const connection = this.resetFor();

    this.resetFor.set(null);

    if (connection) this.facade.run(connection.id, 'reset-host-key');
  }

  confirmReveal(): void {
    const connection = this.revealFor();

    this.revealFor.set(null);

    if (connection) this.facade.revealWebhookSecret(connection.id);
  }

  confirmRotate(): void {
    const connection = this.rotateFor();

    this.rotateFor.set(null);

    if (connection) this.facade.rotateWebhookSecret(connection.id);
  }

  hideSecret(): void {
    this.facade.hideWebhookSecret();
  }

  confirmDelete(): void {
    const connection = this.deleteFor();

    this.deleteFor.set(null);

    if (!connection) return;

    this.facade.remove(connection.id);

    void this.router.navigate(['/delivery/git']);
  }

  dismissResult(): void {
    this.facade.clearActionResult();
  }

  copy(text: string | null | undefined): void {
    if (text) void navigator.clipboard?.writeText(text);
  }

  commitUrl(connection: GitConnection, sha: string | null | undefined): string | null {
    return sha ? gitCommitUrl(connection, sha) : null;
  }

  prUrl(connection: GitConnection, commit: GitCommit): string | null {
    return commit.prUrl ?? (commit.prNumber ? gitPullRequestUrl(connection, commit.prNumber) : null);
  }

  /** Git's own trigger summary: webhooks and / or polling. */
  triggerText(connection: GitConnection): string {
    const parts: string[] = [];

    if (connection.webhook) parts.push($localize`:@@lwConsoleGit-triggerWebhook:webhooks`);

    if (connection.pollIntervalSeconds)
      parts.push($localize`:@@lwConsoleGit-triggerPolling:polling every ${connection.pollIntervalSeconds}:seconds: s`);

    return parts.join(', ');
  }

  isActing(connection: GitConnection, action: string): boolean {
    const acting = this.acting();

    return !!acting && acting.id === connection.id && acting.action === action;
  }
}
