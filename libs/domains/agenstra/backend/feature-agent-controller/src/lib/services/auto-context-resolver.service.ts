import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { KnowledgeNodeEmbeddingEntity } from '../entities/knowledge-node-embedding.entity';
import { KnowledgeRelationSourceType } from '../entities/knowledge-node.enums';

import { LocalEmbeddingProvider } from './embeddings/local-embedding.provider';
import { KnowledgeTreeService } from './knowledge-tree.service';
import { StatisticsService } from './statistics.service';
import { TicketsService } from './tickets.service';

interface ContextInjectionPayload {
  includeWorkspace?: boolean;
  environmentIds?: string[];
  ticketShas?: string[];
  ticketContexts?: string[];
  knowledgeShas?: string[];
  knowledgeContexts?: string[];
  autoEnrichmentEnabled?: boolean;
}

interface AutoContextResolveInput {
  clientId: string;
  prompt: string;
  contextInjection: ContextInjectionPayload;
  /**
   * When set, overrides controller `AUTO_ENRICH_ENABLED_GLOBAL` for this resolve (workspace setting from agent-manager).
   */
  workspaceAutoEnrichEnabledGlobal?: boolean;
  /**
   * When set, overrides controller `AUTO_ENRICH_VECTOR_MAX_COSINE_DISTANCE` for this resolve (pgvector `<=>` cosine
   * distance; lower is more similar). Only embedding rows with distance <= this value are considered.
   */
  workspaceAutoEnrichVectorMaxCosineDistance?: number;
}

@Injectable()
export class AutoContextResolverService {
  private readonly logger = new Logger(AutoContextResolverService.name);
  private readonly vectorEnabled = process.env.AUTO_ENRICH_VECTOR_ENABLED !== 'false';
  private readonly maxSections = parseInt(process.env.AUTO_ENRICH_MAX_SECTIONS || '6', 10);
  private readonly maxChars = parseInt(process.env.AUTO_ENRICH_MAX_CHARS || '12000', 10);
  private readonly vectorTopK = parseInt(process.env.AUTO_ENRICH_VECTOR_TOP_K || '20', 10);

  constructor(
    @InjectRepository(KnowledgeNodeEmbeddingEntity)
    private readonly embeddingRepo: Repository<KnowledgeNodeEmbeddingEntity>,
    private readonly ticketsService: TicketsService,
    private readonly knowledgeTreeService: KnowledgeTreeService,
    private readonly localEmbeddingProvider: LocalEmbeddingProvider,
    private readonly statisticsService: StatisticsService,
  ) {}

  async resolve(input: AutoContextResolveInput): Promise<ContextInjectionPayload> {
    const normalizedTicketShas = this.normalize(input.contextInjection.ticketShas);
    const normalizedKnowledgeShas = this.normalize(input.contextInjection.knowledgeShas);
    const autoEnabled = input.contextInjection.autoEnrichmentEnabled !== false;
    const globalAutoEnrichEnabled =
      input.workspaceAutoEnrichEnabledGlobal !== undefined
        ? input.workspaceAutoEnrichEnabledGlobal
        : process.env.AUTO_ENRICH_ENABLED_GLOBAL !== 'false';

    if (!globalAutoEnrichEnabled || !autoEnabled) {
      return {
        ...input.contextInjection,
        ticketShas: normalizedTicketShas,
        knowledgeShas: normalizedKnowledgeShas,
      };
    }

    const manualTicketIds = new Set<string>();
    const manualKnowledgeNodeIds = new Set<string>();

    for (const sha of normalizedTicketShas) {
      const ticketId = await this.ticketsService.resolveTicketIdByClientSha(input.clientId, sha);

      if (ticketId) {
        manualTicketIds.add(ticketId);
      }
    }

    for (const sha of normalizedKnowledgeShas) {
      const node = await this.knowledgeTreeService.findNodeBySha(input.clientId, sha);

      if (node) {
        manualKnowledgeNodeIds.add(node.id);
      }
    }

    const maxCosineDistance = this.resolveMaxCosineDistance(input);
    const vectorKnowledgeContexts = this.vectorEnabled
      ? await this.resolveVectorKnowledgeContexts(
          input.clientId,
          input.prompt,
          manualKnowledgeNodeIds,
          maxCosineDistance,
        )
      : [];
    const relationContexts = await this.resolveRelationContexts(
      input.clientId,
      manualTicketIds,
      manualKnowledgeNodeIds,
      normalizedKnowledgeShas,
    );
    const combined = this.applySectionBudget([...relationContexts, ...vectorKnowledgeContexts]);
    const output = {
      ...input.contextInjection,
      ticketShas: normalizedTicketShas,
      knowledgeShas: normalizedKnowledgeShas,
      knowledgeContexts: this.normalize([...(input.contextInjection.knowledgeContexts ?? []), ...combined]),
    };

    this.logger.debug(
      JSON.stringify({
        msg: 'auto_context_resolved',
        clientId: input.clientId,
        autoEnabled,
        globalAutoEnrichEnabled,
        vectorEnabled: this.vectorEnabled,
        manualTicketCount: manualTicketIds.size,
        manualKnowledgeCount: manualKnowledgeNodeIds.size,
        vectorContextCount: vectorKnowledgeContexts.length,
        relationContextCount: relationContexts.length,
        finalContextCount: output.knowledgeContexts?.length ?? 0,
        vectorMaxCosineDistance: maxCosineDistance,
      }),
    );

    if ((output.knowledgeContexts?.length ?? 0) > 0) {
      const totalChars = (output.knowledgeContexts ?? []).reduce((sum, ctx) => sum + ctx.length, 0);
      const metricsAgentId =
        output.environmentIds?.find((environmentId) => environmentId.trim().length > 0) ??
        '00000000-0000-0000-0000-000000000000';

      this.statisticsService
        .recordAutoContextEnrichment(input.clientId, metricsAgentId, output.knowledgeContexts?.length ?? 0, totalChars)
        .catch(() => undefined);
    }

    return output;
  }

