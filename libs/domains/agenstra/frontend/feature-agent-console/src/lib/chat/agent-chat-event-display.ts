import type {
  AgentEventEnvelope,
  AgentEventKind,
  AgentResponseObject,
  SuccessResponse,
} from '@forepath/agenstra/frontend/data-access-agent-console';

import { extractInteractionQueryPreviewText, extractThinkingPreviewText } from './agent-chat-response-markdown';

/** One row in the structured agent-event list (decoded from websocket `chatEvent`). */
export interface AgentChatEventDisplayRow {
  /** Stable unique id for Angular `@for` track */
  trackId: string;
  kind: AgentEventKind;
  /** Short label for the badge */
  kindLabel: string;
  /** Primary summary line */
  summaryTitle: string;
  /** Secondary line (preview, ids, status) */
  summaryBody: string;
  /** Bootstrap contextual badge class (without `text-*` unless needed) */
  badgeClass: string;
  /** Pretty-printed JSON for the full envelope (expandable details) */
  detailJson: string;
  /**
   * When set, the details popover shows this plain text instead of `detailJson`
   * (e.g. full thinking text vs raw structured payloads).
   */
  popoverPlainDetail?: string;
  /** Time derived from envelope `timestamp` (fallback: socket receive time) */
  displayTimestampMs: number;
  /** Correlates `toolCall` / `toolResult` envelopes for pairing. */
  toolCallId?: string;
  /**
   * When set, the row shows paired tool call/result popovers (instead of a single details icon).
   */
  toolPair?: AgentChatToolPairView;
}

/** Outcome for a tool invocation/result pair (drives badge + secondary affordances). */
export type AgentChatToolPairOutcome = 'pending' | 'success' | 'error';

export interface AgentChatToolPairView {
  outcome: AgentChatToolPairOutcome;
  /** JSON for the tool call (invocation); omit when only a stray `toolResult` exists. */
  callDetailJson?: string;
  /** JSON for the tool result once available. */
  resultDetailJson?: string;
}

/** Short badge labels for structured `AgentEventKind` rows (i18n). */
export const AGENT_CHAT_EVENT_KIND_LABELS: Record<AgentEventKind, string> = {
  userMessage: $localize`:@@featureChat-agentEventKindUser:User`,
  thinking: $localize`:@@featureChat-agentEventKindThinking:Thinking`,
  interactionQuery: $localize`:@@featureChat-agentEventKindInteractionQuery:Interaction`,
  assistantDelta: $localize`:@@featureChat-agentEventKindDelta:Delta`,
  assistantMessage: $localize`:@@featureChat-agentEventKindAssistant:Assistant`,
  toolCall: $localize`:@@featureChat-agentEventKindTool:Tool`,
  toolResult: $localize`:@@featureChat-agentEventKindResult:Result`,
  question: $localize`:@@featureChat-agentEventKindQuestion:Question`,
  status: $localize`:@@featureChat-agentEventKindStatus:Status`,
  error: $localize`:@@featureChat-agentEventKindError:Error`,
};

export function agentChatEventKindLabel(kind: AgentEventKind): string {
  return AGENT_CHAT_EVENT_KIND_LABELS[kind] ?? kind;
}

function previewString(value: string, maxChars: number): string {
  const t = value.replace(/\s+/g, ' ').trim();

  if (t.length <= maxChars) {
    return t;
  }

  return `${t.slice(0, maxChars - 1)}…`;
}

/** `toolCallId` placeholders must not pair-merge (would collapse unrelated rows). */
export function isConcreteToolCallId(id: string | undefined): id is string {
  return id !== undefined && id.length > 0 && id !== '—';
}

export function toolPairOutcomeFromCallStatus(status: string): AgentChatToolPairOutcome {
  const s = status.toLowerCase();

  if (s === 'failed' || s === 'error' || s.includes('fail') || s === 'cancelled') {
    return 'error';
  }

  return 'pending';
}

