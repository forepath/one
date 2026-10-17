import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import {
  ConsoleAccessFacade,
  ConsoleDriftFacade,
  ConsoleGitFacade,
  gitCommitUrl,
  shortSha,
  type DriftContainer,
  type GitAheadEntry,
  type GitConnection,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcEmptyStateComponent,
  FpcListComponent,
  FpcListItemComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcPageHeaderComponent,
  FpcPanelComponent,
  FpcSpinnerComponent,
} from '@forepath/shared/frontend/ui-components';
import { interval } from 'rxjs';

import { GIT_COMMIT_STATE_TONE, gitCommitStateLabel, gitScopeLabel } from '../git/git-format';

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
    FpcEmptyStateComponent,
    FpcListComponent,
    FpcListItemComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcPageHeaderComponent,
    FpcPanelComponent,
    FpcSpinnerComponent,
  ],
  templateUrl: './drift-page.component.html',
  standalone: true,
})
export class LoadweaverDriftPageComponent implements OnInit {
  private readonly facade = inject(ConsoleDriftFacade);
  private readonly access = inject(ConsoleAccessFacade);
  private readonly git = inject(ConsoleGitFacade);
  private readonly destroyRef = inject(DestroyRef);

  readonly report = toSignal(this.facade.report$, { initialValue: null });
  readonly loading = toSignal(this.facade.loading$, { initialValue: false });
  readonly error = toSignal(this.facade.error$, { initialValue: null });
  readonly proposing = toSignal(this.facade.proposing$, { initialValue: false });
  readonly proposeError = toSignal(this.facade.proposeError$, { initialValue: null });
  readonly projects = toSignal(this.access.projects$, { initialValue: [] as string[] });
  private readonly gitConnections = toSignal(this.git.connections$, { initialValue: [] as GitConnection[] });
  readonly gitAhead = computed(() => this.report()?.gitAhead ?? []);

  readonly stateTone = GIT_COMMIT_STATE_TONE;
  readonly stateLabel = gitCommitStateLabel;
  readonly scopeLabel = (scope: string) => gitScopeLabel(scope === 'cluster' ? null : scope);
  readonly shortSha = shortSha;

  readonly proposeFor = signal<DriftContainer | null>(null);
  readonly invalid = signal(false);
  project = '';
  deployment = '';

  readonly title = $localize`:@@lwConsoleDrift-title:Drift`;
  readonly refreshLabel = $localize`:@@lwConsoleDrift-refresh:Refresh`;
  readonly containersTitle = $localize`:@@lwConsoleDrift-containers:Foreign containers`;
  readonly delegatedTitle = $localize`:@@lwConsoleDrift-delegatedTitle:Delegated containers`;
  readonly inconsistentTitle = $localize`:@@lwConsoleDrift-inconsistent:Failed rollbacks`;
  readonly gitAheadTitle = $localize`:@@lwConsoleGitDrift-aheadTitle:Default branch ahead of the cluster`;
  readonly proposeTitle = $localize`:@@lwConsoleDrift-proposeTitle:Propose a plan`;

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

  shortId(id: string): string {
    return id.slice(0, 12);
  }
}
