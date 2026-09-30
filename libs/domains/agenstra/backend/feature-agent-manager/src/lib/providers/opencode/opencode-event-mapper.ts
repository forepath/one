import { Injectable, Optional } from '@nestjs/common';

import type { AgentResponseObject } from '../agent-provider.interface';
import { OutboundAgentEventPublisher } from '../outbound-agent-event-publisher';

import type {
  Event,
  FileDiff,
  Part,
  PermissionReply,
  QuestionInfo,
  Session,
  SessionStatus,
  SubtaskPart,
  AgentPart,
  TodoItem,
  ToolPart,
} from './opencode-sdk.types';

/** Token usage attached to completed assistant turns. */
export interface OpenCodeUsagePayload {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  costUsd?: number;
}

/** Per-turn OpenCode tool-call bookkeeping. */
export interface OpenCodeToolCallState {
  emittedCalls: Set<string>;
  lastUsage?: OpenCodeUsagePayload;
}

export function createOpenCodeToolCallState(): OpenCodeToolCallState {
  return {
    emittedCalls: new Set(),
  };
}

const PERMISSION_OPTIONS: Array<{ id: PermissionReply; label: string }> = [
  { id: 'once', label: 'Allow once' },
  { id: 'always', label: 'Allow always' },
  { id: 'reject', label: 'Reject' },
];

/**
 * Maps OpenCode SSE bus events to the existing {@link AgentResponseObject} chat model.
 */
@Injectable()
export class OpenCodeEventMapper {
  constructor(@Optional() private readonly outboundPublisher?: OutboundAgentEventPublisher) {}

  mapEvent(
    event: Event,
    toolState: OpenCodeToolCallState = createOpenCodeToolCallState(),
    agentId?: string,
  ): AgentResponseObject[] {
    const mapped = this.mapEventInternal(event, toolState);

    if (agentId && this.outboundPublisher) {
      for (const obj of mapped) {
        void this.outboundPublisher.publish(agentId, obj);
      }
    }

    return mapped;
  }

  buildFinalResult(aggregatedText: string, sessionId?: string, usage?: OpenCodeUsagePayload): AgentResponseObject {
    return {
      type: 'result',
      subtype: 'success',
      result: aggregatedText,
      ...(sessionId ? { session_id: sessionId } : {}),
      ...(usage ? { usage } : {}),
    };
  }

