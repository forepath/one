import { HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { catchError, concatMap, map, of, switchMap, take, takeUntil } from 'rxjs';

import { AgentHarnessTransportService } from '../../services/agent-harness-transport.service';

import {
  agentTurnEvent,
  agentTurnStreamFailure,
  cancelAgentTurn,
  createAgentConversation,
  createAgentConversationFailure,
  createAgentConversationSuccess,
  loadAgentConversationHistoryFailure,
  loadAgentConversationHistorySuccess,
  openAgentConversation,
  resetAgentConversation,
  sendAgentMessage,
} from './agent-harness.actions';
import { selectAgentConversationId } from './agent-harness.selectors';

export function normalizeAgentHarnessError(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    const body = error.error as { error?: { message?: unknown }; message?: unknown } | null;
    const message = body?.error?.message ?? body?.message;

    return typeof message === 'string' ? message : error.message || String(error.status);
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'An unexpected error occurred';
}

export const createAgentConversation$ = createEffect(
  (actions$ = inject(Actions), transport = inject(AgentHarnessTransportService)) => {
    return actions$.pipe(
      ofType(createAgentConversation),
      switchMap(({ title }) =>
        transport.createConversation(title).pipe(
          map((conversation) => createAgentConversationSuccess({ conversation })),
          catchError((error) => of(createAgentConversationFailure({ error: normalizeAgentHarnessError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const openAgentConversation$ = createEffect(
  (actions$ = inject(Actions), transport = inject(AgentHarnessTransportService)) => {
    return actions$.pipe(
      ofType(openAgentConversation),
      switchMap(({ conversationId }) =>
        transport.history(conversationId).pipe(
          map((items) => loadAgentConversationHistorySuccess({ conversationId, items })),
          catchError((error) => of(loadAgentConversationHistoryFailure({ error: normalizeAgentHarnessError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

/** Runs turns one after another; a running turn stops being followed on cancel, reset or conversation switch. */
export const sendAgentMessage$ = createEffect(
  (actions$ = inject(Actions), transport = inject(AgentHarnessTransportService), store = inject(Store)) => {
    const interrupted$ = actions$.pipe(
      ofType(cancelAgentTurn, resetAgentConversation, openAgentConversation, createAgentConversationSuccess),
    );

    return actions$.pipe(
      ofType(sendAgentMessage),
      concatMap(({ text }) =>
        store.select(selectAgentConversationId).pipe(
          take(1),
          switchMap((conversationId) => transport.send(text, conversationId)),
          map((event) => agentTurnEvent({ event })),
          takeUntil(interrupted$),
          catchError((error) => of(agentTurnStreamFailure({ error: normalizeAgentHarnessError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);
