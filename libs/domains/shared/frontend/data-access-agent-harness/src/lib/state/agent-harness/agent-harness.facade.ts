import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import type { Observable } from 'rxjs';

import type {
  AgentActivity,
  AgentChatMessage,
  AgentChatToolCall,
  AgentChatTurnSummary,
} from '../../types/agent-chat.types';

import {
  cancelAgentTurn,
  clearAgentHarnessError,
  createAgentConversation,
  openAgentConversation,
  resetAgentConversation,
  sendAgentMessage,
} from './agent-harness.actions';
import {
  selectAgentActivity,
  selectAgentConversationId,
  selectAgentHarnessCreating,
  selectAgentHarnessError,
  selectAgentHarnessLoading,
  selectAgentLastTurn,
  selectAgentMessages,
  selectAgentSending,
  selectAgentToolCalls,
} from './agent-harness.selectors';

let localSequence = 0;

@Injectable({ providedIn: 'root' })
export class AgentHarnessFacade {
  private readonly store = inject(Store);

  readonly conversationId$: Observable<string | null> = this.store.select(selectAgentConversationId);
  readonly messages$: Observable<AgentChatMessage[]> = this.store.select(selectAgentMessages);
  readonly sending$: Observable<boolean> = this.store.select(selectAgentSending);
  readonly toolCalls$: Observable<AgentChatToolCall[]> = this.store.select(selectAgentToolCalls);
  readonly activity$: Observable<AgentActivity[]> = this.store.select(selectAgentActivity);
  readonly lastTurn$: Observable<AgentChatTurnSummary | null> = this.store.select(selectAgentLastTurn);
  readonly loading$: Observable<boolean> = this.store.select(selectAgentHarnessLoading);
  readonly creating$: Observable<boolean> = this.store.select(selectAgentHarnessCreating);
  readonly error$: Observable<string | null> = this.store.select(selectAgentHarnessError);

  /** Starts a new conversation (chat session) and makes it the open one. */
  createConversation(title?: string): void {
    this.store.dispatch(createAgentConversation({ title }));
  }

  /** Opens an existing conversation and loads its history. */
  openConversation(conversationId: string): void {
    this.store.dispatch(openAgentConversation({ conversationId }));
  }

  send(text: string): void {
    const trimmed = text.trim();

    if (!trimmed) {
      return;
    }

    this.store.dispatch(
      sendAgentMessage({
        text: trimmed,
        localId: `local-${Date.now()}-${localSequence++}`,
        createdAt: Math.floor(Date.now() / 1000),
      }),
    );
  }

  /** Stops following the running turn (the turn itself completes in the chat session). */
  cancel(): void {
    this.store.dispatch(cancelAgentTurn());
  }

  reset(): void {
    this.store.dispatch(resetAgentConversation());
  }

  clearError(): void {
    this.store.dispatch(clearAgentHarnessError());
  }
}
