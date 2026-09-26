import { OpenSearchService } from '@forepath/shared/backend/util-opensearch';
import { Injectable, Logger } from '@nestjs/common';

import { ClientAgentFileSystemProxyService } from '../services/client-agent-file-system-proxy.service';

import { sanitizeWorkspaceSearchPathFilter, shouldSkipWorkspaceIndexPath } from './workspace-search-ignore';
import {
  WORKSPACE_FILES_ENTITY,
  WORKSPACE_FILES_MAPPINGS,
  WORKSPACE_INDEX_CONTENT_MAX_BYTES,
  WORKSPACE_SEARCH_PATH_FIELDS,
  WORKSPACE_SEARCH_TEXT_FIELDS,
  type WorkspaceIndexPathChange,
  type WorkspaceIndexStatusDto,
  type WorkspaceIndexStatusState,
  type WorkspaceSearchHitDto,
  type WorkspaceSearchMode,
  type WorkspaceSearchResponseDto,
} from './workspace-search.types';

interface StatusEntry {
  status: WorkspaceIndexStatusState;
  docCount: number;
  message?: string | null;
}

@Injectable()
export class WorkspaceSearchIndexService {
  private readonly logger = new Logger(WorkspaceSearchIndexService.name);
  private readonly statusByKey = new Map<string, StatusEntry>();
  private indexReady = false;

  constructor(
    private readonly openSearch: OpenSearchService,
    private readonly fileProxy: ClientAgentFileSystemProxyService,
  ) {}

  private statusKey(clientId: string, agentId: string): string {
    return `${clientId}:${agentId}`;
  }

  private docId(clientId: string, agentId: string, path: string): string {
    return `${clientId}:${agentId}:${path}`;
  }

  private indexName(): string {
    return this.openSearch.indexName(WORKSPACE_FILES_ENTITY);
  }

  async ensureIndex(): Promise<void> {
    if (!this.openSearch.isEnabled() || this.indexReady) {
      return;
    }

    await this.openSearch.ensureIndex(this.indexName(), WORKSPACE_FILES_MAPPINGS);
    this.indexReady = true;
  }

  /**
   * In-memory status for this process. After a controller restart the map is empty;
   * callers that need durability should use {@link getStatus} (recovers from OpenSearch).
   */
  private peekStatus(clientId: string, agentId: string): WorkspaceIndexStatusDto {
    if (!clientId || !agentId) {
      return { status: 'error', docCount: 0, message: 'Invalid scope' };
    }

    if (!this.openSearch.isEnabled()) {
      return { status: 'error', docCount: 0, message: 'Search unavailable' };
    }

    const entry = this.statusByKey.get(this.statusKey(clientId, agentId));

    if (!entry) {
      return { status: 'missing', docCount: 0 };
    }

    return {
      status: entry.status,
      docCount: entry.docCount,
      message: entry.message ?? null,
    };
  }

  /**
   * Status for an agent corpus. If this process has no cached entry (e.g. after restart),
   * adopts existing OpenSearch docs as `ready` instead of forcing a full rebuild.
   */
  async getStatus(clientId: string, agentId: string): Promise<WorkspaceIndexStatusDto> {
    const peeked = this.peekStatus(clientId, agentId);

    if (peeked.status !== 'missing' || !clientId || !agentId || !this.openSearch.isEnabled()) {
      return peeked;
    }

    return this.recoverStatusFromOpenSearch(clientId, agentId);
  }

  /**
   * When in-memory status is absent, count OpenSearch docs for this client+agent.
   * docCount > 0 → cache `ready`; otherwise cache `missing` so we do not re-query every poll.
   */
  private async recoverStatusFromOpenSearch(clientId: string, agentId: string): Promise<WorkspaceIndexStatusDto> {
    try {
      await this.ensureIndex();

      const result = await this.openSearch.search({
        index: this.indexName(),
        query: '*',
        fields: ['path'],
        filters: { clientId, agentId },
        from: 0,
        size: 1,
      });

      if (result.total > 0) {
        this.setStatus(clientId, agentId, { status: 'ready', docCount: result.total, message: null });
        this.logger.log(
          `Recovered workspace index status for ${clientId}/${agentId} from OpenSearch (${result.total} docs)`,
        );
      } else {
        this.setStatus(clientId, agentId, { status: 'missing', docCount: 0, message: null });
      }
    } catch (error: unknown) {
      this.logger.warn(
        `Workspace index status recovery failed for ${clientId}/${agentId}: ${(error as Error).message}`,
      );

      return { status: 'missing', docCount: 0 };
    }

    return this.peekStatus(clientId, agentId);
  }

