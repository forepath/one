import {
  parseAgentContextRef,
  type AgentContextAccessResponse,
  type AgentContextGetResponse,
  type AgentContextItemSummary,
  type AgentContextListResponse,
  type AgentContextSearchResponse,
} from '@forepath/agenstra/shared/util-opencode-config';
import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import {
  AGENT_CONTEXT_ACCESS_WAIT_MS,
  AGENT_CONTEXT_MAX_REFS_PER_REQUEST,
  AGENT_CONTEXT_MAX_SEARCH_RESULTS,
} from '../constants/agent-context.constants';
import type {
  AgentContextControllerMetadata,
  AgentContextControllerRequest,
  AgentContextControllerResponse,
  AgentContextStoredItem,
  AgentContextTicketRecord,
} from '../types/agent-context.types';

import { AgentContextAccessService, type AgentContextAccessReply } from './agent-context-access.service';
import { AgentContextTicketsService } from './agent-context-tickets.service';

type ContentRef = { kind: 'ticket' | 'knowledge'; sha: string };

/**
 * Runtime hooks provided by the agents gateway (registered on module init) so this service does
 * not depend on the gateway directly.
 */
export interface AgentContextGatewayBridge {
  /** Ask a connected controller socket of this agent to resolve metadata / content. */
  requestControllerContext(
    record: AgentContextTicketRecord,
    request: AgentContextControllerRequest,
  ): Promise<AgentContextControllerResponse>;
  /** Show a permission-style "allow context access" prompt in the agent's chat. */
  publishContextAccessQuestion(
    record: AgentContextTicketRecord,
    requestId: string,
    prompt: string,
    refs: ContentRef[],
  ): void;
  /** Mark the prompt answered (persisted status frame). */
  publishInteractionAnswered(agentId: string, questionIds: string[], message?: string): void;
}

function summarize(item: AgentContextStoredItem): AgentContextItemSummary {
  return {
    ref: `item:${item.index}`,
    kind: item.kind,
    title: item.title,
    ...(item.sha ? { sha: item.sha } : {}),
    size: item.content.length,
    granted: true,
  };
}

/**
 * Agent-facing context API (called by the worker MCP server). Every method receives a ticket
 * record that was already resolved for the authenticated agent.
 */
@Injectable()
export class AgentContextApiService {
  private readonly logger = new Logger(AgentContextApiService.name);
  private bridge?: AgentContextGatewayBridge;

  constructor(
    private readonly tickets: AgentContextTicketsService,
    private readonly access: AgentContextAccessService,
  ) {}

  registerBridge(bridge: AgentContextGatewayBridge): void {
    this.bridge = bridge;
  }

  list(record: AgentContextTicketRecord): AgentContextListResponse {
    return {
      ticket: record.ticket,
      items: record.items.map(summarize),
      attachments: record.attachments,
      ...(record.workspace ? { workspace: record.workspace } : {}),
      environments: record.environments,
      canRequestAccess: record.accessMode !== 'deny',
    };
  }

  async search(
    record: AgentContextTicketRecord,
    query: string | undefined,
    kinds: Array<'ticket' | 'knowledge'> | undefined,
    limit: number | undefined,
  ): Promise<AgentContextSearchResponse> {
    const boundedLimit = Math.min(Math.max(1, limit ?? 20), AGENT_CONTEXT_MAX_SEARCH_RESULTS);
    const response = await this.callController(record, {
      op: 'search',
      agentId: record.agentId,
      query: query?.trim() || undefined,
      kinds: kinds?.length ? kinds : undefined,
      limit: boundedLimit,
    });

    return {
      items: (response.items ?? []).slice(0, boundedLimit).map((meta) => this.toSummary(record, meta)),
    };
  }