export function toolPairOutcomeToBadgeClass(outcome: AgentChatToolPairOutcome): string {
  switch (outcome) {
    case 'pending':
      return 'text-bg-info';
    case 'success':
      return 'text-bg-success';
    case 'error':
      return 'text-bg-warning';
  }
}

export function parseToolResultIsErrorFromDisplayDetail(detailJson: string): boolean {
  try {
    const o = JSON.parse(detailJson) as Record<string, unknown>;

    if (typeof o['isError'] === 'boolean') {
      return o['isError'];
    }

    if (typeof o['is_error'] === 'boolean') {
      return o['is_error'];
    }

    const payload = o['payload'];

    if (payload && typeof payload === 'object') {
      const p = payload as Record<string, unknown>;

      if (typeof p['isError'] === 'boolean') {
        return p['isError'];
      }
    }
  } catch {
    return false;
  }

  return false;
}

/**
 * Merges a `toolCall` row with the following `toolResult` row for the same `toolCallId`.
 */
export function mergeToolPairDisplayRows(
  callRow: AgentChatEventDisplayRow,
  resultRow: AgentChatEventDisplayRow,
): AgentChatEventDisplayRow {
  const err = parseToolResultIsErrorFromDisplayDetail(resultRow.detailJson);
  const outcome: AgentChatToolPairOutcome = err ? 'error' : 'success';
  const callDetail = (callRow.toolPair?.callDetailJson ?? callRow.detailJson).trim();
  const resultDetail = (resultRow.toolPair?.resultDetailJson ?? resultRow.detailJson).trim();

  return {
    ...callRow,
    kind: 'toolCall',
    kindLabel: AGENT_CHAT_EVENT_KIND_LABELS.toolCall,
    summaryTitle: callRow.summaryTitle,
    summaryBody: `${callRow.summaryBody} → ${resultRow.summaryBody}`,
    badgeClass: toolPairOutcomeToBadgeClass(outcome),
    detailJson: `${callDetail}\n\n---\n\n${resultDetail}`,
    toolCallId: callRow.toolCallId,
    toolPair: {
      outcome,
      callDetailJson: callDetail.length > 0 ? callDetail : undefined,
      resultDetailJson: resultDetail.length > 0 ? resultDetail : undefined,
    },
    popoverPlainDetail: undefined,
  };
}

export interface ToolPairMergeSlot {
  id: string;
  role: 'call' | 'result';
}

/**
 * FIFO-pairs `toolCall` / `toolResult` at given indices by shared concrete `toolCallId`, even when
 * other items (e.g. markdown, status) appear between them. The merged row is emitted at the earlier index.
 */
