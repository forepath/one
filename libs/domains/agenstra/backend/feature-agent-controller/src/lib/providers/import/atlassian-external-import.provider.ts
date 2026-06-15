import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  confluencePageBodyHtml,
  isConfluencePageTypeAncestor,
  isJiraAdfDocument,
  jiraAdfToMarkdown,
} from '../../context-import/atlassian-format-to-markdown';
import {
  atlassianFetchJson,
  buildBasicAuthHeader,
  confluenceContentSearchUrlsEquivalent,
  confluenceRestApiRoot,
  contentHashForImport,
  normalizeAtlassianBaseUrl,
  resolveConfluencePaginationUrl,
} from '../../context-import/atlassian-rest.util';
import {
  atlassianWikiMarkupToMarkdown,
  looksLikeAtlassianWikiMarkup,
} from '../../context-import/atlassian-wiki-markup-to-markdown';
import { buildConfluenceImportSearchCql } from '../../context-import/confluence-import-cql.util';
import {
  confluenceTrimmedImportChain,
  extractConfluenceInternalPageIdsFromHtml,
} from '../../context-import/confluence-import-structure.util';
import { confluenceStorageHtmlToMarkdown } from '../../context-import/confluence-storage-html-to-markdown';
import { buildJiraIssueSearchJql, resolveJiraBoardIdForAgileApi } from '../../context-import/jira-import-jql.util';
import { AtlassianSiteConnectionEntity } from '../../entities/atlassian-site-connection.entity';
import type { ExternalImportConfigEntity } from '../../entities/external-import-config.entity';
import {
  ExternalImportKind,
  ExternalImportMarkerType,
  ExternalImportProviderId,
} from '../../entities/external-import.enums';
import { KnowledgeRelationSourceType, KnowledgeRelationTargetType } from '../../entities/knowledge-node.enums';
import { TicketPriority, TicketStatus } from '../../entities/ticket.enums';
import { ExternalImportSyncMarkerService } from '../../services/external-import-sync-marker.service';
import { KnowledgeTreeService } from '../../services/knowledge-tree.service';
import { TicketsService } from '../../services/tickets.service';
import type {
  ExternalContextImportProvider,
  ExternalContextImportRunContext,
  ExternalContextImportRunResult,
} from '../external-import-provider.interface';

interface JiraIssueFields {
  summary?: string;
  description?: unknown;
  status?: { name?: string; statusCategory?: { name?: string } };
  priority?: { name?: string };
  parent?: { key?: string; id?: string };
}

interface JiraIssue {
  id: string;
  key: string;
  fields?: JiraIssueFields;
}

interface ConfluencePage {
  id: string;
  type?: string;
  title?: string;
  body?: { storage?: { value?: string }; view?: { value?: string } };
  ancestors?: Array<{ id?: string; type?: string; title?: string }>;
}

@Injectable()
export class AtlassianImportProvider implements ExternalContextImportProvider {
  private readonly logger = new Logger(AtlassianImportProvider.name);

  constructor(
    @InjectRepository(AtlassianSiteConnectionEntity)
    private readonly connectionRepo: Repository<AtlassianSiteConnectionEntity>,
    @Inject(forwardRef(() => TicketsService))
    private readonly ticketsService: TicketsService,
    @Inject(forwardRef(() => KnowledgeTreeService))
    private readonly knowledgeTreeService: KnowledgeTreeService,
    private readonly syncMarkerService: ExternalImportSyncMarkerService,
  ) {}

  getType(): string {
    return ExternalImportProviderId.ATLASSIAN;
  }

