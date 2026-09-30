import type {
  AgentEventEnvelope,
  AgentEventKind,
  AgentResponseObject,
  SuccessResponse,
} from '@forepath/agenstra/frontend/data-access-agent-console';
import type { FpcBadgeColor } from '@forepath/shared/frontend/ui-components';

import { extractInteractionQueryPreviewText, extractThinkingPreviewText } from './agent-chat-response-markdown';
import { resolveAgentChatToolDisplay } from './agent-chat-tool-display';

/** Interactive OpenCode question / permission request embedded in a chat event row. */
export interface AgentChatQuestionInteraction {
  questionId: string;
  prompt: string;
  options: Array<{ id: string; label: string }>;
  allowMultiple: boolean;
  sessionId?: string;
  /** Permissions use once/always/reject; questions use selected option labels. */
  replyKind: 'permission' | 'question';
}

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
  /** `fpc-badge` color for the kind pill */
  badgeColor: FpcBadgeColor;
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
  /** OpenCode tool id (e.g. `read`, `bash`) when this row is a tool call/result. */
  toolName?: string;
  /**
   * When set, the row shows paired tool call/result popovers (instead of a single details icon).
   */
  toolPair?: AgentChatToolPairView;
  /** When set, the row renders the question prompt and answer controls. */
  questionInteraction?: AgentChatQuestionInteraction;
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

/** Badge label when a `question` row is actually an OpenCode permission prompt. */
export const AGENT_CHAT_PERMISSION_KIND_LABEL = $localize`:@@featureChat-agentEventKindPermission:Permission`;

export function agentChatEventKindLabel(kind: AgentEventKind): string {
  return AGENT_CHAT_EVENT_KIND_LABELS[kind] ?? kind;
}

/** Builds interactive question UI data from a mapped agent `question` payload. */
export function buildQuestionInteractionFromPayload(
  payload: Record<string, unknown>,
): AgentChatQuestionInteraction | undefined {
  const questionId =
    (typeof payload['questionId'] === 'string' && payload['questionId']) ||
    (typeof payload['request_id'] === 'string' && payload['request_id']) ||
    '';

  if (!questionId) {
    return undefined;
  }

  const prompt = typeof payload['prompt'] === 'string' ? payload['prompt'] : '';
  const sessionId =
    (typeof payload['sessionId'] === 'string' && payload['sessionId']) ||
    (typeof payload['session_id'] === 'string' && payload['session_id']) ||
    undefined;
  const subtype = typeof payload['subtype'] === 'string' ? payload['subtype'] : '';
  const replyKind: AgentChatQuestionInteraction['replyKind'] =
    subtype === 'permission' ||
    subtype === 'permission.v2' ||
    questionId.startsWith('per_') ||
    questionId.startsWith('perm_')
      ? 'permission'
      : 'question';
  const allowMultiple = payload['allowMultiple'] === true;
  const options: Array<{ id: string; label: string }> = [];
  const rawOptions = payload['options'];

  if (Array.isArray(rawOptions)) {
    for (const opt of rawOptions) {
      if (!opt || typeof opt !== 'object') {
        continue;
      }

      const o = opt as Record<string, unknown>;
      const id = typeof o['id'] === 'string' ? o['id'] : '';
      const label = typeof o['label'] === 'string' ? o['label'] : id;

      if (id && label) {
        options.push({ id, label });
      }
    }
  }

  return {
    questionId,
    prompt,
    options,
    allowMultiple,
    ...(sessionId ? { sessionId } : {}),
    replyKind,
  };
}

function previewString(value: string, maxChars: number): string {
  const t = value.replace(/\s+/g, ' ').trim();

  if (t.length <= maxChars) {
    return t;
  }

  return `${t.slice(0, maxChars - 1)}…`;
}

