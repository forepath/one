import {
  AGENT_CONTENT_FINDING_SEVERITIES,
  AGENT_CONTENT_LIMITS,
  AGENT_CONTENT_TICKET_PRIORITIES,
  AGENT_CONTENT_TICKET_STATUSES,
  isAgentContentWriteOperation,
  parseAgentContextRef,
  parseAgentTaskIdFromResumeSessionSuffix,
  type AgentContentChangeRequest,
  type AgentContentChangeResponse,
  type AgentContentChangeSource,
  type AgentContentControllerChange,
  type AgentContentWriteOperation,
} from '@forepath/agenstra/shared/util-opencode-config';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';

import {
  AGENT_CONTEXT_ACCESS_REQUEST_TTL_MS,
  AGENT_CONTEXT_ACCESS_WAIT_MS,
  AGENT_CONTEXT_CHANGE_PREVIEW_LENGTH,
  AGENT_CONTEXT_CHANGE_REQUEST_ID_PREFIX,
} from '../constants/agent-context.constants';
import { isTicketAutomationResumeSessionSuffix } from '../constants/chat-session.constants';
import type { AgentContextTicketRecord } from '../types/agent-context.types';

import type { AgentContextAccessReply } from './agent-context-access.service';
import { AgentContextApiService } from './agent-context-api.service';
import { AgentContextTicketsService } from './agent-context-tickets.service';

type ContentKind = 'ticket' | 'knowledge' | 'plan' | 'initiative';

/** Session key of tickets minted for hidden sessions (see the agents gateway). */
const AUTO_SESSION_KEY_PREFIX = 'suffix:';

const REVISION_MAX_LENGTH = 64;

/** A change waiting for the user (interactive chats). */
interface PendingChange {
  id: string;
  agentId: string;
  ticket: string;
  operation: AgentContentWriteOperation;
  change: AgentContentControllerChange;
  grantKey: string;
  result?: AgentContentChangeResponse;
  createdAt: number;
}

/** Validated change of the agent: refs still as the agent wrote them. */
interface ParsedChange {
  request: AgentContentChangeRequest;
  target?: { kind: ContentKind; sha: string };
  parent?: { kind: ContentKind; sha: string };
}

function kindOf(operation: AgentContentWriteOperation): ContentKind {
  if (operation.startsWith('ticket.')) {
    return 'ticket';
  }

  if (operation.startsWith('initiative.')) {
    return 'initiative';
  }

  return operation.startsWith('plan.') ? 'plan' : 'knowledge';
}

const WORK_ITEM_KEY = /^E\d{1,4}(?:\.S\d{1,4})?$/;

/** Structured parts of an initiative proposal: arrays of objects, bounded; the controller validates their shape. */
function optionalObjectList(value: unknown, field: string): unknown[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (
    !Array.isArray(value) ||
    value.length > AGENT_CONTENT_LIMITS.initiativeProposalItemsMax ||
    value.some((entry) => !entry || typeof entry !== 'object' || Array.isArray(entry))
  ) {
    throw new BadRequestException(
      `${field} must be a list of at most ${AGENT_CONTENT_LIMITS.initiativeProposalItemsMax} objects`,
    );
  }

  return value;
}

function isCreate(operation: AgentContentWriteOperation): boolean {
  return operation === 'ticket.create' || operation === 'page.create';
}

function optionalText(value: unknown, field: string, maxLength: number): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw new BadRequestException(`${field} must be a string`);
  }

  if (value.length > maxLength) {
    throw new BadRequestException(`${field} must be at most ${maxLength} characters`);
  }

  return value;
}

function requiredText(value: unknown, field: string, maxLength: number): string {
  const text = optionalText(value, field, maxLength)?.trim();

  if (!text) {
    throw new BadRequestException(`${field} is required`);
  }

  return text;
}

function oneOf<T extends string>(value: unknown, field: string, allowed: readonly T[]): T | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new BadRequestException(`${field} must be one of ${allowed.join(', ')}`);
  }

  return value as T;
}

function quote(value: string, maxLength = 120): string {
  const collapsed = value.replace(/\s+/g, ' ').trim();

  return JSON.stringify(collapsed.length <= maxLength ? collapsed : `${collapsed.slice(0, maxLength - 1)}…`);
}

