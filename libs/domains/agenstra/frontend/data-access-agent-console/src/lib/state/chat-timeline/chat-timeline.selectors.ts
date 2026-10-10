import { createFeatureSelector, createSelector } from '@ngrx/store';

import { getClientAgentKey } from '../chat-sessions/chat-sessions.reducer';
import { selectChatSessionsMap, selectSelectedChatIdsMap } from '../chat-sessions/chat-sessions.selectors';
import { CLIENT_CHAT_AUTOMATION_SOCKET_EVENT } from '../container-socket/client-chat-automation.constants';
import { CLIENT_CHAT_PLAN_SOCKET_EVENT } from '../container-socket/client-chat-plan.constants';
import { selectSelectedAgentId, selectSelectedClientId } from '../container-socket/container-socket.selectors';
import type {
  ChatMessageData,
  ChatPlanChatEventPayload,
  ChatPlanStatus,
  TicketAutomationRunChatEventPayload,
} from '../container-socket/container-socket.types';

import type { ChatTimelineState } from './chat-timeline.reducer';

export const selectChatTimelineState = createFeatureSelector<ChatTimelineState>('chatTimeline');

export const selectChatTimelineMessages = createSelector(selectChatTimelineState, (state) => state.messages);

export const selectChatTimelineEvents = createSelector(selectChatTimelineState, (state) => state.events);

export const selectMessageFilterResults = createSelector(selectChatTimelineState, (state) => state.filterResults);

export const selectChatTimelineAutomations = createSelector(selectChatTimelineState, (state) => state.automations);

export const selectChatTimelinePlans = createSelector(selectChatTimelineState, (state) => state.plans);

export const selectHasMoreOlder = createSelector(selectChatTimelineState, (state) => state.hasMoreOlder);

export const selectOldestMessageId = createSelector(selectChatTimelineState, (state) => state.oldestMessageId);

export const selectLoadingInitial = createSelector(selectChatTimelineState, (state) => state.loadingInitial);

export const selectLoadingOlder = createSelector(selectChatTimelineState, (state) => state.loadingOlder);

export const selectChatTimelineError = createSelector(selectChatTimelineState, (state) => state.error);

export const selectChatEnhancementPending = createSelector(
  selectChatTimelineState,
  (state) => state.chatEnhancementPendingCorrelationId !== null,
);

export const selectChatEnhancementLastResult = createSelector(
  selectChatTimelineState,
  (state) => state.chatEnhancementLastResult,
);

export const selectTicketBodyGenerationPending = createSelector(
  selectChatTimelineState,
  (state) => state.ticketBodyPendingCorrelationId !== null,
);

export const selectTicketBodyLastResult = createSelector(
  selectChatTimelineState,
  (state) => state.ticketBodyLastResult,
);

/** Statuses that block creating another plan (and disable the plan toolbar button). */
export const CHAT_PLAN_BUSY_STATUSES: readonly ChatPlanStatus[] = ['pending', 'exploring', 'refining', 'executing'];

export type ChatTimelineOrderedRow = {
  event: string;
  payload: import('../container-socket/container-socket.types').ForwardedEventPayload;
  timestamp: number;
  semanticTimestamp: number;
  chatId?: string;
};

function semanticSortKey(row: { event: string; payload: unknown; timestamp: number }): number {
  if (row.event === 'chatMessage' && row.payload && typeof row.payload === 'object' && 'success' in row.payload) {
    const envelope = row.payload as { success?: boolean; data?: ChatMessageData };

    if (envelope.success && envelope.data?.timestamp) {
      const t = Date.parse(envelope.data.timestamp);

      if (!Number.isNaN(t)) {
        return t;
      }
    }
  }

  if (row.event === CLIENT_CHAT_AUTOMATION_SOCKET_EVENT) {
    const p = row.payload as TicketAutomationRunChatEventPayload | undefined;

    if (p?.timelineAt) {
      const t = Date.parse(p.timelineAt);

      if (!Number.isNaN(t)) {
        return t;
      }
    }
  }

  if (row.event === CLIENT_CHAT_PLAN_SOCKET_EVENT) {
    const p = row.payload as ChatPlanChatEventPayload | undefined;

    if (p?.timelineAt) {
      const t = Date.parse(p.timelineAt);

      if (!Number.isNaN(t)) {
        return t;
      }
    }
  }

  return row.timestamp;
}

/**
 * Chat messages merged with ticket automation + chat plan cards, ordered by semantic time.
 * Automation rows are deduped by `run.id` (latest `timelineAt` wins). Filtered to `run.agentId === selectedAgentId`
 * when an agent is selected, and shown only on the primary chat session (main thread).
 * Plan rows are deduped by `plan.id`, filtered to matching agent, and shown when `plan.chatId === selectedChatId`.
 * Chat messages are filtered to the selected chat session when a chatId is selected and present on the message.
 */
