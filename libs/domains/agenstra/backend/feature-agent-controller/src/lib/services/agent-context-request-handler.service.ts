import type { AgentContentChangeResult } from '@forepath/agenstra/shared/util-opencode-config';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Socket as ClientSocket } from 'socket.io-client';
import { In, Repository } from 'typeorm';

import { ChatPlanEntity } from '../entities/chat-plan.entity';
import { KnowledgeNodeEntity } from '../entities/knowledge-node.entity';
import { KnowledgeNodeType } from '../entities/knowledge-node.enums';
import { TicketEntity } from '../entities/ticket.entity';
import { buildChatPlanContextSection, chatPlanContextTitle } from '../utils/chat-plan-mappers';

import { AgentContentChangesService } from './agent-content-changes.service';
import { ChatPlanService } from './chat-plan.service';
import { InitiativeContextService, type InitiativeContextKind } from './initiative-context.service';
import { KnowledgeTreeService } from './knowledge-tree.service';
import { TicketsService } from './tickets.service';

/** Socket.IO event emitted by the agent-manager (with ack) — keep in sync with the manager constant. */
export const AGENT_CONTEXT_REQUEST_EVENT = 'agentContextRequest';

const MAX_SEARCH_LIMIT = 50;
const MAX_REFS = 20;
/** Anchor tickets of a scope check (tickets the platform granted the run). */
const MAX_SCOPE_ANCHORS = 50;
/** Ticket trees are shallow; bounded walk to the root. */
const MAX_TICKET_DEPTH = 50;
const SHA_PATTERN = /^[0-9a-f]{4,40}$/;

/**
 * Plans are agent specific: an agent only reaches the plans of its own environment. Initiatives (overview) and their
 * documents (`artifact`) are workspace wide like tickets and knowledge.
 */
type ContextKind = 'ticket' | 'knowledge' | 'plan' | InitiativeContextKind;

const CONTEXT_KINDS: readonly ContextKind[] = ['ticket', 'knowledge', 'plan', 'initiative', 'artifact'];

const isInitiativeKind = (kind: ContextKind): kind is InitiativeContextKind =>
  kind === 'initiative' || kind === 'artifact';

interface ContextRef {
  kind: ContextKind;
  sha: string;
}

export interface AgentContextMetadata {
  kind: ContextKind;
  sha: string;
  title: string;
  status?: string;
  priority?: string;
  nodeType?: string;
  parentSha?: string | null;
  size?: number;
}

export interface AgentContextContent {
  kind: ContextKind;
  sha: string;
  title: string;
  /** Element version (`updatedAt`), passed back with content changes. */
  revision: string;
  content: string;
}

export type AgentContextRequestResponse =
  | {
      ok: true;
      items?: AgentContextMetadata[];
      contents?: AgentContextContent[];
      changed?: AgentContentChangeResult;
    }
  | { ok: false; error: string; status?: number };

/**
 * Answers on-demand context requests from an agent-manager (worker `agenstra` MCP server → manager →
 * controller) over the Socket.IO connection the controller already holds. Every lookup (and content change, see
 * {@link AgentContentChangesService}) is scoped to the workspace (client) that connection belongs to.
 */
@Injectable()
export class AgentContextRequestHandlerService {
  private readonly logger = new Logger(AgentContextRequestHandlerService.name);

  constructor(
    @InjectRepository(TicketEntity)
    private readonly ticketRepo: Repository<TicketEntity>,
    @InjectRepository(KnowledgeNodeEntity)
    private readonly knowledgeNodeRepo: Repository<KnowledgeNodeEntity>,
    @InjectRepository(ChatPlanEntity)
    private readonly planRepo: Repository<ChatPlanEntity>,
    private readonly ticketsService: TicketsService,
    private readonly knowledgeTreeService: KnowledgeTreeService,
    private readonly contentChanges: AgentContentChangesService,
    private readonly chatPlanService: ChatPlanService,
    @Optional() private readonly initiativeContext?: InitiativeContextService,
  ) {}

