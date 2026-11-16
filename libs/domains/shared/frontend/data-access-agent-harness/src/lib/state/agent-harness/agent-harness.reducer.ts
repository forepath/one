import type { AgentHarnessConversationItem } from '@forepath/shared/shared/util-agent-harness';
import { createReducer, on } from '@ngrx/store';

import type {
  AgentActivity,
  AgentChatMessage,
  AgentChatToolCall,
  AgentChatTurnSummary,
} from '../../types/agent-chat.types';

import {
  agentTurnEvent,
  agentTurnStreamFailure,
  cancelAgentTurn,
  clearAgentHarnessError,
  createAgentConversation,
  createAgentConversationFailure,
  createAgentConversationSuccess,
  loadAgentConversationHistoryFailure,
  loadAgentConversationHistorySuccess,
  openAgentConversation,
  resetAgentConversation,
  sendAgentMessage,
} from './agent-harness.actions';

export const AGENT_HARNESS_FEATURE_KEY = 'agentHarness';

export interface AgentHarnessState {
  /** `conv_…` id of the open conversation; null: the agent's primary session (until the first turn reports it). */
  conversationId: string | null;
  messages: AgentChatMessage[];
  /** A turn is running (input should be disabled). */
  sending: boolean;
  /** Client tool calls of the running / last turn. */
  toolCalls: AgentChatToolCall[];
  /** The agent's own workspace tool calls of the running / last turn (when tool activity is enabled). */
  activity: AgentActivity[];
  lastTurn: AgentChatTurnSummary | null;
  loading: boolean;
  creating: boolean;
  error: string | null;
}

export const initialAgentHarnessState: AgentHarnessState = {
  conversationId: null,
  messages: [],
  sending: false,
  toolCalls: [],
  activity: [],
  lastTurn: null,
  loading: false,
  creating: false,
  error: null,
};

const STREAMING_ID = 'assistant-streaming';

function itemText(item: AgentHarnessConversationItem): string {
  return item.content.map((part) => part.text).join('');
}

function toMessage(item: AgentHarnessConversationItem): AgentChatMessage {
  return {
    id: item.id,
    role: item.role,
    text: itemText(item),
    status: item.status === 'incomplete' ? 'incomplete' : 'completed',
    createdAt: item.created_at,
  };
}

function upsertAssistant(
  messages: AgentChatMessage[],
  update: (current: AgentChatMessage) => AgentChatMessage,
): AgentChatMessage[] {
  const index = messages.findIndex((message) => message.id === STREAMING_ID);

  if (index >= 0) {
    return messages.map((message, i) => (i === index ? update(message) : message));
  }

  return [
    ...messages,
    update({
      id: STREAMING_ID,
      role: 'assistant',
      text: '',
      status: 'streaming',
      createdAt: Math.floor(Date.now() / 1000),
    }),
  ];
}

function finalizeAssistant(messages: AgentChatMessage[], id: string): AgentChatMessage[] {
  return messages.map((message) => (message.id === STREAMING_ID ? { ...message, id } : message));
}

export const agentHarnessReducer = createReducer(
  initialAgentHarnessState,
  on(createAgentConversation, (state) => ({ ...state, creating: true, error: null })),
  on(createAgentConversationSuccess, (state, { conversation }) => ({
    ...initialAgentHarnessState,
    conversationId: conversation.id,
  })),
  on(createAgentConversationFailure, (state, { error }) => ({ ...state, creating: false, error })),
  on(openAgentConversation, (state, { conversationId }) => ({
    ...initialAgentHarnessState,
    conversationId,
    loading: true,
  })),
  on(loadAgentConversationHistorySuccess, (state, { conversationId, items }) =>
    state.conversationId === conversationId ? { ...state, loading: false, messages: items.map(toMessage) } : state,
  ),
  on(loadAgentConversationHistoryFailure, (state, { error }) => ({ ...state, loading: false, error })),
  on(sendAgentMessage, (state, { text, localId, createdAt }) => ({
    ...state,
    sending: true,
    error: null,
    toolCalls: [],
    activity: [],
    messages: [...state.messages, { id: localId, role: 'user' as const, text, status: 'pending' as const, createdAt }],
  })),
  on(agentTurnEvent, (state, { event }) => {
    switch (event.type) {
      case 'turn.started':
        return {
          ...state,
          conversationId: state.conversationId ?? event.conversationId,
          messages: state.messages.map((message) =>
            message.status === 'pending' && message.role === 'user'
              ? { ...message, status: 'completed' as const }
              : message,
          ),
        };
      case 'text.delta':
        return {
          ...state,
          messages: upsertAssistant(state.messages, (message) => ({ ...message, text: message.text + event.delta })),
        };
      case 'text.done':
        return {
          ...state,
          messages: upsertAssistant(state.messages, (message) => ({ ...message, text: event.text })),
        };

      case 'agent.activity': {
        const others = state.activity.filter((entry) => entry.id !== event.activity.id);

        return { ...state, activity: [...others, event.activity] };
      }

      case 'tool.call':
        return {
          ...state,
          toolCalls: [
            ...state.toolCalls,
            { callId: event.call.callId, name: event.call.name, status: 'running' as const },
          ],
        };
      case 'tool.result':
        return {
          ...state,
          toolCalls: state.toolCalls.map((call) =>
            call.callId === event.result.callId
              ? {
                  ...call,
                  status: event.result.status,
                  ...(event.result.error ? { error: event.result.error.message } : {}),
                }
              : call,
          ),
        };
      case 'turn.completed':
        return {
          ...state,
          sending: false,
          conversationId: state.conversationId ?? event.result.conversationId,
          lastTurn: {
            rounds: event.result.rounds,
            usage: event.result.usage,
            toolCalls: event.result.toolCalls.length,
          },
          messages: finalizeAssistant(
            upsertAssistant(state.messages, (message) => ({
              ...message,
              text: event.result.text,
              status: event.result.status,
            })),
            `assistant-${event.result.responseId ?? Date.now()}`,
          ),
        };
      case 'turn.failed':
        return failTurn(state, event.error.message);
      default:
        return state;
    }
  }),
  on(agentTurnStreamFailure, (state, { error }) => failTurn(state, error)),
  on(cancelAgentTurn, (state) =>
    state.sending
      ? {
          ...state,
          sending: false,
          messages: finalizeAssistant(
            state.messages.map((message) =>
              message.id === STREAMING_ID ? { ...message, status: 'incomplete' as const } : message,
            ),
            `assistant-cancelled-${Date.now()}`,
          ),
        }
      : state,
  ),
  on(resetAgentConversation, () => initialAgentHarnessState),
  on(clearAgentHarnessError, (state) => ({ ...state, error: null })),
);

function failTurn(state: AgentHarnessState, error: string): AgentHarnessState {
  return {
    ...state,
    sending: false,
    error,
    messages: finalizeAssistant(
      state.messages.map((message) => {
        if (message.id === STREAMING_ID) {
          return { ...message, status: 'failed' as const };
        }

        return message.status === 'pending' ? { ...message, status: 'failed' as const } : message;
      }),
      `assistant-failed-${Date.now()}`,
    ),
  };
}