/**
 * Content changes of tickets / knowledge pages / plans (update only) requested by the worker `agenstra` MCP server (`agenstra_content_*`).
 * Same gates as reading context, plus a decision per change:
 * - only elements the ticket may read (granted or created by this ticket) are changed or receive children;
 * - `ask` (visible chats): the user approves each change ("allow for this chat" covers the same operation on the same
 *   element); `deny` (hidden helper sessions): never;
 * - `auto`: plans never; unattended task runs / ticket automation forward the change with their source, and the
 *   controller only applies operations a workspace user allowed for that task / automation.
 */
@Injectable()
export class AgentContextChangesService {
  private readonly logger = new Logger(AgentContextChangesService.name);
  private readonly pending = new Map<string, PendingChange>();
  private readonly waiters = new Map<string, Array<(change: PendingChange) => void>>();

  constructor(
    private readonly tickets: AgentContextTicketsService,
    private readonly api: AgentContextApiService,
  ) {}

  static isChangeRequestId(id: string): boolean {
    return id.startsWith(AGENT_CONTEXT_CHANGE_REQUEST_ID_PREFIX);
  }

  /** Validate one change of the agent (types, bounds, ref shapes); throws 400 on invalid input. */
  parse(raw: unknown): ParsedChange {
    const input = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
    const operation = input['operation'];

    if (!isAgentContentWriteOperation(operation)) {
      throw new BadRequestException('Unknown content change operation');
    }

    const kind = kindOf(operation);
    const reason = optionalText(input['reason'], 'reason', AGENT_CONTENT_LIMITS.reasonMaxLength)?.trim() || undefined;
    const parseRef = (field: 'ref' | 'parentRef'): { kind: ContentKind; sha: string } | undefined => {
      const value = input[field];

      if (value === undefined || (field === 'parentRef' && value === '')) {
        return undefined;
      }

      const parsed = typeof value === 'string' ? parseAgentContextRef(value) : null;

      if (!parsed || parsed.kind !== kind) {
        throw new BadRequestException(`${field} must be ${kind}:<sha>`);
      }

      // Narrowed above: the ref kind equals the operation's content kind.
      return parsed as { kind: ContentKind; sha: string };
    };
    const revision = (): string => requiredText(input['revision'], 'revision', REVISION_MAX_LENGTH);
    const ticketFields = () => ({
      ...(input['title'] !== undefined
        ? { title: requiredText(input['title'], 'title', AGENT_CONTENT_LIMITS.titleMaxLength) }
        : {}),
      ...(input['content'] !== undefined
        ? { content: optionalText(input['content'], 'content', AGENT_CONTENT_LIMITS.contentMaxLength) }
        : {}),
      ...(input['priority'] !== undefined
        ? { priority: oneOf(input['priority'], 'priority', AGENT_CONTENT_TICKET_PRIORITIES) }
        : {}),
      ...(input['status'] !== undefined
        ? { status: oneOf(input['status'], 'status', AGENT_CONTENT_TICKET_STATUSES) }
        : {}),
    });
    const withReason = (request: AgentContentChangeRequest): AgentContentChangeRequest =>
      reason ? { ...request, reason } : request;

    switch (operation) {
      case 'ticket.create':
      case 'page.create': {
        const parent = parseRef('parentRef');
        const title = requiredText(input['title'], 'title', AGENT_CONTENT_LIMITS.titleMaxLength);
        const content = optionalText(input['content'], 'content', AGENT_CONTENT_LIMITS.contentMaxLength);

        if (operation === 'ticket.create') {
          const { priority, status } = ticketFields();

          return {
            request: withReason({
              operation,
              title,
              ...(content !== undefined ? { content } : {}),
              ...(priority ? { priority } : {}),
              ...(status ? { status } : {}),
            }),
            parent,
          };
        }

        const nodeType = oneOf(input['nodeType'], 'nodeType', ['page', 'folder'] as const) ?? 'page';

        if (nodeType === 'folder' && content !== undefined) {
          throw new BadRequestException('Folders have no content');
        }

        return {
          request: withReason({ operation, title, nodeType, ...(content !== undefined ? { content } : {}) }),
          parent,
        };
      }
      case 'ticket.update':
      case 'page.update':
      case 'plan.update': {
        const target = parseRef('ref') as { kind: ContentKind; sha: string };
        const fields = ticketFields();

        if (!target) {
          throw new BadRequestException('ref is required');
        }

        if (operation !== 'ticket.update' && (fields.priority !== undefined || fields.status !== undefined)) {
          throw new BadRequestException(
            operation === 'plan.update'
              ? 'Plans have no priority or status'
              : 'Knowledge pages have no priority or status',
          );
        }

        if (operation === 'plan.update' && fields.content !== undefined && !fields.content?.trim()) {
          throw new BadRequestException('A plan must not be empty');
        }

        if (Object.keys(fields).length === 0) {
          throw new BadRequestException('Provide at least one field to change');
        }

        return {
          request: withReason({ operation, ref: `${target.kind}:${target.sha}`, revision: revision(), ...fields }),
          target,
        };
      }
      case 'initiative.propose': {
        const target = parseRef('ref');

        if (!target) {
          throw new BadRequestException('ref is required');
        }

        const artifacts = optionalObjectList(input['artifacts'], 'artifacts');
        const workItems = optionalObjectList(input['workItems'], 'workItems');
        const decisions = optionalObjectList(input['decisions'], 'decisions');

        if (!artifacts?.length && !workItems?.length && !decisions?.length) {
          throw new BadRequestException('Propose at least one document, work item change or decision');
        }

        if (
          JSON.stringify({ artifacts, workItems, decisions }).length > AGENT_CONTENT_LIMITS.initiativeProposalMaxLength
        ) {
          throw new BadRequestException(
            `A proposal must be at most ${AGENT_CONTENT_LIMITS.initiativeProposalMaxLength} characters`,
          );
        }

        const rationale = optionalText(input['rationale'], 'rationale', AGENT_CONTENT_LIMITS.commentMaxLength)?.trim();

        return {
          request: withReason({
            operation,
            ref: `${target.kind}:${target.sha}`,
            title: requiredText(input['title'], 'title', AGENT_CONTENT_LIMITS.titleMaxLength),
            ...(rationale ? { rationale } : {}),
            ...(artifacts ? { artifacts } : {}),
            ...(workItems ? { workItems } : {}),
            ...(decisions ? { decisions } : {}),
          }),
          target,
        };
      }
      case 'initiative.finding': {
        const target = parseRef('ref');

        if (!target) {
          throw new BadRequestException('ref is required');
        }

        const itemKey = optionalText(input['itemKey'], 'itemKey', 16)?.trim();

        if (itemKey && !WORK_ITEM_KEY.test(itemKey)) {
          throw new BadRequestException('itemKey must be a work item key like E1 or E1.S2');
        }

        const evidence = input['evidence'];

        if (
          evidence !== undefined &&
          (!Array.isArray(evidence) ||
            evidence.length > 20 ||
            evidence.some((entry) => typeof entry !== 'string' || entry.length > 500))
        ) {
          throw new BadRequestException('evidence must be a list of at most 20 short strings');
        }

        const severity = oneOf(input['severity'], 'severity', AGENT_CONTENT_FINDING_SEVERITIES);

        return {
          request: withReason({
            operation,
            ref: `${target.kind}:${target.sha}`,
            body: requiredText(input['body'], 'body', AGENT_CONTENT_LIMITS.initiativeFindingMaxLength),
            ...(severity ? { severity } : {}),
            ...(itemKey ? { itemKey } : {}),
            ...(evidence ? { evidence: evidence as string[] } : {}),
          }),
          target,
        };
      }
      case 'ticket.comment': {
        const target = parseRef('ref');

        if (!target) {
          throw new BadRequestException('ref is required');
        }

        return {
          request: withReason({
            operation,
            ref: `${target.kind}:${target.sha}`,
            body: requiredText(input['body'], 'body', AGENT_CONTENT_LIMITS.commentMaxLength),
          }),
          target,
        };
      }
      case 'ticket.delete':
      case 'page.delete': {
        const target = parseRef('ref');

        if (!target) {
          throw new BadRequestException('ref is required');
        }

        return {
          request: withReason({ operation, ref: `${target.kind}:${target.sha}`, revision: revision() }),
          target,
        };
      }
    }
  }