  private resolveMaxCosineDistance(input: AutoContextResolveInput): number {
    if (input.workspaceAutoEnrichVectorMaxCosineDistance !== undefined) {
      return this.clampMaxCosineDistance(input.workspaceAutoEnrichVectorMaxCosineDistance);
    }

    const raw = process.env.AUTO_ENRICH_VECTOR_MAX_COSINE_DISTANCE;

    if (raw !== undefined && raw.trim() !== '') {
      const parsed = Number.parseFloat(raw.trim());

      if (Number.isFinite(parsed)) {
        return this.clampMaxCosineDistance(parsed);
      }
    }

    return 1.0;
  }

  private clampMaxCosineDistance(value: number): number {
    if (!Number.isFinite(value)) {
      return 1.0;
    }

    return Math.min(2, Math.max(0, value));
  }

  private async resolveVectorKnowledgeContexts(
    clientId: string,
    prompt: string,
    excludedKnowledgeNodeIds: Set<string>,
    maxCosineDistance: number,
  ): Promise<string[]> {
    const trimmed = prompt.trim();

    if (!trimmed) {
      return [];
    }

    try {
      const vector = (await this.localEmbeddingProvider.embedMany([trimmed]))[0]?.vector;

      if (!vector || vector.length === 0) {
        return [];
      }

      const formattedVector = `[${vector.join(',')}]`;
      const rows = await this.embeddingRepo
        .createQueryBuilder('embedding')
        .where('embedding.client_id = :clientId', { clientId })
        .andWhere('(embedding.embedding <=> CAST(:vector AS vector)) <= :maxCosineDistance', { maxCosineDistance })
        .orderBy('embedding.embedding <=> CAST(:vector AS vector)', 'ASC')
        .setParameter('vector', formattedVector)
        .take(this.vectorTopK)
        .getMany();
      const contexts: string[] = [];
      const seenNodes = new Set<string>();

      for (const row of rows) {
        if (excludedKnowledgeNodeIds.has(row.knowledgeNodeId) || seenNodes.has(row.knowledgeNodeId)) {
          continue;
        }

        seenNodes.add(row.knowledgeNodeId);
        contexts.push(`Knowledge Page Context:\n${row.chunkText}`.trim());
      }

      return contexts;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.warn(`Vector auto-enrichment failed for client ${clientId}: ${message}`);

      return [];
    }
  }

  private async resolveRelationContexts(
    clientId: string,
    manualTicketIds: Set<string>,
    manualKnowledgeNodeIds: Set<string>,
    normalizedKnowledgeShas: string[],
  ): Promise<string[]> {
    const sections: string[] = [];

    for (const ticketId of manualTicketIds) {
      const related = await this.knowledgeTreeService.collectPromptContextsForSource(
        clientId,
        KnowledgeRelationSourceType.TICKET,
        ticketId,
      );

      sections.push(...related.promptSections);
    }

    for (const sha of normalizedKnowledgeShas) {
      const node = await this.knowledgeTreeService.findNodeBySha(clientId, sha);

      if (!node || node.nodeType !== 'page' || manualKnowledgeNodeIds.has(node.id)) {
        continue;
      }

      const related = await this.knowledgeTreeService.collectPromptContextsForSource(
        clientId,
        KnowledgeRelationSourceType.PAGE,
        node.id,
      );

      sections.push(...related.promptSections);
    }

    return this.normalize(sections);
  }

  private applySectionBudget(sections: string[]): string[] {
    const accepted: string[] = [];
    let totalChars = 0;

    for (const section of sections) {
      if (accepted.length >= this.maxSections) {
        break;
      }

      const nextChars = totalChars + section.length;

      if (nextChars > this.maxChars) {
        break;
      }

      accepted.push(section);
      totalChars = nextChars;
    }

    return accepted;
  }

  private normalize(items?: string[]): string[] {
    return Array.from(new Set((items ?? []).map((item) => item.trim()).filter((item) => item.length > 0)));
  }
}