export function computeToolPairMergePlanFromIndices(options: {
  length: number;
  describe: (index: number) => ToolPairMergeSlot | null;
  mergeAt: (callIndex: number, resultIndex: number) => AgentChatEventDisplayRow;
}): { skip: Set<number>; mergedAt: Map<number, AgentChatEventDisplayRow> } {
  const callsById = new Map<string, number[]>();
  const resultsById = new Map<string, number[]>();

  for (let i = 0; i < options.length; i++) {
    const slot = options.describe(i);

    if (!slot) {
      continue;
    }

    const bucket = slot.role === 'call' ? callsById : resultsById;
    let list = bucket.get(slot.id);

    if (list === undefined) {
      list = [];
      bucket.set(slot.id, list);
    }

    list.push(i);
  }

  const skip = new Set<number>();
  const mergedAt = new Map<number, AgentChatEventDisplayRow>();

  for (const [pairId, callIdxs] of callsById) {
    const resIdxs = resultsById.get(pairId) ?? [];

    for (let p = 0; p < callIdxs.length && p < resIdxs.length; p++) {
      const callIndex = callIdxs[p];
      const resultIndex = resIdxs[p];

      if (callIndex === undefined || resultIndex === undefined) {
        continue;
      }

      mergedAt.set(Math.min(callIndex, resultIndex), options.mergeAt(callIndex, resultIndex));
      skip.add(callIndex);
      skip.add(resultIndex);
    }
  }

  return { skip, mergedAt };
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

function parseEnvelopeTimestamp(iso: string, fallbackMs: number): number {
  const parsed = Date.parse(iso);

  return Number.isFinite(parsed) ? parsed : fallbackMs;
}

function isChatEventSuccess(payload: unknown): payload is SuccessResponse<AgentEventEnvelope> {
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  const p = payload as Record<string, unknown>;

  if (p['success'] !== true) {
    return false;
  }

  const data = p['data'];

  if (!data || typeof data !== 'object') {
    return false;
  }

  const d = data as Record<string, unknown>;

  return typeof d['eventId'] === 'string' && typeof d['kind'] === 'string';
}

/** Parsed `chatEvent` success envelope, or null if the payload is not a valid structured event. */
export function tryParseChatEventEnvelope(payload: unknown): AgentEventEnvelope | null {
  if (!isChatEventSuccess(payload)) {
    return null;
  }

  return payload.data;
}

function formatDetail(envelope: AgentEventEnvelope): string {
  try {
    return JSON.stringify(envelope, null, 2);
  } catch {
    return String(envelope);
  }
}

function summarizeEnvelope(
  envelope: AgentEventEnvelope,
): Omit<AgentChatEventDisplayRow, 'detailJson' | 'trackId' | 'displayTimestampMs'> {
  const kind = envelope.kind;
  const payload = envelope.payload;
  const kindLabel = agentChatEventKindLabel(kind);
  let summaryTitle = kindLabel;
  let summaryBody = '';
  let badgeClass = 'bg-secondary';

  switch (kind) {
    case 'userMessage': {
      const text = typeof (payload as { text?: unknown }).text === 'string' ? (payload as { text: string }).text : '';

      summaryTitle = $localize`:@@featureChat-agentEventSummaryUserMessage:User message`;
      summaryBody = previewString(text, 200);
      badgeClass = 'bg-secondary';
      break;
    }

    case 'thinking': {
      const phase =
        typeof (payload as { phase?: unknown }).phase === 'string' ? (payload as { phase: string }).phase.trim() : '';

      summaryTitle = $localize`:@@featureChat-agentEventSummaryThinking:Agent is thinking`;
      summaryBody = phase ? previewString(phase, 120) : 'Waiting for the first response…';
      badgeClass = 'bg-light text-dark border';
      break;
    }

    case 'interactionQuery': {
      const preview = extractInteractionQueryPreviewText({
        type: 'interaction_query',
        ...(payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}),
      } as AgentResponseObject);

      summaryTitle = $localize`:@@featureChat-agentEventSummaryInteractionQuery:Query`;
      summaryBody = preview ? previewString(preview, 120) : 'Waiting for the first response…';
      badgeClass = 'bg-light text-dark border';
      break;
    }

    case 'assistantDelta': {
      const delta =
        typeof (payload as { delta?: unknown }).delta === 'string' ? (payload as { delta: string }).delta : '';

      summaryTitle = $localize`:@@featureChat-agentEventSummaryAssistantStreaming:Assistant (streaming)`;
      summaryBody = previewString(delta, 220);
      badgeClass = 'bg-info';
      break;
    }

    case 'assistantMessage': {
      const text = typeof (payload as { text?: unknown }).text === 'string' ? (payload as { text: string }).text : '';

      summaryTitle = $localize`:@@featureChat-agentEventSummaryAssistantMessage:Assistant message`;
      summaryBody = previewString(text, 220);
      badgeClass = 'bg-primary';
      break;
    }

    case 'toolCall': {
      const p = payload as {
        toolCallId?: unknown;
        name?: unknown;
        args?: unknown;
        status?: unknown;
      };
      const name = typeof p.name === 'string' ? p.name : 'tool';
      const toolCallId = typeof p.toolCallId === 'string' ? p.toolCallId : '—';
      const status = typeof p.status === 'string' ? p.status : 'unknown';

      summaryTitle =
        name === 'enrichment'
          ? $localize`:@@featureChat-agentEventSummaryEnrichment:Enrichment`
          : $localize`:@@featureChat-agentEventSummaryToolCall:Tool call · ${name}:toolName:`;
      summaryBody = `${status} · ${toolCallId}`;

      if (p.args !== undefined) {
        summaryBody += ` · ${previewUnknown(p.args, 160)}`;
      }

      badgeClass = toolPairOutcomeToBadgeClass(toolPairOutcomeFromCallStatus(status));
      break;
    }

    case 'toolResult': {
      const p = payload as {
        toolCallId?: unknown;
        name?: unknown;
        result?: unknown;
        isError?: unknown;
      };
      const name = typeof p.name === 'string' ? p.name : 'tool';
      const toolCallId = typeof p.toolCallId === 'string' ? p.toolCallId : '—';
      const isError = Boolean(p.isError);

      summaryTitle =
        name === 'enrichment'
          ? $localize`:@@featureChat-agentEventSummaryEnrichmentResult:Enrichment result`
          : $localize`:@@featureChat-agentEventSummaryToolResult:Tool result · ${name}:toolName:`;
      summaryBody = `${isError ? 'Failed' : 'Success'} · ${toolCallId} · ${previewUnknown(p.result, 200)}`;
      badgeClass = toolPairOutcomeToBadgeClass(isError ? 'error' : 'success');
      break;
    }

    case 'question': {
      const p = payload as { prompt?: unknown; questionId?: unknown; options?: unknown };
      const prompt = typeof p.prompt === 'string' ? p.prompt : '';
      const qid = typeof p.questionId === 'string' ? p.questionId : '';

      summaryTitle = $localize`:@@featureChat-agentEventKindQuestion:Question`;
      summaryBody = [qid ? `#${qid}` : '', previewString(prompt, 200)].filter(Boolean).join(' · ');
      badgeClass = 'bg-primary';
      break;
    }

    case 'status': {
      const msg =
        typeof (payload as { message?: unknown }).message === 'string' ? (payload as { message: string }).message : '';

      summaryTitle = $localize`:@@featureChat-agentEventKindStatus:Status`;
      summaryBody = previewString(msg, 220);
      badgeClass = 'bg-secondary';
      break;
    }

    case 'error': {
      const p = payload as { message?: unknown; code?: unknown; details?: unknown };
      const message = typeof p.message === 'string' ? p.message : 'Error';
      const code = typeof p.code === 'string' ? p.code : '';

      summaryTitle = code
        ? $localize`:@@featureChat-agentEventSummaryErrorWithCode:Error (${code}:errorCode:)`
        : $localize`:@@featureChat-agentEventKindError:Error`;
      summaryBody = previewString(message, 200);

      if (typeof p.details === 'string' && p.details.trim()) {
        summaryBody += ` · ${previewString(p.details, 120)}`;
      }

      badgeClass = 'bg-danger';
      break;
    }

    default: {
      summaryBody = previewUnknown(payload, 200);
      badgeClass = 'bg-secondary';
    }
  }

  return {
    kind,
    kindLabel,
    summaryTitle,
    summaryBody,
    badgeClass,
  };
}

