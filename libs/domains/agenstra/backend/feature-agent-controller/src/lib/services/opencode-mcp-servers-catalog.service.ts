import { InjectRepository } from '@nestjs/typeorm';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { In, Repository } from 'typeorm';

import {
  OPENCODE_MCP_REGISTRY_BASE_URL,
  OPENCODE_MCP_SERVERS_DELETE_CHUNK_SIZE,
  OPENCODE_MCP_SERVERS_PAGE_LIMIT,
  OPENCODE_MCP_SERVERS_UPSERT_CHUNK_SIZE,
} from '../constants/opencode-mcp-servers.constants';
import { OpencodeMcpServerDto, OpencodeMcpServersListDto } from '../dto/opencode-mcp-servers.dto';
import { OpencodeMcpServerEntity } from '../entities/opencode-mcp-server.entity';
import { mapOpencodeMcpServerToSearchDocument } from '../search/agenstra-search-document.mapper';
import { AgenstraSearchIndexService } from '../search/agenstra-search-index.service';
import type { AgenstraSearchIdsResult } from '../search/agenstra-search.types';
import {
  applyAgenstraSearchIlike,
  sanitizeListSearch,
  tryAgenstraSearchIds,
} from '../search/agenstra-search-list.util';

interface RegistryServerDetail {
  name?: unknown;
  title?: unknown;
  description?: unknown;
  version?: unknown;
  websiteUrl?: unknown;
  packages?: unknown;
  remotes?: unknown;
  repository?: unknown;
}

interface RegistryOfficialMeta {
  status?: unknown;
  publishedAt?: unknown;
  updatedAt?: unknown;
  isLatest?: unknown;
}

interface RegistryServerResponse {
  server?: RegistryServerDetail;
  _meta?: {
    'io.modelcontextprotocol.registry/official'?: RegistryOfficialMeta;
  };
}

interface RegistryServerList {
  servers?: RegistryServerResponse[];
  metadata?: {
    nextCursor?: unknown;
    count?: unknown;
  };
}

export interface OpencodeMcpServersRefreshResult {
  upserted: number;
  removed: number;
  pages: number;
}

export interface OpencodeMcpServersListParams {
  search?: string;
  limit: number;
  offset: number;
}

/**
 * DB-backed catalog of MCP servers sourced from the official MCP Registry.
 */
@Injectable()
export class OpencodeMcpServersCatalogService {
  private readonly logger = new Logger(OpencodeMcpServersCatalogService.name);

  constructor(
    @InjectRepository(OpencodeMcpServerEntity)
    private readonly serversRepository: Repository<OpencodeMcpServerEntity>,
    private readonly searchIndex: AgenstraSearchIndexService,
  ) {}

  async count(): Promise<number> {
    return await this.serversRepository.count();
  }

  async isEmpty(): Promise<boolean> {
    return (await this.count()) === 0;
  }

  async listServers(params: OpencodeMcpServersListParams): Promise<OpencodeMcpServersListDto> {
    const { limit, offset } = params;
    const sanitized = sanitizeListSearch(params.search);

    if (sanitized) {
      const openSearchIds = await tryAgenstraSearchIds(
        this.searchIndex,
        {
          entityType: 'opencode-mcp-servers',
          query: sanitized,
          instanceScoped: true,
          limit,
          offset,
        },
        this.logger,
      );
      const hydrated = await this.hydrateServersBySearchIds(openSearchIds);

      if (hydrated) {
        return {
          servers: hydrated.items.map((row) => this.toDto(row)),
          total: hydrated.total,
          limit,
          offset,
        };
      }

      const qb = this.serversRepository.createQueryBuilder('s').orderBy('s.title', 'ASC').addOrderBy('s.name', 'ASC');

      applyAgenstraSearchIlike(qb, 'opencode-mcp-servers', 's', sanitized);
      const [rows, total] = await qb.skip(offset).take(limit).getManyAndCount();

      return {
        servers: rows.map((row) => this.toDto(row)),
        total,
        limit,
        offset,
      };
    }

    const [rows, total] = await this.serversRepository.findAndCount({
      order: { title: 'ASC', name: 'ASC' },
      take: limit,
      skip: offset,
    });

    return {
      servers: rows.map((row) => this.toDto(row)),
      total,
      limit,
      offset,
    };
  }

