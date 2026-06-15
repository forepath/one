import type {
  AgentResponseObject,
  ChatMessageData,
  ForwardedEventPayload,
  TicketAutomationRunChatEventPayload,
} from '@forepath/agenstra/frontend/data-access-agent-console';

/** Matches `selectChatTimelineOrdered` rows (avoid importing selector here for Jest graph). */
export interface ChatTimelineOrderedRowLike {
  event: string;
  payload: unknown;
  timestamp: number;
  semanticTimestamp: number;
}

const TICKET_AUTOMATION_RUN_CHAT_UPSERT = 'ticketAutomationRunChatUpsert';

import {
  AGENT_CHAT_EVENT_KIND_LABELS,
  computeToolPairMergePlanFromIndices,
  isConcreteToolCallId,
  mergeAdjacentInteractionQueryDisplayRows,
  mergeAdjacentThinkingDisplayRows,
  mergeToolPairDisplayRows,
  toolPairOutcomeFromCallStatus,
  toolPairOutcomeToBadgeClass,
  type AgentChatEventDisplayRow,
} from './agent-chat-event-display';
import {
  extractInteractionQueryPreviewText,
  extractThinkingPreviewText,
  formatAgentResponseForChatMarkdown,
} from './agent-chat-response-markdown';

/** Mirrors chat.component `ChatMessageWithFilter` without importing the component. */
export type ChatMessageWithFilter = {
  event: string;
  payload: ForwardedEventPayload;
  timestamp: number;
  filterResult: {
    direction: 'incoming' | 'outgoing';
    status: 'allowed' | 'filtered' | 'dropped';
    matchedFilter?: {
      type: string;
      displayName: string;
      matched: boolean;
      reason?: string;
    };
  } | null;
};

export type ChatDisplayThreadItem =
  | { kind: 'user'; msg: ChatMessageWithFilter }
  | { kind: 'agentTurn'; msgs: ChatMessageWithFilter[]; view: AgentTurnView }
  | { kind: 'ticketAutomationRun'; sortTime: number; payload: TicketAutomationRunChatEventPayload };

/** Ordered slices of an agent turn: structured rows and prose markdown interleaved as produced. */
export type AgentTurnSegment =
  | { kind: 'row'; row: AgentChatEventDisplayRow }
  | { kind: 'markdown'; markdown: string; trackId: string };

export interface AgentTurnView {
  segments: AgentTurnSegment[];
  displayTimestamp: number;
  hasFiltered: boolean;
  hasDropped: boolean;
}

/** Exported for streaming preview: merge adjacent thinking row segments without crossing markdown blocks. */
export function consolidateThinkingInSegments(segments: AgentTurnSegment[]): AgentTurnSegment[] {
  const out: AgentTurnSegment[] = [];

  for (const seg of segments) {
    if (seg.kind !== 'row') {
      out.push(seg);
      continue;
    }

    const prev = out[out.length - 1];

    if (seg.row.kind === 'thinking' && prev?.kind === 'row' && prev.row.kind === 'thinking') {
      out[out.length - 1] = {
        kind: 'row',
        row: mergeAdjacentThinkingDisplayRows(prev.row, seg.row),
      };
    } else {
      out.push(seg);
    }
  }

  return out;
}

/** Merges consecutive `interactionQuery` row segments (chunked stream / history parts). */
export function consolidateInteractionQueriesInSegments(segments: AgentTurnSegment[]): AgentTurnSegment[] {
  const out: AgentTurnSegment[] = [];

  for (const seg of segments) {
    if (seg.kind !== 'row') {
      out.push(seg);
      continue;
    }

    const prev = out[out.length - 1];

    if (seg.row.kind === 'interactionQuery' && prev?.kind === 'row' && prev.row.kind === 'interactionQuery') {
      out[out.length - 1] = {
        kind: 'row',
        row: mergeAdjacentInteractionQueryDisplayRows(prev.row, seg.row),
      };
    } else {
      out.push(seg);
    }
  }

  return out;
}