/** OpenCode `question` tool parts duplicate the dedicated interactive `question` event — omit from tool rows. */
export function isInteractiveQuestionToolName(name: string | undefined): boolean {
  return (name ?? '').trim().toLowerCase() === 'question';
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

export function toolPairOutcomeToBadgeColor(outcome: AgentChatToolPairOutcome): FpcBadgeColor {
  switch (outcome) {
    case 'pending':
      return 'info';
    case 'success':
      return 'success';
    case 'error':
      return 'warning';
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
    badgeColor: toolPairOutcomeToBadgeColor(outcome),
    detailJson: `${callDetail}\n\n---\n\n${resultDetail}`,
    toolCallId: callRow.toolCallId,
    toolName: callRow.toolName ?? resultRow.toolName,
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

/**
 * Collect question/permission ids marked answered via status frames (`questionId` on payload).
 * Used after reload so restored prompts stay dismissed when a reply was persisted.
 */
export function collectAnsweredQuestionIdsFromChatEvents(events: Array<{ payload: unknown }>): string[] {
  const ids: string[] = [];

  for (const ev of events) {
    const envelope = tryParseChatEventEnvelope(ev.payload);

    if (envelope?.kind !== 'status') {
      continue;
    }

    const questionId = (envelope.payload as { questionId?: unknown }).questionId;

    if (typeof questionId === 'string' && questionId.trim()) {
      ids.push(questionId.trim());
    }
  }

  return ids;
}

/**
 * Collect answered question ids embedded in persisted `agenstra_turn` parts
 * (covers older transcripts where a reply status was only stored inside the turn,
 * and turns where the agent continued after the prompt without a separate status frame).
 */
export function collectAnsweredQuestionIdsFromChatMessages(messages: Array<{ payload: unknown }>): string[] {
  const ids: string[] = [];

  for (const msg of messages) {
    const payload = msg.payload;

    if (!payload || typeof payload !== 'object') {
      continue;
    }

    const success = payload as { success?: unknown; data?: unknown };

    if (success.success !== true || !success.data || typeof success.data !== 'object') {
      continue;
    }

    const data = success.data as { response?: unknown; from?: unknown };
    const response = data.response;

    if (!response || typeof response !== 'object') {
      continue;
    }

    const r = response as { type?: unknown; parts?: unknown };

    if (r.type !== 'agenstra_turn' || !Array.isArray(r.parts)) {
      continue;
    }

    const parts = r.parts;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];

      if (!part || typeof part !== 'object') {
        continue;
      }

      const p = part as { type?: unknown; questionId?: unknown };

      if (p.type === 'status' && typeof p.questionId === 'string' && p.questionId.trim()) {
        ids.push(p.questionId.trim());
        continue;
      }

      // Question/permission prompts that are not the last part of the turn were already handled
      // (agent continued after the reply). Keep last-part prompts interactive when restoring.
      if (p.type === 'question' && typeof p.questionId === 'string' && p.questionId.trim() && i < parts.length - 1) {
        ids.push(p.questionId.trim());
      }
    }
  }

  return ids;
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
  let kindLabel = agentChatEventKindLabel(kind);
  let summaryTitle = kindLabel;
  let summaryBody = '';
  let badgeColor: FpcBadgeColor = 'secondary';

  switch (kind) {
    case 'userMessage': {
      const text = typeof (payload as { text?: unknown }).text === 'string' ? (payload as { text: string }).text : '';

      summaryTitle = $localize`:@@featureChat-agentEventSummaryUserMessage:User message`;
      summaryBody = previewString(text, 200);
      badgeColor = 'secondary';
      break;
    }

    case 'thinking': {
      const phase =
        typeof (payload as { phase?: unknown }).phase === 'string' ? (payload as { phase: string }).phase.trim() : '';

      summaryTitle = $localize`:@@featureChat-agentEventSummaryThinking:Agent is thinking`;
      summaryBody = phase ? previewString(phase, 120) : 'Waiting for the first response…';
      badgeColor = 'light';
      break;
    }

    case 'interactionQuery': {
      const preview = extractInteractionQueryPreviewText({
        type: 'interaction_query',
        ...(payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}),
      } as AgentResponseObject);

      summaryTitle = $localize`:@@featureChat-agentEventSummaryInteractionQuery:Query`;
      summaryBody = preview ? previewString(preview, 120) : 'Waiting for the first response…';
      badgeColor = 'light';
      break;
    }

    case 'assistantDelta': {
      const delta =
        typeof (payload as { delta?: unknown }).delta === 'string' ? (payload as { delta: string }).delta : '';

      summaryTitle = $localize`:@@featureChat-agentEventSummaryAssistantStreaming:Assistant (streaming)`;
      summaryBody = previewString(delta, 220);
      badgeColor = 'info';
      break;
    }

    case 'assistantMessage': {
      const text = typeof (payload as { text?: unknown }).text === 'string' ? (payload as { text: string }).text : '';

      summaryTitle = $localize`:@@featureChat-agentEventSummaryAssistantMessage:Assistant message`;
      summaryBody = previewString(text, 220);
      badgeColor = 'primary';
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

      summaryTitle = resolveAgentChatToolDisplay(name).label;
      summaryBody = `${status} · ${toolCallId}`;

      if (p.args !== undefined) {
        const args = p.args as Record<string, unknown>;
        const agentName =
          typeof args['agent'] === 'string'
            ? args['agent']
            : typeof args['subagent_type'] === 'string'
              ? args['subagent_type']
              : undefined;
        const description = typeof args['description'] === 'string' ? args['description'] : undefined;

        if (agentName || description) {
          summaryBody = [agentName ? `@${agentName}` : null, description, `${status} · ${toolCallId}`]
            .filter((part): part is string => Boolean(part))
            .join(' · ');
        } else {
          summaryBody += ` · ${previewUnknown(p.args, 160)}`;
        }
      }

      badgeColor = toolPairOutcomeToBadgeColor(toolPairOutcomeFromCallStatus(status));
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

      summaryTitle = resolveAgentChatToolDisplay(name).label;
      summaryBody = `${isError ? 'Failed' : 'Success'} · ${toolCallId} · ${previewUnknown(p.result, 200)}`;
      badgeColor = toolPairOutcomeToBadgeColor(isError ? 'error' : 'success');
      break;
    }

    case 'question': {
      const p = payload as {
        prompt?: unknown;
        questionId?: unknown;
        options?: unknown;
        subtype?: unknown;
      };
      const interaction = buildQuestionInteractionFromPayload(p as Record<string, unknown>);
      const prompt = typeof p.prompt === 'string' ? p.prompt : '';
      const qid = typeof p.questionId === 'string' ? p.questionId : '';
      const isPermission = interaction?.replyKind === 'permission';

      if (isPermission) {
        kindLabel = AGENT_CHAT_PERMISSION_KIND_LABEL;
      }

      summaryTitle = isPermission
        ? AGENT_CHAT_PERMISSION_KIND_LABEL
        : $localize`:@@featureChat-agentEventKindQuestion:Question`;
      summaryBody = previewString(prompt, 240) || (qid ? `#${qid}` : '');
      badgeColor = isPermission ? 'warning' : 'primary';
      break;
    }

    case 'status': {
      const payloadObj = payload as { message?: unknown; title?: unknown };
      const msg = typeof payloadObj.message === 'string' ? payloadObj.message : '';
      const title = typeof payloadObj.title === 'string' ? payloadObj.title.trim() : '';

      summaryTitle = title || $localize`:@@featureChat-agentEventKindStatus:Status`;
      summaryBody = previewString(msg, 220);
      badgeColor =
        title === 'Retry' || title === 'Permission'
          ? 'warning'
          : title === 'Todos' || title === 'Diff' || title === 'File' || title === 'Patch'
            ? 'info'
            : 'secondary';
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

      badgeColor = 'danger';
      break;
    }

    default: {
      summaryBody = previewUnknown(payload, 200);
      badgeColor = 'secondary';
    }
  }

  return {
    kind,
    kindLabel,
    summaryTitle,
    summaryBody,
    badgeColor,
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

/**
 * Collapses multiple `toolCall` rows that share a concrete `toolCallId` into the earliest row
 * (ACP emits started then in_progress as separate events). Keeps the latest summary/status.
 */
export function coalesceDuplicateToolCallDisplayRows(rows: AgentChatEventDisplayRow[]): AgentChatEventDisplayRow[] {
  if (rows.length === 0) {
    return rows;
  }

  const firstIndexById = new Map<string, number>();
  const skip = new Set<number>();
  const replaced = new Map<number, AgentChatEventDisplayRow>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    if (row === undefined || row.kind !== 'toolCall' || !isConcreteToolCallId(row.toolCallId)) {
      continue;
    }

    const id = row.toolCallId;
    const firstIndex = firstIndexById.get(id);

    if (firstIndex === undefined) {
      firstIndexById.set(id, i);
      continue;
    }

    const base = replaced.get(firstIndex) ?? rows[firstIndex];

    if (base === undefined) {
      continue;
    }

    replaced.set(firstIndex, {
      ...base,
      summaryTitle: row.summaryTitle || base.summaryTitle,
      summaryBody: row.summaryBody || base.summaryBody,
      badgeColor: row.badgeColor || base.badgeColor,
      detailJson: row.detailJson || base.detailJson,
      toolName: row.toolName ?? base.toolName,
      toolPair: {
        outcome: row.toolPair?.outcome ?? base.toolPair?.outcome ?? 'pending',
        callDetailJson: row.toolPair?.callDetailJson ?? base.toolPair?.callDetailJson ?? row.detailJson,
        resultDetailJson: row.toolPair?.resultDetailJson ?? base.toolPair?.resultDetailJson,
      },
    });
    skip.add(i);
  }

  const out: AgentChatEventDisplayRow[] = [];

  for (let i = 0; i < rows.length; i++) {
    if (skip.has(i)) {
      continue;
    }

    const row = replaced.get(i) ?? rows[i];

    if (row !== undefined) {
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

  const coalesced = coalesceDuplicateToolCallDisplayRows(rows);
  const { skip, mergedAt } = computeToolPairMergePlanFromIndices({
    length: coalesced.length,
    describe: (i) => {
      const r = coalesced[i];

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
      const callRow = coalesced[callIndex];
      const resultRow = coalesced[resultIndex];

      if (callRow === undefined || resultRow === undefined) {
        throw new Error('tool pair merge: missing row');
      }

      return mergeToolPairDisplayRows(callRow, resultRow);
    },
  });
  const out: AgentChatEventDisplayRow[] = [];

  for (let i = 0; i < coalesced.length; i++) {
    if (skip.has(i)) {
      const row = mergedAt.get(i);

      if (row) {
        out.push(row);
      }

      continue;
    }

    const row = coalesced[i];

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

  // Suppress OpenCode step markers (legacy envelopes still in flight / history).
  if (envelope.kind === 'status') {
    const p = envelope.payload as { title?: unknown; message?: unknown };
    const title = typeof p.title === 'string' ? p.title.trim() : '';
    const message = typeof p.message === 'string' ? p.message : '';

    if (title === 'Step' || /^step\b/i.test(message.trim())) {
      return null;
    }
  }

  if (envelope.kind === 'thinking') {
    const phase =
      typeof (envelope.payload as { phase?: unknown }).phase === 'string'
        ? (envelope.payload as { phase: string }).phase.trim().toLowerCase()
        : '';

    if (phase === 'step') {
      return null;
    }
  }

  // Interactive Question UI comes from `kind: 'question'`; drop duplicate tool frames.
  if (envelope.kind === 'toolCall' || envelope.kind === 'toolResult') {
    const name = (envelope.payload as { name?: unknown }).name;

    if (typeof name === 'string' && isInteractiveQuestionToolName(name)) {
      return null;
    }
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
    const p = envelope.payload as { toolCallId?: unknown; status?: unknown; name?: unknown };
    const rawId = typeof p.toolCallId === 'string' ? p.toolCallId : undefined;

    if (isConcreteToolCallId(rawId)) {
      row.toolCallId = rawId;
    }

    if (typeof p.name === 'string' && p.name.trim().length > 0) {
      row.toolName = p.name;
    }

    const status = typeof p.status === 'string' ? p.status : 'unknown';
    const outcome = toolPairOutcomeFromCallStatus(status);

    row.toolPair = {
      outcome,
      callDetailJson: row.detailJson,
    };
    row.badgeColor = toolPairOutcomeToBadgeColor(outcome);
  }

  if (envelope.kind === 'toolResult') {
    const p = envelope.payload as { toolCallId?: unknown; isError?: unknown; name?: unknown };
    const rawId = typeof p.toolCallId === 'string' ? p.toolCallId : undefined;

    if (isConcreteToolCallId(rawId)) {
      row.toolCallId = rawId;
    }

    if (typeof p.name === 'string' && p.name.trim().length > 0) {
      row.toolName = p.name;
    }

    const err = Boolean(p.isError);
    const outcome: AgentChatToolPairOutcome = err ? 'error' : 'success';

    row.toolPair = {
      outcome,
      resultDetailJson: row.detailJson,
    };
    row.badgeColor = toolPairOutcomeToBadgeColor(outcome);
  }

  if (envelope.kind === 'question') {
    const payload =
      envelope.payload && typeof envelope.payload === 'object' ? (envelope.payload as Record<string, unknown>) : {};
    const interaction = buildQuestionInteractionFromPayload({
      type: 'question',
      ...payload,
    });

    if (interaction) {
      row.questionInteraction = interaction;
      row.summaryBody = previewString(interaction.prompt, 240) || row.summaryBody;
      row.popoverPlainDetail = interaction.prompt;

      if (interaction.replyKind === 'permission') {
        row.kindLabel = AGENT_CHAT_PERMISSION_KIND_LABEL;
        row.summaryTitle = AGENT_CHAT_PERMISSION_KIND_LABEL;
        row.badgeColor = 'warning';
      }
    }
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