  private setStatus(clientId: string, agentId: string, patch: Partial<StatusEntry>): void {
    const key = this.statusKey(clientId, agentId);
    const previous = this.statusByKey.get(key) ?? { status: 'missing' as const, docCount: 0 };

    this.statusByKey.set(key, { ...previous, ...patch });
  }

  async applyPathChanges(clientId: string, agentId: string, changes: WorkspaceIndexPathChange[]): Promise<void> {
    if (!clientId || !agentId || !this.openSearch.isEnabled()) {
      return;
    }

    await this.ensureIndex();

    for (const change of changes) {
      if (shouldSkipWorkspaceIndexPath(change.path)) {
        continue;
      }

      if (change.op === 'delete') {
        await this.openSearch.deleteDocument(this.indexName(), this.docId(clientId, agentId, change.path));
        continue;
      }

      await this.upsertPath(clientId, agentId, change.path);
    }

    await this.refreshDocCount(clientId, agentId);

    const current = this.peekStatus(clientId, agentId);

    if (current.status === 'missing') {
      this.setStatus(clientId, agentId, { status: 'ready' });
    }
  }

  async rebuild(clientId: string, agentId: string, seedPaths?: string[]): Promise<void> {
    if (!clientId || !agentId) {
      return;
    }

    if (!this.openSearch.isEnabled()) {
      this.setStatus(clientId, agentId, { status: 'error', message: 'Search unavailable' });

      return;
    }

    this.setStatus(clientId, agentId, { status: 'indexing', message: null });

    try {
      await this.ensureIndex();
      await this.openSearch.deleteByQuery(this.indexName(), { clientId, agentId });

      const paths = seedPaths?.length
        ? seedPaths.filter((path) => !shouldSkipWorkspaceIndexPath(path))
        : await this.walkAllFilePaths(clientId, agentId);

      for (const path of paths) {
        await this.upsertPath(clientId, agentId, path);
      }

      await this.refreshDocCount(clientId, agentId);
      this.setStatus(clientId, agentId, { status: 'ready', message: null });
    } catch (error: unknown) {
      this.logger.warn(`Workspace index rebuild failed for ${clientId}/${agentId}: ${(error as Error).message}`);
      this.setStatus(clientId, agentId, { status: 'error', message: 'Index rebuild failed' });
    }
  }

  async purgeAgent(clientId: string, agentId: string): Promise<void> {
    if (!clientId || !agentId || !this.openSearch.isEnabled()) {
      this.statusByKey.delete(this.statusKey(clientId, agentId));

      return;
    }

    await this.ensureIndex();
    await this.openSearch.deleteByQuery(this.indexName(), { clientId, agentId });
    this.statusByKey.delete(this.statusKey(clientId, agentId));
  }

  async search(
    clientId: string,
    agentId: string,
    query: string,
    includePaths: string[] = [],
    excludePaths: string[] = [],
    from = 0,
    size = 50,
    mode: WorkspaceSearchMode = 'full',
  ): Promise<WorkspaceSearchResponseDto> {
    const status = await this.getStatus(clientId, agentId);

    if (!clientId || !agentId) {
      return { status: 'error', hits: [], total: 0 };
    }

    if (status.status === 'missing' || status.status === 'indexing' || status.status === 'error') {
      return { status: status.status, hits: [], total: 0 };
    }

    if (!this.openSearch.isEnabled()) {
      return { status: 'error', hits: [], total: 0 };
    }

    await this.ensureIndex();

    const include = includePaths.map(sanitizeWorkspaceSearchPathFilter).filter((value): value is string => !!value);
    const exclude = excludePaths.map(sanitizeWorkspaceSearchPathFilter).filter((value): value is string => !!value);
    const filters: Record<string, string | string[] | boolean | number> = {
      clientId,
      agentId,
    };
    const searchMode: WorkspaceSearchMode = mode === 'files' ? 'files' : 'full';
    const fields = searchMode === 'files' ? WORKSPACE_SEARCH_PATH_FIELDS : WORKSPACE_SEARCH_TEXT_FIELDS;

    const result = await this.openSearch.search({
      index: this.indexName(),
      query: query.trim(),
      fields,
      filters,
      from,
      size,
    });

    let hits: WorkspaceSearchHitDto[] = result.hits.map((hit) => {
      const source = hit.source;
      const path = String(source['path'] ?? '');
      const content = typeof source['content'] === 'string' ? source['content'] : '';
      const fileType = String(source['fileType'] ?? 'binary');
      const matches = searchMode === 'full' && fileType === 'text' ? this.buildMatches(content, query) : [];
      const first = matches[0];

      return {
        path,
        fileName: String(source['fileName'] ?? path.split('/').pop() ?? path),
        fileType,
        size: Number(source['size'] ?? 0),
        matches,
        snippet: first?.snippet ?? null,
        line: first?.line ?? null,
      };
    });

    if (include.length > 0) {
      hits = hits.filter((hit) => include.some((prefix) => hit.path === prefix || hit.path.startsWith(`${prefix}/`)));
    }

    if (exclude.length > 0) {
      hits = hits.filter((hit) => !exclude.some((prefix) => hit.path === prefix || hit.path.startsWith(`${prefix}/`)));
    }

    return {
      status: 'ready',
      hits,
      total: hits.length < result.total && (include.length > 0 || exclude.length > 0) ? hits.length : result.total,
    };
  }

