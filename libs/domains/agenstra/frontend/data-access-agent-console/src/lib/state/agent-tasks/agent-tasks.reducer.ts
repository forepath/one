import { createReducer, on } from '@ngrx/store';

import {
  agentTaskRemovedReceived,
  agentTaskRunReceived,
  agentTaskUpsertReceived,
  clearAgentTasksError,
  createAgentTask,
  createAgentTaskFailure,
  createAgentTaskSuccess,
  deleteAgentTask,
  deleteAgentTaskFailure,
  deleteAgentTaskSuccess,
  loadAgentTaskRuns,
  loadAgentTaskRunsFailure,
  loadAgentTaskRunsSuccess,
  loadMoreAgentTaskRuns,
  loadMoreAgentTaskRunsFailure,
  loadMoreAgentTaskRunsSuccess,
  loadAgentTasks,
  loadAgentTasksFailure,
  loadAgentTasksSuccess,
  approveAgentTask,
  runAgentTaskNow,
  runAgentTaskNowFailure,
  runAgentTaskNowSuccess,
  updateAgentTask,
  updateAgentTaskFailure,
  updateAgentTaskSuccess,
} from './agent-tasks.actions';
import type { AgentTaskResponseDto, AgentTaskRunResponseDto } from './agent-tasks.types';

export interface AgentTasksState {
  clientId: string | null;
  tasks: AgentTaskResponseDto[];
  runsByTaskId: Record<string, AgentTaskRunResponseDto[]>;
  loading: boolean;
  saving: boolean;
  runsLoadingTaskId: string | null;
  /** Session history paging per task (infinite scroll). */
  runsHasMore: Record<string, boolean>;
  runsAppendLoading: Record<string, boolean>;
  runsAppendError: Record<string, string | null>;
  /** Tasks with an in-flight "run now" request. */
  runRequestTaskIds: string[];
  /** Outcome of the latest "run now" request (`queued: false` = a run was still in progress). */
  lastRunNow: { taskId: string; queued: boolean } | null;
  error: string | null;
}

export const initialAgentTasksState: AgentTasksState = {
  clientId: null,
  tasks: [],
  runsByTaskId: {},
  loading: false,
  saving: false,
  runsLoadingTaskId: null,
  runsHasMore: {},
  runsAppendLoading: {},
  runsAppendError: {},
  runRequestTaskIds: [],
  lastRunNow: null,
  error: null,
};

function upsertTask(tasks: AgentTaskResponseDto[], task: AgentTaskResponseDto): AgentTaskResponseDto[] {
  const next = tasks.some((existing) => existing.id === task.id)
    ? tasks.map((existing) => (existing.id === task.id ? task : existing))
    : [...tasks, task];

  return next.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Newest first; `id` breaks ties like the backend so pages line up. */
function compareRuns(a: AgentTaskRunResponseDto, b: AgentTaskRunResponseDto): number {
  return b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id);
}

/**
 * Merge runs by id (incoming wins). Live run snapshots (chat cards) carry no transcript, so an already loaded session
 * history is kept for them.
 */
function mergeRuns(
  runs: AgentTaskRunResponseDto[] | undefined,
  incoming: AgentTaskRunResponseDto[],
): AgentTaskRunResponseDto[] {
  const byId = new Map((runs ?? []).map((run) => [run.id, run]));

  for (const run of incoming) {
    const previous = byId.get(run.id);

    byId.set(
      run.id,
      run.transcript === undefined && previous?.transcript ? { ...run, transcript: previous.transcript } : run,
    );
  }

  return [...byId.values()].sort(compareRuns);
}

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record };

  delete next[key];

  return next;
}

function withoutTask(state: AgentTasksState, taskId: string): AgentTasksState {
  return {
    ...state,
    tasks: state.tasks.filter((task) => task.id !== taskId),
    runsByTaskId: withoutKey(state.runsByTaskId, taskId),
    runsHasMore: withoutKey(state.runsHasMore, taskId),
    runsAppendLoading: withoutKey(state.runsAppendLoading, taskId),
    runsAppendError: withoutKey(state.runsAppendError, taskId),
  };
}