  private mapEventInternal(event: Event, toolState: OpenCodeToolCallState): AgentResponseObject[] {
    switch (event.type) {
      case 'message.part.updated':
        return this.mapPartUpdated(event.properties.part, event.properties.delta, toolState);
      case 'message.updated':
        return this.mapMessageUpdated(event.properties.info, toolState);
      case 'session.idle':
        return [{ type: 'session_idle', session_id: event.properties.sessionID }];
      case 'session.created':
      case 'session.updated':
      case 'session.deleted':
        return this.mapSessionLifecycle(event.properties.info, event.type);
      case 'session.status':
        return this.mapSessionStatus(event.properties.sessionID, event.properties.status);
      case 'session.compacted':
        return [
          this.statusEvent('Context compacted', 'session_compacted', {
            session_id: event.properties.sessionID,
          }),
        ];
      case 'session.diff':
        return this.mapSessionDiff(event.properties.sessionID, event.properties.diff);
      case 'session.error': {
        const error = event.properties.error;
        const message =
          error && typeof error === 'object' && 'data' in error && error.data && typeof error.data === 'object'
            ? String((error.data as { message?: unknown }).message ?? 'OpenCode session error')
            : error && typeof error === 'object' && typeof error.message === 'string'
              ? error.message
              : 'OpenCode session error';

        return [
          {
            type: 'result',
            subtype: 'error',
            is_error: true,
            result: message,
            session_id: event.properties.sessionID,
          },
        ];
      }
      case 'todo.updated':
        return this.mapTodoUpdated(event.properties.sessionID, event.properties.todos);
      case 'command.executed':
        return [
          this.statusEvent(
            event.properties.arguments
              ? `Command /${event.properties.name} ${event.properties.arguments}`
              : `Command /${event.properties.name}`,
            'command',
            { session_id: event.properties.sessionID, name: event.properties.name },
          ),
        ];
      case 'file.edited':
        return [
          this.statusEvent(`File edited: ${event.properties.file}`, 'file_edited', { path: event.properties.file }),
        ];
      case 'vcs.branch.updated':
        return [
          this.statusEvent(
            event.properties.branch ? `Branch: ${event.properties.branch}` : 'Branch updated',
            'vcs_branch',
            { branch: event.properties.branch },
          ),
        ];
      case 'permission.replied':
        return [
          this.statusEvent(
            `Permission ${event.properties.permissionID}: ${event.properties.response}`,
            'permission_replied',
            {
              session_id: event.properties.sessionID,
              questionId: event.properties.permissionID,
            },
          ),
        ];
      case 'tui.toast.show': {
        const title = event.properties.title?.trim();
        const message = title ? `${title}: ${event.properties.message}` : event.properties.message;

        if (event.properties.variant === 'error') {
          return [
            {
              type: 'result',
              subtype: 'error',
              is_error: true,
              result: message,
            },
          ];
        }

        return [this.statusEvent(message, `toast_${event.properties.variant}`)];
      }
      case 'permission.updated':
        return this.mapPermissionQuestion({
          id: event.properties.id,
          sessionID: event.properties.sessionID,
          prompt: this.buildPermissionPrompt(
            event.properties.type,
            event.properties.title || event.properties.type || 'Permission required',
            event.properties.pattern,
            event.properties.metadata,
          ),
          permissionType: event.properties.type,
          pattern: event.properties.pattern,
          metadata: event.properties.metadata,
          subtype: 'permission',
        });
      case 'permission.asked':
      case 'permission.v2.asked': {
        const payload = this.eventPayload(event);
        const id = typeof payload.id === 'string' ? payload.id : '';
        const sessionID = typeof payload.sessionID === 'string' ? payload.sessionID : undefined;
        const permissionType =
          typeof payload.permission === 'string'
            ? payload.permission
            : typeof payload.action === 'string'
              ? payload.action
              : 'permission';
        const metadata = (payload.metadata as Record<string, unknown> | undefined) ?? {};
        const pattern = payload.patterns ?? payload.resources ?? payload.pattern;
        const prompt = this.buildPermissionPrompt(permissionType, permissionType, pattern, metadata);

        return this.mapPermissionQuestion({
          id,
          sessionID,
          prompt,
          permissionType,
          pattern,
          metadata,
          subtype: event.type === 'permission.v2.asked' ? 'permission.v2' : 'permission',
        });
      }
      case 'question.asked':
      case 'question.v2.asked': {
        const payload = this.eventPayload(event);
        const requestId =
          (typeof payload.requestID === 'string' && payload.requestID) ||
          (typeof payload.id === 'string' && payload.id) ||
          '';
        const sessionID = typeof payload.sessionID === 'string' ? payload.sessionID : undefined;
        const questions = Array.isArray(payload.questions) ? (payload.questions as QuestionInfo[]) : [];
        const first = questions[0];
        const prompt =
          (first && typeof first.question === 'string' && first.question) ||
          (first && typeof first.header === 'string' && first.header) ||
          'Question';
        const options = this.mapQuestionOptions(questions);

        return [
          {
            type: 'question',
            subtype: event.type === 'question.v2.asked' ? 'question.v2' : 'question',
            questionId: requestId,
            request_id: requestId,
            prompt,
            options,
            allowMultiple: first?.multiple === true,
            session_id: sessionID,
            result: { questions },
          },
        ];
      }
      default:
        return [];
    }
  }

  private statusEvent(message: string, subtype: string, extra: Record<string, unknown> = {}): AgentResponseObject {
    return {
      type: 'status',
      subtype,
      title: this.statusTitleForSubtype(subtype),
      result: message,
      message,
      ...extra,
    };
  }

  private statusTitleForSubtype(subtype: string): string {
    switch (subtype) {
      case 'todo':
        return 'Todos';
      case 'file_edited':
        return 'File';
      case 'patch':
        return 'Patch';
      case 'session_diff':
        return 'Diff';
      case 'session_compacted':
      case 'compaction':
        return 'Compaction';
      case 'command':
        return 'Command';
      case 'vcs_branch':
        return 'Branch';
      case 'permission_replied':
        return 'Permission';
      case 'retry':
      case 'session_retry':
        return 'Retry';
      case 'step':
        return 'Step';
      case 'file_attachment':
        return 'Attachment';
      case 'subagent_session':
        return 'Subagent';
      case 'agent_mention':
        return 'Mention';
      case 'toast_info':
      case 'toast_success':
      case 'toast_warning':
        return 'Notice';
      default:
        return 'Status';
    }
  }

