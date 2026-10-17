import type { RequestWithUser } from '@forepath/identity/backend';
import { OpenSearchService } from '@forepath/shared/backend/util-opensearch';
import { BadRequestException, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Not } from 'typeorm';

import { atLeast, canReadProject, type AccessCaller } from '../access/access.utils';
import { ProjectAccessService } from '../access/project-access.service';
import { NodeEntity } from '../entities/node.entity';
import { PlanEntity } from '../entities/plan.entity';
import { ResourceEntity } from '../entities/resource.entity';
import { WorkloadPlannerService } from '../services/workload-planner.service';
import { matchActions, rankResults, searchDocuments, type SearchAction, type SearchDocument } from './search.utils';

const REINDEX_MS = 60_000;
const ADVISORY_LOCK_SEARCH = 0x4c570019;
const MAX_DOCUMENTS = 10_000;
const MAX_RECENTS = 20;

export interface SearchResult {
  id: string;
  kind: string;
  title: string;
  project: string | null;
  link: string;
  favourite: boolean;
}

function visible(caller: AccessCaller, doc: { project: string | null }): boolean {
  return doc.project ? canReadProject(caller, doc.project) : !!caller.clusterRole;
}

function userKey(caller: AccessCaller): string | null {
  return caller.userId ?? (caller.isApiKey ? 'api-key' : null);
}

/**
 * Global search and command palette (3.25): every entity indexed in OpenSearch (re-indexed every minute by one
 * replica), scoped by access, favourites and recently visited items first, plus matching actions. Without a log
 * store, the same documents are matched in memory.
 */