export const agentTasksReducer = createReducer(
  initialAgentTasksState,
  on(loadAgentTasks, (state, { clientId }) => ({
    ...(state.clientId === clientId ? state : { ...initialAgentTasksState }),
    clientId,
    loading: true,
    error: null,
  })),
  on(loadAgentTasksSuccess, (state, { clientId, tasks }) =>
    state.clientId !== clientId
      ? state
      : { ...state, loading: false, tasks: [...tasks].sort((a, b) => a.createdAt.localeCompare(b.createdAt)) },
  ),
  on(loadAgentTasksFailure, (state, { error }) => ({ ...state, loading: false, error })),
  on(createAgentTask, updateAgentTask, deleteAgentTask, approveAgentTask, (state) => ({
    ...state,
    saving: true,
    error: null,
  })),
  on(createAgentTaskSuccess, updateAgentTaskSuccess, (state, { task }) => ({
    ...state,
    saving: false,
    tasks: task.clientId === state.clientId ? upsertTask(state.tasks, task) : state.tasks,
  })),
  on(deleteAgentTaskSuccess, (state, { taskId }) => ({ ...withoutTask(state, taskId), saving: false })),
  on(createAgentTaskFailure, updateAgentTaskFailure, deleteAgentTaskFailure, (state, { error }) => ({
    ...state,
    saving: false,
    error,
  })),
  on(runAgentTaskNow, (state, { taskId }) => ({
    ...state,
    runRequestTaskIds: [...state.runRequestTaskIds.filter((id) => id !== taskId), taskId],
    lastRunNow: null,
    error: null,
  })),
  on(runAgentTaskNowSuccess, (state, { taskId, queued }) => ({
    ...state,
    runRequestTaskIds: state.runRequestTaskIds.filter((id) => id !== taskId),
    lastRunNow: { taskId, queued },
  })),
  on(runAgentTaskNowFailure, (state, { taskId, error }) => ({
    ...state,
    runRequestTaskIds: state.runRequestTaskIds.filter((id) => id !== taskId),
    error,
  })),
  on(loadAgentTaskRuns, (state, { taskId, refresh }) => (refresh ? state : { ...state, runsLoadingTaskId: taskId })),
  on(loadAgentTaskRunsSuccess, (state, { taskId, runs, hasMore, refresh }) => {
    const loaded = refresh && state.runsByTaskId[taskId] !== undefined;

    return {
      ...state,
      runsLoadingTaskId: state.runsLoadingTaskId === taskId ? null : state.runsLoadingTaskId,
      runsByTaskId: {
        ...state.runsByTaskId,
        [taskId]: loaded ? mergeRuns(state.runsByTaskId[taskId], runs) : [...runs].sort(compareRuns),
      },
      runsHasMore: loaded ? state.runsHasMore : { ...state.runsHasMore, [taskId]: hasMore },
      runsAppendError: loaded ? state.runsAppendError : { ...state.runsAppendError, [taskId]: null },
    };
  }),
  on(loadAgentTaskRunsFailure, (state, { error }) => ({ ...state, runsLoadingTaskId: null, error })),
  on(loadMoreAgentTaskRuns, (state, { taskId }) => ({
    ...state,
    runsAppendLoading: { ...state.runsAppendLoading, [taskId]: true },
    runsAppendError: { ...state.runsAppendError, [taskId]: null },
  })),
  on(loadMoreAgentTaskRunsSuccess, (state, { taskId, runs, hasMore }) => ({
    ...state,
    runsByTaskId: { ...state.runsByTaskId, [taskId]: mergeRuns(state.runsByTaskId[taskId], runs) },
    runsHasMore: { ...state.runsHasMore, [taskId]: hasMore },
    runsAppendLoading: { ...state.runsAppendLoading, [taskId]: false },
  })),
  on(loadMoreAgentTaskRunsFailure, (state, { taskId, error }) => ({
    ...state,
    runsAppendLoading: { ...state.runsAppendLoading, [taskId]: false },
    runsAppendError: { ...state.runsAppendError, [taskId]: error },
  })),
  on(agentTaskUpsertReceived, (state, { task }) =>
    task.clientId === state.clientId ? { ...state, tasks: upsertTask(state.tasks, task) } : state,
  ),
  on(agentTaskRemovedReceived, (state, { event }) =>
    event.clientId === state.clientId ? withoutTask(state, event.taskId) : state,
  ),
  on(agentTaskRunReceived, (state, { run }) =>
    run.clientId === state.clientId
      ? {
          ...state,
          runsByTaskId: { ...state.runsByTaskId, [run.taskId]: mergeRuns(state.runsByTaskId[run.taskId], [run]) },
        }
      : state,
  ),
  on(clearAgentTasksError, (state) => ({ ...state, error: null })),
);