export function consolidateToolPairsInSegments(segments: AgentTurnSegment[]): AgentTurnSegment[] {
  const { skip, mergedAt } = computeToolPairMergePlanFromIndices({
    length: segments.length,
    describe: (i) => {
      const s = segments[i];

      if (s === undefined) {
        return null;
      }

      if (s.kind !== 'row') {
        return null;
      }

      const r = s.row;

      if (!isConcreteToolCallId(r.toolCallId)) {
        return null;
      }

      const id = r.toolCallId;

      if (r.kind === 'toolCall') {
        return { id, role: 'call' as const };
      }

      if (r.kind === 'toolResult') {
        return { id, role: 'result' as const };
      }

      return null;
    },
    mergeAt: (callIndex, resultIndex) => {
      const callSeg = segments[callIndex];
      const resultSeg = segments[resultIndex];

      if (callSeg === undefined || resultSeg === undefined) {
        throw new Error('tool pair merge: missing segment');
      }

      if (callSeg.kind !== 'row' || resultSeg.kind !== 'row') {
        throw new Error('tool pair merge: expected row segments');
      }

      return mergeToolPairDisplayRows(callSeg.row, resultSeg.row);
    },
  });
  const out: AgentTurnSegment[] = [];

  for (let i = 0; i < segments.length; i++) {
    if (skip.has(i)) {
      const row = mergedAt.get(i);

      if (row) {
        out.push({ kind: 'row', row });
      }

      continue;
    }

    const seg = segments[i];

    if (seg !== undefined) {
      out.push(seg);
    }
  }

  return out;
}

export function consolidateAgentTurnSegments(segments: AgentTurnSegment[]): AgentTurnSegment[] {
  return consolidateToolPairsInSegments(
    consolidateInteractionQueriesInSegments(consolidateThinkingInSegments(segments)),
  );
}

function appendMarkdownToSegments(segments: AgentTurnSegment[], md: string, trackId: string): void {
  const trimmed = md.trim();

  if (!trimmed) {
    return;
  }

  const last = segments[segments.length - 1];

  if (last?.kind === 'markdown') {
    last.markdown = `${last.markdown}\n\n${trimmed}`;
  } else {
    segments.push({ kind: 'markdown', markdown: trimmed, trackId });
  }
}

function isUserPayload(payload: ForwardedEventPayload): boolean {
  if ('success' in payload && payload.success && 'data' in payload) {
    const data = payload.data as ChatMessageData;

    return 'from' in data && data.from === 'user';
  }

  return false;
}

function isAgentPayload(payload: ForwardedEventPayload): boolean {
  if ('success' in payload && payload.success && 'data' in payload) {
    const data = payload.data as ChatMessageData;

    return 'from' in data && data.from === 'agent';
  }

  return false;
}

function getChatMessageData(payload: ForwardedEventPayload): ChatMessageData | null {
  if ('success' in payload && payload.success && 'data' in payload) {
    return payload.data as ChatMessageData;
  }

  return null;
}

function previewString(value: string, maxChars: number): string {
  const t = value.replace(/\s+/g, ' ').trim();

  if (t.length <= maxChars) {
    return t;
  }

  return `${t.slice(0, maxChars - 1)}…`;
}