  private mapSessionStatus(sessionId: string, status: SessionStatus): AgentResponseObject[] {
    if (status.type === 'busy') {
      return [{ type: 'thinking', phase: 'running', session_id: sessionId }];
    }

    if (status.type === 'retry') {
      return [
        this.statusEvent(`Retry ${status.attempt}: ${status.message}`, 'session_retry', {
          session_id: sessionId,
          attempt: status.attempt,
        }),
      ];
    }

    // idle is also emitted as session.idle; avoid duplicate chat noise
    return [];
  }

  private mapSessionDiff(sessionId: string, diff: FileDiff[]): AgentResponseObject[] {
    if (!diff.length) {
      return [];
    }

    const summary = diff
      .slice(0, 8)
      .map((entry) => `${entry.file} (+${entry.additions}/-${entry.deletions})`)
      .join(', ');
    const more = diff.length > 8 ? ` (+${diff.length - 8} more)` : '';

    return [
      this.statusEvent(`Changed files: ${summary}${more}`, 'session_diff', {
        session_id: sessionId,
        files: diff.map((d) => ({ file: d.file, additions: d.additions, deletions: d.deletions })),
      }),
    ];
  }

  private mapTodoUpdated(sessionId: string, todos: TodoItem[]): AgentResponseObject[] {
    if (!todos.length) {
      return [this.statusEvent('Todos cleared', 'todo', { session_id: sessionId })];
    }

    const lines = todos.map((todo) => {
      const mark =
        todo.status === 'completed'
          ? 'x'
          : todo.status === 'in_progress'
            ? '~'
            : todo.status === 'cancelled'
              ? '-'
              : ' ';

      return `[${mark}] ${todo.content} (${todo.priority})`;
    });

    return [
      this.statusEvent(lines.join('\n'), 'todo', {
        session_id: sessionId,
        todos,
      }),
    ];
  }

  private mapMessageUpdated(
    info: { role?: string; sessionID?: string; [key: string]: unknown },
    toolState: OpenCodeToolCallState,
  ): AgentResponseObject[] {
    if (info.role !== 'assistant') {
      return [];
    }

    const tokens = info.tokens as
      | {
          input?: number;
          output?: number;
          reasoning?: number;
          cache?: { read?: number; write?: number };
        }
      | undefined;
    const cost = typeof info.cost === 'number' ? info.cost : undefined;

    if (!tokens && cost === undefined) {
      return [];
    }

    toolState.lastUsage = {
      ...(typeof tokens?.input === 'number' ? { inputTokens: tokens.input } : {}),
      ...(typeof tokens?.output === 'number' ? { outputTokens: tokens.output } : {}),
      ...(typeof tokens?.reasoning === 'number' ? { reasoningTokens: tokens.reasoning } : {}),
      ...(typeof tokens?.cache?.read === 'number' ? { cacheReadTokens: tokens.cache.read } : {}),
      ...(typeof tokens?.cache?.write === 'number' ? { cacheWriteTokens: tokens.cache.write } : {}),
      ...(cost !== undefined ? { costUsd: cost } : {}),
    };

    return [];
  }

  private mapPermissionQuestion(args: {
    id: string;
    sessionID?: string;
    prompt: string;
    permissionType: string;
    pattern?: unknown;
    metadata: Record<string, unknown>;
    subtype: string;
  }): AgentResponseObject[] {
    if (!args.id) {
      return [];
    }

    return [
      {
        type: 'question',
        subtype: args.subtype,
        questionId: args.id,
        request_id: args.id,
        prompt: args.prompt,
        options: PERMISSION_OPTIONS,
        session_id: args.sessionID,
        result: {
          title: args.prompt,
          permissionType: args.permissionType,
          pattern: args.pattern,
          metadata: args.metadata,
        },
      },
    ];
  }

  /**
   * Builds a user-visible permission prompt that includes paths / patterns (e.g. the directory).
   */
  private buildPermissionPrompt(
    permissionType: string,
    titleOrFallback: string,
    pattern?: unknown,
    metadata?: Record<string, unknown>,
  ): string {
    const head = (titleOrFallback || permissionType || 'Permission required').trim();
    const paths = this.collectPermissionPaths(pattern, metadata).filter(
      (path) => path.length > 0 && !head.includes(path),
    );

    if (paths.length === 0) {
      return head || 'Permission required';
    }

    return `${head}\n${paths.join('\n')}`;
  }

