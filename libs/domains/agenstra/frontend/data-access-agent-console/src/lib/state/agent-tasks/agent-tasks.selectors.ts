import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { AgentTasksState } from './agent-tasks.reducer';
import type { AgentTaskRunResponseDto } from './agent-tasks.types';

const NO_RUNS: AgentTaskRunResponseDto[] = [];

export const selectAgentTasksState = createFeatureSelector<AgentTasksState>('agentTasks');

export const selectAgentTasksClientId = createSelector(selectAgentTasksState, (s) => s.clientId);

export const selectAgentTasks = createSelector(selectAgentTasksState, (s) => s.tasks);

export const selectAgentTasksLoading = createSelector(selectAgentTasksState, (s) => s.loading);

export const selectAgentTasksSaving = createSelector(selectAgentTasksState, (s) => s.saving);

export const selectAgentTasksError = createSelector(selectAgentTasksState, (s) => s.error);

export const selectAgentTaskRunsByTaskId = createSelector(selectAgentTasksState, (s) => s.runsByTaskId);

export const selectAgentTaskRunsLoadingTaskId = createSelector(selectAgentTasksState, (s) => s.runsLoadingTaskId);

export const selectAgentTaskRunRequestTaskIds = createSelector(selectAgentTasksState, (s) => s.runRequestTaskIds);

export const selectAgentTasksLastRunNow = createSelector(selectAgentTasksState, (s) => s.lastRunNow);

export const selectAgentTasksForAgent = (agentId: string | null) =>
  createSelector(selectAgentTasks, (tasks) => (agentId ? tasks.filter((task) => task.agentId === agentId) : tasks));

export const selectAgentTaskRuns = (taskId: string) =>
  createSelector(selectAgentTaskRunsByTaskId, (runsByTaskId) => runsByTaskId[taskId] ?? NO_RUNS);

export const selectAgentTaskRunsHasMore = (taskId: string) =>
  createSelector(selectAgentTasksState, (s) => s.runsHasMore[taskId] === true);

export const selectAgentTaskRunsAppendLoading = (taskId: string) =>
  createSelector(selectAgentTasksState, (s) => s.runsAppendLoading[taskId] === true);

export const selectAgentTaskRunsAppendError = (taskId: string) =>
  createSelector(selectAgentTasksState, (s) => s.runsAppendError[taskId] ?? null);
