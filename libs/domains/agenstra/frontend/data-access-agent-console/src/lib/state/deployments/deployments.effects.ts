import { HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, map, mergeMap, of, switchMap } from 'rxjs';

import { DeploymentsService } from '../../services/deployments.service';

import {
  cancelRun,
  cancelRunFailure,
  cancelRunSuccess,
  createDeploymentConfiguration,
  createDeploymentConfigurationFailure,
  createDeploymentConfigurationSuccess,
  deleteDeploymentConfiguration,
  deleteDeploymentConfigurationFailure,
  deleteDeploymentConfigurationSuccess,
  loadBranches,
  loadBranchesFailure,
  loadBranchesSuccess,
  loadDeploymentConfiguration,
  loadDeploymentConfigurationFailure,
  loadDeploymentConfigurationSuccess,
  loadJobLogs,
  loadJobLogsFailure,
  loadJobLogsSuccess,
  loadRepositories,
  loadRepositoriesFailure,
  loadRepositoriesSuccess,
  loadRunJobs,
  loadRunJobsFailure,
  loadRunJobsSuccess,
  loadRunLogs,
  loadRunLogsFailure,
  loadRunLogsSuccess,
  loadRunStatus,
  loadRunStatusFailure,
  loadRunStatusSuccess,
  loadRuns,
  loadRunsFailure,
  loadRunsSuccess,
  loadWorkflows,
  loadWorkflowsFailure,
  loadWorkflowsSuccess,
  triggerWorkflow,
  triggerWorkflowFailure,
  triggerWorkflowSuccess,
  updateDeploymentConfiguration,
  updateDeploymentConfigurationFailure,
  updateDeploymentConfigurationSuccess,
} from './deployments.actions';

/**
 * Normalizes error messages from HTTP errors.
 */
function normalizeError(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    return error.error?.message || error.message || 'An unexpected error occurred';
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  if (error && typeof error === 'object' && 'message' in error) {
    return String(error.message);
  }

  return 'An unexpected error occurred';
}

export const loadDeploymentConfiguration$ = createEffect(
  (actions$ = inject(Actions), deploymentsService = inject(DeploymentsService)) => {
    return actions$.pipe(
      ofType(loadDeploymentConfiguration),
      switchMap(({ clientId, agentId }) =>
        deploymentsService.getConfiguration(clientId, agentId).pipe(
          map((configuration) => loadDeploymentConfigurationSuccess({ configuration })),
          catchError((error) => {
            // The service should handle 404 and return null, but catch any other errors
            return of(loadDeploymentConfigurationFailure({ error: normalizeError(error) }));
          }),
        ),
      ),
    );
  },
  { functional: true },
);