export const selectChatTimelineOrdered = createSelector(
  selectChatTimelineMessages,
  selectChatTimelineAutomations,
  selectChatTimelinePlans,
  selectSelectedAgentId,
  selectSelectedClientId,
  selectSelectedChatIdsMap,
  selectChatSessionsMap,
  (
    messages,
    automations,
    plans,
    selectedAgentId,
    selectedClientId,
    selectedChatIds,
    sessionsMap,
  ): ChatTimelineOrderedRow[] => {
    const agentKey = selectedClientId && selectedAgentId ? getClientAgentKey(selectedClientId, selectedAgentId) : null;
    const selectedChatId = agentKey ? (selectedChatIds[agentKey] ?? null) : null;
    const sessions = agentKey ? (sessionsMap[agentKey] ?? null) : null;
    const primaryChatId = sessions?.find((session) => session.kind === 'primary')?.id ?? null;
    const showAutomationCards = !selectedChatId || (!!primaryChatId && selectedChatId === primaryChatId);
    const chatMsgs = messages.filter((e) => {
      if (!selectedChatId) {
        return true;
      }

      const rowChatId =
        e.chatId ??
        (e.payload &&
          typeof e.payload === 'object' &&
          'success' in e.payload &&
          e.payload.success &&
          (e.payload as { data?: ChatMessageData }).data?.chatId);

      return rowChatId === selectedChatId;
    });
    const rawAuto = showAutomationCards ? automations : [];
    const byRun = new Map<string, (typeof automations)[0]>();

    for (const e of rawAuto) {
      const run = (e.payload as TicketAutomationRunChatEventPayload | undefined)?.run;

      if (!run?.id || !run.agentId) {
        continue;
      }

      if (selectedAgentId && run.agentId !== selectedAgentId) {
        continue;
      }

      const prev = byRun.get(run.id);

      if (!prev) {
        byRun.set(run.id, e);
        continue;
      }

      const prevT = semanticSortKey(prev);
      const curT = semanticSortKey(e);

      if (curT >= prevT) {
        byRun.set(run.id, e);
      }
    }

    const byPlan = new Map<string, (typeof plans)[0]>();

    for (const e of plans) {
      const plan = (e.payload as ChatPlanChatEventPayload | undefined)?.plan;

      if (!plan?.id || !plan.agentId || !plan.chatId) {
        continue;
      }

      if (selectedAgentId && plan.agentId !== selectedAgentId) {
        continue;
      }

      if (selectedChatId && plan.chatId !== selectedChatId) {
        continue;
      }

      const prev = byPlan.get(plan.id);

      if (!prev) {
        byPlan.set(plan.id, e);
        continue;
      }

      const prevT = semanticSortKey(prev);
      const curT = semanticSortKey(e);

      if (curT >= prevT) {
        byPlan.set(plan.id, e);
      }
    }

    const automationRows = [...byRun.values()];
    const planRows = [...byPlan.values()];
    const merged: ChatTimelineOrderedRow[] = [...chatMsgs, ...automationRows, ...planRows].map((e) => ({
      event: e.event,
      payload: e.payload,
      timestamp: e.timestamp,
      chatId: 'chatId' in e ? e.chatId : undefined,
      semanticTimestamp: semanticSortKey(e),
    }));

    merged.sort((a, b) => a.semanticTimestamp - b.semanticTimestamp || a.timestamp - b.timestamp);

    return merged;
  },
);

/**
 * True when the selected chat already has a busy plan (pending/exploring/refining/executing)
 * for the selected agent — used to disable the plan toolbar button.
 */
export const selectChatPlanBusyForSelectedChat = createSelector(
  selectChatTimelinePlans,
  selectSelectedAgentId,
  selectSelectedClientId,
  selectSelectedChatIdsMap,
  (plans, selectedAgentId, selectedClientId, selectedChatIds): boolean => {
    const agentKey = selectedClientId && selectedAgentId ? getClientAgentKey(selectedClientId, selectedAgentId) : null;
    const selectedChatId = agentKey ? (selectedChatIds[agentKey] ?? null) : null;

    if (!selectedAgentId || !selectedChatId) {
      return false;
    }

    return plans.some((row) => {
      const plan = row.payload.plan;

      return (
        plan.agentId === selectedAgentId &&
        plan.chatId === selectedChatId &&
        CHAT_PLAN_BUSY_STATUSES.includes(plan.status)
      );
    });
  },
);
