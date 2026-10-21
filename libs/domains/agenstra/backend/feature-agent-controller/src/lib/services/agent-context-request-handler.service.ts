import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Socket as ClientSocket } from 'socket.io-client';
import { In, Repository } from 'typeorm';

import { KnowledgeNodeEntity } from '../entities/knowledge-node.entity';
import { KnowledgeNodeType } from '../entities/knowledge-node.enums';
import { TicketEntity } from '../entities/ticket.entity';

import { KnowledgeTreeService } from './knowledge-tree.service';
import { TicketsService } from './tickets.service';

/** Socket.IO event emitted by the agent-manager (with ack) — keep in sync with the manager constant. */
export const AGENT_CONTEXT_REQUEST_EVENT = 'agentContextRequest';

const MAX_SEARCH_LIMIT = 50;
const MAX_REFS = 20;
const SHA_PATTERN = /^[0-9a-f]{4,40}$/;

type ContextKind = 'ticket' | 'knowledge';

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
  content: string;
}

export type AgentContextRequestResponse =
  | { ok: true; items?: AgentContextMetadata[]; contents?: AgentContextContent[] }
  | { ok: false; error: string };

/**
 * Answers on-demand context requests from an agent-manager (worker `agenstra` MCP server → manager →
 * controller) over the Socket.IO connection the controller already holds. Every lookup is scoped to the
 * workspace (client) that connection belongs to.
 */
@Injectable()
export class AgentContextRequestHandlerService {
  private readonly logger = new Logger(AgentContextRequestHandlerService.name);

  constructor(
    @InjectRepository(TicketEntity)
    private readonly ticketRepo: Repository<TicketEntity>,
    @InjectRepository(KnowledgeNodeEntity)
    private readonly knowledgeNodeRepo: Repository<KnowledgeNodeEntity>,
    private readonly ticketsService: TicketsService,
    private readonly knowledgeTreeService: KnowledgeTreeService,
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

    switch (request['op']) {
      case 'search':
        return {
          ok: true,
          items: await this.search(
            clientId,
            typeof request['query'] === 'string' ? request['query'] : undefined,
            this.parseKinds(request['kinds']),
            typeof request['limit'] === 'number' ? request['limit'] : undefined,
          ),
        };
      case 'describe':
        return { ok: true, items: await this.describe(clientId, this.parseRefs(request['refs'])) };
      case 'content':
        return { ok: true, contents: await this.content(clientId, this.parseRefs(request['refs'])) };
      default:
        return { ok: false, error: 'Unsupported context request' };
    }
  }

  async search(
    clientId: string,
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

    return results.slice(0, bounded);
  }

  async describe(clientId: string, refs: ContextRef[]): Promise<AgentContextMetadata[]> {
    const tickets: TicketEntity[] = [];
    const nodes: KnowledgeNodeEntity[] = [];

    for (const ref of refs) {
      if (ref.kind === 'ticket') {
        const ticket = await this.findTicket(clientId, ref.sha);

        if (ticket) {
          tickets.push(ticket);
        }
      } else {
        const node = await this.findKnowledgeNode(clientId, ref.sha);

        if (node) {
          nodes.push(node);
        }
      }
    }

    return [...(await this.mapTickets(clientId, tickets)), ...(await this.mapKnowledge(clientId, nodes))];
  }

  /** Full content in the exact format previously inlined into prompts. */
  async content(clientId: string, refs: ContextRef[]): Promise<AgentContextContent[]> {
    const contents: AgentContextContent[] = [];

    for (const ref of refs) {
      if (ref.kind === 'ticket') {
        const ticket = await this.findTicket(clientId, ref.sha);
        const prompt = ticket?.longSha
          ? await this.ticketsService.getPrototypePromptByClientSha(clientId, ticket.longSha)
          : null;

        if (ticket?.longSha && prompt?.prompt) {
          contents.push({ kind: 'ticket', sha: ticket.longSha, title: ticket.title, content: prompt.prompt });
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
        contents.push({ kind: 'knowledge', sha: node.longSha, title: node.title, content: sections.join('\n\n') });
      }
    }

    return contents;
  }

  private async findTicket(clientId: string, sha: string): Promise<TicketEntity | null> {
    if (sha.length >= 40) {
      return this.ticketRepo.findOne({ where: { clientId, longSha: sha.slice(0, 40) } });
    }

    return this.ticketRepo
      .createQueryBuilder('t')
      .where('t.client_id = :clientId', { clientId })
      .andWhere('t.long_sha LIKE :prefix', { prefix: `${sha}%` })
      .orderBy('t.created_at', 'DESC')
      .getOne();
  }

  private async findKnowledgeNode(clientId: string, sha: string): Promise<KnowledgeNodeEntity | null> {
    if (sha.length >= 40) {
      return this.knowledgeNodeRepo.findOne({ where: { clientId, longSha: sha.slice(0, 40) } });
    }

    return this.knowledgeNodeRepo
      .createQueryBuilder('n')
      .where('n.client_id = :clientId', { clientId })
      .andWhere('n.long_sha LIKE :prefix', { prefix: `${sha}%` })
      .orderBy('n.created_at', 'DESC')
      .getOne();
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

  private parseKinds(raw: unknown): ContextKind[] {
    const values = Array.isArray(raw) ? raw : [];
    const kinds = values.filter((value): value is ContextKind => value === 'ticket' || value === 'knowledge');

    return kinds.length > 0 ? [...new Set(kinds)] : ['ticket', 'knowledge'];
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

      if ((kind === 'ticket' || kind === 'knowledge') && SHA_PATTERN.test(sha)) {
        refs.push({ kind, sha });
      }
    }

    return refs;
  }

  private escapeLike(value: string): string {
    return value.replace(/[\\%_]/g, (match) => `\\${match}`);
  }
}
