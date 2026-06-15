import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { catchError, exhaustMap, filter, from, map, mergeMap, of, switchMap, withLatestFrom } from 'rxjs';

import { AgentsService } from '../../services/agents.service';
import { listDirectory, listDirectoryFailure, listDirectorySuccess } from '../files/files.actions';
import type { FileNodeDto } from '../files/files.types';
import { setContainerRunningStatus } from '../stats/stats.actions';

import {
  createClientAgent,
  createClientAgentFailure,
  createClientAgentSuccess,
  deleteClientAgent,
  deleteClientAgentFailure,
  deleteClientAgentSuccess,
  loadClientAgent,
  loadClientAgentCommands,
  loadClientAgentCommandsSuccess,
  loadClientAgentFailure,
  loadClientAgentModels,
  loadClientAgentModelsFailure,
  loadClientAgentModelsSuccess,
  loadClientAgents,
  loadClientAgentsBatch,
  loadClientAgentsFailure,
  loadClientAgentsSuccess,
  loadClientAgentSuccess,
  restartClientAgent,
  restartClientAgentFailure,
  restartClientAgentSuccess,
  startClientAgent,
  startClientAgentFailure,
  startClientAgentSuccess,
  stopClientAgent,
  stopClientAgentFailure,
  stopClientAgentSuccess,
  updateClientAgent,
  updateClientAgentFailure,
  updateClientAgentSuccess,
} from './agents.actions';
import { selectAgentsEntities } from './agents.selectors';

/**
 * Normalizes error messages from HTTP errors.
 */