  async requestChange(record: AgentContextTicketRecord, parsed: ParsedChange): Promise<AgentContentChangeResponse> {
    const { request } = parsed;
    const denied = (message: string): AgentContentChangeResponse => ({
      requestId: '',
      decision: 'denied',
      operation: request.operation,
      message,
    });

    if (record.accessMode === 'deny') {
      return denied('Content cannot be changed in this session.');
    }

    const source = this.resolveSource(record);

    if (!source) {
      return denied('Plans and background sessions are read-only: describe the change instead of making it.');
    }

    if (record.accessMode === 'auto' && !this.api.isExclusiveAutoSession(record)) {
      return denied(
        'Content cannot be changed automatically while other sessions of this agent are working. Try again later.',
      );
    }

    if (record.changeCount >= AGENT_CONTENT_LIMITS.maxChangesPerTicket) {
      return denied(`At most ${AGENT_CONTENT_LIMITS.maxChangesPerTicket} content changes per turn.`);
    }

    const target = parsed.target ? await this.resolveReadable(record, parsed.target) : undefined;
    const parent = parsed.parent ? await this.resolveReadable(record, parsed.parent) : undefined;

    if ((parsed.target && !target) || (parsed.parent && !parent)) {
      const ref = parsed.target ?? parsed.parent;

      return denied(
        `${ref?.kind}:${ref?.sha} is not readable in this session (or a short SHA is ambiguous: use the full SHA). ` +
          'Request access with context_request_access first.',
      );
    }

    record.changeCount += 1;

    const change = this.toControllerChange(request, target?.sha, parent?.sha);
    const grantKey = this.grantKey(request.operation, target ?? parent);

    if (record.accessMode === 'auto' || this.tickets.hasWriteGrant(record, grantKey)) {
      return this.apply(record, '', change, source);
    }

    const pending: PendingChange = {
      id: `${AGENT_CONTEXT_CHANGE_REQUEST_ID_PREFIX}${randomBytes(12).toString('hex')}`,
      agentId: record.agentId,
      ticket: record.ticket,
      operation: request.operation,
      change,
      grantKey,
      createdAt: Date.now(),
    };

    this.purgeExpired();
    this.pending.set(pending.id, pending);
    this.api.publishChangeQuestion(record, pending.id, this.buildPrompt(request, target ?? parent, parent));

    return this.awaitDecision(pending);
  }