export const createDeploymentConfiguration$ = createEffect(
  (actions$ = inject(Actions), deploymentsService = inject(DeploymentsService)) => {
    return actions$.pipe(
      ofType(createDeploymentConfiguration),
      mergeMap(({ clientId, agentId, dto }) =>
        deploymentsService.createConfiguration(clientId, agentId, dto).pipe(
          map((configuration) => createDeploymentConfigurationSuccess({ configuration })),
          catchError((error) => of(createDeploymentConfigurationFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const updateDeploymentConfiguration$ = createEffect(
  (actions$ = inject(Actions), deploymentsService = inject(DeploymentsService)) => {
    return actions$.pipe(
      ofType(updateDeploymentConfiguration),
      mergeMap(({ clientId, agentId, dto }) =>
        deploymentsService.updateConfiguration(clientId, agentId, dto).pipe(
          map((configuration) => updateDeploymentConfigurationSuccess({ configuration })),
          catchError((error) => of(updateDeploymentConfigurationFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const deleteDeploymentConfiguration$ = createEffect(
  (actions$ = inject(Actions), deploymentsService = inject(DeploymentsService)) => {
    return actions$.pipe(
      ofType(deleteDeploymentConfiguration),
      mergeMap(({ clientId, agentId }) =>
        deploymentsService.deleteConfiguration(clientId, agentId).pipe(
          map(() => deleteDeploymentConfigurationSuccess()),
          catchError((error) => of(deleteDeploymentConfigurationFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const loadRepositories$ = createEffect(
  (actions$ = inject(Actions), deploymentsService = inject(DeploymentsService)) => {
    return actions$.pipe(
      ofType(loadRepositories),
      switchMap(({ clientId, agentId }) =>
        deploymentsService.listRepositories(clientId, agentId).pipe(
          map((repositories) => loadRepositoriesSuccess({ repositories })),
          catchError((error) => of(loadRepositoriesFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const loadBranches$ = createEffect(
  (actions$ = inject(Actions), deploymentsService = inject(DeploymentsService)) => {
    return actions$.pipe(
      ofType(loadBranches),
      switchMap(({ clientId, agentId, repositoryId }) =>
        deploymentsService.listBranches(clientId, agentId, repositoryId).pipe(
          map((branches) => loadBranchesSuccess({ branches })),
          catchError((error) => of(loadBranchesFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const loadWorkflows$ = createEffect(
  (actions$ = inject(Actions), deploymentsService = inject(DeploymentsService)) => {
    return actions$.pipe(
      ofType(loadWorkflows),
      switchMap(({ clientId, agentId, repositoryId, branch }) =>
        deploymentsService.listWorkflows(clientId, agentId, repositoryId, branch).pipe(
          map((workflows) => loadWorkflowsSuccess({ workflows })),
          catchError((error) => of(loadWorkflowsFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const loadRuns$ = createEffect(
  (actions$ = inject(Actions), deploymentsService = inject(DeploymentsService)) => {
    return actions$.pipe(
      ofType(loadRuns),
      switchMap(({ clientId, agentId, limit, offset }) =>
        deploymentsService.listRuns(clientId, agentId, limit, offset).pipe(
          map((runs) => loadRunsSuccess({ runs })),
          catchError((error) => of(loadRunsFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const triggerWorkflow$ = createEffect(
  (actions$ = inject(Actions), deploymentsService = inject(DeploymentsService)) => {
    return actions$.pipe(
      ofType(triggerWorkflow),
      mergeMap(({ clientId, agentId, dto }) =>
        deploymentsService.triggerWorkflow(clientId, agentId, dto).pipe(
          map((run) => triggerWorkflowSuccess({ run })),
          catchError((error) => of(triggerWorkflowFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const loadRunStatus$ = createEffect(
  (actions$ = inject(Actions), deploymentsService = inject(DeploymentsService)) => {
    return actions$.pipe(
      ofType(loadRunStatus),
      switchMap(({ clientId, agentId, runId }) =>
        deploymentsService.getRunStatus(clientId, agentId, runId).pipe(
          map((run) => loadRunStatusSuccess({ run })),
          catchError((error) => of(loadRunStatusFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const loadRunLogs$ = createEffect(
  (actions$ = inject(Actions), deploymentsService = inject(DeploymentsService)) => {
    return actions$.pipe(
      ofType(loadRunLogs),
      switchMap(({ clientId, agentId, runId }) =>
        deploymentsService.getRunLogs(clientId, agentId, runId).pipe(
          map((response) => loadRunLogsSuccess({ logs: response.logs })),
          catchError((error) => of(loadRunLogsFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const cancelRun$ = createEffect(
  (actions$ = inject(Actions), deploymentsService = inject(DeploymentsService)) => {
    return actions$.pipe(
      ofType(cancelRun),
      mergeMap(({ clientId, agentId, runId }) =>
        deploymentsService.cancelRun(clientId, agentId, runId).pipe(
          map(() => cancelRunSuccess()),
          catchError((error) => of(cancelRunFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const loadRunJobs$ = createEffect(
  (actions$ = inject(Actions), deploymentsService = inject(DeploymentsService)) => {
    return actions$.pipe(
      ofType(loadRunJobs),
      switchMap(({ clientId, agentId, runId }) =>
        deploymentsService.listRunJobs(clientId, agentId, runId).pipe(
          map((jobs) => loadRunJobsSuccess({ jobs })),
          catchError((error) => of(loadRunJobsFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const loadJobLogs$ = createEffect(
  (actions$ = inject(Actions), deploymentsService = inject(DeploymentsService)) => {
    return actions$.pipe(
      ofType(loadJobLogs),
      switchMap(({ clientId, agentId, runId, jobId }) =>
        deploymentsService.getJobLogs(clientId, agentId, runId, jobId).pipe(
          map((response) => loadJobLogsSuccess({ logs: response.logs })),
          catchError((error) => of(loadJobLogsFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);