function normalizeError(error: unknown): string {
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

const BATCH_SIZE = 10;

export const loadClientAgents$ = createEffect(
  (actions$ = inject(Actions), agentsService = inject(AgentsService)) => {
    return actions$.pipe(
      ofType(loadClientAgents),
      switchMap(({ clientId }) => {
        // Start with offset 0, limit 10, ignore user params for batch loading
        const batchParams = { limit: BATCH_SIZE, offset: 0 };

        return agentsService.listClientAgents(clientId, batchParams).pipe(
          switchMap((agents) => {
            if (agents.length === 0) {
              // No entries, dispatch success with empty array
              return of(loadClientAgentsSuccess({ clientId, agents: [] }));
            }

            // Has entries, check if we got a full batch (might be more)
            if (agents.length < BATCH_SIZE) {
              // Partial batch, we're done
              return of(loadClientAgentsSuccess({ clientId, agents }));
            }

            // Full batch, load next batch
            return of(loadClientAgentsBatch({ clientId, offset: BATCH_SIZE, accumulatedAgents: agents }));
          }),
          catchError((error) => of(loadClientAgentsFailure({ clientId, error: normalizeError(error) }))),
        );
      }),
    );
  },
  { functional: true },
);

export const loadClientAgentsBatch$ = createEffect(
  (actions$ = inject(Actions), agentsService = inject(AgentsService)) => {
    return actions$.pipe(
      ofType(loadClientAgentsBatch),
      switchMap(({ clientId, offset, accumulatedAgents }) => {
        const batchParams = { limit: BATCH_SIZE, offset };

        return agentsService.listClientAgents(clientId, batchParams).pipe(
          switchMap((agents) => {
            const newAccumulated = [...accumulatedAgents, ...agents];

            if (agents.length === 0) {
              // No more entries, dispatch success with all accumulated
              return of(loadClientAgentsSuccess({ clientId, agents: newAccumulated }));
            }

            // Has entries, check if we got a full batch (might be more)
            if (agents.length < BATCH_SIZE) {
              // Partial batch, we're done
              return of(loadClientAgentsSuccess({ clientId, agents: newAccumulated }));
            }

            // Full batch, load next batch
            return of(
              loadClientAgentsBatch({ clientId, offset: offset + BATCH_SIZE, accumulatedAgents: newAccumulated }),
            );
          }),
          catchError((error) => of(loadClientAgentsFailure({ clientId, error: normalizeError(error) }))),
        );
      }),
    );
  },
  { functional: true },
);

export const loadClientAgent$ = createEffect(
  (actions$ = inject(Actions), agentsService = inject(AgentsService)) => {
    return actions$.pipe(
      ofType(loadClientAgent),
      switchMap(({ clientId, agentId }) =>
        agentsService.getClientAgent(clientId, agentId).pipe(
          map((agent) => loadClientAgentSuccess({ clientId, agent })),
          catchError((error) => of(loadClientAgentFailure({ clientId, error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const loadClientAgentModels$ = createEffect(
  (actions$ = inject(Actions), agentsService = inject(AgentsService)) => {
    return actions$.pipe(
      ofType(loadClientAgentModels),
      switchMap(({ clientId, agentId }) =>
        agentsService.listClientAgentModels(clientId, agentId).pipe(
          map((models) => loadClientAgentModelsSuccess({ clientId, agentId, models })),
          catchError((error) => of(loadClientAgentModelsFailure({ clientId, agentId, error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const createClientAgent$ = createEffect(
  (actions$ = inject(Actions), agentsService = inject(AgentsService)) => {
    return actions$.pipe(
      ofType(createClientAgent),
      exhaustMap(({ clientId, agent }) =>
        agentsService.createClientAgent(clientId, agent).pipe(
          map((createdAgent) => createClientAgentSuccess({ clientId, agent: createdAgent })),
          catchError((error) => of(createClientAgentFailure({ clientId, error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const updateClientAgent$ = createEffect(
  (actions$ = inject(Actions), agentsService = inject(AgentsService)) => {
    return actions$.pipe(
      ofType(updateClientAgent),
      exhaustMap(({ clientId, agentId, agent }) =>
        agentsService.updateClientAgent(clientId, agentId, agent).pipe(
          map((updatedAgent) => updateClientAgentSuccess({ clientId, agent: updatedAgent })),
          catchError((error) => of(updateClientAgentFailure({ clientId, error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const deleteClientAgent$ = createEffect(
  (actions$ = inject(Actions), agentsService = inject(AgentsService)) => {
    return actions$.pipe(
      ofType(deleteClientAgent),
      exhaustMap(({ clientId, agentId }) =>
        agentsService.deleteClientAgent(clientId, agentId).pipe(
          map(() => deleteClientAgentSuccess({ clientId, agentId })),
          catchError((error) => of(deleteClientAgentFailure({ clientId, error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const startClientAgent$ = createEffect(
  (actions$ = inject(Actions), agentsService = inject(AgentsService)) => {
    return actions$.pipe(
      ofType(startClientAgent),
      exhaustMap(({ clientId, agentId }) =>
        agentsService.startClientAgent(clientId, agentId).pipe(
          mergeMap((agent) =>
            from([
              startClientAgentSuccess({ clientId, agent }),
              setContainerRunningStatus({ clientId, agentId: agent.id, running: true }),
            ]),
          ),
          catchError((error) => of(startClientAgentFailure({ clientId, error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const stopClientAgent$ = createEffect(
  (actions$ = inject(Actions), agentsService = inject(AgentsService)) => {
    return actions$.pipe(
      ofType(stopClientAgent),
      exhaustMap(({ clientId, agentId }) =>
        agentsService.stopClientAgent(clientId, agentId).pipe(
          mergeMap((agent) =>
            from([
              stopClientAgentSuccess({ clientId, agent }),
              setContainerRunningStatus({ clientId, agentId: agent.id, running: false }),
            ]),
          ),
          catchError((error) => of(stopClientAgentFailure({ clientId, error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const restartClientAgent$ = createEffect(
  (actions$ = inject(Actions), agentsService = inject(AgentsService)) => {
    return actions$.pipe(
      ofType(restartClientAgent),
      exhaustMap(({ clientId, agentId }) =>
        agentsService.restartClientAgent(clientId, agentId).pipe(
          mergeMap((agent) =>
            from([
              restartClientAgentSuccess({ clientId, agent }),
              setContainerRunningStatus({ clientId, agentId: agent.id, running: true }),
            ]),
          ),
          catchError((error) => of(restartClientAgentFailure({ clientId, error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

/**
 * Effect that sets loading state when directory listing for .cursor/commands starts.
 */
export const loadClientAgentCommandsLoading$ = createEffect(
  (actions$ = inject(Actions)) => {
    return actions$.pipe(
      ofType(listDirectory),
      filter(({ params }) => {
        // Normalize path for comparison (handle both '.cursor/commands' and './.cursor/commands')
        const path = params?.path || '';
        const normalized = path.replace(/^\.\//, '').replace(/\/$/, '');

        return (
          normalized === '.cursor/commands' ||
          normalized === 'cursor/commands' ||
          normalized === '.opencode/command' ||
          normalized === 'opencode/command'
        );
      }),
      map(({ clientId, agentId }) => loadClientAgentCommands({ clientId, agentId })),
    );
  },
  { functional: true },
);

/**
 * Effect that listens to files directory listing success/failure for .cursor/commands
 * and extracts .md files as commands.
 */
export const loadClientAgentCommandsFromFiles$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store)) => {
    return actions$.pipe(
      ofType(listDirectorySuccess, listDirectoryFailure),
      withLatestFrom(store.select(selectAgentsEntities)),
      map(([action, agentsEntities]) => {
        const agent = agentsEntities[action.clientId]?.find((agent) => agent.id === action.agentId);

        if (!agent) {
          return action;
        }

        return {
          ...action,
          agentType: agent.agentType,
        };
      }),
      filter((action) => {
        // Normalize path for comparison (handle both '.cursor/commands' and './.cursor/commands')
        const normalized = action.directoryPath.replace(/^\.\//, '').replace(/\/$/, '');

        return (
          normalized === '.cursor/commands' ||
          normalized === 'cursor/commands' ||
          normalized === '.opencode/command' ||
          normalized === 'opencode/command'
        );
      }),
      map((action: any) => {
        if (action.type === '[Files] List Directory Success') {
          const { clientId, agentId, agentType, files, directoryPath } = action;
          // Filter for .md files (type === 'file' and name ends with .md)
          const commandFiles = files.filter((file: FileNodeDto) => file.type === 'file' && file.name.endsWith('.md'));
          // Determine agentType from directoryPath
          const normalizedPath = directoryPath.replace(/^\.\//, '').replace(/\/$/, '');
          // Extract command names: remove .md extension and prefix with /
          const commands: { [agentType: string]: string[] } = {
            cursor: [],
            opencode: [],
          };

          if (agentType) {
            const commandNames = commandFiles.map((file: FileNodeDto) => {
              const commandName = file.name.replace(/\.md$/, '');

              return `/${commandName}`;
            });

            if (normalizedPath.includes(normalizedPath)) {
              commands[agentType] = commandNames;
            }
          } else {
            // If agentType couldn't be determined, return empty object
            // This shouldn't happen if the filter is working correctly
          }

          return loadClientAgentCommandsSuccess({ clientId, agentId, commands });
        } else {
          // If directory listing fails, determine agentType from directoryPath and return empty commands
          const { clientId, agentId, directoryPath } = action;
          const normalizedPath = directoryPath.replace(/^\.\//, '').replace(/\/$/, '');
          const commands: { [agentType: string]: string[] } = {};

          if (normalizedPath === '.cursor/commands' || normalizedPath === 'cursor/commands') {
            commands['cursor'] = [];
          } else if (normalizedPath === '.opencode/command' || normalizedPath === 'opencode/command') {
            commands['opencode'] = [];
          }

          return loadClientAgentCommandsSuccess({ clientId, agentId, commands });
        }
      }),
    );
  },
  { functional: true },
);