  private async upsertPath(clientId: string, agentId: string, filePath: string): Promise<void> {
    if (shouldSkipWorkspaceIndexPath(filePath)) {
      return;
    }

    try {
      const probe = await this.fileProxy.probeFile(clientId, agentId, filePath, 'app');
      const fileName = filePath.split('/').pop() ?? filePath;
      const pathParts = filePath.split('/').filter(Boolean);
      let content: string | undefined;
      let contentOmitted = probe.fileType !== 'text';

      if (probe.fileType === 'text' && probe.size <= WORKSPACE_INDEX_CONTENT_MAX_BYTES) {
        const read = await this.fileProxy.readFile(clientId, agentId, filePath, 'app');

        content = read.buffer.toString('utf-8');
        contentOmitted = false;
      } else if (probe.fileType === 'text') {
        contentOmitted = true;
      }

      await this.openSearch.indexDocument(this.indexName(), this.docId(clientId, agentId, filePath), {
        clientId,
        agentId,
        path: filePath,
        pathParts,
        fileName,
        content,
        fileType: probe.fileType,
        size: probe.size,
        indexedAt: new Date().toISOString(),
        contentOmitted,
      });
    } catch (error: unknown) {
      this.logger.debug(`Skip index upsert for ${filePath}: ${(error as Error).message}`);
    }
  }

  private async walkAllFilePaths(clientId: string, agentId: string, directory = '.'): Promise<string[]> {
    const nodes = await this.fileProxy.listDirectory(clientId, agentId, directory, 'app');
    const paths: string[] = [];

    for (const node of nodes) {
      if (shouldSkipWorkspaceIndexPath(node.path)) {
        continue;
      }

      if (node.type === 'file') {
        paths.push(node.path);
      } else if (node.type === 'directory') {
        const childPaths = await this.walkAllFilePaths(clientId, agentId, node.path);

        paths.push(...childPaths);
      }
    }

    return paths;
  }

  private async refreshDocCount(clientId: string, agentId: string): Promise<void> {
    const result = await this.openSearch.search({
      index: this.indexName(),
      query: '*',
      fields: ['path'],
      filters: { clientId, agentId },
      from: 0,
      size: 1,
    });
    const previous = this.statusByKey.get(this.statusKey(clientId, agentId));

    this.setStatus(clientId, agentId, {
      status: previous?.status === 'indexing' ? 'indexing' : 'ready',
      docCount: result.total,
    });
  }

  private static readonly MAX_MATCHES_PER_FILE = 100;

  private buildMatches(content: string, query: string): { line: number; snippet: string }[] {
    if (!content || !query.trim()) {
      return [];
    }

    const needle = query.trim().toLowerCase();
    const lines = content.split(/\r?\n/);
    const matches: { line: number; snippet: string }[] = [];

    for (let index = 0; index < lines.length; index++) {
      if (lines[index].toLowerCase().includes(needle)) {
        matches.push({ line: index + 1, snippet: lines[index].slice(0, 240) });

        if (matches.length >= WorkspaceSearchIndexService.MAX_MATCHES_PER_FILE) {
          break;
        }
      }
    }

    return matches;
  }
}
