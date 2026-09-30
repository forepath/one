import type { Logger } from '@nestjs/common';
import type { ObjectLiteral, Repository, SelectQueryBuilder } from 'typeorm';
import { In } from 'typeorm';

import type { AgenstraSearchIndexService } from './agenstra-search-index.service';
import type {
  AgenstraSearchEntityType,
  AgenstraSearchIdsParams,
  AgenstraSearchIdsResult,
} from './agenstra-search.types';

export const MAX_LIST_SEARCH_LENGTH = 200;

export function sanitizeListSearch(search: string | undefined): string | undefined {
  if (!search || typeof search !== 'string') {
    return undefined;
  }

  const trimmed = search.trim();

  if (trimmed.length === 0) {
    return undefined;
  }

  return trimmed.length > MAX_LIST_SEARCH_LENGTH ? trimmed.slice(0, MAX_LIST_SEARCH_LENGTH) : trimmed;
}

export function escapeIlikePattern(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/**
 * Returns matching document IDs from OpenSearch, or null when OpenSearch is disabled/unavailable.
 */
export async function tryAgenstraSearchIds(
  searchIndex: AgenstraSearchIndexService | undefined,
  params: Omit<AgenstraSearchIdsParams, 'query'> & { query: string | undefined },
  logger?: Logger,
): Promise<AgenstraSearchIdsResult | null> {
  const sanitized = sanitizeListSearch(params.query);

  if (!sanitized || !searchIndex?.isEnabled()) {
    return null;
  }

  try {
    return await searchIndex.searchIds({ ...params, query: sanitized });
  } catch (error) {
    logger?.warn(`OpenSearch ${params.entityType} lookup failed, falling back to ILIKE: ${(error as Error).message}`);

    return null;
  }
}

/**
 * Hydrate TypeORM entities in OpenSearch hit order.
 * Returns null when lookup was skipped or empty (caller should fall back to ILIKE) —
 * empty OS hits cover unindexed data and analyzer gaps.
 * When total > 0 but ids are empty (offset past the end), returns an empty page.
 */
export async function hydrateEntitiesBySearchIds<T extends ObjectLiteral & { id: string }>(
  repository: Repository<T>,
  lookup: AgenstraSearchIdsResult | null,
): Promise<{ items: T[]; total: number } | null> {
  if (!lookup) {
    return null;
  }

  if (lookup.ids.length === 0) {
    if (lookup.total === 0) {
      return null;
    }

    return { items: [], total: lookup.total };
  }

  const found = await repository.findBy({ id: In(lookup.ids) } as never);
  const byId = new Map((found as T[]).map((item) => [item.id, item]));
  const items = lookup.ids.map((id) => byId.get(id)).filter((item): item is T => item != null);

  return { items, total: lookup.total };
}

export function orderItemsBySearchIds<T extends { id: string }>(items: T[], ids: string[]): T[] {
  const byId = new Map(items.map((item) => [item.id, item]));

  return ids.map((id) => byId.get(id)).filter((item): item is T => item != null);
}

export function matchesInMemoryListSearch(value: unknown, search: string): boolean {
  const sanitized = sanitizeListSearch(search);

  if (!sanitized) {
    return true;
  }

  const haystack = JSON.stringify(value ?? '').toLowerCase();

  return haystack.includes(sanitized.toLowerCase());
}

const SEARCH_FIELD_COLUMNS: Partial<
  Record<AgenstraSearchEntityType, Record<string, (alias: string) => string | undefined>>
> = {
  clients: {
    name: (alias) => `${alias}.name`,
    description: (alias) => `${alias}.description`,
    id: (alias) => `CAST(${alias}.id AS text)`,
  },
  tickets: {
    title: (alias) => `${alias}.title`,
    content: (alias) => `${alias}.content`,
    status: (alias) => `${alias}.status::text`,
    priority: (alias) => `${alias}.priority::text`,
    id: (alias) => `CAST(${alias}.id AS text)`,
  },
  'knowledge-nodes': {
    title: (alias) => `${alias}.title`,
    content: (alias) => `${alias}.content`,
    status: (alias) => `${alias}.node_type::text`,
    id: (alias) => `CAST(${alias}.id AS text)`,
  },
  'filter-rules': {
    pattern: (alias) => `${alias}.pattern`,
    filterType: (alias) => `${alias}.filter_type`,
    direction: (alias) => `${alias}.direction::text`,
    id: (alias) => `CAST(${alias}.id AS text)`,
  },
  'atlassian-connections': {
    label: (alias) => `${alias}.label`,
    baseUrl: (alias) => `${alias}.base_url`,
    accountEmail: (alias) => `${alias}.account_email`,
    id: (alias) => `CAST(${alias}.id AS text)`,
  },
  'import-configs': {
    provider: (alias) => `${alias}.provider`,
    importKind: (alias) => `${alias}.import_kind`,
    id: (alias) => `CAST(${alias}.id AS text)`,
  },
  'opencode-providers': {
    name: (alias) => `${alias}.name`,
    id: (alias) => `${alias}.id`,
    provider: (alias) => `${alias}.npm`,
    label: (alias) => `${alias}.api`,
  },
  'opencode-mcp-servers': {
    name: (alias) => `${alias}.name`,
    title: (alias) => `${alias}.title`,
    description: (alias) => `${alias}.description`,
    status: (alias) => `${alias}.status`,
    id: (alias) => `${alias}.name`,
  },
};

export function applyAgenstraSearchIlike<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  entityType: AgenstraSearchEntityType,
  alias: string,
  search: string,
  extraColumns?: Record<string, string>,
): void {
  const sanitized = sanitizeListSearch(search);

  if (!sanitized) {
    return;
  }

  const columnMap = SEARCH_FIELD_COLUMNS[entityType] ?? {};
  const pattern = `%${escapeIlikePattern(sanitized)}%`;
  const clauses: string[] = [];

  for (const [field, resolve] of Object.entries(columnMap)) {
    const joined = extraColumns?.[field];

    if (joined) {
      clauses.push(`${joined} ILIKE :agenstraSearchTerm`);
      continue;
    }

    const column = resolve(alias);

    if (column) {
      clauses.push(`${column} ILIKE :agenstraSearchTerm`);
    }
  }

  if (entityType === 'import-configs') {
    clauses.push(`${alias}.jql ILIKE :agenstraSearchTerm`);
    clauses.push(`${alias}.cql ILIKE :agenstraSearchTerm`);
    clauses.push(`${alias}.confluence_space_key ILIKE :agenstraSearchTerm`);
  }

  if (entityType === 'filter-rules') {
    clauses.push(`COALESCE(${alias}.replace_content, '') ILIKE :agenstraSearchTerm`);
  }

  if (clauses.length === 0) {
    return;
  }

  qb.andWhere(`(${clauses.join(' OR ')})`, { agenstraSearchTerm: pattern });
}