  /** Re-wait on a pending change (agent polls after a `pending` response). */
  async changeStatus(record: AgentContextTicketRecord, requestId: string): Promise<AgentContentChangeResponse> {
    const pending = this.get(record.agentId, requestId);

    if (pending.ticket !== record.ticket) {
      throw new NotFoundException('Unknown or expired content change request');
    }

    return this.awaitDecision(pending);
  }

  /**
   * Apply a user's decision (permission reply endpoint). The change is made here, so a decision made after the MCP
   * call stopped waiting still takes effect; later replies (e.g. a second console tab) are ignored.
   */
  async decide(agentId: string, requestId: string, reply: AgentContextAccessReply): Promise<string[]> {
    const pending = this.get(agentId, requestId);

    if (pending.result) {
      return [requestId];
    }

    if (reply === 'reject') {
      this.settle(pending, {
        requestId,
        decision: 'denied',
        operation: pending.operation,
        message: 'The user rejected the change.',
      });

      return [requestId];
    }

    // Claimed before the (asynchronous) apply: concurrent replies must not apply the change twice.
    pending.result = { requestId, decision: 'pending', operation: pending.operation };

    let record: AgentContextTicketRecord;

    try {
      record = this.tickets.resolve(agentId, pending.ticket);
    } catch {
      this.settle(pending, {
        requestId,
        decision: 'failed',
        operation: pending.operation,
        message: 'The turn that requested this change has ended.',
      });

      return [requestId];
    }

    if (reply === 'always') {
      this.tickets.grantWrite(record, pending.grantKey, 'session');
    }

    this.settle(pending, await this.apply(record, requestId, pending.change, { kind: 'chat' }));

    return [requestId];
  }

  /**
   * Visible chats ask; unattended runs name their task (the controller checks its approved content writes) or the
   * ticket automation; plans and every other hidden session cannot change anything.
   */
  private resolveSource(record: AgentContextTicketRecord): AgentContentChangeSource | undefined {
    if (record.accessMode === 'ask') {
      return { kind: 'chat' };
    }

    const suffix = record.sessionKey.startsWith(AUTO_SESSION_KEY_PREFIX)
      ? record.sessionKey.slice(AUTO_SESSION_KEY_PREFIX.length)
      : undefined;
    const taskId = parseAgentTaskIdFromResumeSessionSuffix(suffix);

    if (taskId) {
      return { kind: 'task', taskId };
    }

    if (isTicketAutomationResumeSessionSuffix(suffix)) {
      return { kind: 'automation' };
    }

    return undefined;
  }

