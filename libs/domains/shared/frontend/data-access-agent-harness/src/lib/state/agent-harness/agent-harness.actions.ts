import type {
  AgentHarnessConversation,
  AgentHarnessConversationItem,
  AgentHarnessEvent,
} from '@forepath/shared/shared/util-agent-harness';
import { createAction, props } from '@ngrx/store';

export const createAgentConversation = createAction('[Agent Harness] Create Conversation', props<{ title?: string }>());

export const createAgentConversationSuccess = createAction(
  '[Agent Harness] Create Conversation Success',
  props<{ conversation: AgentHarnessConversation }>(),
);

export const createAgentConversationFailure = createAction(
  '[Agent Harness] Create Conversation Failure',
  props<{ error: string }>(),
);

export const openAgentConversation = createAction(
  '[Agent Harness] Open Conversation',
  props<{ conversationId: string }>(),
);

export const loadAgentConversationHistorySuccess = createAction(
  '[Agent Harness] Load History Success',
  props<{ conversationId: string; items: AgentHarnessConversationItem[] }>(),
);

export const loadAgentConversationHistoryFailure = createAction(
  '[Agent Harness] Load History Failure',
  props<{ error: string }>(),
);

/** Sends a user message in the open conversation (the agent's primary session when none is open). */
export const sendAgentMessage = createAction(
  '[Agent Harness] Send Message',
  props<{ text: string; localId: string; createdAt: number }>(),
);

export const agentTurnEvent = createAction('[Agent Harness] Turn Event', props<{ event: AgentHarnessEvent }>());

export const agentTurnStreamFailure = createAction('[Agent Harness] Turn Stream Failure', props<{ error: string }>());

export const cancelAgentTurn = createAction('[Agent Harness] Cancel Turn');

export const resetAgentConversation = createAction('[Agent Harness] Reset Conversation');

export const clearAgentHarnessError = createAction('[Agent Harness] Clear Error');
