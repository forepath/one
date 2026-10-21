import {
  agentContextShaMatches,
  parseAgentContextRef,
  type AgentContextAccessResponse,
  type AgentContextGetResponse,
  type AgentContextItemSummary,
  type AgentContextListResponse,
  type AgentContextSearchResponse,
} from '@forepath/agenstra/shared/util-opencode-config';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';

import {
  AGENT_CONTEXT_ACCESS_WAIT_MS,
  AGENT_CONTEXT_MAX_REFS_PER_REQUEST,
  AGENT_CONTEXT_MAX_SEARCH_RESULTS,
} from '../constants/agent-context.constants';
import type {
  AgentContextControllerContent,
  AgentContextControllerMetadata,
  AgentContextControllerRequest,
  AgentContextControllerResponse,
  AgentContextStoredItem,
  AgentContextTicketRecord,
} from '../types/agent-context.types';

import { isTicketAutomationResumeSessionSuffix } from '../constants/chat-session.constants';

import { AgentActiveTurnsService } from './agent-active-turns.service';
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
/** Session key of tickets minted for hidden sessions (see the agents gateway). */
const AUTO_SESSION_KEY_PREFIX = 'suffix:';

@Injectable()
export class AgentContextApiService {
  private readonly logger = new Logger(AgentContextApiService.name);
  private bridge?: AgentContextGatewayBridge;