  /** Exact element (full SHA) for a ref the ticket may read: granted, or created by a change of this ticket. */
  private async resolveReadable(
    record: AgentContextTicketRecord,
    ref: { kind: ContentKind; sha: string },
  ): Promise<{ kind: ContentKind; sha: string; title?: string } | undefined> {
    if (!this.tickets.isGranted(record, ref.kind, ref.sha) && !this.tickets.isCreated(record, ref.kind, ref.sha)) {
      return undefined;
    }

    const [resolved] = await this.api.resolveRefs(record, [ref]);

    // A grant always names a full SHA; the resolved element must be one of the granted ones (never "some" element a
    // short ref happens to match).
    if (
      !resolved ||
      (!this.tickets.isGranted(record, resolved.kind, resolved.sha) &&
        !this.tickets.isCreated(record, resolved.kind, resolved.sha))
    ) {
      return undefined;
    }

    // Same kind as the readable ref (resolution never changes the kind).
    return { ...resolved, kind: ref.kind };
  }

  private toControllerChange(
    request: AgentContentChangeRequest,
    targetSha: string | undefined,
    parentSha: string | undefined,
  ): AgentContentControllerChange {
    // The controller receives resolved SHAs only (never the agent's refs) and no reason.
    const fields: Record<string, unknown> = { ...request };

    delete fields['reason'];
    delete fields['ref'];
    delete fields['parentRef'];

    return {
      ...fields,
      ...(targetSha ? { sha: targetSha } : {}),
      ...(parentSha ? { parentSha } : {}),
    } as AgentContentControllerChange;
  }

  private grantKey(operation: AgentContentWriteOperation, ref: { kind: ContentKind; sha: string } | undefined): string {
    return `${operation}|${ref ? `${ref.kind}:${ref.sha}` : 'root'}`;
  }

  private async apply(
    record: AgentContextTicketRecord,
    requestId: string,
    change: AgentContentControllerChange,
    source: AgentContentChangeSource,
  ): Promise<AgentContentChangeResponse> {
    const operation = change.operation;
    let response;

    try {
      response = await this.api.requestController(record, { op: 'change', agentId: record.agentId, change, source });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.warn(`Content change ${operation} for agent ${record.agentId} failed: ${message}`);

      return { requestId, decision: 'failed', operation, message: 'Content changes are unavailable right now.' };
    }

    if (response.ok === false || !response.changed) {
      const status = response.ok === false ? response.status : undefined;

      return {
        requestId,
        decision: status === 403 ? 'denied' : 'failed',
        operation,
        message: (response.ok === false && response.error) || 'The change could not be applied.',
      };
    }

    const changed = response.changed;
    const sha = changed.sha.toLowerCase();

    if (isCreate(operation)) {
      this.tickets.rememberCreated(record, changed.kind, sha);
    } else {
      this.tickets.invalidateItem(record, changed.kind, sha);
    }

    return {
      requestId,
      decision: 'applied',
      operation,
      ref: `${changed.kind}:${sha}`,
      title: changed.title,
      ...(changed.revision ? { revision: changed.revision } : {}),
      ...(changed.deleted ? { message: 'Deleted.' } : {}),
    };
  }

