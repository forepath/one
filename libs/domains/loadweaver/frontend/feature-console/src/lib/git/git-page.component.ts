import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, OnInit, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import {
  ConsoleAccessFacade,
  ConsoleAccessManagementFacade,
  ConsoleGitFacade,
  gitCommitUrl,
  gitPullRequestUrl,
  gitRepoWebUrl,
  parseGitRepoUrl,
  shortRef,
  shortSha,
  sopsEncryptCommand,
  type GitCommit,
  type GitConnection,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcButtonGroupComponent,
  FpcConfirmDialogComponent,
  FpcEmptyStateComponent,
  FpcFormCheckComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcInputGroupComponent,
  FpcListComponent,
  FpcListItemComponent,
  FpcPageHeaderComponent,
  FpcPanelComponent,
  FpcPanelGridComponent,
  FpcSpinnerComponent,
} from '@forepath/shared/frontend/ui-components';
import { combineLatest, interval, map } from 'rxjs';

import { projectRoleOf } from '../access/access-format';
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

/** The connection a route points at: `/git/<id>` (inbox links) or `/git?connection=<id>`. */
export function routeConnectionId(
  params: { get(name: string): string | null },
  query: { get(name: string): string | null },
) {
  return params.get('id') || query.get('connection') || null;
}

/**
 * Git connections (3.29): per scope (the cluster, each project) the repository, branch, path, mode and trigger, the
 * sync status and the commits Loadweaver synced or wrote with their plans. Scope admins connect, change and
 * disconnect repositories, test them, sync now, export the scope, reset a pinned SSH host key and read or rotate the
 * webhook secret; everyone who may read the scope sees the rest. Also shows the cluster's SOPS recipient.
 */