  async get(record: AgentContextTicketRecord, rawRef: string): Promise<AgentContextGetResponse> {
    const ref = parseAgentContextRef(rawRef);

    if (!ref) {
      throw new BadRequestException('ref must be item:<n>, ticket:<sha> or knowledge:<sha>');
    }

    if (ref.kind === 'item') {
      const item = this.tickets.findItemByIndex(record, ref.index);

      if (!item) {
        throw new NotFoundException(`No context item ${rawRef} for this ticket`);
      }

      return { ref: `item:${item.index}`, kind: item.kind, title: item.title, content: item.content };
    }

    if (!this.tickets.isGranted(record, ref.kind, ref.sha)) {
      throw new ForbiddenException(
        `Access to ${ref.kind}:${ref.sha} is not granted. Request it with context_request_access first.`,
      );
    }

    const cached = this.tickets.findItemBySha(record, ref.kind, ref.sha);

    if (cached) {
      return { ref: `${cached.kind}:${cached.sha}`, kind: cached.kind, title: cached.title, content: cached.content };
    }

    const response = await this.callController(record, { op: 'content', agentId: record.agentId, refs: [ref] });
    const content = (response.contents ?? []).find((entry) => entry.kind === ref.kind);

    if (!content) {
      throw new NotFoundException(`${ref.kind}:${ref.sha} was not found in this workspace`);
    }

    const stored = this.tickets.rememberItem(record, {
      kind: content.kind,
      sha: content.sha.toLowerCase(),
      title: content.title,
      content: content.content,
    });

    return { ref: `${stored.kind}:${stored.sha}`, kind: stored.kind, title: stored.title, content: stored.content };
  }

  async requestAccess(
    record: AgentContextTicketRecord,
    rawRefs: string[],
    reason: string | undefined,
  ): Promise<AgentContextAccessResponse> {
    const refs = this.parseContentRefs(rawRefs);
    const missing = refs.filter((ref) => !this.tickets.isGranted(record, ref.kind, ref.sha));
    const refLabels = refs.map((ref) => `${ref.kind}:${ref.sha}`);

    if (missing.length === 0) {
      return { requestId: '', decision: 'granted', refs: refLabels };
    }

    if (record.accessMode === 'deny') {
      return {
        requestId: '',
        decision: 'denied',
        refs: refLabels,
        message: 'Additional context cannot be requested in this session.',
      };
    }

    const request = this.access.create({ agentId: record.agentId, ticket: record.ticket, refs: missing, reason });

    if (record.accessMode === 'auto') {
      // Auto-approval sessions (unattended automation, read-only plans) never ask.
      this.decideAccess(record.agentId, request.id, 'always');

      return { requestId: request.id, decision: 'granted', refs: refLabels };
    }

    if (!this.bridge) {
      return { requestId: request.id, decision: 'denied', refs: refLabels, message: 'Context access is unavailable.' };
    }

    const described = await this.describeRefs(record, missing);

    this.bridge.publishContextAccessQuestion(record, request.id, this.buildAccessPrompt(described, reason), missing);

    return this.awaitDecision(record, request.id, refLabels);
  }

  /** Re-wait on a pending request (agent polls after a `pending` response). */
  async accessStatus(record: AgentContextTicketRecord, requestId: string): Promise<AgentContextAccessResponse> {
    const request = this.access.get(record.agentId, requestId);

    if (request.ticket !== record.ticket) {
      throw new NotFoundException('Unknown or expired context access request');
    }

    return this.awaitDecision(
      record,
      requestId,
      request.refs.map((ref) => `${ref.kind}:${ref.sha}`),
    );
  }

  /**
   * Apply a user's decision (permission reply endpoint). Grants are applied here so a decision made
   * after the MCP call stopped waiting still takes effect for the next `context_get`.
   */
  decideAccess(agentId: string, requestId: string, reply: AgentContextAccessReply): string[] {
    const request = this.access.decide(agentId, requestId, reply);

    if (request.decision === 'granted' && request.reply === reply) {
      try {
        const record = this.tickets.resolve(agentId, request.ticket);

        this.tickets.grant(record, request.refs, reply === 'always' ? 'session' : 'once');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        this.logger.debug(`Context grant for ${requestId} skipped: ${message}`);
      }
    }

    return [requestId];
  }