  async getServerOrThrow(name: string): Promise<OpencodeMcpServerDto> {
    const trimmed = name.trim();

    if (!trimmed) {
      throw new NotFoundException('MCP server not found');
    }

    const row = await this.serversRepository.findOne({ where: { name: trimmed } });

    if (!row) {
      throw new NotFoundException('MCP server not found');
    }

    return this.toDto(row);
  }

  /** Batch lookup by reverse-DNS registry names (missing names are omitted). */
  async getServersByNames(names: readonly string[]): Promise<OpencodeMcpServerDto[]> {
    const normalized = [...new Set(names.map((name) => name.trim()).filter((name) => name.length > 0))];

    if (normalized.length === 0) {
      return [];
    }

    const rows = await this.serversRepository.findBy({ name: In(normalized) });

    return rows.map((row) => this.toDto(row));
  }

  /**
   * Walks all cursor pages of the official registry latest-servers list,
   * then upserts and removes stale names. Does not delete on mid-walk failure.
   */
  async refreshFromOfficialRegistry(): Promise<OpencodeMcpServersRefreshResult> {
    const mapped = await this.fetchAllLatestServers();

    if (mapped.servers.length === 0) {
      throw new Error(`MCP registry at ${mapped.baseUrl} returned no valid servers after ${mapped.pages} page(s)`);
    }

    const now = new Date();
    const rows = mapped.servers.map((server) =>
      this.serversRepository.create({
        name: server.name,
        title: server.title,
        description: server.description,
        version: server.version,
        status: server.status,
        websiteUrl: server.websiteUrl ?? null,
        packages: server.packages,
        remotes: server.remotes,
        repository: server.repository ?? null,
        publishedAt: server.publishedAt ? new Date(server.publishedAt) : null,
        registryUpdatedAt: server.registryUpdatedAt ? new Date(server.registryUpdatedAt) : null,
        updatedAt: now,
      }),
    );

    // Chunk upserts: a single multi-row INSERT exceeds Postgres bind limits (~65k params).
    for (let offset = 0; offset < rows.length; offset += OPENCODE_MCP_SERVERS_UPSERT_CHUNK_SIZE) {
      const chunk = rows.slice(offset, offset + OPENCODE_MCP_SERVERS_UPSERT_CHUNK_SIZE);

      await this.serversRepository.upsert(chunk, {
        conflictPaths: ['name'],
        skipUpdateIfNoValuesChanged: false,
      });
    }

    void this.searchIndex.bulkUpsertSafe(
      'opencode-mcp-servers',
      rows.map((row) => mapOpencodeMcpServerToSearchDocument(row)),
    );

    const keepNames = new Set(mapped.servers.map((server) => server.name));
    const existing = await this.serversRepository.find({ select: ['name'] });
    const staleNames = existing.map((row) => row.name).filter((name) => !keepNames.has(name));
    let removed = 0;

    for (let offset = 0; offset < staleNames.length; offset += OPENCODE_MCP_SERVERS_DELETE_CHUNK_SIZE) {
      const chunk = staleNames.slice(offset, offset + OPENCODE_MCP_SERVERS_DELETE_CHUNK_SIZE);
      const deleteResult = await this.serversRepository
        .createQueryBuilder()
        .delete()
        .where('name IN (:...names)', { names: chunk })
        .execute();

      removed += deleteResult.affected ?? 0;
    }

    for (const name of staleNames) {
      void this.searchIndex.deleteSafe('opencode-mcp-servers', name);
    }

    this.logger.log(
      `Refreshed OpenCode MCP servers catalog: upserted=${mapped.servers.length} removed=${removed} pages=${mapped.pages}`,
    );

    return { upserted: mapped.servers.length, removed, pages: mapped.pages };
  }

