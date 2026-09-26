import { CommonModule } from '@angular/common';
import { Component, effect, inject, input, output, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { AgentsFacade, ClientsFacade, VcsFacade } from '@forepath/agenstra/frontend/data-access-agent-console';
import { FpcSpinnerComponent } from '@forepath/shared/frontend/ui-components';
import { combineLatest, map, Observable, of, switchMap } from 'rxjs';

import { getGitRepositoryDisplayLabel } from '../../git-repository-display';
import { GitBranchModalComponent } from '../git-branch-modal/git-branch-modal.component';

/**
 * Repo / branch / dirty-dot strip for the workspace sidebar footer.
 * Lives outside the Files/Search swap so it stays visible in both modes.
 */
@Component({
  selector: 'framework-git-sidebar-status-bar',
  standalone: true,
  imports: [CommonModule, FpcSpinnerComponent, GitBranchModalComponent],
  templateUrl: './git-sidebar-status-bar.component.html',
  styleUrls: ['./git-sidebar-status-bar.component.scss'],
})
export class GitSidebarStatusBarComponent {
  private readonly clientsFacade = inject(ClientsFacade);
  private readonly agentsFacade = inject(AgentsFacade);
  private readonly vcsFacade = inject(VcsFacade);

  readonly clientId = input.required<string>();
  readonly agentId = input.required<string>();

  readonly toggleGitManager = output<void>();

  readonly branchModalOpen = signal(false);

  readonly clientRepositoryName$: Observable<string | null> = combineLatest([
    toObservable(this.clientId),
    toObservable(this.agentId),
  ]).pipe(
    switchMap(([clientId, agentId]) => {
      if (!clientId || !agentId) {
        return of(null);
      }

      return combineLatest([
        this.clientsFacade.getClientById$(clientId),
        this.agentsFacade
          .getClientAgents$(clientId)
          .pipe(map((agents) => agents.find((agent) => agent.id === agentId) ?? null)),
      ]).pipe(map(([client, agent]) => getGitRepositoryDisplayLabel(agent, client?.config ?? null)));
    }),
  );

  readonly currentBranch$ = this.vcsFacade.currentBranch$;
  readonly statusIndicator$ = this.vcsFacade.statusIndicator$;
  readonly loadingStatus$ = this.vcsFacade.loadingStatus$;
  /** Always show the footer once client/agent are set (do not gate on remote repo label). */
  readonly showBar$ = combineLatest([toObservable(this.clientId), toObservable(this.agentId)]).pipe(
    map(([clientId, agentId]) => !!clientId && !!agentId),
  );
  readonly showStatusIndicatorSpinner$ = combineLatest([
    this.vcsFacade.staging$,
    this.vcsFacade.unstaging$,
    this.vcsFacade.committing$,
    this.loadingStatus$,
    this.statusIndicator$,
  ]).pipe(
    map(
      ([staging, unstaging, committing, loadingStatus, indicator]) =>
        !!(staging || unstaging || committing || loadingStatus) && indicator !== null,
    ),
  );

  constructor() {
    effect(() => {
      const clientId = this.clientId();
      const agentId = this.agentId();

      if (clientId && agentId) {
        this.vcsFacade.loadStatus(clientId, agentId);
      }
    });
  }

  onOpenBranchModal(): void {
    this.branchModalOpen.set(true);
  }

  onBranchModalClosed(): void {
    this.branchModalOpen.set(false);
  }

  onStatusIndicatorClick(event: MouseEvent): void {
    event.stopPropagation();
    this.toggleGitManager.emit();
  }

  getStatusIndicatorTitle(indicator: string): string {
    switch (indicator) {
      case 'clean':
        return $localize`:@@featureFileTree-statusClean:In sync with remote - Click to open Version Control`;
      case 'changes':
        return $localize`:@@featureFileTree-statusChanges:Local changes (staged, unstaged, or unpushed) - Click to open Version Control`;
      case 'conflict':
        return $localize`:@@featureFileTree-statusConflict:Merge conflicts detected - Click to open Version Control`;
      default:
        return '';
    }
  }

  getCurrentBranchTitle(branch: string): string {
    return $localize`:@@featureFileTree-currentBranchTitle:Current branch: ${branch}:branch:`;
  }
}
