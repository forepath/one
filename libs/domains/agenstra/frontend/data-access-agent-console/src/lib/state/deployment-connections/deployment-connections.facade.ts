import { Injectable, inject } from '@angular/core';
import type { ConnectionTestResult, DeploymentConnectionSummary } from '@forepath/agenstra/shared/util-opencode-config';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';

import {
  clearDeploymentConnectionsError,
  clearDeploymentConnectionTestResult,
  createDeploymentConnection,
  deleteDeploymentConnection,
  loadDeploymentConnections,
  testDeploymentConnection,
  updateDeploymentConnection,
} from './deployment-connections.actions';
import {
  selectDeploymentConnections,
  selectDeploymentConnectionsError,
  selectDeploymentConnectionsHasNext,
  selectDeploymentConnectionsLastTest,
  selectDeploymentConnectionsLoading,
  selectDeploymentConnectionsSaving,
  selectDeploymentConnectionsTestingIds,
} from './deployment-connections.selectors';
import type {
  CreateDeploymentConnectionDto,
  DeploymentConnectionsQuery,
  UpdateDeploymentConnectionDto,
} from './deployment-connections.types';

/** Admin CI/CD connections (`/connections/deployments` page). */
@Injectable({
  providedIn: 'root',
})
export class DeploymentConnectionsFacade {
  private readonly store = inject(Store);

  readonly connections$: Observable<DeploymentConnectionSummary[]> = this.store.select(selectDeploymentConnections);
  readonly hasNext$: Observable<boolean> = this.store.select(selectDeploymentConnectionsHasNext);
  readonly loading$: Observable<boolean> = this.store.select(selectDeploymentConnectionsLoading);
  readonly saving$: Observable<boolean> = this.store.select(selectDeploymentConnectionsSaving);
  readonly testingIds$: Observable<string[]> = this.store.select(selectDeploymentConnectionsTestingIds);
  readonly lastTest$: Observable<{ id: string; result: ConnectionTestResult } | null> = this.store.select(
    selectDeploymentConnectionsLastTest,
  );
  readonly error$: Observable<string | null> = this.store.select(selectDeploymentConnectionsError);

  load(query: DeploymentConnectionsQuery = {}): void {
    this.store.dispatch(loadDeploymentConnections({ query }));
  }

  create(dto: CreateDeploymentConnectionDto): void {
    this.store.dispatch(createDeploymentConnection({ dto }));
  }

  update(id: string, dto: UpdateDeploymentConnectionDto): void {
    this.store.dispatch(updateDeploymentConnection({ id, dto }));
  }

  delete(id: string): void {
    this.store.dispatch(deleteDeploymentConnection({ id }));
  }

  test(id: string): void {
    this.store.dispatch(testDeploymentConnection({ id }));
  }

  clearError(): void {
    this.store.dispatch(clearDeploymentConnectionsError());
  }

  clearTestResult(): void {
    this.store.dispatch(clearDeploymentConnectionTestResult());
  }
}