  private async awaitDecision(
    record: AgentContextTicketRecord,
    requestId: string,
    refLabels: string[],
  ): Promise<AgentContextAccessResponse> {
    const decided = await this.access.waitForDecision(record.agentId, requestId, AGENT_CONTEXT_ACCESS_WAIT_MS);

    if (decided.decision === 'pending') {
      return {
        requestId,
        decision: 'pending',
        refs: refLabels,
        message: 'Waiting for the user. Call context_request_access again with this requestId to keep waiting.',
      };
    }

    return {
      requestId,
      decision: decided.decision,
      refs: refLabels,
      ...(decided.decision === 'denied' ? { message: 'The user denied access.' } : {}),
    };
  }

  private parseContentRefs(rawRefs: string[]): ContentRef[] {
    if (!Array.isArray(rawRefs) || rawRefs.length === 0) {
      throw new BadRequestException('refs must contain at least one ticket:<sha> or knowledge:<sha>');
    }

    if (rawRefs.length > AGENT_CONTEXT_MAX_REFS_PER_REQUEST) {
      throw new BadRequestException(`At most ${AGENT_CONTEXT_MAX_REFS_PER_REQUEST} refs per request`);
    }

    const refs = new Map<string, ContentRef>();

    for (const raw of rawRefs) {
      const parsed = typeof raw === 'string' ? parseAgentContextRef(raw) : null;

      if (!parsed || parsed.kind === 'item') {
        throw new BadRequestException(`Invalid ref '${String(raw)}' (expected ticket:<sha> or knowledge:<sha>)`);
      }

      refs.set(`${parsed.kind}:${parsed.sha}`, parsed);
    }

    return [...refs.values()];
  }

  private async describeRefs(
    record: AgentContextTicketRecord,
    refs: ContentRef[],
  ): Promise<Array<ContentRef & { title?: string }>> {
    try {
      const response = await this.callController(record, { op: 'describe', agentId: record.agentId, refs });
      const items = response.items ?? [];

      return refs.map((ref) => ({
        ...ref,
        title: items.find((item) => item.kind === ref.kind && item.sha.toLowerCase().startsWith(ref.sha))?.title,
      }));
    } catch {
      return refs;
    }
  }

  private buildAccessPrompt(refs: Array<ContentRef & { title?: string }>, reason: string | undefined): string {
    const labels = refs.map((ref) => {
      const short = ref.sha.slice(0, 8);

      return ref.title ? `${ref.kind} ${short} "${ref.title}"` : `${ref.kind} ${short}`;
    });
    const trimmedReason = reason?.replace(/\s+/g, ' ').trim().slice(0, 300);

    return [
      `The agent requests access to additional context: ${labels.join(', ')}.`,
      ...(trimmedReason ? [`Reason: ${trimmedReason}`] : []),
    ].join('\n');
  }

  private toSummary(record: AgentContextTicketRecord, meta: AgentContextControllerMetadata): AgentContextItemSummary {
    const sha = meta.sha.toLowerCase();

    return {
      ref: `${meta.kind}:${sha}`,
      kind: meta.kind,
      title: meta.title,
      sha,
      ...(meta.status ? { status: meta.status } : {}),
      ...(meta.priority ? { priority: meta.priority } : {}),
      ...(meta.nodeType ? { nodeType: meta.nodeType } : {}),
      ...(meta.parentSha !== undefined ? { parentSha: meta.parentSha } : {}),
      ...(meta.size !== undefined ? { size: meta.size } : {}),
      granted: this.tickets.isGranted(record, meta.kind, sha),
    };
  }

  private async callController(
    record: AgentContextTicketRecord,
    request: AgentContextControllerRequest,
  ): Promise<Extract<AgentContextControllerResponse, { ok: true }>> {
    if (!this.bridge) {
      throw new ForbiddenException('Context lookup is unavailable');
    }

    const response = await this.bridge.requestControllerContext(record, request);

    if (response.ok === false) {
      throw new NotFoundException(response.error || 'Context lookup failed');
    }

    return response;
  }
}
