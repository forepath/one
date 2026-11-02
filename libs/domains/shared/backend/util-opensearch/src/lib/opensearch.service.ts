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

  /**
   * Count documents matching term filters only (no text query).
   */
  async count(index: string, filters: Record<string, string | string[] | boolean | number> = {}): Promise<number> {
    if (!this.isEnabled()) {
      return 0;
    }

    try {
      const client = this.getClient();
      const { query } = buildScopedSearchBody({ query: '', fields: [], filters, from: 0, size: 0 });
      const response = await client.count({ index, body: { query } });
      const count = response.body?.count;

      return typeof count === 'number' ? count : 0;
    } catch (error) {
      this.logger.warn(`OpenSearch count failed for ${index}: ${(error as Error).message}`);
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

  /**
   * Appends documents without ids (time series such as logs): one bulk request; returns how many were rejected.
   */
  async bulkAppend(index: string, documents: readonly Record<string, unknown>[]): Promise<number> {
    if (!this.isEnabled() || documents.length === 0) {
      return 0;
    }

    try {
      const client = this.getClient();
      const body = documents.flatMap((document) => [{ create: { _index: index } }, document]);
      const response = await client.bulk({ refresh: false, body });
      const items = (response.body?.items ?? []) as Array<{ create?: { error?: unknown } }>;

      return response.body?.errors ? items.filter((item) => item.create?.error).length : 0;
    } catch (error) {
      this.logger.warn(`OpenSearch bulk append failed for ${index}: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * A search with a caller-built body (time ranges, sorting, `search_after` cursors); hits carry their sort values.
   */
  async searchRaw(
    index: string,
    body: Record<string, unknown>,
  ): Promise<{ total: number; hits: { id: string; source: Record<string, unknown>; sort: unknown[] }[] }> {
    if (!this.isEnabled()) {
      return { total: 0, hits: [] };
    }

    try {
      const client = this.getClient();
      const response = await client.search({ index, body, ignore_unavailable: true, allow_no_indices: true });
      const hitsRaw = (response.body?.hits?.hits ?? []) as Array<{
        _id?: string;
        _source?: Record<string, unknown>;
        sort?: unknown[];
      }>;
      const totalRaw = response.body?.hits?.total;

      return {
        total:
          typeof totalRaw === 'number'
            ? totalRaw
            : typeof totalRaw?.value === 'number'
              ? totalRaw.value
              : hitsRaw.length,
        hits: hitsRaw.map((hit) => ({ id: hit._id ?? '', source: hit._source ?? {}, sort: hit.sort ?? [] })),
      };
    } catch (error) {
      this.logger.warn(`OpenSearch search failed for ${index}: ${(error as Error).message}`);
      throw error;
    }
  }

  /** Creates or replaces a composable index template (settings and mappings for indices matching its patterns). */
  async putIndexTemplate(name: string, body: Record<string, unknown>): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }

    await this.getClient().indices.putIndexTemplate({ name, body });
  }

  /** Names of the indices matching a pattern. */
  async listIndices(pattern: string): Promise<string[]> {
    if (!this.isEnabled()) {
      return [];
    }

    const response = await this.getClient().cat.indices({ index: [pattern], format: 'json', h: ['index'] });
    const rows = (response.body ?? []) as Array<{ index?: string }>;

    return rows
      .map((row) => row.index ?? '')
      .filter(Boolean)
      .sort();
  }

  /** Deletes whole indices by exact name (retention); wildcards are refused. */
  async deleteIndices(indices: readonly string[]): Promise<void> {
    if (!this.isEnabled() || indices.length === 0) {
      return;
    }

    if (indices.some((index) => index.includes('*') || index.includes(','))) {
      throw new Error('deleteIndices takes exact index names');
    }

    await this.getClient().indices.delete({ index: [...indices], ignore_unavailable: true });
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