  async testConnection(connectionId: string): Promise<{ ok: boolean; message?: string }> {
    try {
      const row = await this.connectionRepo.findOne({ where: { id: connectionId } });

      if (!row) {
        return { ok: false, message: 'Connection not found' };
      }

      const base = normalizeAtlassianBaseUrl(row.baseUrl);
      const auth = buildBasicAuthHeader(row.accountEmail, row.apiToken);
      const url = `${base}/rest/api/3/myself`;
      const res = await atlassianFetchJson(url, { method: 'GET', headers: { Authorization: auth } });

      if (!res.ok) {
        return { ok: false, message: `HTTP ${res.status}` };
      }

      return { ok: true };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);

      return { ok: false, message: msg };
    }
  }

  async runImport(ctx: ExternalContextImportRunContext): Promise<ExternalContextImportRunResult> {
    if (process.env.ATLASSIAN_IMPORT_DISABLED === 'true') {
      return { processedCount: 0, hasMore: false, errorMessage: 'Atlassian import disabled' };
    }

    const config = ctx.config;

    if (config.provider !== ExternalImportProviderId.ATLASSIAN) {
      return { processedCount: 0, hasMore: false, errorMessage: 'Wrong provider' };
    }

    const connection = await this.connectionRepo.findOne({ where: { id: config.atlassianConnectionId } });

    if (!connection) {
      return { processedCount: 0, hasMore: false, errorMessage: 'Atlassian connection missing' };
    }

    try {
      if (config.importKind === ExternalImportKind.JIRA) {
        return await this.runJiraImport(config, connection, ctx.itemBudget);
      }

      if (config.importKind === ExternalImportKind.CONFLUENCE) {
        return await this.runConfluenceImport(config, connection, ctx.itemBudget);
      }

      return { processedCount: 0, hasMore: false, errorMessage: 'Unknown import kind' };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);

      this.logger.warn(`Atlassian import failed for config ${config.id}: ${msg}`);

      return { processedCount: 0, hasMore: false, errorMessage: msg };
    }
  }

  private async runJiraImport(
    config: ExternalImportConfigEntity,
    connection: AtlassianSiteConnectionEntity,
    _itemBudget: number,
  ): Promise<ExternalContextImportRunResult> {
    const jqlTrim = config.jql?.trim() ?? '';

    if (!jqlTrim) {
      return { processedCount: 0, hasMore: false, errorMessage: 'JQL is required for Jira import' };
    }

    const base = normalizeAtlassianBaseUrl(connection.baseUrl);
    const auth = buildBasicAuthHeader(connection.accountEmail, connection.apiToken);
    const pageSize = 100;
    const issues: JiraIssue[] = [];
    const agileBoardId = resolveJiraBoardIdForAgileApi(config.jiraBoardId);
    const effectiveJql = buildJiraIssueSearchJql(jqlTrim);

    if (agileBoardId != null) {
      let startAt = 0;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const url = new URL(`${base}/rest/agile/1.0/board/${agileBoardId}/issue`);

        url.searchParams.set('startAt', String(startAt));
        url.searchParams.set('maxResults', String(pageSize));
        url.searchParams.set('fields', 'summary,description,status,priority,parent,issuetype');
        // Board scope is the URL path; omit injected ORDER BY so Jira can use board rank by default.
        url.searchParams.set('jql', jqlTrim);

        const res = await atlassianFetchJson(url.toString(), { method: 'GET', headers: { Authorization: auth } });

        if (!res.ok) {
          return { processedCount: 0, hasMore: false, errorMessage: `Jira board issues HTTP ${res.status}` };
        }

        const body = res.json as { issues?: JiraIssue[]; total?: number; startAt?: number; maxResults?: number };
        const batch = body.issues ?? [];

        issues.push(...batch);

        if (batch.length === 0) {
          break;
        }

        const nextStart = (body.startAt ?? startAt) + batch.length;
        const total = body.total;

        if (typeof total === 'number' && nextStart >= total) {
          break;
        }

        if (typeof total !== 'number' && batch.length < pageSize) {
          break;
        }

        startAt = nextStart;
      }
    } else {
      let startAt = 0;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const res = await atlassianFetchJson(`${base}/rest/api/3/search`, {
          method: 'POST',
          headers: { Authorization: auth, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jql: effectiveJql,
            startAt,
            maxResults: pageSize,
            fields: ['summary', 'description', 'status', 'priority', 'parent', 'issuetype'],
          }),
        });

        if (!res.ok) {
          return { processedCount: 0, hasMore: false, errorMessage: `Jira search HTTP ${res.status}` };
        }

        const body = res.json as { issues?: JiraIssue[]; total?: number; startAt?: number; maxResults?: number };
        const batch = body.issues ?? [];

        issues.push(...batch);

        if (batch.length === 0) {
          break;
        }

        const nextStart = (body.startAt ?? startAt) + batch.length;
        const total = body.total;

        if (typeof total === 'number' && nextStart >= total) {
          break;
        }

        if (typeof total !== 'number' && batch.length < pageSize) {
          break;
        }

        startAt = nextStart;
      }
    }

    let processed = 0;
    const keyToLocalId = new Map<string, string>();

    for (const iss of issues) {
      const m = await this.syncMarkerService.findMarker(config.id, ExternalImportMarkerType.JIRA_ISSUE, iss.key);

      if (m?.localTicketId) {
        keyToLocalId.set(iss.key, m.localTicketId);
      }
    }

    const pending = [...issues];
    let rounds = 0;

    while (pending.length > 0 && rounds < issues.length * 4 + 8) {
      rounds++;
      let progressed = false;

      for (let i = 0; i < pending.length; ) {
        const issue = pending[i]!;
        const parentKey = issue.fields?.parent?.key;
        let parentId: string | null = config.agenstraParentTicketId ?? null;

        if (parentKey) {
          const mapped = keyToLocalId.get(parentKey);

          if (!mapped) {
            i++;

            continue;
          }

          parentId = mapped;
        }

        pending.splice(i, 1);
        progressed = true;
        const result = await this.processOneJiraIssue(config, issue, parentId);

        if (result.count > 0) {
          processed += result.count;
        }

        if (result.ticketId) {
          keyToLocalId.set(issue.key, result.ticketId);
        }
      }

      if (!progressed) {
        break;
      }
    }

    return { processedCount: processed, hasMore: pending.length > 0 };
  }

  private async processOneJiraIssue(
    config: ExternalImportConfigEntity,
    issue: JiraIssue,
    parentId: string | null,
  ): Promise<{ count: number; ticketId?: string }> {
    const key = issue.key;
    const marker = await this.syncMarkerService.findMarker(config.id, ExternalImportMarkerType.JIRA_ISSUE, key);

    if (marker && !marker.localTicketId) {
      return { count: 0 };
    }

    const title = (issue.fields?.summary ?? key).slice(0, 500);
    const content = extractJiraDescription(issue.fields?.description);
    const hash = contentHashForImport(title, content);
    const status = config.importTargetTicketStatus ?? TicketStatus.DRAFT;
    const priority = mapJiraPriority(issue.fields);

    if (marker?.contentHash === hash && marker.localTicketId) {
      return { count: 0, ticketId: marker.localTicketId };
    }

    const dto = await this.ticketsService.importUpsertTicket({
      clientId: config.clientId,
      parentId,
      title,
      content,
      priority,
      status,
      existingTicketId: marker?.localTicketId ?? null,
    });

    await this.syncMarkerService.upsertMarkerFields(config.id, ExternalImportMarkerType.JIRA_ISSUE, key, {
      localTicketId: dto.id,
      localKnowledgeNodeId: null,
      contentHash: hash,
      lastImportedAt: new Date(),
    });

    return { count: 1, ticketId: dto.id };
  }

  private async runConfluenceImport(
    config: ExternalImportConfigEntity,
    connection: AtlassianSiteConnectionEntity,
    itemBudget: number,
  ): Promise<ExternalContextImportRunResult> {
    const cqlRaw = config.cql?.trim() ?? '';

    if (!cqlRaw) {
      return { processedCount: 0, hasMore: false, errorMessage: 'CQL is required for Confluence import' };
    }

    const siteBase = normalizeAtlassianBaseUrl(connection.baseUrl);
    const confluenceRoot = confluenceRestApiRoot(siteBase);
    const auth = buildBasicAuthHeader(connection.accountEmail, connection.apiToken);
    const cql = buildConfluenceImportSearchCql(cqlRaw, config.confluenceSpaceKey, config.confluenceRootPageId);
    const limit = 100;
    const searchParams = new URLSearchParams();

    searchParams.set('cql', cql);
    searchParams.set('limit', String(limit));
    searchParams.set('expand', 'body.storage,body.view,ancestors,version');

    const budget = Math.max(1, itemBudget);
    const maxRawResults = Math.min(5000, Math.max(100, budget * 40));
    const maxPages = Math.min(5000, Math.max(1, Math.ceil(maxRawResults / limit)));
    let fetchTruncated = false;
    let nextUrl: string | null = `${confluenceRoot}/rest/api/content/search?${searchParams.toString()}`;
    const results: ConfluencePage[] = [];

    for (let pageIdx = 0; nextUrl; pageIdx++) {
      if (pageIdx >= maxPages) {
        fetchTruncated = true;
        break;
      }

      const current = nextUrl;
      const res = await atlassianFetchJson(current, { method: 'GET', headers: { Authorization: auth } });

      if (!res.ok) {
        return { processedCount: 0, hasMore: false, errorMessage: `Confluence search HTTP ${res.status}` };
      }

      const body = res.json as {
        results?: ConfluencePage[];
        size?: number;
        limit?: number;
        _links?: { next?: string };
      };

      results.push(...(body.results ?? []));

      const relNext = body._links?.next;

      if (results.length >= maxRawResults) {
        if (relNext) {
          fetchTruncated = true;
        }

        break;
      }

      if (!relNext) {
        break;
      }

      const resolvedNext = resolveConfluencePaginationUrl(siteBase, confluenceRoot, relNext);

      if (confluenceContentSearchUrlsEquivalent(resolvedNext, current)) {
        break;
      }

      nextUrl = resolvedNext;
    }

    let processed = 0;
    const importRootFolderId = config.agenstraParentFolderId ?? null;
    const passesConfluenceRootFilter = (page: ConfluencePage): boolean => {
      if (!config.confluenceRootPageId) {
        return true;
      }

      if (page.id === config.confluenceRootPageId) {
        return true;
      }

      return page.ancestors?.some((a) => a.id === config.confluenceRootPageId) ?? false;
    };
    const filteredForTree = results.filter(passesConfluenceRootFilter);
    const flatParentFolderId = importRootFolderId;
    let stoppedByBudget = false;
    let relationWalkEnd = filteredForTree.length;

    for (let i = 0; i < filteredForTree.length; i++) {
      const page = filteredForTree[i]!;

      if (processed >= budget) {
        stoppedByBudget = true;
        relationWalkEnd = i;
        break;
      }

      const externalId = page.id;
      const marker = await this.syncMarkerService.findMarker(
        config.id,
        ExternalImportMarkerType.CONFLUENCE_PAGE,
        externalId,
      );

      if (marker && !marker.localKnowledgeNodeId) {
        continue;
      }

      const title = (page.title ?? 'Untitled').slice(0, 500);
      const html = confluencePageBodyHtml(page);
      const content = confluenceStorageHtmlToMarkdown(html);
      const hash = contentHashForImport(title, content);

      if (marker?.contentHash === hash && marker.localKnowledgeNodeId) {
        continue;
      }

      const node = await this.knowledgeTreeService.importUpsertKnowledgePage({
        clientId: config.clientId,
        parentFolderId: flatParentFolderId,
        title,
        content,
        existingNodeId: marker?.localKnowledgeNodeId ?? null,
      });

      await this.syncMarkerService.upsertMarkerFields(config.id, ExternalImportMarkerType.CONFLUENCE_PAGE, externalId, {
        localTicketId: null,
        localKnowledgeNodeId: node.id,
        contentHash: hash,
        lastImportedAt: new Date(),
      });

      processed++;
    }

    const pagesForThisRunRelations = filteredForTree.slice(0, relationWalkEnd);
    const confluenceIdToLocalPageId = new Map<string, string>();

    for (const p of filteredForTree) {
      const m = await this.syncMarkerService.findMarker(config.id, ExternalImportMarkerType.CONFLUENCE_PAGE, p.id);

      if (m?.localKnowledgeNodeId) {
        confluenceIdToLocalPageId.set(p.id, m.localKnowledgeNodeId);
      }
    }

    await this.syncConfluenceInternalLinksAsRelations(config, pagesForThisRunRelations, confluenceIdToLocalPageId);
    await this.syncConfluenceStructuralPageRelations(config, pagesForThisRunRelations, confluenceIdToLocalPageId);

    return { processedCount: processed, hasMore: fetchTruncated || stoppedByBudget };
  }

  private async resolveConfluencePageLocalKnowledgeId(
    config: ExternalImportConfigEntity,
    confluencePageId: string,
    confluenceIdToLocalPageId: ReadonlyMap<string, string>,
  ): Promise<string | null> {
    const fromBatch = confluenceIdToLocalPageId.get(confluencePageId);

    if (fromBatch) {
      return fromBatch;
    }

    const m = await this.syncMarkerService.findMarker(
      config.id,
      ExternalImportMarkerType.CONFLUENCE_PAGE,
      confluencePageId,
    );

    return m?.localKnowledgeNodeId ?? null;
  }

  private async ensureConfluencePageToPageRelation(
    config: ExternalImportConfigEntity,
    sourceLocalId: string,
    targetLocalId: string,
  ): Promise<void> {
    if (sourceLocalId === targetLocalId) {
      return;
    }

    const existing = await this.knowledgeTreeService.importListRelations(
      config.clientId,
      KnowledgeRelationSourceType.PAGE,
      sourceLocalId,
    );

    if (existing.some((r) => r.targetType === KnowledgeRelationTargetType.PAGE && r.targetNodeId === targetLocalId)) {
      return;
    }

    await this.knowledgeTreeService.importCreateRelation({
      clientId: config.clientId,
      sourceType: KnowledgeRelationSourceType.PAGE,
      sourceId: sourceLocalId,
      targetType: KnowledgeRelationTargetType.PAGE,
      targetNodeId: targetLocalId,
    });
  }

  /**
   * Confluence hierarchy (page under page, or page under folder under page) becomes PAGE→PAGE relations
   * instead of knowledge folders.
   */
  private async syncConfluenceStructuralPageRelations(
    config: ExternalImportConfigEntity,
    pages: readonly ConfluencePage[],
    confluenceIdToLocalPageId: ReadonlyMap<string, string>,
  ): Promise<void> {
    const batchSize = pages.length;
    const rootPageId = config.confluenceRootPageId ?? null;

    for (const page of pages) {
      const childLocal = confluenceIdToLocalPageId.get(page.id);

      if (!childLocal) {
        continue;
      }

      const chain = confluenceTrimmedImportChain(page, batchSize, rootPageId);
      let nearestPageAncestorId: string | null = null;

      for (let i = chain.length - 1; i >= 0; i--) {
        const a = chain[i];

        if (!a?.id || !isConfluencePageTypeAncestor(a)) {
          continue;
        }

        nearestPageAncestorId = a.id;
        break;
      }

      if (!nearestPageAncestorId || nearestPageAncestorId === page.id) {
        continue;
      }

      const parentLocal = await this.resolveConfluencePageLocalKnowledgeId(
        config,
        nearestPageAncestorId,
        confluenceIdToLocalPageId,
      );

      if (!parentLocal) {
        continue;
      }

      await this.ensureConfluencePageToPageRelation(config, parentLocal, childLocal);
    }
  }

  private async syncConfluenceInternalLinksAsRelations(
    config: ExternalImportConfigEntity,
    pages: ConfluencePage[],
    confluenceIdToLocalPageId: ReadonlyMap<string, string>,
  ): Promise<void> {
    for (const page of pages) {
      const sourceLocal = confluenceIdToLocalPageId.get(page.id);

      if (!sourceLocal) {
        continue;
      }

      const html = confluencePageBodyHtml(page);

      for (const targetConfluenceId of extractConfluenceInternalPageIdsFromHtml(html)) {
        const targetLocal = await this.resolveConfluencePageLocalKnowledgeId(
          config,
          targetConfluenceId,
          confluenceIdToLocalPageId,
        );

        if (!targetLocal) {
          continue;
        }

        await this.ensureConfluencePageToPageRelation(config, sourceLocal, targetLocal);
      }
    }
  }
}

function extractJiraDescription(desc: unknown): string | null {
  if (desc == null) {
    return null;
  }

  if (typeof desc === 'string') {
    const t = desc.trim();

    if (!t.length) {
      return null;
    }

    const out = looksLikeAtlassianWikiMarkup(t) ? atlassianWikiMarkupToMarkdown(t) : t;

    return out.length ? out : null;
  }

  if (isJiraAdfDocument(desc)) {
    const md = jiraAdfToMarkdown(desc);

    return md.length ? md : null;
  }

  try {
    return JSON.stringify(desc);
  } catch {
    return String(desc);
  }
}

function mapJiraPriority(fields?: JiraIssueFields): TicketPriority {
  const name = String(fields?.priority?.name ?? '').toLowerCase();

  if (name.includes('highest') || name.includes('blocker')) {
    return TicketPriority.CRITICAL;
  }

  if (name.includes('high')) {
    return TicketPriority.HIGH;
  }

  if (name.includes('low') || name.includes('lowest') || name.includes('minor')) {
    return TicketPriority.LOW;
  }

  return TicketPriority.MEDIUM;
}
