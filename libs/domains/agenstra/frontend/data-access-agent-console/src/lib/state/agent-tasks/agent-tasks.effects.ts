import { HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { catchError, concatMap, exhaustMap, filter, map, mergeMap, of, switchMap, withLatestFrom } from 'rxjs';

import { AgentTasksService } from '../../services/agent-tasks.service';

import {
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
  runAgentTaskNow,
  runAgentTaskNowFailure,
  runAgentTaskNowSuccess,
  updateAgentTask,
  updateAgentTaskFailure,
  updateAgentTaskSuccess,
} from './agent-tasks.actions';
import { selectAgentTasksState } from './agent-tasks.selectors';

/** Runs per session history page (infinite scroll). */
export const AGENT_TASK_RUNS_PAGE_SIZE = 10;

function normalizeError(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    const message = error.error?.message;

    if (Array.isArray(message)) {
      return message.join('; ');
    }

    return message ?? error.message ?? String(error.status);
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'An unexpected error occurred';
}

export const loadAgentTasks$ = createEffect(
  (actions$ = inject(Actions), service = inject(AgentTasksService)) =>
    actions$.pipe(
      ofType(loadAgentTasks),
      switchMap(({ clientId }) =>
        service.listTasks(clientId).pipe(
          map((tasks) => loadAgentTasksSuccess({ clientId, tasks })),
          catchError((error) => of(loadAgentTasksFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const createAgentTask$ = createEffect(
  (actions$ = inject(Actions), service = inject(AgentTasksService)) =>
    actions$.pipe(
      ofType(createAgentTask),
      concatMap(({ clientId, agentId, dto }) =>
        service.createTask(clientId, agentId, dto).pipe(
          map((task) => createAgentTaskSuccess({ task })),
          catchError((error) => of(createAgentTaskFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const updateAgentTask$ = createEffect(
  (actions$ = inject(Actions), service = inject(AgentTasksService)) =>
    actions$.pipe(
      ofType(updateAgentTask),
      concatMap(({ clientId, agentId, taskId, dto }) =>
        service.updateTask(clientId, agentId, taskId, dto).pipe(
          map((task) => updateAgentTaskSuccess({ task })),
          catchError((error) => of(updateAgentTaskFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const deleteAgentTask$ = createEffect(
  (actions$ = inject(Actions), service = inject(AgentTasksService)) =>
    actions$.pipe(
      ofType(deleteAgentTask),
      concatMap(({ clientId, agentId, taskId }) =>
        service.deleteTask(clientId, agentId, taskId).pipe(
          map(() => deleteAgentTaskSuccess({ taskId })),
          catchError((error) => of(deleteAgentTaskFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const runAgentTaskNow$ = createEffect(
  (actions$ = inject(Actions), service = inject(AgentTasksService)) =>
    actions$.pipe(
      ofType(runAgentTaskNow),
      mergeMap(({ clientId, agentId, taskId }) =>
        service.runNow(clientId, agentId, taskId).pipe(
          map(({ queued }) => runAgentTaskNowSuccess({ taskId, queued })),
          catchError((error) => of(runAgentTaskNowFailure({ taskId, error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const loadAgentTaskRuns$ = createEffect(
  (actions$ = inject(Actions), service = inject(AgentTasksService)) =>
    actions$.pipe(
      ofType(loadAgentTaskRuns),
      switchMap(({ clientId, agentId, taskId, refresh }) =>
        service.listRuns(clientId, agentId, taskId, { limit: AGENT_TASK_RUNS_PAGE_SIZE, includeTranscript: true }).pipe(
          map((runs) =>
            loadAgentTaskRunsSuccess({ taskId, runs, hasMore: runs.length === AGENT_TASK_RUNS_PAGE_SIZE, refresh }),
          ),
          catchError((error) => of(loadAgentTaskRunsFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const loadMoreAgentTaskRuns$ = createEffect(
  (actions$ = inject(Actions), service = inject(AgentTasksService), store = inject(Store)) =>
    actions$.pipe(
      ofType(loadMoreAgentTaskRuns),
      withLatestFrom(store.select(selectAgentTasksState)),
      filter(
        ([{ taskId }, state]) =>
          state.runsHasMore[taskId] === true &&
          state.runsAppendLoading[taskId] !== true &&
          state.runsLoadingTaskId !== taskId,
      ),
      exhaustMap(([{ clientId, agentId, taskId }, state]) =>
        service
          .listRuns(clientId, agentId, taskId, {
            limit: AGENT_TASK_RUNS_PAGE_SIZE,
            offset: state.runsByTaskId[taskId]?.length ?? 0,
            includeTranscript: true,
          })
          .pipe(
            map((runs) =>
              loadMoreAgentTaskRunsSuccess({ taskId, runs, hasMore: runs.length === AGENT_TASK_RUNS_PAGE_SIZE }),
            ),
            catchError((error) => of(loadMoreAgentTaskRunsFailure({ taskId, error: normalizeError(error) }))),
          ),
      ),
    ),
  { functional: true },
);
