import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { catchError, exhaustMap, filter, from, groupBy, map, mergeMap, of, switchMap, withLatestFrom } from 'rxjs';

import { AgentsService } from '../../services/agents.service';
import {
  OpencodeConfigService,
  type OpencodeCommandInfoDto,
  type OpencodeConfigDto,
} from '../../services/opencode-config.service';
import { setContainerRunningStatus } from '../stats/stats.actions';
import {
  forwardedEventReceived,
  remoteReconnected,
  setClientSuccess,
} from '../container-socket/container-socket.actions';
import { selectSelectedClientId } from '../container-socket/container-socket.selectors';

import {
  createClientAgent,
  createClientAgentFailure,
  createClientAgentSuccess,
  deleteClientAgent,
  deleteClientAgentFailure,
  deleteClientAgentSuccess,
  loadClientAgent,
  loadClientAgentCommands,
  loadClientAgentCommandsFailure,
  loadClientAgentCommandsSuccess,
  loadClientAgentFailure,
  loadClientAgentModels,
  loadClientAgentModelsFailure,
  loadClientAgentModelsSuccess,
  loadClientAgents,
  loadClientAgentsFailure,
  loadClientAgentsSuccess,
  loadClientAgentSuccess,
  loadMoreClientAgents,
  loadMoreClientAgentsFailure,
  loadMoreClientAgentsSuccess,
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
import { selectAgentsState } from './agents.selectors';
import type { AgentSlashCommand } from './agents.types';

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

/** Normalize slash-command ids for chat typeahead (`ship` → `/ship`). */
function normalizeCommandName(name: string): string | null {
  const trimmed = name.trim();

  if (!trimmed) {
    return null;
  }

  const withSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;

  return withSlash.length > 1 ? withSlash : null;
}

/**
 * OpenCode built-in prompt commands always registered in its Command service
 * (see opencode packages/opencode/src/command/index.ts).
 */
const OPENCODE_BUILTIN_SLASH_COMMANDS: AgentSlashCommand[] = [
  { name: '/init', description: 'guided AGENTS.md setup' },
  { name: '/review', description: 'review changes [commit|branch|pr], defaults to uncommitted' },
];

function upsertSlashCommand(target: Map<string, AgentSlashCommand>, entry: AgentSlashCommand): void {
  const normalized = normalizeCommandName(entry.name);

  if (!normalized) {
    return;
  }

  const existing = target.get(normalized);

  target.set(normalized, {
    name: normalized,
    description: entry.description?.trim() || existing?.description,
    source: entry.source ?? existing?.source,
  });
}

function slashCommandsFromWorker(rows: OpencodeCommandInfoDto[]): AgentSlashCommand[] {
  const merged = new Map<string, AgentSlashCommand>();

  for (const row of rows) {
    upsertSlashCommand(merged, {
      name: row.name,
      description: row.description,
      source: row.source,
    });
  }

  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function commandKeysFromMap(value: unknown): Array<{ name: string; description?: string }> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }

  return Object.entries(value as Record<string, unknown>).map(([name, entry]) => {
    const description =
      entry &&
      typeof entry === 'object' &&
      !Array.isArray(entry) &&
      typeof (entry as { description?: unknown }).description === 'string'
        ? (entry as { description: string }).description
        : undefined;

    return { name, description };
  });
}

/**
 * Offline fallback when the worker `GET /command` list is unavailable.
 * Mirrors OpenCode's registry shape for config commands + builtins (not filesystem skills).
 */