const isChunkedSummaryPlaceholder = (s: string): boolean => {
  const t = s.trim();

  return t.length === 0 || t === '…' || t === '—';
};

/**
 * Merges two consecutive `thinking` display rows (chunked producer output).
 */
export function mergeAdjacentThinkingDisplayRows(
  prev: AgentChatEventDisplayRow,
  row: AgentChatEventDisplayRow,
): AgentChatEventDisplayRow {
  const pieces = [prev.summaryBody, row.summaryBody]
    .map((s) => s.trim())
    .filter((s) => !isChunkedSummaryPlaceholder(s));
  const mergedRaw = pieces.join('\n');
  const summaryBody = mergedRaw.length === 0 ? '…' : previewString(mergedRaw.replace(/\r\n/g, '\n'), 480);
  const mergedPlainParts = [prev.popoverPlainDetail, row.popoverPlainDetail]
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter((s) => s.length > 0);
  const mergedPopoverPlain = mergedPlainParts.length > 0 ? mergedPlainParts.join('\n') : undefined;
  const merged: AgentChatEventDisplayRow = {
    ...prev,
    trackId: `${prev.trackId}~${row.trackId}`,
    summaryBody,
    detailJson: `${prev.detailJson}\n---\n${row.detailJson}`.trim(),
  };

  if (mergedPopoverPlain !== undefined) {
    merged.popoverPlainDetail = mergedPopoverPlain;
  }

  return merged;
}