function previewUnknown(value: unknown, maxChars: number): string {
  if (value === undefined || value === null) {
    return '—';
  }

  if (typeof value === 'string') {
    return previewString(value, maxChars);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  try {
    return previewString(JSON.stringify(value), maxChars);
  } catch {
    return '[Unserializable]';
  }
}

/**
 * Maps a structured agent response object to a streaming-style timeline row, or null when it
 * should be rendered as assistant markdown instead.
 */
export function mapAgentResponseObjectToDisplayRow(
  r: AgentResponseObject,
  trackId: string,
  displayTimestampMs: number,
): AgentChatEventDisplayRow | null {
  const t = r.type;

  if (t === 'tool' || t === 'tool_call' || t === 'toolCall') {
    const name = typeof r['name'] === 'string' ? r['name'] : 'tool';
    const rawToolCallId = typeof r['toolCallId'] === 'string' ? r['toolCallId'] : undefined;
    const toolCallIdDisplay = rawToolCallId ?? '—';
    const status = typeof r['status'] === 'string' ? r['status'] : 'unknown';
    let summaryBody = `${status} · ${toolCallIdDisplay}`;
    const summaryTitle = name === 'enrichment' ? 'Enrichment' : `Tool call · ${name}`;

    if (r['args'] !== undefined) {
      summaryBody += ` · ${previewUnknown(r['args'], 160)}`;
    }

    const detailJson = JSON.stringify(r, null, 2);
    const outcome = toolPairOutcomeFromCallStatus(status);

    return {
      trackId,
      kind: 'toolCall',
      kindLabel: AGENT_CHAT_EVENT_KIND_LABELS.toolCall,
      summaryTitle,
      summaryBody,
      badgeClass: toolPairOutcomeToBadgeClass(outcome),
      detailJson,
      displayTimestampMs,
      ...(isConcreteToolCallId(rawToolCallId) ? { toolCallId: rawToolCallId } : {}),
      toolPair: {
        outcome,
        callDetailJson: detailJson,
      },
    };
  }

  if (t === 'tool_result' || t === 'toolResult') {
    const name = typeof r['name'] === 'string' ? r['name'] : 'tool';
    const rawToolCallId = typeof r['toolCallId'] === 'string' ? r['toolCallId'] : undefined;
    const toolCallIdDisplay = rawToolCallId ?? '—';
    const isError = Boolean(r['isError'] ?? r['is_error']);
    const summaryTitle = name === 'enrichment' ? 'Enrichment result' : `Tool result · ${name}`;
    const detailJson = JSON.stringify(r, null, 2);
    const outcome = isError ? 'error' : 'success';

    return {
      trackId,
      kind: 'toolResult',
      kindLabel: AGENT_CHAT_EVENT_KIND_LABELS.toolResult,
      summaryTitle,
      summaryBody: `${isError ? 'Failed' : 'Success'} · ${toolCallIdDisplay} · ${previewUnknown(r['result'], 200)}`,
      badgeClass: toolPairOutcomeToBadgeClass(outcome),
      detailJson,
      displayTimestampMs,
      ...(isConcreteToolCallId(rawToolCallId) ? { toolCallId: rawToolCallId } : {}),
      toolPair: {
        outcome,
        resultDetailJson: detailJson,
      },
    };
  }

  if (t === 'question') {
    const prompt = typeof r['prompt'] === 'string' ? r['prompt'] : '';
    const qid = typeof r['questionId'] === 'string' ? r['questionId'] : '';

    return {
      trackId,
      kind: 'question',
      kindLabel: AGENT_CHAT_EVENT_KIND_LABELS.question,
      summaryTitle: 'Question',
      summaryBody: [qid ? `#${qid}` : '', previewString(prompt, 200)].filter(Boolean).join(' · '),
      badgeClass: 'bg-primary',
      detailJson: JSON.stringify(r, null, 2),
      displayTimestampMs,
    };
  }

  if (t === 'error' || r.is_error === true) {
    const message = typeof r['message'] === 'string' ? r['message'] : 'Error';
    const code = typeof r['code'] === 'string' ? r['code'] : '';

    return {
      trackId,
      kind: 'error',
      kindLabel: AGENT_CHAT_EVENT_KIND_LABELS.error,
      summaryTitle: code ? `Error (${code})` : 'Error',
      summaryBody: previewString(message, 200),
      badgeClass: 'bg-danger',
      detailJson: JSON.stringify(r, null, 2),
      displayTimestampMs,
    };
  }

  if (t === 'thinking') {
    const preview = extractThinkingPreviewText(r);

    return {
      trackId,
      kind: 'thinking',
      kindLabel: AGENT_CHAT_EVENT_KIND_LABELS.thinking,
      summaryTitle: 'Thinking',
      summaryBody: preview ? previewString(preview, 220) : '…',
      badgeClass: 'bg-light text-dark border',
      detailJson: JSON.stringify(r, null, 2),
      ...(preview.trim().length > 0 ? { popoverPlainDetail: preview } : {}),
      displayTimestampMs,
    };
  }

  if (t === 'interaction_query' || t === 'interactionQuery') {
    const preview = extractInteractionQueryPreviewText(r);

    return {
      trackId,
      kind: 'interactionQuery',
      kindLabel: AGENT_CHAT_EVENT_KIND_LABELS.interactionQuery,
      summaryTitle: $localize`:@@featureChat-agentEventSummaryInteractionQuery:Query`,
      summaryBody: preview ? previewString(preview, 220) : '…',
      badgeClass: 'bg-light text-dark border',
      detailJson: JSON.stringify(r, null, 2),
      ...(preview.trim().length > 0 ? { popoverPlainDetail: preview } : {}),
      displayTimestampMs,
    };
  }

  return null;
}

function isMessageDropped(messageData: ChatMessageData): boolean {
  if (!('response' in messageData)) {
    return false;
  }

  const r = messageData.response;

  if (typeof r !== 'object' || r === null) {
    return false;
  }

  const o = r as AgentResponseObject;

  return (
    o.type === 'error' &&
    (o['result'] === 'MESSAGE_DROPPED' || String(o['message'] ?? '').includes('Message was dropped'))
  );
}

function buildViewFromParts(parts: AgentResponseObject[], baseTimestamp: number): AgentTurnView {
  const segments: AgentTurnSegment[] = [];
  let i = 0;

  for (const part of parts) {
    if (part.type === 'delta') {
      continue;
    }

    const row = mapAgentResponseObjectToDisplayRow(part, `part-${baseTimestamp}-${i}`, baseTimestamp);

    if (row) {
      segments.push({ kind: 'row', row });
    } else {
      const md = formatAgentResponseForChatMarkdown(part);

      appendMarkdownToSegments(segments, md, `md-${baseTimestamp}-${i}`);
    }

    i += 1;
  }

  return {
    segments: consolidateAgentTurnSegments(segments),
    displayTimestamp: baseTimestamp,
    hasFiltered: false,
    hasDropped: false,
  };
}

export function buildAgentTurnView(msgs: ChatMessageWithFilter[]): AgentTurnView {
  if (msgs.length === 0) {
    return {
      segments: [],
      displayTimestamp: Date.now(),
      hasFiltered: false,
      hasDropped: false,
    };
  }

  const hasFiltered = msgs.some((m) => m.filterResult?.status === 'filtered');
  const hasDropped = msgs.some((m) => {
    const d = getChatMessageData(m.payload);

    return d ? isMessageDropped(d) : false;
  });

  if (msgs.length === 1) {
    const data = getChatMessageData(msgs[0].payload);

    if (data && 'response' in data) {
      const r = data.response;

      if (typeof r === 'object' && r !== null && r['type'] === 'agenstra_turn' && Array.isArray(r['parts'])) {
        const view = buildViewFromParts(r['parts'] as AgentResponseObject[], msgs[0].timestamp);

        return { ...view, hasFiltered, hasDropped };
      }
    }
  }

  const segments: AgentTurnSegment[] = [];
  let idx = 0;

  for (const msg of msgs) {
    const data = getChatMessageData(msg.payload);

    if (!data || !('response' in data)) {
      continue;
    }

    const r = data.response;

    if (typeof r === 'string') {
      const md = formatAgentResponseForChatMarkdown(r);

      appendMarkdownToSegments(segments, md, `md-${msg.timestamp}-${idx}`);
    } else {
      const row = mapAgentResponseObjectToDisplayRow(r, `m-${msg.timestamp}-${idx}`, msg.timestamp);

      if (row) {
        segments.push({ kind: 'row', row });
      } else {
        const md = formatAgentResponseForChatMarkdown(r);

        appendMarkdownToSegments(segments, md, `md-${msg.timestamp}-${idx}`);
      }
    }

    idx += 1;
  }

  const displayTimestamp = msgs[msgs.length - 1]?.timestamp ?? Date.now();

  return {
    segments: consolidateAgentTurnSegments(segments),
    displayTimestamp,
    hasFiltered,
    hasDropped,
  };
}

export function buildChatDisplayThread(messages: ChatMessageWithFilter[]): ChatDisplayThreadItem[] {
  const out: ChatDisplayThreadItem[] = [];
  let agentRun: ChatMessageWithFilter[] = [];
  const flushAgent = (): void => {
    if (agentRun.length === 0) {
      return;
    }

    const view = buildAgentTurnView(agentRun);

    out.push({ kind: 'agentTurn', msgs: [...agentRun], view });
    agentRun = [];
  };

  for (const msg of messages) {
    if (isUserPayload(msg.payload)) {
      flushAgent();
      out.push({ kind: 'user', msg });
    } else if (isAgentPayload(msg.payload)) {
      agentRun.push(msg);
    }
  }

  flushAgent();

  return out;
}

/**
 * Merges ordered chat + automation timeline rows into display items (automation rows break agent turns).
 */
export function buildMergedChatDisplayThread(
  orderedRows: ChatTimelineOrderedRowLike[],
  filteredChatMessages: ChatMessageWithFilter[],
): ChatDisplayThreadItem[] {
  const resolveChatRow = (row: ChatTimelineOrderedRowLike): ChatMessageWithFilter | null => {
    const hit = filteredChatMessages.find((m) => m.payload === row.payload && m.timestamp === row.timestamp);

    if (hit) {
      return hit;
    }

    if (row.event !== 'chatMessage') {
      return null;
    }

    return {
      event: row.event,
      payload: row.payload as ForwardedEventPayload,
      timestamp: row.timestamp,
      filterResult: null,
    };
  };
  const out: ChatDisplayThreadItem[] = [];
  let agentRun: ChatMessageWithFilter[] = [];
  const flushAgent = (): void => {
    if (agentRun.length === 0) {
      return;
    }

    const view = buildAgentTurnView(agentRun);

    out.push({ kind: 'agentTurn', msgs: [...agentRun], view });
    agentRun = [];
  };

  for (const row of orderedRows) {
    if (row.event === TICKET_AUTOMATION_RUN_CHAT_UPSERT) {
      flushAgent();
      const payload = row.payload as TicketAutomationRunChatEventPayload;

      out.push({ kind: 'ticketAutomationRun', sortTime: row.semanticTimestamp, payload });
      continue;
    }

    if (row.event !== 'chatMessage') {
      continue;
    }

    const msg = resolveChatRow(row);

    if (!msg) {
      continue;
    }

    if (isUserPayload(msg.payload)) {
      flushAgent();
      out.push({ kind: 'user', msg });
    } else if (isAgentPayload(msg.payload)) {
      agentRun.push(msg);
    }
  }

  flushAgent();

  return out;
}
