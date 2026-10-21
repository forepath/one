import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';

import {
  clearAgentTasksError,
  createAgentTask,
  deleteAgentTask,
  loadAgentTaskRuns,
  loadMoreAgentTaskRuns,
  loadAgentTasks,
  approveAgentTask,
  runAgentTaskNow,
  updateAgentTask,
} from './agent-tasks.actions';
import {
  selectAgentTaskRunRequestTaskIds,
  selectAgentTaskRunsAppendError,
  selectAgentTaskRunsAppendLoading,
  selectAgentTaskRunsHasMore,
  selectAgentTaskRuns,
  selectAgentTaskRunsLoadingTaskId,
  selectAgentTasks,
  selectAgentTasksError,
  selectAgentTasksLastRunNow,
  selectAgentTasksLoading,
  selectAgentTasksSaving,
} from './agent-tasks.selectors';
import type {
  AgentTaskResponseDto,
  AgentTaskRunResponseDto,
  CreateAgentTaskDto,
  UpdateAgentTaskDto,
} from './agent-tasks.types';

@Injectable({
  providedIn: 'root',
})
export class AgentTasksFacade {
  private readonly store = inject(Store);

  readonly tasks$: Observable<AgentTaskResponseDto[]> = this.store.select(selectAgentTasks);
  readonly loading$: Observable<boolean> = this.store.select(selectAgentTasksLoading);
  readonly saving$: Observable<boolean> = this.store.select(selectAgentTasksSaving);
  readonly error$: Observable<string | null> = this.store.select(selectAgentTasksError);
  readonly runsLoadingTaskId$: Observable<string | null> = this.store.select(selectAgentTaskRunsLoadingTaskId);
  readonly runRequestTaskIds$: Observable<string[]> = this.store.select(selectAgentTaskRunRequestTaskIds);
  readonly lastRunNow$: Observable<{ taskId: string; queued: boolean } | null> =
    this.store.select(selectAgentTasksLastRunNow);

  runs$(taskId: string): Observable<AgentTaskRunResponseDto[]> {
    return this.store.select(selectAgentTaskRuns(taskId));
  }

  load(clientId: string): void {
    this.store.dispatch(loadAgentTasks({ clientId }));
  }

  create(clientId: string, agentId: string, dto: CreateAgentTaskDto): void {
    this.store.dispatch(createAgentTask({ clientId, agentId, dto }));
  }

  update(clientId: string, agentId: string, taskId: string, dto: UpdateAgentTaskDto): void {
    this.store.dispatch(updateAgentTask({ clientId, agentId, taskId, dto }));
  }

  delete(clientId: string, agentId: string, taskId: string): void {
    this.store.dispatch(deleteAgentTask({ clientId, agentId, taskId }));
  }

  approve(clientId: string, agentId: string, taskId: string, reviewedUpdatedAt: string): void {
    this.store.dispatch(approveAgentTask({ clientId, agentId, taskId, reviewedUpdatedAt }));
  }

  runNow(clientId: string, agentId: string, taskId: string): void {
    this.store.dispatch(runAgentTaskNow({ clientId, agentId, taskId }));
  }

  runsHasMore$(taskId: string): Observable<boolean> {
    return this.store.select(selectAgentTaskRunsHasMore(taskId));
  }

  runsAppendLoading$(taskId: string): Observable<boolean> {
    return this.store.select(selectAgentTaskRunsAppendLoading(taskId));
  }

  runsAppendError$(taskId: string): Observable<string | null> {
    return this.store.select(selectAgentTaskRunsAppendError(taskId));
  }

  /** First page of the session history; `refresh` merges the newest page into the loaded ones. */
  loadRuns(clientId: string, agentId: string, taskId: string, options: { refresh?: boolean } = {}): void {
    this.store.dispatch(
      loadAgentTaskRuns({ clientId, agentId, taskId, ...(options.refresh ? { refresh: true } : {}) }),
    );
  }

  loadMoreRuns(clientId: string, agentId: string, taskId: string): void {
    this.store.dispatch(loadMoreAgentTaskRuns({ clientId, agentId, taskId }));
  }

  clearError(): void {
    this.store.dispatch(clearAgentTasksError());
  }
}