  /**
   * Fetches every page via opaque `metadata.nextCursor` until exhausted.
   */
  async fetchAllLatestServers(): Promise<{
    servers: OpencodeMcpServerDto[];
    pages: number;
    baseUrl: string;
  }> {
    const baseUrl = (process.env.OPENCODE_MCP_REGISTRY_BASE_URL?.trim() || OPENCODE_MCP_REGISTRY_BASE_URL).replace(
      /\/+$/,
      '',
    );
    const limit = OPENCODE_MCP_SERVERS_PAGE_LIMIT;
    const byName = new Map<string, OpencodeMcpServerDto>();
    let cursor: string | undefined;
    let pages = 0;

    // Full catalog sync — never stop after the first page.
    for (;;) {
      const url = new URL(`${baseUrl}/v0.1/servers`);

      url.searchParams.set('version', 'latest');
      url.searchParams.set('limit', String(limit));

      if (cursor) {
        url.searchParams.set('cursor', cursor);
      }

      const response = await fetch(url.toString());

      if (!response.ok) {
        throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
      }

      const payload = (await response.json()) as RegistryServerList;
      pages += 1;

      const pageServers = Array.isArray(payload.servers) ? payload.servers : [];

      for (const item of pageServers) {
        const mapped = this.mapServerResponse(item);

        if (mapped) {
          byName.set(mapped.name, mapped);
        }
      }

      const nextCursor = typeof payload.metadata?.nextCursor === 'string' ? payload.metadata.nextCursor.trim() : '';

      if (!nextCursor) {
        break;
      }

      cursor = nextCursor;
    }

    return {
      servers: [...byName.values()].sort((a, b) => a.title.localeCompare(b.title) || a.name.localeCompare(b.name)),
      pages,
      baseUrl,
    };
  }

  private async hydrateServersBySearchIds(
    lookup: AgenstraSearchIdsResult | null,
  ): Promise<{ items: OpencodeMcpServerEntity[]; total: number } | null> {
    if (!lookup) {
      return null;
    }

    if (lookup.ids.length === 0) {
      if (lookup.total === 0) {
        return null;
      }

      return { items: [], total: lookup.total };
    }

    const found = await this.serversRepository.findBy({ name: In(lookup.ids) });
    const byName = new Map(found.map((item) => [item.name, item]));
    const items = lookup.ids
      .map((id) => byName.get(id))
      .filter((item): item is OpencodeMcpServerEntity => item != null);

    return { items, total: lookup.total };
  }

  private mapServerResponse(item: RegistryServerResponse): OpencodeMcpServerDto | null {
    const server = item?.server;

    if (!server || typeof server.name !== 'string' || !server.name.trim()) {
      return null;
    }

    const official = item._meta?.['io.modelcontextprotocol.registry/official'];
    const status =
      official && typeof official.status === 'string' && official.status.trim() ? official.status.trim() : 'active';

    if (status === 'deleted') {
      return null;
    }

    const name = server.name.trim().slice(0, 200);
    const titleRaw = typeof server.title === 'string' && server.title.trim() ? server.title.trim() : name;
    const title = titleRaw.slice(0, 256);
    const descriptionRaw =
      typeof server.description === 'string' && server.description.trim() ? server.description.trim() : title;
    const description = descriptionRaw.slice(0, 512);
    const versionRaw = typeof server.version === 'string' && server.version.trim() ? server.version.trim() : '0.0.0';
    const version = versionRaw.slice(0, 255);

    const dto: OpencodeMcpServerDto = {
      name,
      title,
      description,
      version,
      status: status.slice(0, 32),
      packages: Array.isArray(server.packages) ? server.packages : [],
      remotes: Array.isArray(server.remotes) ? server.remotes : [],
    };

    if (typeof server.websiteUrl === 'string' && server.websiteUrl.trim()) {
      dto.websiteUrl = server.websiteUrl.trim().slice(0, 1024);
    }

    if (server.repository && typeof server.repository === 'object' && !Array.isArray(server.repository)) {
      dto.repository = server.repository as Record<string, unknown>;
    }

    if (official && typeof official.publishedAt === 'string' && official.publishedAt.trim()) {
      dto.publishedAt = official.publishedAt.trim();
    }

    if (official && typeof official.updatedAt === 'string' && official.updatedAt.trim()) {
      dto.registryUpdatedAt = official.updatedAt.trim();
    }

    return dto;
  }

  private toDto(row: OpencodeMcpServerEntity): OpencodeMcpServerDto {
    const dto: OpencodeMcpServerDto = {
      name: row.name,
      title: row.title,
      description: row.description,
      version: row.version,
      status: row.status,
      packages: Array.isArray(row.packages) ? row.packages : [],
      remotes: Array.isArray(row.remotes) ? row.remotes : [],
    };

    if (row.websiteUrl) {
      dto.websiteUrl = row.websiteUrl;
    }

    if (row.repository) {
      dto.repository = row.repository;
    }

    if (row.publishedAt) {
      dto.publishedAt = row.publishedAt.toISOString();
    }

    if (row.registryUpdatedAt) {
      dto.registryUpdatedAt = row.registryUpdatedAt.toISOString();
    }

    return dto;
  }
}