/**
 * Merges two consecutive `interactionQuery` display rows (chunked producer output).
 */
export function mergeAdjacentInteractionQueryDisplayRows(
  prev: AgentChatEventDisplayRow,
  row: AgentChatEventDisplayRow,
): AgentChatEventDisplayRow {
  const pieces = [prev.summaryBody, row.summaryBody]
    .map((s) => s.trim())
    .filter((s) => !isChunkedSummaryPlaceholder(s));
  const mergedRaw = pieces.join('\n');
  const summaryBody = mergedRaw.length === 0 ? '…' : previewString(mergedRaw.replace(/\r\n/g, '\n'), 480);
  const mergedPlainParts = [prev.popoverPlainDetail, row.popoverPlainDetail]
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter((s) => s.length > 0);
  const mergedPopoverPlain = mergedPlainParts.length > 0 ? mergedPlainParts.join('\n') : undefined;
  const merged: AgentChatEventDisplayRow = {
    ...prev,
    trackId: `${prev.trackId}~${row.trackId}`,
    summaryBody,
    detailJson: `${prev.detailJson}\n---\n${row.detailJson}`.trim(),
  };

  if (mergedPopoverPlain !== undefined) {
    merged.popoverPlainDetail = mergedPopoverPlain;
  }

  return merged;
}

/**
 * Merges adjacent `thinking` rows so chunked producer output shows as one timeline pill (summary + combined details).
 */
export function consolidateConsecutiveThinkingTimelineRows(
  rows: AgentChatEventDisplayRow[],
): AgentChatEventDisplayRow[] {
  if (rows.length === 0) {
    return rows;
  }

  const out: AgentChatEventDisplayRow[] = [];

  for (const row of rows) {
    const prev = out[out.length - 1];

    if (row.kind === 'thinking' && prev?.kind === 'thinking') {
      out[out.length - 1] = mergeAdjacentThinkingDisplayRows(prev, row);
    } else {
      out.push(row);
    }
  }

  return out;
}

/**
 * Merges adjacent `interactionQuery` rows (same pattern as chunked `thinking`).
 */
export function consolidateConsecutiveInteractionQueryTimelineRows(
  rows: AgentChatEventDisplayRow[],
): AgentChatEventDisplayRow[] {
  if (rows.length === 0) {
    return rows;
  }

  const out: AgentChatEventDisplayRow[] = [];

  for (const row of rows) {
    const prev = out[out.length - 1];

    if (row.kind === 'interactionQuery' && prev?.kind === 'interactionQuery') {
      out[out.length - 1] = mergeAdjacentInteractionQueryDisplayRows(prev, row);
    } else {
      out.push(row);
    }
  }

  return out;
}