  /** Register the ack handler on a controller → manager socket for one workspace. */
  attach(remote: ClientSocket, clientId: string): void {
    remote.on(
      AGENT_CONTEXT_REQUEST_EVENT,
      (request: unknown, ack?: (response: AgentContextRequestResponse) => void) => {
        if (typeof ack !== 'function') {
          return;
        }

        void this.handle(clientId, request)
          .then(ack)
          .catch((error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);

            this.logger.warn(`Agent context request failed for client ${clientId}: ${message}`);
            ack({ ok: false, error: 'Context lookup failed' });
          });
      },
    );
  }

  async handle(clientId: string, raw: unknown): Promise<AgentContextRequestResponse> {
    const request = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    // The manager sends the authenticated agent with every request; plans are only served for that agent.
    const agentId = typeof request['agentId'] === 'string' ? request['agentId'] : '';

    switch (request['op']) {
      case 'search':
        return {
          ok: true,
          items: await this.search(
            clientId,
            agentId,
            typeof request['query'] === 'string' ? request['query'] : undefined,
            this.parseKinds(request['kinds']),
            typeof request['limit'] === 'number' ? request['limit'] : undefined,
          ),
        };
      case 'describe':
        return { ok: true, items: await this.describe(clientId, agentId, this.parseRefs(request['refs'])) };
      case 'content':
        return { ok: true, contents: await this.content(clientId, agentId, this.parseRefs(request['refs'])) };
      case 'scope':
        return {
          ok: true,
          items: await this.scope(clientId, this.parseRefs(request['refs']), this.parseAnchors(request['anchors'])),
        };
      case 'change':
        return this.contentChanges.handle(clientId, request['agentId'], request['change'], request['source']);
      default:
        return { ok: false, error: 'Unsupported context request' };
    }
  }

  async search(
    clientId: string,
    agentId: string,
    query: string | undefined,
    kinds: ContextKind[],
    limit: number | undefined,
  ): Promise<AgentContextMetadata[]> {
    const bounded = Math.min(Math.max(1, Math.floor(limit ?? 20)), MAX_SEARCH_LIMIT);
    const term = query?.trim().slice(0, 200) ?? '';
    const results: AgentContextMetadata[] = [];

    if (kinds.includes('ticket')) {
      const qb = this.ticketRepo
        .createQueryBuilder('t')
        .where('t.client_id = :clientId', { clientId })
        .andWhere('t.long_sha IS NOT NULL');

      if (term) {
        qb.andWhere('(t.title ILIKE :like OR t.long_sha LIKE :prefix)', {
          like: `%${this.escapeLike(term)}%`,
          prefix: `${this.escapeLike(term.toLowerCase())}%`,
        });
      }

      results.push(
        ...(await this.mapTickets(clientId, await qb.orderBy('t.updated_at', 'DESC').take(bounded).getMany())),
      );
    }

    if (kinds.includes('knowledge')) {
      const qb = this.knowledgeNodeRepo
        .createQueryBuilder('n')
        .where('n.client_id = :clientId', { clientId })
        .andWhere('n.long_sha IS NOT NULL');

      if (term) {
        qb.andWhere('(n.title ILIKE :like OR n.long_sha LIKE :prefix)', {
          like: `%${this.escapeLike(term)}%`,
          prefix: `${this.escapeLike(term.toLowerCase())}%`,
        });
      }

      results.push(
        ...(await this.mapKnowledge(clientId, await qb.orderBy('n.updated_at', 'DESC').take(bounded).getMany())),
      );
    }

    if (kinds.includes('plan') && agentId) {
      const qb = this.planRepo
        .createQueryBuilder('p')
        .where('p.client_id = :clientId', { clientId })
        .andWhere('p.agent_id = :agentId', { agentId })
        .andWhere('p.long_sha IS NOT NULL');

      if (term) {
        qb.andWhere(
          '(p.summary ILIKE :like OR p.source_prompt ILIKE :like OR p.plan_markdown ILIKE :like OR p.long_sha LIKE :prefix)',
          {
            like: `%${this.escapeLike(term)}%`,
            prefix: `${this.escapeLike(term.toLowerCase())}%`,
          },
        );
      }

      results.push(...this.mapPlans(await qb.orderBy('p.updated_at', 'DESC').take(bounded).getMany()));
    }

    const initiativeKinds = kinds.filter(isInitiativeKind);

    if (initiativeKinds.length > 0 && this.initiativeContext) {
      results.push(...(await this.initiativeContext.search(clientId, term, initiativeKinds, bounded)));
    }

    return results.slice(0, bounded);
  }

  async describe(clientId: string, agentId: string, refs: ContextRef[]): Promise<AgentContextMetadata[]> {
    const tickets: TicketEntity[] = [];
    const nodes: KnowledgeNodeEntity[] = [];
    const plans: ChatPlanEntity[] = [];

    for (const ref of refs) {
      switch (ref.kind) {
        case 'ticket': {
          const ticket = await this.findTicket(clientId, ref.sha);

          if (ticket) {
            tickets.push(ticket);
          }

          break;
        }
        case 'knowledge': {
          const node = await this.findKnowledgeNode(clientId, ref.sha);

          if (node) {
            nodes.push(node);
          }

          break;
        }
        case 'plan': {
          const plan = agentId ? await this.chatPlanService.findForAgentBySha(clientId, agentId, ref.sha) : null;

          if (plan) {
            plans.push(plan);
          }

          break;
        }
      }
    }

    const initiativeRefs = refs.filter((ref): ref is { kind: InitiativeContextKind; sha: string } =>
      isInitiativeKind(ref.kind),
    );

    return [
      ...(await this.mapTickets(clientId, tickets)),
      ...(await this.mapKnowledge(clientId, nodes)),
      ...this.mapPlans(plans),
      ...(initiativeRefs.length && this.initiativeContext
        ? await this.initiativeContext.describe(clientId, initiativeRefs)
        : []),
    ];
  }

  /**
   * Scope of automatic grants in unattended ticket automation: of the requested refs, only tickets in the same ticket
   * tree (same root) as one of the anchor tickets — the tickets the platform granted the run. Knowledge refs are
   * never in scope.
   */
  async scope(clientId: string, refs: ContextRef[], anchorShas: string[]): Promise<AgentContextMetadata[]> {
    const anchorRoots = new Set<string>();

    for (const sha of anchorShas) {
      const anchor = await this.findTicket(clientId, sha);

      if (anchor) {
        anchorRoots.add(await this.rootTicketId(clientId, anchor));
      }
    }

    if (anchorRoots.size === 0) {
      return [];
    }

    const allowed: TicketEntity[] = [];

    for (const ref of refs) {
      const ticket = ref.kind === 'ticket' ? await this.findTicket(clientId, ref.sha) : null;

      if (ticket && anchorRoots.has(await this.rootTicketId(clientId, ticket))) {
        allowed.push(ticket);
      }
    }

    return this.mapTickets(clientId, allowed);
  }

  private async rootTicketId(clientId: string, ticket: TicketEntity): Promise<string> {
    let current = ticket;

    for (let depth = 0; current.parentId && depth < MAX_TICKET_DEPTH; depth++) {
      const parent = await this.ticketRepo.findOne({ where: { clientId, id: current.parentId } });

      if (!parent) {
        break;
      }

      current = parent;
    }

    return current.id;
  }

  private parseAnchors(raw: unknown): string[] {
    if (!Array.isArray(raw)) {
      return [];
    }

    return raw
      .filter((sha): sha is string => typeof sha === 'string')
      .map((sha) => sha.trim().toLowerCase())
      .filter((sha) => SHA_PATTERN.test(sha))
      .slice(0, MAX_SCOPE_ANCHORS);
  }

  /** Full content in the exact format previously inlined into prompts. */
  async content(clientId: string, agentId: string, refs: ContextRef[]): Promise<AgentContextContent[]> {
    const contents: AgentContextContent[] = [];

    for (const ref of refs) {
      if (isInitiativeKind(ref.kind)) {
        if (this.initiativeContext) {
          contents.push(...(await this.initiativeContext.content(clientId, [{ kind: ref.kind, sha: ref.sha }])));
        }

        continue;
      }

      if (ref.kind === 'plan') {
        const plan = agentId ? await this.chatPlanService.findForAgentBySha(clientId, agentId, ref.sha) : null;

        if (plan?.longSha) {
          contents.push({
            kind: 'plan',
            sha: plan.longSha,
            title: chatPlanContextTitle(plan),
            revision: plan.updatedAt.toISOString(),
            content: buildChatPlanContextSection(plan),
          });
        }

        continue;
      }

      if (ref.kind === 'ticket') {
        const ticket = await this.findTicket(clientId, ref.sha);
        const prompt = ticket?.longSha
          ? await this.ticketsService.getPrototypePromptByClientSha(clientId, ticket.longSha)
          : null;

        if (ticket?.longSha && prompt?.prompt) {
          contents.push({
            kind: 'ticket',
            sha: ticket.longSha,
            title: ticket.title,
            revision: ticket.updatedAt.toISOString(),
            content: prompt.prompt,
          });
        }

        continue;
      }

      const node = await this.findKnowledgeNode(clientId, ref.sha);

      if (!node?.longSha) {
        continue;
      }

      const sections =
        node.nodeType === KnowledgeNodeType.PAGE
          ? [`Knowledge Page: ${node.title}\n${node.content ?? ''}`.trim()]
          : (await this.knowledgeTreeService.collectPromptContextsByHashesInternal(clientId, [node.longSha]))
              .promptSections;

      if (sections.length > 0) {
        contents.push({
          kind: 'knowledge',
          sha: node.longSha,
          title: node.title,
          revision: node.updatedAt.toISOString(),
          content: sections.join('\n\n'),
        });
      }
    }

    return contents;
  }

  /**
   * A short SHA only resolves when exactly one element has it: grants are bound to the element the user approved,
   * so an ambiguous prefix must never pick "some" element.
   */
  private async findTicket(clientId: string, sha: string): Promise<TicketEntity | null> {
    if (sha.length >= 40) {
      return this.ticketRepo.findOne({ where: { clientId, longSha: sha.slice(0, 40) } });
    }

    const matches = await this.ticketRepo
      .createQueryBuilder('t')
      .where('t.client_id = :clientId', { clientId })
      .andWhere('t.long_sha LIKE :prefix', { prefix: `${sha}%` })
      .orderBy('t.created_at', 'DESC')
      .take(2)
      .getMany();

    return matches.length === 1 ? matches[0] : null;
  }

  private async findKnowledgeNode(clientId: string, sha: string): Promise<KnowledgeNodeEntity | null> {
    if (sha.length >= 40) {
      return this.knowledgeNodeRepo.findOne({ where: { clientId, longSha: sha.slice(0, 40) } });
    }

    const matches = await this.knowledgeNodeRepo
      .createQueryBuilder('n')
      .where('n.client_id = :clientId', { clientId })
      .andWhere('n.long_sha LIKE :prefix', { prefix: `${sha}%` })
      .orderBy('n.created_at', 'DESC')
      .take(2)
      .getMany();

    return matches.length === 1 ? matches[0] : null;
  }

  private async mapTickets(clientId: string, rows: TicketEntity[]): Promise<AgentContextMetadata[]> {
    const parentIds = [...new Set(rows.map((row) => row.parentId).filter((id): id is string => !!id))];
    const parents = parentIds.length
      ? await this.ticketRepo.find({ where: { clientId, id: In(parentIds) }, select: ['id', 'longSha'] })
      : [];
    const parentSha = new Map(parents.map((parent) => [parent.id, parent.longSha ?? null]));

    return rows
      .filter((row) => !!row.longSha)
      .map((row) => ({
        kind: 'ticket' as const,
        sha: row.longSha as string,
        title: row.title,
        status: row.status,
        priority: row.priority,
        parentSha: row.parentId ? (parentSha.get(row.parentId) ?? null) : null,
        size: row.content?.length ?? 0,
      }));
  }

  private async mapKnowledge(clientId: string, rows: KnowledgeNodeEntity[]): Promise<AgentContextMetadata[]> {
    const parentIds = [...new Set(rows.map((row) => row.parentId).filter((id): id is string => !!id))];
    const parents = parentIds.length
      ? await this.knowledgeNodeRepo.find({ where: { clientId, id: In(parentIds) }, select: ['id', 'longSha'] })
      : [];
    const parentSha = new Map(parents.map((parent) => [parent.id, parent.longSha ?? null]));

    return rows
      .filter((row) => !!row.longSha)
      .map((row) => ({
        kind: 'knowledge' as const,
        sha: row.longSha as string,
        title: row.title,
        nodeType: row.nodeType,
        parentSha: row.parentId ? (parentSha.get(row.parentId) ?? null) : null,
        size: row.content?.length ?? 0,
      }));
  }

  private mapPlans(rows: ChatPlanEntity[]): AgentContextMetadata[] {
    return rows
      .filter((row) => !!row.longSha)
      .map((row) => ({
        kind: 'plan' as const,
        sha: row.longSha as string,
        title: chatPlanContextTitle(row),
        // Executed plans are read-only for good (shown to the agent like a status).
        status: row.executionStartedAt ? `${row.status} (read-only)` : row.status,
        size: row.planMarkdown?.length ?? 0,
      }));
  }

  private parseKinds(raw: unknown): ContextKind[] {
    const values = Array.isArray(raw) ? raw : [];
    const kinds = values.filter((value): value is ContextKind => CONTEXT_KINDS.includes(value as ContextKind));

    return kinds.length > 0 ? [...new Set(kinds)] : [...CONTEXT_KINDS];
  }

  private parseRefs(raw: unknown): ContextRef[] {
    if (!Array.isArray(raw)) {
      return [];
    }

    const refs: ContextRef[] = [];

    for (const entry of raw.slice(0, MAX_REFS)) {
      const ref = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
      const kind = ref['kind'];
      const sha = typeof ref['sha'] === 'string' ? ref['sha'].trim().toLowerCase() : '';

      if (CONTEXT_KINDS.includes(kind as ContextKind) && SHA_PATTERN.test(sha)) {
        refs.push({ kind: kind as ContextKind, sha });
      }
    }

    return refs;
  }

  private escapeLike(value: string): string {
    return value.replace(/[\\%_]/g, (match) => `\\${match}`);
  }
}