@Component({
  selector: 'loadweaver-git-page',
  imports: [
    FpcPanelGridComponent,
    FpcButtonGroupComponent,
    FpcFormFieldComponent,
    FpcFormControlComponent,
    FpcFormCheckComponent,
    FpcInputGroupComponent,
    CommonModule,
    FormsModule,
    RouterModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcConfirmDialogComponent,
    FpcEmptyStateComponent,
    FpcListComponent,
    FpcListItemComponent,
    FpcPageHeaderComponent,
    FpcPanelComponent,
    FpcSpinnerComponent,
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
  readonly sopsRecipient = toSignal(this.facade.sopsRecipient$, { initialValue: null });
  readonly sopsLoaded = toSignal(this.facade.sopsLoaded$, { initialValue: false });
  readonly sopsError = toSignal(this.facade.sopsError$, { initialValue: null });
  readonly sopsUnavailable = toSignal(this.facade.sopsUnavailable$, { initialValue: false });
  private readonly me = toSignal(this.access.me$, { initialValue: null });
  private readonly allProjects = toSignal(this.accessManagement.projects$, { initialValue: [] as string[] });
  readonly routeId = toSignal(
    combineLatest([this.route.paramMap, this.route.queryParamMap]).pipe(
      map(([params, query]) => routeConnectionId(params, query)),
    ),
    { initialValue: null },
  );

  readonly isClusterAdmin = computed(() => this.me()?.clusterRole === 'cluster-admin');
  /** The connection shown: the routed one, otherwise the first. */
  readonly selected = computed(() => {
    const id = this.routeId();
    const connections = this.connections();

    return id ? (connections.find((c) => c.id === id) ?? null) : (connections[0] ?? null);
  });
  readonly routedMissing = computed(() => !!this.routeId() && this.loaded() && !this.loading() && !this.selected());
  readonly commits = computed(() => {
    const selected = this.selected();

    return selected ? (this.allCommits()[selected.id] ?? []) : [];
  });
  readonly canAdminSelected = computed(() => {
    const selected = this.selected();

    return !!selected && mayAdministerGitScope(this.me(), selected.project);
  });
  /** Scopes the caller may connect that have no connection yet ('' = the cluster scope). */
  readonly freeScopes = computed(() => {
    const me = this.me();
    const taken = new Set(this.connections().map((c) => c.project ?? ''));
    const projects = this.isClusterAdmin()
      ? this.allProjects()
      : Object.keys(me?.projects ?? {}).filter((p) => projectRoleOf(me, p) === 'admin');
    const scopes = [...(this.isClusterAdmin() ? [''] : []), ...[...projects].sort()];

    return scopes.filter((s) => !taken.has(s));
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
  readonly sopsCommand = computed(() => {
    const recipient = this.sopsRecipient();

    return recipient ? sopsEncryptCommand(recipient) : null;
  });

  readonly editOpen = signal(false);
  readonly editing = signal<GitConnection | null>(null);
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
  readonly stateTone = GIT_COMMIT_STATE_TONE;
  readonly stateLabel = gitCommitStateLabel;
  readonly kindLabel = gitCommitKindLabel;
  readonly webhookHint = webhookSecretHint;
  readonly shortSha = shortSha;
  readonly shortRef = shortRef;
  readonly repoWebUrl = gitRepoWebUrl;

  readonly title = $localize`:@@lwConsoleGit-title:Git`;
  readonly refreshLabel = $localize`:@@lwConsoleGit-refresh:Refresh`;
  readonly connectLabel = $localize`:@@lwConsoleGit-connect:Connect repository`;
  readonly testLabel = $localize`:@@lwConsoleGit-test:Test connection`;
  readonly syncLabel = $localize`:@@lwConsoleGit-sync:Sync now`;
  readonly exportLabel = $localize`:@@lwConsoleGit-export:Export to repository`;
  readonly resetHostKeyLabel = $localize`:@@lwConsoleGit-resetHostKey:Reset SSH host key`;
  readonly editLabel = $localize`:@@lwConsoleGit-edit:Edit`;
  readonly deleteLabel = $localize`:@@lwConsoleGit-delete:Disconnect`;
  readonly connectionsTitle = $localize`:@@lwConsoleGit-connections:Connections`;
  readonly commitsTitle = $localize`:@@lwConsoleGit-commits:Commits`;
  readonly webhookTitle = $localize`:@@lwConsoleGit-webhook:Webhook`;
  readonly sopsTitle = $localize`:@@lwConsoleGit-sops:SOPS`;
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
    // Cluster admins may connect any project.
    effect(() => {
      if (this.isClusterAdmin()) untracked(() => this.accessManagement.loadProjects());
    });

    // The shown connection's commits.
    effect(() => {
      const id = this.selected()?.id;

      if (id) untracked(() => this.facade.loadCommits(id));
    });
  }

  ngOnInit(): void {
    this.access.load();
    this.facade.load();
    this.facade.loadSopsRecipient();
    interval(REFRESH_MS)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.facade.load(true);

        const id = this.selected()?.id;

        if (id) this.facade.loadCommits(id, true);
      });
    // A secret read on demand never outlives the page.
    this.destroyRef.onDestroy(() => {
      this.facade.hideWebhookSecret();
      this.facade.clearActionResult();
    });
  }

  refresh(): void {
    this.facade.load();
    this.facade.loadSopsRecipient();

    const id = this.selected()?.id;

    if (id) this.facade.loadCommits(id);
  }

  select(connection: GitConnection): void {
    this.facade.hideWebhookSecret();
    this.facade.clearActionResult();
    void this.router.navigate(['/git', connection.id]);
  }

  openCreate(): void {
    this.editing.set(null);
    this.editOpen.set(true);
  }

  openEdit(connection: GitConnection): void {
    this.editing.set(connection);
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

    if (this.routeId() === connection.id) void this.router.navigate(['/git']);
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

    return parts.join(' · ');
  }

  isActing(connection: GitConnection, action: string): boolean {
    const acting = this.acting();

    return !!acting && acting.id === connection.id && acting.action === action;
  }
}