  constructor(
    private readonly tickets: AgentContextTicketsService,
    private readonly access: AgentContextAccessService,
    @Optional() private readonly activeTurns?: AgentActiveTurnsService,
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

    const content = await this.fetchGrantedContent(record, ref);

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

    if (!this.bridge) {
      return { requestId: '', decision: 'denied', refs: refLabels, message: 'Context access is unavailable.' };
    }

    if (record.accessMode === 'auto' && !this.isExclusiveAutoSession(record)) {
      // The MCP call carries no session: while other sessions of the agent work, the call may come from one of them
      // (e.g. a visible chat that read this ticket from the session store), so nothing is granted automatically.
      return {
        requestId: '',
        decision: 'denied',
        refs: refLabels,
        message:
          'Additional context cannot be granted automatically while other sessions of this agent are working. ' +
          'Continue with the granted context or try again later.',
      };
    }

    // Requests and grants always name the exact elements (full SHAs) the user sees in the prompt: short or
    // ambiguous prefixes must not grant other elements later.
    const resolved = await this.resolveRefs(record, missing);

    if (resolved.length === 0) {
      return {
        requestId: '',
        decision: 'denied',
        refs: refLabels,
        message: 'None of the refs exists in this workspace (or a short SHA is ambiguous: use the full SHA).',
      };
    }

    const resolvedRefs = resolved.map(({ kind, sha }) => ({ kind, sha }));
    const alreadyGranted = refs.filter((ref) => !missing.includes(ref)).map((ref) => `${ref.kind}:${ref.sha}`);
    const resolvedLabels = [...alreadyGranted, ...resolvedRefs.map((ref) => `${ref.kind}:${ref.sha}`)];

    if (record.accessMode === 'auto') {
      return this.autoGrant(record, resolvedRefs, alreadyGranted, reason);
    }

    const request = this.access.create({
      agentId: record.agentId,
      ticket: record.ticket,
      refs: resolvedRefs,
      reason,
    });

    this.bridge.publishContextAccessQuestion(
      record,
      request.id,
      this.buildAccessPrompt(resolved, reason),
      resolvedRefs,
    );

    return this.awaitDecision(record, request.id, resolvedLabels);
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

  /**
   * Nobody can answer in hidden sessions, so requests are decided by a scope the controller derives from what the
   * platform granted the run: unattended ticket automation may read tickets of the same ticket tree; plans and task
   * runs get nothing beyond their pre-granted context. Grants are bound to this ticket (this turn) only.
   */
  private async autoGrant(
    record: AgentContextTicketRecord,
    refs: ContentRef[],
    alreadyGranted: string[],
    reason: string | undefined,
  ): Promise<AgentContextAccessResponse> {
    const suffix = record.sessionKey.startsWith(AUTO_SESSION_KEY_PREFIX)
      ? record.sessionKey.slice(AUTO_SESSION_KEY_PREFIX.length)
      : undefined;
    let inScope: ContentRef[] = [];

    if (isTicketAutomationResumeSessionSuffix(suffix) && record.scopeAnchors.length > 0) {
      const response = await this.callController(record, {
        op: 'scope',
        agentId: record.agentId,
        refs,
        anchors: record.scopeAnchors,
      });
      const allowed = new Set((response.items ?? []).map((item) => `${item.kind}:${item.sha.toLowerCase()}`));

      inScope = refs.filter((ref) => allowed.has(`${ref.kind}:${ref.sha}`));
    }

    const refused = refs.filter((ref) => !inScope.includes(ref)).map((ref) => `${ref.kind}:${ref.sha}`);
    const scopeMessage =
      refused.length > 0
        ? `Outside the context this run may read on its own (${refused.join(', ')}); continue with the granted context.`
        : undefined;

    if (inScope.length === 0) {
      return {
        requestId: '',
        decision: 'denied',
        refs: [...alreadyGranted, ...refused],
        message: scopeMessage,
      };
    }

    const request = this.access.create({ agentId: record.agentId, ticket: record.ticket, refs: inScope, reason });

    this.decideAccess(record.agentId, request.id, 'once');

    return {
      requestId: request.id,
      decision: 'granted',
      refs: [...alreadyGranted, ...inScope.map((ref) => `${ref.kind}:${ref.sha}`)],
      ...(scopeMessage ? { message: scopeMessage } : {}),
    };
  }

  /** Auto-approval tickets belong to one hidden session (`suffix:<resumeSessionSuffix>`), which must be all that runs. */
  private isExclusiveAutoSession(record: AgentContextTicketRecord): boolean {
    if (!this.activeTurns) {
      return true;
    }

    if (!record.sessionKey.startsWith(AUTO_SESSION_KEY_PREFIX)) {
      return false;
    }

    return this.activeTurns.isOnlyRunningHiddenSession(
      record.agentId,
      record.sessionKey.slice(AUTO_SESSION_KEY_PREFIX.length),
    );
  }

  /**
   * Resolve refs to the exact elements (full SHA + title) of the workspace. The controller resolves a short SHA only
   * when it is unique; unknown or ambiguous refs are dropped.
   */
  private async resolveRefs(
    record: AgentContextTicketRecord,
    refs: ContentRef[],
  ): Promise<Array<ContentRef & { title?: string }>> {
    const response = await this.callController(record, { op: 'describe', agentId: record.agentId, refs });
    const items = response.items ?? [];
    const resolved = new Map<string, ContentRef & { title?: string }>();

    for (const ref of refs) {
      const item = items.find((entry) => entry.kind === ref.kind && entry.sha.toLowerCase().startsWith(ref.sha));

      if (item) {
        const sha = item.sha.toLowerCase();

        resolved.set(`${ref.kind}:${sha}`, { kind: ref.kind, sha, title: item.title });
      }
    }

    return [...resolved.values()];
  }

  /**
   * Content of a granted element: fetched by each compatible granted SHA (never by the agent's own ref), and only
   * returned when it is the element the agent asked for.
   */
  private async fetchGrantedContent(
    record: AgentContextTicketRecord,
    ref: ContentRef,
  ): Promise<AgentContextControllerContent | undefined> {
    for (const granted of this.tickets.matchingGrants(record, ref.kind, ref.sha)) {
      const response = await this.callController(record, {
        op: 'content',
        agentId: record.agentId,
        refs: [{ kind: ref.kind, sha: granted }],
      });
      const content = (response.contents ?? []).find(
        (entry) =>
          entry.kind === ref.kind &&
          entry.sha.toLowerCase().startsWith(granted) &&
          agentContextShaMatches(entry.sha.toLowerCase(), ref.sha),
      );

      if (content) {
        return content;
      }
    }

    return undefined;
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