  private buildPrompt(
    request: AgentContentChangeRequest,
    target: { kind: ContentKind; sha: string; title?: string } | undefined,
    parent: { kind: ContentKind; sha: string; title?: string } | undefined,
  ): string {
    const label = (ref: { kind: ContentKind; sha: string; title?: string }) =>
      `${ref.kind} ${ref.sha.slice(0, 8)}${ref.title ? ` ${quote(ref.title)}` : ''}`;
    const preview = (value: string) => {
      const trimmed = value.trim();

      return trimmed.length <= AGENT_CONTEXT_CHANGE_PREVIEW_LENGTH
        ? trimmed
        : `${trimmed.slice(0, AGENT_CONTEXT_CHANGE_PREVIEW_LENGTH)}… (${trimmed.length} characters)`;
    };
    const fields = request as Partial<Record<'title' | 'content' | 'priority' | 'status' | 'body', string>>;
    const lines: string[] = [];

    switch (request.operation) {
      case 'ticket.create':
        lines.push(`The agent wants to create a ticket${parent ? ` below ${label(parent)}` : ''}.`);
        break;
      case 'page.create':
        lines.push(
          `The agent wants to create a knowledge ${request.nodeType === 'folder' ? 'folder' : 'page'}` +
            `${parent ? ` in ${label(parent)}` : ''}.`,
        );
        break;
      case 'ticket.comment':
        lines.push(`The agent wants to comment on ${label(target as NonNullable<typeof target>)}.`);
        break;
      case 'ticket.delete':
      case 'page.delete':
        lines.push(`The agent wants to delete ${label(target as NonNullable<typeof target>)}.`);
        break;
      case 'plan.update':
        lines.push(
          `The agent wants to change ${label(target as NonNullable<typeof target>)} (not executed yet; the new ` +
            'version is what runs when the plan is executed).',
        );
        break;
      case 'initiative.propose': {
        const counts = [
          request.artifacts?.length ? `${request.artifacts.length} document(s)` : undefined,
          request.workItems?.length ? `${request.workItems.length} work item change(s)` : undefined,
          request.decisions?.length ? `${request.decisions.length} decision(s)` : undefined,
        ].filter(Boolean);

        lines.push(
          `The agent wants to propose a change to ${label(target as NonNullable<typeof target>)}: ` +
            `${counts.join(', ')}. Nothing changes until a user accepts the proposal on the Initiatives page.`,
        );

        if (request.rationale) lines.push('Rationale:', preview(request.rationale));
        break;
      }
      case 'initiative.finding':
        lines.push(
          `The agent wants to record a ${request.severity ?? 'minor'} finding on ` +
            `${label(target as NonNullable<typeof target>)}${request.itemKey ? ` (${request.itemKey})` : ''}.`,
          'Finding:',
          preview(request.body),
        );
        break;
      default:
        lines.push(`The agent wants to change ${label(target as NonNullable<typeof target>)}.`);
    }

    if (fields.title !== undefined) lines.push(`Title: ${quote(fields.title, 200)}`);
    if (fields.status !== undefined) lines.push(`Status: ${fields.status}`);
    if (fields.priority !== undefined) lines.push(`Priority: ${fields.priority}`);
    if (fields.content !== undefined) {
      lines.push(
        isCreate(request.operation) ? 'Content:' : 'New content (replaces the current one):',
        preview(fields.content),
      );
    }
    if (fields.body !== undefined && request.operation === 'ticket.comment')
      lines.push('Comment:', preview(fields.body));
    if (request.reason) lines.push(`Reason: ${request.reason.replace(/\s+/g, ' ').trim()}`);

    return lines.join('\n');
  }

  private async awaitDecision(pending: PendingChange): Promise<AgentContentChangeResponse> {
    const decided = await this.waitForDecision(pending, AGENT_CONTEXT_ACCESS_WAIT_MS);

    if (decided.result && decided.result.decision !== 'pending') {
      return decided.result;
    }

    return {
      requestId: pending.id,
      decision: 'pending',
      operation: pending.operation,
      message: 'Waiting for the user. Call content_change_status with this requestId to keep waiting.',
    };
  }

  private waitForDecision(pending: PendingChange, timeoutMs: number): Promise<PendingChange> {
    if (pending.result && pending.result.decision !== 'pending') {
      return Promise.resolve(pending);
    }

    return new Promise((resolve) => {
      const waiter = (decided: PendingChange) => {
        clearTimeout(timer);
        resolve(decided);
      };
      const timer = setTimeout(() => {
        this.waiters.set(
          pending.id,
          (this.waiters.get(pending.id) ?? []).filter((entry) => entry !== waiter),
        );
        resolve(pending);
      }, timeoutMs);

      timer.unref?.();
      this.waiters.set(pending.id, [...(this.waiters.get(pending.id) ?? []), waiter]);
    });
  }

  private settle(pending: PendingChange, result: AgentContentChangeResponse): void {
    pending.result = result;

    const waiters = this.waiters.get(pending.id) ?? [];

    this.waiters.delete(pending.id);

    for (const waiter of waiters) {
      waiter(pending);
    }

    if (result.decision !== 'pending') {
      this.api.publishInteractionAnswered(
        pending.agentId,
        [pending.id],
        `Content change ${pending.id}: ${result.decision}`,
      );
    }
  }

  private get(agentId: string, id: string): PendingChange {
    this.purgeExpired();

    const pending = this.pending.get(id);

    if (!pending || pending.agentId !== agentId) {
      throw new NotFoundException('Unknown or expired content change request');
    }

    return pending;
  }

  private purgeExpired(): void {
    const cutoff = Date.now() - AGENT_CONTEXT_ACCESS_REQUEST_TTL_MS;

    for (const [id, pending] of this.pending.entries()) {
      if (pending.createdAt >= cutoff) {
        continue;
      }

      this.pending.delete(id);

      if (!pending.result || pending.result.decision === 'pending') {
        this.settle(pending, {
          requestId: id,
          decision: 'denied',
          operation: pending.operation,
          message: 'Nobody decided on the change in time.',
        });
      }
    }
  }
}