/** Merges tool call + result rows in a flat timeline (websocket event list) by matching `toolCallId`. */
export function consolidateConsecutiveToolPairTimelineRows(
  rows: AgentChatEventDisplayRow[],
): AgentChatEventDisplayRow[] {
  if (rows.length === 0) {
    return rows;
  }

  const { skip, mergedAt } = computeToolPairMergePlanFromIndices({
    length: rows.length,
    describe: (i) => {
      const r = rows[i];

      if (r === undefined) {
        return null;
      }

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
      const callRow = rows[callIndex];
      const resultRow = rows[resultIndex];

      if (callRow === undefined || resultRow === undefined) {
        throw new Error('tool pair merge: missing row');
      }

      return mergeToolPairDisplayRows(callRow, resultRow);
    },
  });
  const out: AgentChatEventDisplayRow[] = [];

  for (let i = 0; i < rows.length; i++) {
    if (skip.has(i)) {
      const row = mergedAt.get(i);

      if (row) {
        out.push(row);
      }

      continue;
    }

    const row = rows[i];

    if (row !== undefined) {
      out.push(row);
    }
  }

  return out;
}

/**
 * Maps a single forwarded socket row (from `chatEvent`) into a display row, or `null` if the payload is not a success envelope.
 */
export function mapForwardedChatEventToDisplayRow(forwarded: {
  payload: unknown;
  timestamp: number;
}): AgentChatEventDisplayRow | null {
  const envelope = tryParseChatEventEnvelope(forwarded.payload);

  if (!envelope) {
    return null;
  }

  const displayTimestampMs = parseEnvelopeTimestamp(envelope.timestamp, forwarded.timestamp);
  const row: AgentChatEventDisplayRow = {
    trackId: `${envelope.eventId}-${forwarded.timestamp}`,
    displayTimestampMs,
    detailJson: formatDetail(envelope),
    ...summarizeEnvelope(envelope),
  };

  if (envelope.kind === 'thinking') {
    const plain = extractThinkingPreviewText(envelope.payload as AgentResponseObject);

    if (plain.trim().length > 0) {
      row.popoverPlainDetail = plain;
    }
  }

  if (envelope.kind === 'interactionQuery') {
    const plain = extractInteractionQueryPreviewText({
      type: 'interaction_query',
      ...(envelope.payload && typeof envelope.payload === 'object'
        ? (envelope.payload as Record<string, unknown>)
        : {}),
    } as AgentResponseObject);

    if (plain.trim().length > 0) {
      row.popoverPlainDetail = plain;
    }
  }

  if (envelope.kind === 'toolCall') {
    const p = envelope.payload as { toolCallId?: unknown; status?: unknown };
    const rawId = typeof p.toolCallId === 'string' ? p.toolCallId : undefined;

    if (isConcreteToolCallId(rawId)) {
      row.toolCallId = rawId;
    }

    const status = typeof p.status === 'string' ? p.status : 'unknown';
    const outcome = toolPairOutcomeFromCallStatus(status);

    row.toolPair = {
      outcome,
      callDetailJson: row.detailJson,
    };
    row.badgeClass = toolPairOutcomeToBadgeClass(outcome);
  }

  if (envelope.kind === 'toolResult') {
    const p = envelope.payload as { toolCallId?: unknown; isError?: unknown };
    const rawId = typeof p.toolCallId === 'string' ? p.toolCallId : undefined;

    if (isConcreteToolCallId(rawId)) {
      row.toolCallId = rawId;
    }

    const err = Boolean(p.isError);
    const outcome: AgentChatToolPairOutcome = err ? 'error' : 'success';

    row.toolPair = {
      outcome,
      resultDetailJson: row.detailJson,
    };
    row.badgeClass = toolPairOutcomeToBadgeClass(outcome);
  }

  return row;
}

/**
 * Maps the last forwarded `chatEvent` entries to UI rows (newest kept by caller via slice).
 */
export function mapForwardedChatEventsToDisplayRows(
  events: Array<{ payload: unknown; timestamp: number }>,
): AgentChatEventDisplayRow[] {
  const rows = events
    .map((ev) => mapForwardedChatEventToDisplayRow(ev))
    .filter((row): row is AgentChatEventDisplayRow => row !== null);

  return consolidateConsecutiveToolPairTimelineRows(
    consolidateConsecutiveInteractionQueryTimelineRows(consolidateConsecutiveThinkingTimelineRows(rows)),
  );
}
