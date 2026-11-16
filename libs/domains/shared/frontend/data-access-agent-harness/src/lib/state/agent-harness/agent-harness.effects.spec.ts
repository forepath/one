import { Actions } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { of, Subject, throwError, toArray } from 'rxjs';

import type { AgentHarnessTransportService } from '../../services/agent-harness-transport.service';

import {
  agentTurnEvent,
  agentTurnStreamFailure,
  cancelAgentTurn,
  createAgentConversation,
  createAgentConversationFailure,
  createAgentConversationSuccess,
  loadAgentConversationHistorySuccess,
  openAgentConversation,
  sendAgentMessage,
} from './agent-harness.actions';
import { createAgentConversation$, openAgentConversation$, sendAgentMessage$ } from './agent-harness.effects';

const CONV = 'conv_33333333333343338333333333333333';

function store(conversationId: string | null): Store {
  return { select: jest.fn().mockReturnValue(of(conversationId)) } as unknown as Store;
}

describe('agent harness effects', () => {
  it('creates conversations', (done) => {
    const conversation = {
      id: CONV,
      object: 'conversation' as const,
      created_at: 1,
      metadata: { agenstra_chat_id: 'x' },
    };
    const transport = { createConversation: jest.fn().mockReturnValue(of(conversation)) };

    createAgentConversation$(
      of(createAgentConversation({ title: 'T' })) as Actions,
      transport as unknown as AgentHarnessTransportService,
    ).subscribe((action) => {
      expect(transport.createConversation).toHaveBeenCalledWith('T');
      expect(action).toEqual(createAgentConversationSuccess({ conversation }));
      done();
    });
  });

  it('reports creation failures', (done) => {
    const transport = { createConversation: jest.fn().mockReturnValue(throwError(() => new Error('No access'))) };

    createAgentConversation$(
      of(createAgentConversation({})) as Actions,
      transport as unknown as AgentHarnessTransportService,
    ).subscribe((action) => {
      expect(action).toEqual(createAgentConversationFailure({ error: 'No access' }));
      done();
    });
  });

  it('loads history when a conversation is opened', (done) => {
    const transport = { history: jest.fn().mockReturnValue(of([])) };

    openAgentConversation$(
      of(openAgentConversation({ conversationId: CONV })) as Actions,
      transport as unknown as AgentHarnessTransportService,
    ).subscribe((action) => {
      expect(action).toEqual(loadAgentConversationHistorySuccess({ conversationId: CONV, items: [] }));
      done();
    });
  });

  it('maps turn events of the open conversation', (done) => {
    const transport = {
      send: jest
        .fn()
        .mockReturnValue(of({ type: 'text.delta' as const, delta: 'a' }, { type: 'text.done' as const, text: 'a' })),
    };

    sendAgentMessage$(
      of(sendAgentMessage({ text: 'hi', localId: 'l', createdAt: 1 })) as Actions,
      transport as unknown as AgentHarnessTransportService,
      store(CONV),
    )
      .pipe(toArray())
      .subscribe((actions) => {
        expect(transport.send).toHaveBeenCalledWith('hi', CONV);
        expect(actions).toEqual([
          agentTurnEvent({ event: { type: 'text.delta', delta: 'a' } }),
          agentTurnEvent({ event: { type: 'text.done', text: 'a' } }),
        ]);
        done();
      });
  });

  it('stops following a turn on cancel and reports stream errors', () => {
    const actions$ = new Subject<any>();
    const turn$ = new Subject<any>();
    const transport = {
      send: jest
        .fn()
        .mockReturnValueOnce(turn$)
        .mockReturnValueOnce(throwError(() => new Error('down'))),
    };
    const emitted: unknown[] = [];

    sendAgentMessage$(
      actions$ as unknown as Actions,
      transport as unknown as AgentHarnessTransportService,
      store(null),
    ).subscribe((action) => emitted.push(action));

    actions$.next(sendAgentMessage({ text: 'a', localId: 'l1', createdAt: 1 }));
    turn$.next({ type: 'text.delta', delta: 'x' });
    actions$.next(cancelAgentTurn());
    turn$.next({ type: 'text.delta', delta: 'ignored' });
    actions$.next(sendAgentMessage({ text: 'b', localId: 'l2', createdAt: 1 }));

    expect(turn$.observed).toBe(false);
    expect(emitted).toEqual([
      agentTurnEvent({ event: { type: 'text.delta', delta: 'x' } }),
      agentTurnStreamFailure({ error: 'down' }),
    ]);
  });
});
