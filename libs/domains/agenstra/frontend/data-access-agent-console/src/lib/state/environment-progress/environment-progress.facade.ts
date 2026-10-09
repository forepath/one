import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';

import { loadEnvironmentProgress } from './environment-progress.actions';
import {
  selectClientEnvironmentProgress,
  selectCreateEnvironmentProgress,
  selectEnvironmentProgressForAgent,
  selectClientEnvironmentProgressByAgentId,
  selectClientPendingEnvironmentProgress,
  selectWorkspaceEnvironmentProgress,
  selectWorkspaceEnvironmentProgressByClientId,
} from './environment-progress.selectors';
import type { EnvironmentProgress, WorkspaceEnvironmentProgress } from './environment-progress.types';

/**
 * Facade for environment (agent) create / update progress.
 * Selected workspace: live socket events; other workspaces: status socket snapshots.
 */
@Injectable({
  providedIn: 'root',
})
export class EnvironmentProgressFacade {
  private readonly store = inject(Store);

  /** Aggregated progress of all workspaces with running operations, keyed by clientId. */
  readonly workspaceProgressByClientId$: Observable<Record<string, WorkspaceEnvironmentProgress>> = this.store.select(
    selectWorkspaceEnvironmentProgressByClientId,
  );

  getClientEnvironmentProgress$(clientId: string): Observable<EnvironmentProgress[]> {
    return this.store.select(selectClientEnvironmentProgress(clientId));
  }

  /** Running operation per environment (agentId) of a workspace. */
  getClientEnvironmentProgressByAgentId$(clientId: string): Observable<Record<string, EnvironmentProgress>> {
    return this.store.select(selectClientEnvironmentProgressByAgentId(clientId));
  }

  /** Operations of environments not yet in the loaded environment list (e.g. creates in progress). */
  getClientPendingEnvironmentProgress$(clientId: string): Observable<EnvironmentProgress[]> {
    return this.store.select(selectClientPendingEnvironmentProgress(clientId));
  }

  getWorkspaceEnvironmentProgress$(clientId: string): Observable<WorkspaceEnvironmentProgress | null> {
    return this.store.select(selectWorkspaceEnvironmentProgress(clientId));
  }

  /** Running operation of one environment, or null. */
  getEnvironmentProgressForAgent$(clientId: string, agentId: string): Observable<EnvironmentProgress | null> {
    return this.store.select(selectEnvironmentProgressForAgent(clientId, agentId));
  }

  /** Running create operation of a not yet persisted environment matched by name, or null. */
  getCreateEnvironmentProgress$(clientId: string, agentName: string): Observable<EnvironmentProgress | null> {
    return this.store.select(selectCreateEnvironmentProgress(clientId, agentName));
  }

  loadEnvironmentProgress(clientId: string): void {
    this.store.dispatch(loadEnvironmentProgress({ clientId }));
  }
}
