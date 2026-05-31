import { createHash } from 'crypto';

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { KnowledgeNodeEmbeddingEntity } from '../../entities/knowledge-node-embedding.entity';
import { KnowledgeNodeEntity } from '../../entities/knowledge-node.entity';
import { KnowledgeNodeType } from '../../entities/knowledge-node.enums';

import { LocalEmbeddingProvider } from './local-embedding.provider';

interface EmbeddingChunk {
  index: number;
  text: string;
}

@Injectable()
export class KnowledgeEmbeddingIndexService {
  private readonly logger = new Logger(KnowledgeEmbeddingIndexService.name);
  private readonly chunkMaxChars = parseInt(process.env.EMBEDDING_CHUNK_MAX_CHARS || '1200', 10);

  constructor(
    @InjectRepository(KnowledgeNodeEntity)
    private readonly knowledgeNodeRepo: Repository<KnowledgeNodeEntity>,
    @InjectRepository(KnowledgeNodeEmbeddingEntity)
    private readonly embeddingRepo: Repository<KnowledgeNodeEmbeddingEntity>,
    private readonly localEmbeddingProvider: LocalEmbeddingProvider,
  ) {}

  async reindexPage(clientId: string, knowledgeNodeId: string, title: string, content: string): Promise<void> {
    const chunks = this.buildChunks(title, content);

    await this.embeddingRepo.delete({ knowledgeNodeId });

    if (chunks.length === 0) {
      return;
    }

    try {
      const embeddings = await this.localEmbeddingProvider.embedMany(chunks.map((chunk) => chunk.text));
      const rows = chunks.map((chunk, idx) =>
        this.embeddingRepo.create({
          clientId,
          knowledgeNodeId,
          chunkIndex: chunk.index,
          chunkText: chunk.text,
          embedding: embeddings[idx].vector,
          embeddingModel: this.localEmbeddingProvider.getModelName(),
          embeddingProvider: this.localEmbeddingProvider.getProviderName(),
          contentHash: this.hashContent(chunk.text),
        }),
      );

      await this.embeddingRepo.save(rows);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.warn(`Failed to index embeddings for page ${knowledgeNodeId}: ${message}`);
    }
  }

  async deleteForNode(knowledgeNodeId: string): Promise<void> {
    await this.embeddingRepo.delete({ knowledgeNodeId });
  }

  async findPageIdsBatch(
    offset: number,
    limit: number,
    clientId?: string,
  ): Promise<Array<{ clientId: string; nodeId: string; title: string; content: string }>> {
    const where = clientId
      ? { clientId, nodeType: KnowledgeNodeType.PAGE }
      : {
          nodeType: KnowledgeNodeType.PAGE,
        };
    const pages = await this.knowledgeNodeRepo.find({
      where,
      select: ['id', 'clientId', 'title', 'content'],
      order: { updatedAt: 'DESC' },
      skip: offset,
      take: limit,
    });

    return pages.map((page) => ({
      clientId: page.clientId,
      nodeId: page.id,
      title: page.title,
      content: page.content ?? '',
    }));
  }

  async reindexAllPages(clientId?: string): Promise<{ processed: number }> {
    const where = clientId
      ? { clientId, nodeType: KnowledgeNodeType.PAGE }
      : {
          nodeType: KnowledgeNodeType.PAGE,
        };
    const pages = await this.knowledgeNodeRepo.find({
      where,
      select: ['id', 'clientId', 'title', 'content'],
      order: { updatedAt: 'DESC' },
    });

    for (const page of pages) {
      await this.reindexPage(page.clientId, page.id, page.title, page.content ?? '');
    }

    return { processed: pages.length };
  }

  private buildChunks(title: string, content: string): EmbeddingChunk[] {
    const merged = `${title.trim()}\n\n${(content || '').trim()}`.trim();

    if (!merged) {
      return [];
    }

    const lines = merged
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const chunks: EmbeddingChunk[] = [];
    let chunk = '';
    let idx = 0;

    for (const line of lines) {
      const candidate = chunk.length === 0 ? line : `${chunk}\n${line}`;

      if (candidate.length <= this.chunkMaxChars) {
        chunk = candidate;
        continue;
      }

      if (chunk.length > 0) {
        chunks.push({ index: idx++, text: chunk });
      }

      if (line.length <= this.chunkMaxChars) {
        chunk = line;
      } else {
        const parts = this.splitLongLine(line);

        for (let i = 0; i < parts.length - 1; i++) {
          chunks.push({ index: idx++, text: parts[i] });
        }

        chunk = parts[parts.length - 1] ?? '';
      }
    }

    if (chunk.length > 0) {
      chunks.push({ index: idx, text: chunk });
    }

    return chunks;
  }

  private splitLongLine(text: string): string[] {
    const parts: string[] = [];
    let offset = 0;

    while (offset < text.length) {
      parts.push(text.slice(offset, offset + this.chunkMaxChars));
      offset += this.chunkMaxChars;
    }

    return parts;
  }

  private hashContent(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}
