import { HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { catchError, concatMap, exhaustMap, filter, map, mergeMap, of, switchMap, withLatestFrom } from 'rxjs';

import { WorkspaceDeploymentsService } from '../../services/workspace-deployments.service';

import {
  approveDeploymentWorkflow,
  approveDeploymentWorkflowFailure,
  approveDeploymentWorkflowSuccess,
  cancelDeploymentRun,
  cancelDeploymentRunFailure,
  cancelDeploymentRunSuccess,
  createDeploymentWorkflow,
  createDeploymentWorkflowSuccess,
  deleteDeploymentWorkflow,
  deleteDeploymentWorkflowSuccess,
  loadDeploymentConnectionOptions,
  loadDeploymentConnectionOptionsFailure,
  loadDeploymentConnectionOptionsSuccess,
  loadDeploymentRun,
  loadDeploymentRunFailure,
  loadDeploymentRunLogs,
  loadDeploymentRunLogsFailure,
  loadDeploymentRunLogsSuccess,
  loadDeploymentRuns,
  loadDeploymentRunsFailure,
  loadDeploymentRunsSuccess,
  loadDeploymentRunSuccess,
  loadDeploymentWorkflow,
  loadDeploymentWorkflowFailure,
  loadDeploymentWorkflows,
  loadDeploymentWorkflowsFailure,
  loadDeploymentWorkflowsSuccess,
  loadDeploymentWorkflowSuccess,
  saveDeploymentWorkflowFailure,
  syncDeploymentWorkflow,
  syncDeploymentWorkflowFailure,
  syncDeploymentWorkflowSuccess,
  triggerDeploymentWorkflow,
  triggerDeploymentWorkflowFailure,
  triggerDeploymentWorkflowSuccess,
  updateDeploymentWorkflow,
  updateDeploymentWorkflowSuccess,
} from './workspace-deployments.actions';
import { selectWorkspaceDeploymentsState } from './workspace-deployments.selectors';
import { DEPLOYMENT_RUNS_DEFAULT_LIMIT } from './workspace-deployments.types';

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

/** Workflows per page when the page does not ask for a size. */
export const DEPLOYMENT_WORKFLOWS_DEFAULT_LIMIT = 25;

export const loadDeploymentWorkflows$ = createEffect(
  (actions$ = inject(Actions), service = inject(WorkspaceDeploymentsService)) =>
    actions$.pipe(
      ofType(loadDeploymentWorkflows),
      switchMap(({ clientId, query }) => {
        const limit = query.limit ?? DEPLOYMENT_WORKFLOWS_DEFAULT_LIMIT;

        return service.listWorkflows(clientId, { ...query, limit }).pipe(
          map((workflows) =>
            loadDeploymentWorkflowsSuccess({ clientId, workflows, hasNext: workflows.length >= limit }),
          ),
          catchError((error) => of(loadDeploymentWorkflowsFailure({ error: normalizeError(error) }))),
        );
      }),
    ),
  { functional: true },
);

export const loadDeploymentWorkflow$ = createEffect(
  (actions$ = inject(Actions), service = inject(WorkspaceDeploymentsService)) =>
    actions$.pipe(
      ofType(loadDeploymentWorkflow),
      switchMap(({ clientId, workflowId }) =>
        service.getWorkflow(clientId, workflowId).pipe(
          map((workflow) => loadDeploymentWorkflowSuccess({ workflow })),
          catchError((error) => of(loadDeploymentWorkflowFailure({ workflowId, error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const createDeploymentWorkflow$ = createEffect(
  (actions$ = inject(Actions), service = inject(WorkspaceDeploymentsService)) =>
    actions$.pipe(
      ofType(createDeploymentWorkflow),
      concatMap(({ clientId, dto }) =>
        service.createWorkflow(clientId, dto).pipe(
          map((workflow) => createDeploymentWorkflowSuccess({ workflow })),
          catchError((error) => of(saveDeploymentWorkflowFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const updateDeploymentWorkflow$ = createEffect(
  (actions$ = inject(Actions), service = inject(WorkspaceDeploymentsService)) =>
    actions$.pipe(
      ofType(updateDeploymentWorkflow),
      concatMap(({ clientId, workflowId, dto }) =>
        service.updateWorkflow(clientId, workflowId, dto).pipe(
          map((workflow) => updateDeploymentWorkflowSuccess({ workflow })),
          catchError((error) => of(saveDeploymentWorkflowFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const deleteDeploymentWorkflow$ = createEffect(
  (actions$ = inject(Actions), service = inject(WorkspaceDeploymentsService)) =>
    actions$.pipe(
      ofType(deleteDeploymentWorkflow),
      concatMap(({ clientId, workflowId }) =>
        service.deleteWorkflow(clientId, workflowId).pipe(
          map(() => deleteDeploymentWorkflowSuccess({ workflowId })),
          catchError((error) => of(saveDeploymentWorkflowFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

/** A deleted workflow shifts the server pages: reload the listed page. */
export const reloadDeploymentWorkflowsAfterDelete$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store)) =>
    actions$.pipe(
      ofType(deleteDeploymentWorkflowSuccess),
      withLatestFrom(store.select(selectWorkspaceDeploymentsState)),
      filter(([, state]) => !!state.clientId),
      map(([, state]) => loadDeploymentWorkflows({ clientId: state.clientId as string, query: state.workflowsQuery })),
    ),
  { functional: true },
);

export const approveDeploymentWorkflow$ = createEffect(
  (actions$ = inject(Actions), service = inject(WorkspaceDeploymentsService)) =>
    actions$.pipe(
      ofType(approveDeploymentWorkflow),
      exhaustMap(({ clientId, workflowId, updatedAt }) =>
        service.approveWorkflow(clientId, workflowId, updatedAt).pipe(
          map((workflow) => approveDeploymentWorkflowSuccess({ workflow })),
          catchError((error) =>
            of(
              approveDeploymentWorkflowFailure({
                clientId,
                workflowId,
                error: normalizeError(error),
                conflict: error instanceof HttpErrorResponse && error.status === 409,
              }),
            ),
          ),
        ),
      ),
    ),
  { functional: true },
);

/**
 * The workflow changed since it was reviewed (409): reload the listed page and the opened workflow so the admin
 * reviews the current version (the backend message stays shown).
 */
export const reloadDeploymentWorkflowAfterApprovalConflict$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store)) =>
    actions$.pipe(
      ofType(approveDeploymentWorkflowFailure),
      filter(({ conflict }) => conflict),
      withLatestFrom(store.select(selectWorkspaceDeploymentsState)),
      filter(([{ clientId }, state]) => state.clientId === clientId),
      mergeMap(([{ clientId, workflowId }, state]) => [
        loadDeploymentWorkflows({ clientId, query: state.workflowsQuery }),
        ...(state.selectedWorkflow?.id === workflowId ? [loadDeploymentWorkflow({ clientId, workflowId })] : []),
      ]),
    ),
  { functional: true },
);

export const triggerDeploymentWorkflow$ = createEffect(
  (actions$ = inject(Actions), service = inject(WorkspaceDeploymentsService)) =>
    actions$.pipe(
      ofType(triggerDeploymentWorkflow),
      exhaustMap(({ clientId, workflowId, dto }) =>
        service.triggerWorkflow(clientId, workflowId, dto).pipe(
          map((run) => triggerDeploymentWorkflowSuccess({ run })),
          catchError((error) => of(triggerDeploymentWorkflowFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const syncDeploymentWorkflow$ = createEffect(
  (actions$ = inject(Actions), service = inject(WorkspaceDeploymentsService)) =>
    actions$.pipe(
      ofType(syncDeploymentWorkflow),
      mergeMap(({ clientId, workflowId }) =>
        service.syncWorkflow(clientId, workflowId).pipe(
          map(({ synced }) => syncDeploymentWorkflowSuccess({ workflowId, synced })),
          catchError((error) => of(syncDeploymentWorkflowFailure({ workflowId, error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

/** Synced provider history: reload the listed runs page when it shows the synced workflow (or all workflows). */
export const reloadDeploymentRunsAfterSync$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store)) =>
    actions$.pipe(
      ofType(syncDeploymentWorkflowSuccess),
      withLatestFrom(store.select(selectWorkspaceDeploymentsState)),
      filter(
        ([{ workflowId }, state]) =>
          !!state.clientId && (!state.runsQuery.workflowId || state.runsQuery.workflowId === workflowId),
      ),
      map(([, state]) => loadDeploymentRuns({ clientId: state.clientId as string, query: state.runsQuery })),
    ),
  { functional: true },
);

export const loadDeploymentRuns$ = createEffect(
  (actions$ = inject(Actions), service = inject(WorkspaceDeploymentsService)) =>
    actions$.pipe(
      ofType(loadDeploymentRuns),
      switchMap(({ clientId, query }) =>
        service.listRuns(clientId, { ...query, limit: query.limit ?? DEPLOYMENT_RUNS_DEFAULT_LIMIT }).pipe(
          map(({ items, total }) => loadDeploymentRunsSuccess({ clientId, runs: items, total })),
          catchError((error) => of(loadDeploymentRunsFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const loadDeploymentRun$ = createEffect(
  (actions$ = inject(Actions), service = inject(WorkspaceDeploymentsService)) =>
    actions$.pipe(
      ofType(loadDeploymentRun),
      switchMap(({ clientId, runId }) =>
        service.getRun(clientId, runId).pipe(
          map((detail) => loadDeploymentRunSuccess({ detail })),
          catchError((error) => of(loadDeploymentRunFailure({ runId, error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const loadDeploymentRunLogs$ = createEffect(
  (actions$ = inject(Actions), service = inject(WorkspaceDeploymentsService)) =>
    actions$.pipe(
      ofType(loadDeploymentRunLogs),
      switchMap(({ clientId, runId, jobId }) =>
        service.getRunLogs(clientId, runId, jobId).pipe(
          map((logs) => loadDeploymentRunLogsSuccess({ runId, jobId, logs })),
          catchError((error) => of(loadDeploymentRunLogsFailure({ runId, jobId, error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const cancelDeploymentRun$ = createEffect(
  (actions$ = inject(Actions), service = inject(WorkspaceDeploymentsService)) =>
    actions$.pipe(
      ofType(cancelDeploymentRun),
      mergeMap(({ clientId, runId }) =>
        service.cancelRun(clientId, runId).pipe(
          map((run) => cancelDeploymentRunSuccess({ run })),
          catchError((error) => of(cancelDeploymentRunFailure({ runId, error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const loadDeploymentConnectionOptions$ = createEffect(
  (actions$ = inject(Actions), service = inject(WorkspaceDeploymentsService)) =>
    actions$.pipe(
      ofType(loadDeploymentConnectionOptions),
      switchMap(({ clientId }) =>
        service.listConnections(clientId).pipe(
          map((connections) => loadDeploymentConnectionOptionsSuccess({ clientId, connections })),
          catchError((error) => of(loadDeploymentConnectionOptionsFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);