function slashCommandsFromOpencodeConfig(dto: OpencodeConfigDto): AgentSlashCommand[] {
  const merged = new Map<string, AgentSlashCommand>();

  for (const builtin of OPENCODE_BUILTIN_SLASH_COMMANDS) {
    upsertSlashCommand(merged, builtin);
  }

  const inheritedCommands =
    dto.inheritedAdditive?.find((entry) => entry.path === '/commands' || entry.path === 'commands')?.keys ?? [];

  for (const name of inheritedCommands) {
    upsertSlashCommand(merged, { name });
  }

  for (const entry of commandKeysFromMap((dto.effective as Record<string, unknown> | undefined)?.['commands'])) {
    upsertSlashCommand(merged, entry);
  }

  for (const entry of commandKeysFromMap((dto.config as Record<string, unknown> | undefined)?.['commands'])) {
    upsertSlashCommand(merged, entry);
  }

  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const BATCH_SIZE = 10;

export const loadClientAgents$ = createEffect(
  (actions$ = inject(Actions), agentsService = inject(AgentsService)) => {
    return actions$.pipe(
      ofType(loadClientAgents),
      switchMap(({ clientId, params }) => {
        const batchParams = {
          limit: params?.limit ?? BATCH_SIZE,
          offset: params?.offset ?? 0,
          search: params?.search?.trim() || undefined,
        };

        return agentsService.listClientAgents(clientId, batchParams).pipe(
          map((agents) =>
            loadClientAgentsSuccess({
              clientId,
              agents,
              hasMore: agents.length === BATCH_SIZE,
              nextOffset: agents.length,
            }),
          ),
          catchError((error) => of(loadClientAgentsFailure({ clientId, error: normalizeError(error) }))),
        );
      }),
    );
  },
  { functional: true },
);

export const loadMoreClientAgents$ = createEffect(
  (actions$ = inject(Actions), agentsService = inject(AgentsService), store = inject(Store)) => {
    return actions$.pipe(
      ofType(loadMoreClientAgents),
      withLatestFrom(store.select(selectAgentsState)),
      filter(
        ([{ clientId }, state]) =>
          Boolean(state.hasMore[clientId]) && !state.loading[clientId] && !state.appendLoading[clientId],
      ),
      exhaustMap(([{ clientId }, state]) => {
        const offset = state.nextOffset[clientId] ?? 0;
        const batchParams = {
          limit: BATCH_SIZE,
          offset,
          search: state.search?.[clientId] ?? undefined,
        };

        return agentsService.listClientAgents(clientId, batchParams).pipe(
          map((agents) =>
            loadMoreClientAgentsSuccess({
              clientId,
              agents,
              hasMore: agents.length === BATCH_SIZE,
              nextOffset: offset + agents.length,
            }),
          ),
          catchError((error) => of(loadMoreClientAgentsFailure({ clientId, error: normalizeError(error) }))),
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
      groupBy(({ clientId, agentId }) => `${clientId}:${agentId}`),
      mergeMap((requests$) =>
        requests$.pipe(
          switchMap(({ clientId, agentId }) =>
            agentsService.listClientAgentModels(clientId, agentId).pipe(
              map((models) => loadClientAgentModelsSuccess({ clientId, agentId, models })),
              catchError((error) =>
                of(loadClientAgentModelsFailure({ clientId, agentId, error: normalizeError(error) })),
              ),
            ),
          ),
        ),
      ),
    );
  },
  { functional: true },
);

/** Refresh catalogs only after config was applied, including updates from other users/layers. */
export const refreshAgentCatalogsOnConfigSynced$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store)) =>
    actions$.pipe(
      ofType(forwardedEventReceived, setClientSuccess, remoteReconnected),
      withLatestFrom(store.select(selectSelectedClientId), store.select(selectAgentsState)),
      mergeMap(([action, selectedClientId, state]) => {
        let clientId: string;
        let agentId: string | null = null;

        if (action.type === forwardedEventReceived.type) {
          if (action.event !== 'opencodeConfigSynced' || !selectedClientId) {
            return of();
          }

          const envelope = action.payload as { success?: unknown; data?: { agentId?: unknown } } | null;

          if (envelope?.success !== true || typeof envelope.data?.agentId !== 'string' || !envelope.data.agentId) {
            return of();
          }

          clientId = selectedClientId;
          agentId = envelope.data.agentId;
        } else {
          clientId = action.clientId;
        }

        const modelKeys = new Set([
          ...Object.keys(state.agentModels),
          ...Object.keys(state.loadingAgentModels),
          ...Object.keys(state.agentModelsErrors),
        ]);
        const commandKeys = new Set([...Object.keys(state.commands), ...Object.keys(state.loadingCommands)]);
        const keys = new Set([...modelKeys, ...commandKeys]);
        const prefix = `${clientId}:`;

        return from(
          [...keys]
            .filter((key) => key.startsWith(prefix) && (!agentId || key === `${prefix}${agentId}`))
            .flatMap((key) => {
              const target = { clientId, agentId: key.slice(prefix.length) };

              return [
                ...(modelKeys.has(key) ? [loadClientAgentModels(target)] : []),
                ...(commandKeys.has(key) ? [loadClientAgentCommands(target)] : []),
              ];
            }),
        );
      }),
    ),
  { functional: true },
);

export const createClientAgent$ = createEffect(
  (actions$ = inject(Actions), agentsService = inject(AgentsService)) => {
    return actions$.pipe(
      ofType(createClientAgent),
      exhaustMap(({ clientId, agent }) =>
        agentsService.createClientAgent(clientId, agent).pipe(
          map((created) => createClientAgentSuccess({ clientId, agent: created })),
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
          map((updated) => updateClientAgentSuccess({ clientId, agent: updated })),
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
 * Prefer OpenCode worker `GET /command` (commands + skills + MCP prompts + builtins).
 * Fall back to effective config + builtins when the worker is offline.
 */
export const loadClientAgentCommandsFromConfig$ = createEffect(
  (actions$ = inject(Actions), opencodeConfigService = inject(OpencodeConfigService)) => {
    return actions$.pipe(
      ofType(loadClientAgentCommands),
      groupBy(({ clientId, agentId }) => `${clientId}:${agentId}`),
      mergeMap((requests$) =>
        requests$.pipe(
          switchMap(({ clientId, agentId }) =>
            opencodeConfigService.listAgentCommands(clientId, agentId).pipe(
              map((dto) => slashCommandsFromWorker(dto.commands ?? [])),
              catchError(() => of([] as AgentSlashCommand[])),
              switchMap((fromWorker) => {
                if (fromWorker.length > 0) {
                  return of(
                    loadClientAgentCommandsSuccess({
                      clientId,
                      agentId,
                      commands: fromWorker,
                    }),
                  );
                }

                return opencodeConfigService.getAgent(clientId, agentId).pipe(
                  map((dto) =>
                    loadClientAgentCommandsSuccess({
                      clientId,
                      agentId,
                      commands: slashCommandsFromOpencodeConfig(dto),
                    }),
                  ),
                  catchError(() => of(loadClientAgentCommandsFailure({ clientId, agentId }))),
                );
              }),
            ),
          ),
        ),
      ),
    );
  },
  { functional: true },
);