  private collectPermissionPaths(pattern?: unknown, metadata?: Record<string, unknown>): string[] {
    const out: string[] = [];
    const add = (value: unknown): void => {
      if (typeof value === 'string') {
        const trimmed = value.trim();

        if (trimmed) {
          out.push(trimmed);
        }

        return;
      }

      if (Array.isArray(value)) {
        for (const item of value) {
          add(item);
        }
      }
    };

    add(pattern);

    if (metadata && typeof metadata === 'object') {
      for (const key of ['path', 'filepath', 'file', 'directory', 'dir', 'cwd', 'target', 'patterns', 'resources']) {
        add(metadata[key]);
      }
    }

    return [...new Set(out)];
  }

  private mapQuestionOptions(questions: QuestionInfo[]): Array<{ id: string; label: string }> {
    const options: Array<{ id: string; label: string }> = [];

    for (const q of questions) {
      if (!Array.isArray(q.options)) {
        continue;
      }

      for (const opt of q.options) {
        const label = typeof opt.label === 'string' ? opt.label : typeof opt.id === 'string' ? opt.id : '';
        const id = typeof opt.id === 'string' ? opt.id : label;

        if (id && label) {
          options.push({ id, label });
        }
      }
    }

    return options;
  }

  private eventPayload(event: Event): Record<string, unknown> {
    if ('properties' in event && event.properties && typeof event.properties === 'object') {
      return event.properties as Record<string, unknown>;
    }

    if ('data' in event && event.data && typeof event.data === 'object') {
      return event.data as Record<string, unknown>;
    }

    return {};
  }

  /**
   * OpenCode may echo Agenstra's injected prompt (context / hydration) as a text part.
   * Those must never surface in the user-visible chat transcript.
   */
  private isInternalPromptText(text: string): boolean {
    return (
      text.includes('<hidden-context>') ||
      text.includes('</hidden-context>') ||
      text.includes('[SYSTEM INTERNAL - HIDDEN HYDRATION CONTEXT]') ||
      text.includes('[END HIDDEN HYDRATION CONTEXT]')
    );
  }

  private mapPartUpdated(
    part: Part,
    delta: string | undefined,
    toolState: OpenCodeToolCallState,
  ): AgentResponseObject[] {
    if (part.type === 'text') {
      // Synthetic parts and echoed internal prompts are for the model only.
      if (part.synthetic === true || this.isInternalPromptText(part.text)) {
        return [];
      }

      if (typeof delta === 'string' && delta.length > 0) {
        if (this.isInternalPromptText(delta)) {
          return [];
        }

        return [{ type: 'delta', delta }];
      }

      if (part.text) {
        return [{ type: 'delta', delta: part.text }];
      }

      return [];
    }

    if (part.type === 'reasoning') {
      return [{ type: 'thinking', phase: 'running' }];
    }

    if (part.type === 'tool') {
      return this.mapToolPart(part, toolState);
    }

    if (part.type === 'subtask') {
      return this.mapSubtaskPart(part, toolState);
    }

    if (part.type === 'agent') {
      return this.mapAgentMentionPart(part);
    }

    // OpenCode turn boundaries — track usage on finish, but do not show step noise in chat.
    if (part.type === 'step-start') {
      return [];
    }

    if (part.type === 'step-finish') {
      toolState.lastUsage = {
        inputTokens: part.tokens.input,
        outputTokens: part.tokens.output,
        reasoningTokens: part.tokens.reasoning,
        cacheReadTokens: part.tokens.cache.read,
        cacheWriteTokens: part.tokens.cache.write,
        costUsd: part.cost,
      };

      return [];
    }

    if (part.type === 'patch') {
      const files = part.files?.length ? part.files.join(', ') : part.hash;

      return [
        this.statusEvent(`Patch: ${files}`, 'patch', {
          session_id: part.sessionID,
          hash: part.hash,
          files: part.files,
        }),
      ];
    }

    if (part.type === 'retry') {
      const errMsg =
        part.error && typeof part.error === 'object'
          ? String(
              (part.error.data && typeof part.error.data === 'object'
                ? (part.error.data as { message?: unknown }).message
                : undefined) ??
                part.error.message ??
                'provider error',
            )
          : 'provider error';

      return [
        this.statusEvent(`Retry attempt ${part.attempt}: ${errMsg}`, 'retry', {
          session_id: part.sessionID,
          attempt: part.attempt,
        }),
      ];
    }

    if (part.type === 'compaction') {
      return [
        this.statusEvent(part.auto ? 'Automatic context compaction' : 'Context compaction', 'compaction', {
          session_id: part.sessionID,
        }),
      ];
    }

    if (part.type === 'file') {
      const label = part.filename || part.url || 'attachment';

      return [
        this.statusEvent(`Attachment: ${label}`, 'file_attachment', {
          session_id: part.sessionID,
          mime: part.mime,
          filename: part.filename,
          url: part.url,
        }),
      ];
    }

    return [];
  }