@Injectable()
export class SearchService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SearchService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly access: ProjectAccessService,
    private readonly opensearch: OpenSearchService,
    private readonly planner: WorkloadPlannerService,
  ) {}

  get index(): string {
    return this.opensearch.indexName('search');
  }

  onApplicationBootstrap(): void {
    if (!this.opensearch.isEnabled()) return;

    this.timer = setInterval(() => void this.reindex(), REINDEX_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async documents(): Promise<SearchDocument[]> {
    const resources = await this.dataSource.getRepository(ResourceEntity).find();
    const services = this.planner.parse(resources).parsed.flatMap((d) =>
      d.compose.services.map((s) => ({
        project: d.project,
        deployment: d.name,
        service: s.name,
        hosts: s.http.map((h) => h.host),
      })),
    );
    const nodes = await this.dataSource
      .getRepository(NodeEntity)
      .find({ where: { lifecycle: Not('left') }, select: { name: true, site: true } });
    const plans = await this.dataSource.getRepository(PlanEntity).find({
      order: { createdAt: 'DESC' },
      take: 500,
      select: { id: true, status: true, changes: true, createdAt: true },
    });
    const alerts: { id: string; title: string; project: string | null }[] = await this.dataSource.query(
      `SELECT id, title, project FROM lw_alerts WHERE state <> 'resolved' ORDER BY started_at DESC LIMIT 500`,
    );

    return searchDocuments({
      resources,
      services,
      nodes,
      plans: plans.map((p) => ({
        id: p.id,
        status: p.status,
        projects: [...new Set(p.changes.flatMap((c) => (c.project ? [c.project] : [])))],
        createdAt: p.createdAt,
      })),
      alerts,
    }).slice(0, MAX_DOCUMENTS);
  }

  /** Rebuilds the index: upserts every document, removes those that are gone. One replica at a time. */
  async reindex(): Promise<boolean> {
    if (this.running || !this.opensearch.isEnabled()) return false;

    this.running = true;

    const runner = this.dataSource.createQueryRunner();

    try {
      await runner.connect();

      const [{ locked }] = await runner.query('SELECT pg_try_advisory_lock($1) AS locked', [ADVISORY_LOCK_SEARCH]);

      if (!locked) return false;

      try {
        await this.opensearch.ensureIndex(this.index, {
          properties: {
            kind: { type: 'keyword' },
            name: { type: 'text' },
            title: { type: 'text' },
            text: { type: 'text' },
            project: { type: 'keyword' },
            link: { type: 'keyword', index: false },
          },
        });

        const docs = await this.documents();
        const ids = new Set(docs.map((d) => d.id));

        await this.opensearch.bulkUpsert(
          this.index,
          docs.map((d) => ({ id: d.id, document: { ...d, project: d.project ?? '' } })),
        );

        const existing = await this.opensearch.searchRaw(this.index, {
          size: MAX_DOCUMENTS,
          _source: false,
          query: { match_all: {} },
        });

        for (const hit of existing.hits.filter((h) => !ids.has(h.id)))
          await this.opensearch.deleteDocument(this.index, hit.id);
      } finally {
        await runner.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_SEARCH]);
      }

      return true;
    } catch (error) {
      this.logger.warn(`Search index: ${error instanceof Error ? error.message : String(error)}`);

      return false;
    } finally {
      await runner.release();
      this.running = false;
    }
  }

  async search(
    req: RequestWithUser | undefined,
    q: string,
    limit = 20,
  ): Promise<{ results: SearchResult[]; actions: SearchAction[] }> {
    const query = q.trim().slice(0, 200);

    if (!query) throw new BadRequestException('empty query');

    const caller = await this.access.caller(req);
    const projects = [...caller.projects.keys()].filter((p) => canReadProject(caller, p));
    const take = Math.min(Math.max(limit, 1), 50);
    let hits: (SearchDocument & { score: number })[];

    if (this.opensearch.isEnabled()) {
      const result = await this.opensearch.searchRaw(this.index, {
        size: take * 3,
        query: {
          bool: {
            must: [{ multi_match: { query, type: 'bool_prefix', fields: ['title^3', 'name^2', 'text'] } }],
            ...(caller.clusterRole ? {} : { filter: [{ terms: { project: projects.length ? projects : ['-'] } }] }),
          },
        },
      });

      hits = result.hits.map((h, i) => ({
        ...(h.source as unknown as SearchDocument),
        project: (h.source['project'] as string) || null,
        score: result.hits.length - i,
      }));
    } else {
      const words = query.toLowerCase().split(/\s+/);

      hits = (await this.documents())
        .map((d) => {
          const haystack = `${d.title} ${d.text}`.toLowerCase();

          return { ...d, score: words.every((w) => haystack.includes(w)) ? words.length : 0 };
        })
        .filter((d) => d.score > 0);
    }

    const user = userKey(caller);
    const favourites = new Set<string>(
      user
        ? (
            (await this.dataSource.query(`SELECT item FROM lw_search_favorites WHERE user_id = $1`, [user])) as {
              item: string;
            }[]
          ).map((r) => r.item)
        : [],
    );
    const recents = new Map<string, number>(
      user
        ? (
            (await this.dataSource.query(`SELECT item, visited_at FROM lw_search_recents WHERE user_id = $1`, [
              user,
            ])) as {
              item: string;
              visited_at: Date;
            }[]
          ).map((r) => [r.item, new Date(r.visited_at).getTime()])
        : [],
    );
    const results = rankResults(
      hits.filter((h) => visible(caller, h)),
      favourites,
      recents,
    )
      .slice(0, take)
      .map((h) => ({
        id: h.id,
        kind: h.kind,
        title: h.title,
        project: h.project,
        link: h.link,
        favourite: favourites.has(h.id),
      }));
    return { results, actions: await this.actions(caller, query) };
  }

  private async actions(caller: AccessCaller, query: string): Promise<SearchAction[]> {
    const nodes = caller.clusterRole
      ? (
          await this.dataSource
            .getRepository(NodeEntity)
            .find({ where: { lifecycle: Not('left') }, select: { name: true } })
        ).map((n) => n.name)
      : [];
    const resources = await this.dataSource
      .getRepository(ResourceEntity)
      .find({ where: [{ kind: 'Project' }, { kind: 'Deployment' }] });
    const services = this.planner
      .parse(resources)
      .parsed.filter((d) => canReadProject(caller, d.project))
      .flatMap((d) => d.compose.services.map((s) => ({ project: d.project, deployment: d.name, service: s.name })));

    return matchActions(query, {
      nodes,
      services,
      projects: resources.filter((r) => r.kind === 'Project' && canReadProject(caller, r.name)).map((r) => r.name),
      canManageNodes: caller.clusterRole === 'cluster-admin' || caller.clusterRole === 'infra-operator',
      canPlan: !!caller.clusterRole || [...caller.projects.values()].some((r) => atLeast(r, 'developer')),
    });
  }

  async favourites(req: RequestWithUser | undefined): Promise<string[]> {
    const user = userKey(await this.access.caller(req));

    if (!user) return [];

    return (
      (await this.dataSource.query(`SELECT item FROM lw_search_favorites WHERE user_id = $1 ORDER BY created_at`, [
        user,
      ])) as {
        item: string;
      }[]
    ).map((r) => r.item);
  }

  async setFavourite(req: RequestWithUser | undefined, item: string, favourite: boolean): Promise<void> {
    const user = userKey(await this.access.caller(req));

    if (!user) throw new BadRequestException('favourites need a user');

    if (favourite)
      await this.dataSource.query(
        `INSERT INTO lw_search_favorites (user_id, item) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [user, item],
      );
    else await this.dataSource.query(`DELETE FROM lw_search_favorites WHERE user_id = $1 AND item = $2`, [user, item]);
  }

  /** Records a visit (the console calls this on navigation); keeps the last 20 per user. */
  async visited(req: RequestWithUser | undefined, item: string): Promise<void> {
    const user = userKey(await this.access.caller(req));

    if (!user) return;

    await this.dataSource.query(
      `INSERT INTO lw_search_recents (user_id, item, visited_at) VALUES ($1, $2, now())
       ON CONFLICT (user_id, item) DO UPDATE SET visited_at = now()`,
      [user, item],
    );
    await this.dataSource.query(
      `DELETE FROM lw_search_recents WHERE user_id = $1 AND item NOT IN (
         SELECT item FROM lw_search_recents WHERE user_id = $1 ORDER BY visited_at DESC LIMIT ${MAX_RECENTS})`,
      [user],
    );
  }
}
