import type { SessionNotification, ToolCallContent } from '@agentclientprotocol/sdk';
import { Injectable } from '@nestjs/common';

import type { AgentResponseObject } from '../agent-provider.interface';

/** Per-prompt ACP tool-call bookkeeping (names + which calls were already emitted). */
export interface AcpToolCallState {
  names: Map<string, string>;
  emittedCalls: Set<string>;
}

export function createAcpToolCallState(): AcpToolCallState {
  return {
    names: new Map(),
    emittedCalls: new Set(),
  };
}

/** @deprecated Prefer {@link AcpToolCallState}; kept for older call sites/tests. */
export type AcpToolNameCache = Map<string, string>;

const TOOL_KIND_LABELS: Record<string, string> = {
  execute: 'shell',
  search: 'search',
  read: 'read',
  edit: 'edit',
  delete: 'delete',
  move: 'move',
  think: 'think',
  fetch: 'fetch',
  switch_mode: 'switch_mode',
  other: 'tool',
};

const MAX_TITLE_NAME_LENGTH = 80;

@Injectable()
export class AcpNotificationMapper {
  mapSessionUpdate(
    notification: SessionNotification,
    toolState: AcpToolCallState | AcpToolNameCache = createAcpToolCallState(),
  ): AgentResponseObject[] {
    const state = normalizeToolCallState(toolState);
    const update = notification.update;
    const results: AgentResponseObject[] = [];

    switch (update.sessionUpdate) {
      case 'agent_message_chunk':
        if (update.content.type === 'text' && update.content.text) {
          results.push({ type: 'delta', delta: update.content.text });
        }
        break;
      case 'agent_thought_chunk':
        results.push({ type: 'thinking', phase: 'running' });
        break;
      case 'tool_call': {
        const name = resolveToolName(update, state.names);
        const toolCall: AgentResponseObject = {
          type: 'tool_call',
          toolCallId: update.toolCallId,
          name,
          status: mapAcpToolStatus(update.status),
        };

        if (update.rawInput !== undefined) {
          toolCall.args = update.rawInput;
        }

        state.emittedCalls.add(update.toolCallId);
        results.push(toolCall);
        break;
      }
      case 'tool_call_update': {
        const name = resolveToolName(update, state.names);

        if (update.status === 'completed' || update.status === 'failed') {
          results.push({
            type: 'tool_result',
            toolCallId: update.toolCallId,
            name,
            result: extractToolResultPayload(update),
            isError: update.status === 'failed',
            ...(update.rawInput !== undefined ? { args: update.rawInput } : {}),
          });
        } else if (!state.emittedCalls.has(update.toolCallId)) {
          // First sighting of this tool (update without a prior tool_call).
          const toolCall: AgentResponseObject = {
            type: 'tool_call',
            toolCallId: update.toolCallId,
            name,
            status: mapAcpToolStatus(update.status ?? 'in_progress'),
          };

          if (update.rawInput !== undefined) {
            toolCall.args = update.rawInput;
          }

          state.emittedCalls.add(update.toolCallId);
          results.push(toolCall);
        }
        // Else: status-only progress (started → in_progress) — do not emit another row.
        break;
      }
      case 'plan':
      case 'plan_update':
        results.push({ type: 'thinking', phase: 'plan' });
        break;
      default:
        break;
    }

    return results;
  }

  buildFinalResult(aggregatedText: string, sessionId?: string): AgentResponseObject {
    return {
      type: 'result',
      subtype: 'success',
      result: aggregatedText,
      ...(sessionId ? { session_id: sessionId } : {}),
    };
  }
}

function normalizeToolCallState(toolState: AcpToolCallState | AcpToolNameCache): AcpToolCallState {
  if (toolState instanceof Map) {
    return {
      names: toolState,
      emittedCalls: new Set(toolState.keys()),
    };
  }

  return toolState;
}

function mapAcpToolStatus(status: string | null | undefined): 'started' | 'inProgress' | 'succeeded' | 'failed' {
  if (status === 'completed') {
    return 'succeeded';
  }

  if (status === 'failed') {
    return 'failed';
  }

  if (status === 'pending') {
    return 'started';
  }

  return 'inProgress';
}