  private mapSessionLifecycle(info: Session, eventType: string): AgentResponseObject[] {
    if (!info.parentID && eventType !== 'session.deleted') {
      return [];
    }

    const title = info.title?.trim() || info.id;
    let message: string;
    let subtype = 'subagent_session';

    if (eventType === 'session.created') {
      message = info.parentID ? `Subagent session started: ${title}` : `Session started: ${title}`;
    } else if (eventType === 'session.deleted') {
      message = info.parentID ? `Subagent session ended: ${title}` : `Session ended: ${title}`;
      subtype = info.parentID ? 'subagent_session' : 'session';
    } else {
      if (!info.parentID) {
        return [];
      }

      message = `Subagent session updated: ${title}`;
    }

    return [
      this.statusEvent(message, subtype, {
        session_id: info.id,
        ...(info.parentID ? { parent_session_id: info.parentID } : {}),
        name: title,
      }),
    ];
  }

  private mapSubtaskPart(part: SubtaskPart, toolState: OpenCodeToolCallState): AgentResponseObject[] {
    const callId = part.id;

    if (!toolState.emittedCalls.has(callId)) {
      toolState.emittedCalls.add(callId);

      return [
        {
          type: 'tool_call',
          subtype: 'subagent',
          toolCallId: callId,
          name: 'subagent',
          status: 'running',
          args: {
            agent: part.agent,
            description: part.description,
            prompt: part.prompt,
          },
          session_id: part.sessionID,
        },
      ];
    }

    return [];
  }

  private mapAgentMentionPart(part: AgentPart): AgentResponseObject[] {
    return [
      this.statusEvent(`Mentioned agent @${part.name}`, 'agent_mention', {
        name: part.name,
        session_id: part.sessionID,
      }),
    ];
  }

  private mapToolPart(part: ToolPart, toolState: OpenCodeToolCallState): AgentResponseObject[] {
    const name = part.tool || 'tool';

    // `question.asked` already drives the interactive Question UI; skip the duplicate tool frames.
    if (name === 'question') {
      return [];
    }

    const callId = part.callID || part.id;
    const state = part.state;
    const isSubagentTask = name === 'task' || name === 'subagent';
    const displayName = isSubagentTask ? 'subagent' : name;
    const subtype = isSubagentTask ? 'subagent' : undefined;
    const enrichedArgs =
      state.input !== undefined
        ? isSubagentTask
          ? {
              ...state.input,
              ...(typeof state.input['subagent_type'] === 'string' ? { agent: state.input['subagent_type'] } : {}),
            }
          : state.input
        : undefined;

    if (state.status === 'completed' || state.status === 'error') {
      return [
        {
          type: 'tool_result',
          ...(subtype ? { subtype } : {}),
          toolCallId: callId,
          name: displayName,
          result: state.status === 'completed' ? state.output : state.error,
          isError: state.status === 'error',
          // Keep input on the result so UI embeds work when the call frame was skipped or dropped.
          ...(enrichedArgs !== undefined ? { args: enrichedArgs } : {}),
          ...('title' in state && typeof state.title === 'string' ? { title: state.title } : {}),
        },
      ];
    }

    if (!toolState.emittedCalls.has(callId)) {
      toolState.emittedCalls.add(callId);

      return [
        {
          type: 'tool_call',
          ...(subtype ? { subtype } : {}),
          toolCallId: callId,
          name: displayName,
          status: state.status === 'pending' ? 'pending' : 'running',
          ...(enrichedArgs !== undefined ? { args: enrichedArgs } : {}),
        },
      ];
    }

    return [];
  }
}
