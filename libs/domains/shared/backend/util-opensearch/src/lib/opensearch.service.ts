import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Client } from '@opensearch-project/opensearch';

import { buildOpenSearchIndexName, readOpenSearchConnectionConfig } from './opensearch-connection.config';
import { buildScopedSearchBody, clampSearchPagination } from './opensearch-query.util';
import type { OpenSearchBulkUpsertItem, OpenSearchSearchParams, OpenSearchSearchResult } from './opensearch.types';

@Injectable()
export class OpenSearchService implements OnModuleDestroy {
  private readonly logger = new Logger(OpenSearchService.name);
  private client: Client | null = null;

  isEnabled(): boolean {
    return readOpenSearchConnectionConfig().enabled;
  }

  indexName(entity: string): string {
    return buildOpenSearchIndexName(entity);
  }

  async ping(): Promise<boolean> {
    if (!this.isEnabled()) {
      return false;
    }

    try {
      const client = this.getClient();
      const response = await client.ping();

      return response.statusCode !== undefined && response.statusCode >= 200 && response.statusCode < 300;
    } catch (error) {
      this.logger.warn(`OpenSearch ping failed: ${(error as Error).message}`);

      return false;
    }
  }

  async ensureIndex(index: string, mappings?: Record<string, unknown>): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }

    const client = this.getClient();
    const exists = await client.indices.exists({ index });

    if (exists.body === true) {
      return;
    }

    await client.indices.create({
      index,
      body: {
        settings: {
          number_of_shards: 1,
          number_of_replicas: 0,
          analysis: {
            analyzer: {
              default: {
                type: 'standard',
              },
            },
          },
        },
        ...(mappings ? { mappings } : {}),
      },
    });
  }

  async indexDocument(index: string, id: string, document: Record<string, unknown>): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }

    try {
      const client = this.getClient();

      await client.index({
        index,
        id,
        body: document,
        refresh: false,
      });
    } catch (error) {
      this.logger.warn(`OpenSearch index failed for ${index}/${id}: ${(error as Error).message}`);
      throw error;
    }
  }

  async bulkUpsert(index: string, items: OpenSearchBulkUpsertItem[]): Promise<void> {
    if (!this.isEnabled() || items.length === 0) {
      return;
    }

    try {
      const client = this.getClient();
      const body = items.flatMap((item) => [{ index: { _index: index, _id: item.id } }, item.document]);
      const response = await client.bulk({ refresh: false, body });

      if (response.body?.errors) {
        this.logger.warn(`OpenSearch bulk upsert reported item errors for index ${index}`);
      }
    } catch (error) {
      this.logger.warn(`OpenSearch bulk upsert failed for ${index}: ${(error as Error).message}`);
      throw error;
    }
  }

  async deleteDocument(index: string, id: string): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }

    try {
      const client = this.getClient();

      await client.delete({
        index,
        id,
        refresh: false,
      });
    } catch (error) {
      const statusCode = (error as { meta?: { statusCode?: number } })?.meta?.statusCode;

      if (statusCode === 404) {
        return;
      }

      this.logger.warn(`OpenSearch delete failed for ${index}/${id}: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Delete documents matching term filters (fail closed when filters empty).
   */
  async deleteByQuery(index: string, filters: Record<string, string | string[] | boolean | number>): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }

    const filterEntries = Object.entries(filters).filter(([, value]) => {
      if (value === undefined || value === null) {
        return false;
      }

      if (Array.isArray(value)) {
        return value.length > 0;
      }

      return true;
    });

    if (filterEntries.length === 0) {
      this.logger.warn(`OpenSearch deleteByQuery refused for ${index}: empty filters`);

      return;
    }

    try {
      const client = this.getClient();
      const must = filterEntries.map(([field, value]) =>
        Array.isArray(value) ? { terms: { [field]: value } } : { term: { [field]: value } },
      );

      await client.deleteByQuery({
        index,
        body: {
          query: {
            bool: { must },
          },
        },
        refresh: true,
      });
    } catch (error) {
      this.logger.warn(`OpenSearch deleteByQuery failed for ${index}: ${(error as Error).message}`);
      throw error;
    }
  }

  async search(params: OpenSearchSearchParams): Promise<OpenSearchSearchResult> {
    if (!this.isEnabled()) {
      return { hits: [], total: 0 };
    }

    const { from, size } = clampSearchPagination(params.size, params.from);

    try {
      const client = this.getClient();
      const body = buildScopedSearchBody({
        query: params.query,
        fields: params.fields,
        filters: params.filters,
        from,
        size,
      });
      const response = await client.search({
        index: params.index,
        body,
      });
      const hitsRaw = (response.body?.hits?.hits ?? []) as Array<{
        _id?: string;
        _score?: number | null;
        _source?: Record<string, unknown>;
      }>;
      const totalRaw = response.body?.hits?.total;
      const total =
        typeof totalRaw === 'number' ? totalRaw : typeof totalRaw?.value === 'number' ? totalRaw.value : hitsRaw.length;

      return {
        total,
        hits: hitsRaw.map((hit) => ({
          id: hit._id ?? String(hit._source?.['id'] ?? ''),
          score: hit._score ?? null,
          source: hit._source ?? {},
        })),
      };
    } catch (error) {
      this.logger.warn(`OpenSearch search failed for ${params.index}: ${(error as Error).message}`);
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.client) {
      return;
    }

    try {
      await this.client.close();
    } catch (error) {
      this.logger.warn(`OpenSearch disconnect failed: ${(error as Error).message}`);
    } finally {
      this.client = null;
    }
  }

  private getClient(): Client {
    if (this.client) {
      return this.client;
    }

    const config = readOpenSearchConnectionConfig();
    this.client = new Client({
      node: config.node,
      ...(config.username || config.password
        ? {
            auth: {
              username: config.username || 'admin',
              password: config.password || '',
            },
          }
        : {}),
      ssl: {
        rejectUnauthorized: process.env['OPENSEARCH_TLS_REJECT_UNAUTHORIZED'] !== 'false',
      },
    });

    return this.client;
  }
}