function resolveToolName(
  update: {
    toolCallId: string;
    title?: string | null;
    kind?: string | null;
    rawInput?: unknown;
  },
  nameCache: AcpToolNameCache,
): string {
  const fromTitle = normalizeTitle(update.title);
  const fromKind = kindToLabel(update.kind);
  const fromRawInput = extractNameFromRawInput(update.rawInput);

  let candidate = '';

  if (fromTitle && isCompactTitle(fromTitle)) {
    candidate = fromTitle;
  } else if (fromKind) {
    candidate = fromKind;
  } else if (fromRawInput) {
    candidate = fromRawInput;
  } else if (fromTitle) {
    candidate = abbreviateCommandTitle(fromTitle);
  }

  if (candidate) {
    nameCache.set(update.toolCallId, candidate);

    return candidate;
  }

  return nameCache.get(update.toolCallId) ?? 'tool';
}

function normalizeTitle(title: string | null | undefined): string {
  if (typeof title !== 'string') {
    return '';
  }

  const trimmed = title.trim();

  if (
    (trimmed.startsWith('`') && trimmed.endsWith('`')) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }

  return trimmed;
}

function isCompactTitle(title: string): boolean {
  if (title.length > MAX_TITLE_NAME_LENGTH || title.includes('\n')) {
    return false;
  }

  // Shell agents often put the full command in title; treat those as non-names.
  if (/[;|]|&&|\|\|/.test(title) || /^\s*(ls|cd|cat|echo|for|while|if|sudo)\b/.test(title)) {
    return false;
  }

  return true;
}

function abbreviateCommandTitle(title: string): string {
  const firstLine = title.split('\n')[0]?.trim() ?? title;
  const firstToken = firstLine.split(/\s+/)[0] ?? firstLine;

  if (firstToken.length > 0 && firstToken.length <= MAX_TITLE_NAME_LENGTH) {
    return firstToken.replace(/^#+/, '') || 'shell';
  }

  return 'shell';
}

function kindToLabel(kind: string | null | undefined): string {
  if (typeof kind !== 'string' || !kind.trim()) {
    return '';
  }

  const normalized = kind.trim().toLowerCase();

  return TOOL_KIND_LABELS[normalized] ?? normalized;
}

function extractNameFromRawInput(rawInput: unknown): string {
  if (!rawInput || typeof rawInput !== 'object') {
    return '';
  }

  const record = rawInput as Record<string, unknown>;

  for (const key of ['name', 'toolName', 'tool', 'command', 'cmd']) {
    const value = record[key];

    if (typeof value === 'string' && value.trim()) {
      const trimmed = value.trim();

      if (key === 'command' || key === 'cmd') {
        return abbreviateCommandTitle(trimmed);
      }

      if (isCompactTitle(trimmed)) {
        return trimmed;
      }
    }
  }

  return '';
}

function extractToolResultPayload(update: {
  status?: string | null;
  rawOutput?: unknown;
  content?: Array<ToolCallContent> | null;
}): unknown {
  if (update.rawOutput !== undefined && update.rawOutput !== null) {
    return update.rawOutput;
  }

  if (Array.isArray(update.content) && update.content.length > 0) {
    return serializeToolContent(update.content);
  }

  return update.status ?? 'completed';
}

function serializeToolContent(content: Array<ToolCallContent>): unknown {
  const texts: string[] = [];
  const parts: unknown[] = [];

  for (const item of content) {
    if (item.type === 'content') {
      const block = item.content;

      if (
        block &&
        typeof block === 'object' &&
        'type' in block &&
        block.type === 'text' &&
        typeof block.text === 'string'
      ) {
        texts.push(block.text);
      } else {
        parts.push(item);
      }
    } else if (item.type === 'diff') {
      parts.push({
        type: 'diff',
        path: item.path,
        oldText: item.oldText,
        newText: item.newText,
      });
    } else if (item.type === 'terminal') {
      parts.push({
        type: 'terminal',
        terminalId: item.terminalId,
      });
    } else {
      parts.push(item);
    }
  }

  if (parts.length === 0) {
    return texts.join('\n');
  }

  if (texts.length === 0 && parts.length === 1) {
    return parts[0];
  }

  return {
    ...(texts.length > 0 ? { text: texts.join('\n') } : {}),
    parts,
  };
}
