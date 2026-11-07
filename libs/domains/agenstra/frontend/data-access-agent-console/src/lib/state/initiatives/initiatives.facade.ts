import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';

import {
  clearInitiativeError,
  loadInitiativeArtifactVersion,
  loadInitiatives,
  openInitiativeArtifact,
  openInitiativeRun,
  reloadInitiative,
  reloadInitiativeOverview,
  runInitiativeCommand,
  selectInitiative,
} from './initiatives.actions';
import {
  selectInitiativeActivity,
  selectInitiativeArtifacts,
  selectInitiativeArtifactVersions,
  selectInitiativeCompareVersion,
  selectInitiativeDecisions,
  selectInitiativeDetailLoading,
  selectInitiativeFindings,
  selectCreatedInitiativeId,
  selectInitiativeLastBuildResult,
  selectInitiativeOverview,
  selectInitiativeProposals,
  selectInitiativeRuns,
  selectInitiativesConflict,
  selectInitiativesError,
  selectInitiativesList,
  selectInitiativesListLoading,
  selectInitiativesPending,
  selectInitiativesTotal,
  selectInitiativeWorkItems,
  selectOpenInitiativeArtifact,
  selectOpenInitiativeRun,
  selectSelectedInitiative,
  selectSelectedInitiativeId,
} from './initiatives.selectors';
import type {
  InitiativeActivityDto,
  InitiativeArtifactDto,
  InitiativeArtifactVersionDto,
  InitiativeBuildActionDto,
  InitiativeCommand,
  InitiativeDecisionDto,
  InitiativeDto,
  InitiativeFindingDto,
  InitiativeOverviewDto,
  InitiativeProposalDto,
  InitiativeRunDto,
  InitiativeWorkItemsDto,
} from './initiatives.types';

@Injectable({
  providedIn: 'root',
})
export class InitiativesFacade {
  private readonly store = inject(Store);

  readonly initiatives$: Observable<InitiativeDto[]> = this.store.select(selectInitiativesList);
  readonly total$: Observable<number> = this.store.select(selectInitiativesTotal);
  readonly listLoading$: Observable<boolean> = this.store.select(selectInitiativesListLoading);
  readonly selectedId$: Observable<string | null> = this.store.select(selectSelectedInitiativeId);
  readonly selected$: Observable<InitiativeDto | null> = this.store.select(selectSelectedInitiative);
  readonly detailLoading$: Observable<boolean> = this.store.select(selectInitiativeDetailLoading);
  readonly overview$: Observable<InitiativeOverviewDto | null> = this.store.select(selectInitiativeOverview);
  readonly artifacts$: Observable<InitiativeArtifactDto[]> = this.store.select(selectInitiativeArtifacts);
  readonly openArtifact$: Observable<InitiativeArtifactDto | null> = this.store.select(selectOpenInitiativeArtifact);
  readonly versions$: Observable<InitiativeArtifactVersionDto[]> = this.store.select(selectInitiativeArtifactVersions);
  readonly compareVersion$: Observable<InitiativeArtifactVersionDto | null> =
    this.store.select(selectInitiativeCompareVersion);
  readonly workItems$: Observable<InitiativeWorkItemsDto | null> = this.store.select(selectInitiativeWorkItems);
  readonly runs$: Observable<InitiativeRunDto[]> = this.store.select(selectInitiativeRuns);
  readonly openRun$: Observable<InitiativeRunDto | null> = this.store.select(selectOpenInitiativeRun);
  readonly proposals$: Observable<InitiativeProposalDto[]> = this.store.select(selectInitiativeProposals);
  readonly findings$: Observable<InitiativeFindingDto[]> = this.store.select(selectInitiativeFindings);
  readonly decisions$: Observable<InitiativeDecisionDto[]> = this.store.select(selectInitiativeDecisions);
  readonly activity$: Observable<InitiativeActivityDto[]> = this.store.select(selectInitiativeActivity);
  readonly pending$: Observable<boolean> = this.store.select(selectInitiativesPending);
  readonly error$: Observable<string | null> = this.store.select(selectInitiativesError);
  readonly conflict$: Observable<boolean> = this.store.select(selectInitiativesConflict);
  readonly createdId$: Observable<string | null> = this.store.select(selectCreatedInitiativeId);
  readonly lastBuildResult$: Observable<InitiativeBuildActionDto | null> = this.store.select(
    selectInitiativeLastBuildResult,
  );

  load(clientId: string, search?: string, state?: string | null): void {
    this.store.dispatch(loadInitiatives({ clientId, search, state }));
  }

  select(id: string | null): void {
    this.store.dispatch(selectInitiative({ id }));
  }

  /** Refetch the selected initiative in place (keeps the open document / run). */
  reload(id: string): void {
    this.store.dispatch(reloadInitiative({ id }));
  }

  reloadOverview(id: string): void {
    this.store.dispatch(reloadInitiativeOverview({ id }));
  }

  openArtifact(artifactId: string | null): void {
    this.store.dispatch(openInitiativeArtifact({ artifactId }));
  }

  compareVersion(artifactId: string, version: number | null): void {
    this.store.dispatch(loadInitiativeArtifactVersion({ artifactId, version }));
  }

  openRun(runId: string | null): void {
    this.store.dispatch(openInitiativeRun({ runId }));
  }

  run(command: InitiativeCommand): void {
    this.store.dispatch(runInitiativeCommand({ command }));
  }

  clearError(): void {
    this.store.dispatch(clearInitiativeError());
  }
}
