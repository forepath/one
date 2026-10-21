import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { catchError, EMPTY, exhaustMap, map, mergeMap, of, switchMap, withLatestFrom } from 'rxjs';

import { ChatSessionsService } from '../../services/chat-sessions.service';
import { forwardedEventReceived } from '../container-socket/container-socket.actions';
import { selectSelectedAgentId, selectSelectedClientId } from '../container-socket/container-socket.selectors';

import {
  createChatSession,
  createChatSessionFailure,
  createChatSessionSuccess,
  deleteChatSession,
  deleteChatSessionFailure,
  deleteChatSessionSuccess,
  loadChatSessions,
  loadChatSessionsFailure,
  loadChatSessionsSuccess,
  updateChatSession,
  updateChatSessionFailure,
  updateChatSessionSuccess,
} from './chat-sessions.actions';
import { getClientAgentKey } from './chat-sessions.reducer';
import { selectChatSessionsMap } from './chat-sessions.selectors';

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

export const loadChatSessions$ = createEffect(
  (actions$ = inject(Actions), chatSessionsService = inject(ChatSessionsService)) => {
    return actions$.pipe(
      ofType(loadChatSessions),
      switchMap(({ clientId, agentId, params }) =>
        chatSessionsService.listChatSessions(clientId, agentId, params).pipe(
          map((sessions) => {
            const primaryChatId = sessions.find((session) => session.kind === 'primary')?.id;

            return loadChatSessionsSuccess({ clientId, agentId, sessions, primaryChatId });
          }),
          catchError((error) => of(loadChatSessionsFailure({ clientId, agentId, error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const createChatSession$ = createEffect(
  (actions$ = inject(Actions), chatSessionsService = inject(ChatSessionsService)) => {
    return actions$.pipe(
      ofType(createChatSession),
      exhaustMap(({ clientId, agentId, createDto }) =>
        chatSessionsService.createChatSession(clientId, agentId, createDto ?? {}).pipe(
          map((session) => createChatSessionSuccess({ clientId, agentId, session })),
          catchError((error) => of(createChatSessionFailure({ clientId, agentId, error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const updateChatSession$ = createEffect(
  (actions$ = inject(Actions), chatSessionsService = inject(ChatSessionsService)) => {
    return actions$.pipe(
      ofType(updateChatSession),
      exhaustMap(({ clientId, agentId, chatId, updateDto }) =>
        chatSessionsService.updateChatSession(clientId, agentId, chatId, updateDto).pipe(
          map((session) => updateChatSessionSuccess({ clientId, agentId, session })),
          catchError((error) =>
            of(updateChatSessionFailure({ clientId, agentId, chatId, error: normalizeError(error) })),
          ),
        ),
      ),
    );
  },
  { functional: true },
);

export const deleteChatSession$ = createEffect(
  (actions$ = inject(Actions), chatSessionsService = inject(ChatSessionsService)) => {
    return actions$.pipe(
      ofType(deleteChatSession),
      exhaustMap(({ clientId, agentId, chatId }) =>
        chatSessionsService.deleteChatSession(clientId, agentId, chatId).pipe(
          map(() => deleteChatSessionSuccess({ clientId, agentId, chatId })),
          catchError((error) =>
            of(deleteChatSessionFailure({ clientId, agentId, chatId, error: normalizeError(error) })),
          ),
        ),
      ),
    );
  },
  { functional: true },
);

/** `chatId` of a forwarded `chatMessage` / `chatEvent` (`{ success, data: { chatId } }`). */
function forwardedChatId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const chatId = (payload as { data?: { chatId?: unknown } }).data?.chatId;

  return typeof chatId === 'string' && chatId ? chatId : null;
}

/**
 * Chats can appear without a user action (a handoff opens a chat on the target agent): reload the agent's sessions
 * once when activity arrives for a chat that is not listed yet, so it shows up in the chat switcher.
 */
export const reloadChatSessionsOnUnknownChat$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store)) => {
    const requested = new Set<string>();

    return actions$.pipe(
      ofType(forwardedEventReceived),
      withLatestFrom(
        store.select(selectSelectedClientId),
        store.select(selectSelectedAgentId),
        store.select(selectChatSessionsMap),
      ),
      mergeMap(([action, clientId, agentId, sessionsMap]) => {
        if (action.event !== 'chatMessage' && action.event !== 'chatEvent') {
          return EMPTY;
        }

        const chatId = forwardedChatId(action.payload);

        if (!chatId || !clientId || !agentId) {
          return EMPTY;
        }

        const sessions = sessionsMap[getClientAgentKey(clientId, agentId)];
        const requestKey = `${clientId}:${agentId}:${chatId}`;

        if (!sessions || sessions.some((session) => session.id === chatId) || requested.has(requestKey)) {
          return EMPTY;
        }

        requested.add(requestKey);

        return of(loadChatSessions({ clientId, agentId }));
      }),
    );
  },
  { functional: true },
);
