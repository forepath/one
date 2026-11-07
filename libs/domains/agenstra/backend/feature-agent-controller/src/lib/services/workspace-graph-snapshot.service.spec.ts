import type {
  AgentGraphDocument,
  AgentGraphEnvironmentDigest,
  AgentGraphStatus,
} from '@forepath/agenstra/shared/util-opencode-config';
import { ClientAgentCredentialEntity, UserRole } from '@forepath/identity/backend';
import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ChatPlanEntity } from '../entities/chat-plan.entity';
import { KnowledgeNodeEntity } from '../entities/knowledge-node.entity';
import { KnowledgeRelationEntity } from '../entities/knowledge-relation.entity';
import { TicketEntity } from '../entities/ticket.entity';
import { ClientsRepository } from '../repositories/clients.repository';
import { WorkspaceGraphSnapshotsRepository } from '../repositories/workspace-graph-snapshots.repository';
import {
  attachWorkspaceToComposedGraph,
  buildCrossEnvironmentReferenceEdges,
  buildWorkspaceSnapshotGraph,
  computeManagerKey,
  createGraphScopeCheck,
  filterGraphByScopes,
  limitGraphByDegree,
  mapSettledWithConcurrency,
  unionWorkspaceGraphs,
  WORKSPACE_GRAPH_LIMITS,
} from '../utils/workspace-graph.utils';

import { ClientAgentGraphProxyService } from './client-agent-graph-proxy.service';
import { ClientAgentProxyService } from './client-agent-proxy.service';
import { WorkspaceGraphChangeNotifierService } from './workspace-graph-change-notifier.service';
import {
  WORKSPACE_GRAPH_DIRTY_DEBOUNCE_MS,
  WORKSPACE_GRAPH_DIRTY_MAX_WAIT_MS,
  WORKSPACE_GRAPH_MANUAL_REFRESH_COOLDOWN_MS,
  WORKSPACE_GRAPH_MIN_REBUILD_INTERVAL_MS,
  WORKSPACE_GRAPH_STARTUP_DELAY_MS_ENV,
  WORKSPACE_GRAPH_STARTUP_REBUILD_ENV,
  WorkspaceGraphSnapshotService,
} from './workspace-graph-snapshot.service';

const CLIENT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CLIENT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ENV_1 = '11111111-1111-4111-8111-111111111111';
const ENV_2 = '22222222-2222-4222-8222-222222222222';
const ENV_3 = '33333333-3333-4333-8333-333333333333';

function status(overrides: Partial<AgentGraphStatus> = {}): AgentGraphStatus {
  return {
    environmentId: ENV_1,
    status: 'ready',
    builtAt: '2026-01-01T00:00:00.000Z',
    buildDurationMs: 10,
    truncated: false,
    error: null,
    layers: {},
    languages: { typescript: 10, markdown: 2 },
    fileCount: 12,
    ...overrides,
  };
}

function digest(overrides: Partial<AgentGraphEnvironmentDigest> = {}): AgentGraphEnvironmentDigest {
  return {
    environmentId: ENV_1,
    status: status(),
    modules: [],
    hubs: [],
    referencedMountIds: [],
    ...overrides,
  };
}

describe('workspace graph utils', () => {
  const managerKey = computeManagerKey('https://manager.example.com/');

  it('computes a stable 16 hex manager key independent of trailing slashes and case', () => {
    expect(managerKey).toMatch(/^[0-9a-f]{16}$/);
    expect(computeManagerKey('https://MANAGER.example.com')).toBe(managerKey);
    expect(computeManagerKey('https://other.example.com')).not.toBe(managerKey);
  });

  describe('buildWorkspaceSnapshotGraph', () => {
    const graph = buildWorkspaceSnapshotGraph(
      {
        clientId: CLIENT_A,
        clientName: 'Workspace A',
        environments: [
          {
            agentId: ENV_1,
            name: 'Frontend',
            managerKey,
            digest: digest({
              mountId: 'mount-1',
              referencedMountIds: ['mount-2', 'mount-2'],
              modules: Array.from({ length: 20 }, (_, index) => ({
                id: `m${index}`,
                label: `module ${index}`,
                files: index,
              })),
            }),
          },
          {
            agentId: ENV_2,
            managerKey,
            digest: digest({ environmentId: ENV_2, mountId: 'mount-2', status: status({ languages: { go: 3 } }) }),
          },
          { agentId: ENV_3, name: 'Broken', managerKey, failedStatus: 'failed' },
        ],
        knowledge: [
          { id: 'k-folder', nodeType: 'folder', parentId: null, title: 'Docs', longSha: 'sha-f' },
          { id: 'k-page', nodeType: 'page', parentId: 'k-folder', title: 'Page', longSha: 'sha-p' },
        ],
        tickets: [
          { id: 't-parent', parentId: null, title: 'Epic', longSha: 'sha-t1', status: 'todo', priority: 'high' },
          { id: 't-child', parentId: 't-parent', title: 'Task', longSha: 'sha-t2', status: 'done', priority: 'low' },
          { id: 't-orphan', parentId: 'gone', title: 'Orphan', longSha: null, status: 'todo', priority: 'low' },
        ],
        plans: [
          { id: 'p-1', agentId: ENV_1, summary: 'Refactor login', longSha: 'sha-plan', status: 'ready' },
          { id: 'p-foreign', agentId: 'not-a-member', summary: 'Hidden', longSha: null, status: 'ready' },
        ],
        relations: [
          { sourceType: 'ticket', sourceId: 't-child', targetType: 'page', targetNodeId: 'k-page' },
          { sourceType: 'page', sourceId: 'k-page', targetType: 'ticket', targetTicketLongSha: 'sha-t1' },
          { sourceType: 'page', sourceId: 'k-page', targetType: 'ticket', targetTicketLongSha: 'unknown' },
        ],
      },
      new Date('2026-02-01T00:00:00.000Z'),
    );
    const node = (id: string) => graph.nodes.find((entry) => entry.id === id);
    const hasEdge = (from: string, to: string, type: string) =>
      graph.edges.some((edge) => edge.from === from && edge.to === to && edge.type === type);

    it('builds the workspace document envelope', () => {
      expect(graph).toEqual(
        expect.objectContaining({
          version: 1,
          scope: 'global',
          layer: 'global',
          clientId: CLIENT_A,
          generatedAt: '2026-02-01T00:00:00.000Z',
          truncated: false,
          totalNodes: graph.nodes.length,
          totalEdges: graph.edges.length,
        }),
      );
      expect(node(`workspace:${CLIENT_A}`)).toEqual(
        expect.objectContaining({ type: 'workspace', label: 'Workspace A' }),
      );
    });

    it('adds environment nodes with digest attributes and failed environments', () => {
      expect(node(`environment:${ENV_1}`)).toEqual({
        id: `environment:${ENV_1}`,
        type: 'environment',
        label: 'Frontend',
        attrs: {
          status: 'ready',
          fileCount: 12,
          builtAt: '2026-01-01T00:00:00.000Z',
          managerKey,
          referencedMountIds: ['mount-2'],
          mountId: 'mount-1',
        },
      });
      expect(node(`environment:${ENV_2}`)?.label).toBe(ENV_2);
      expect(node(`environment:${ENV_3}`)?.attrs).toEqual(
        expect.objectContaining({ status: 'failed', fileCount: 0, builtAt: null }),
      );
      expect(node(`environment:${ENV_3}`)?.attrs).not.toHaveProperty('mountId');
      expect(hasEdge(`workspace:${CLIENT_A}`, `environment:${ENV_3}`, 'contains')).toBe(true);
    });

    it('keeps the largest modules per environment only', () => {
      const modules = graph.nodes.filter((entry) => entry.type === 'module');

      expect(modules).toHaveLength(WORKSPACE_GRAPH_LIMITS.maxModulesPerEnvironment);
      expect(node(`module:${ENV_1}:m19`)).toBeDefined();
      expect(node(`module:${ENV_1}:m0`)).toBeUndefined();
      expect(hasEdge(`environment:${ENV_1}`, `module:${ENV_1}:m19`, 'contains')).toBe(true);
    });

    it('shares language nodes between environments', () => {
      expect(graph.nodes.filter((entry) => entry.id === 'language:typescript')).toHaveLength(1);
      expect(
        graph.edges.find((edge) => edge.from === `environment:${ENV_1}` && edge.to === 'language:typescript'),
      ).toEqual(expect.objectContaining({ type: 'written_in', attrs: { files: 10 } }));
      expect(hasEdge(`environment:${ENV_2}`, 'language:go', 'written_in')).toBe(true);
    });

    it('builds knowledge and ticket hierarchies without bodies', () => {
      expect(node('knowledge:k-folder')?.type).toBe('knowledge-folder');
      expect(node('knowledge:k-page')).toEqual({
        id: 'knowledge:k-page',
        type: 'knowledge',
        label: 'Page',
        attrs: { sha: 'sha-p' },
      });
      expect(hasEdge(`workspace:${CLIENT_A}`, 'knowledge:k-folder', 'contains')).toBe(true);
      expect(hasEdge('knowledge:k-folder', 'knowledge:k-page', 'contains')).toBe(true);
      expect(node('ticket:t-child')?.attrs).toEqual({ sha: 'sha-t2', status: 'done', priority: 'low' });
      expect(hasEdge('ticket:t-parent', 'ticket:t-child', 'contains')).toBe(true);
      expect(hasEdge(`workspace:${CLIENT_A}`, 'ticket:t-orphan', 'contains')).toBe(true);
      expect(JSON.stringify(graph)).not.toContain('content');
    });

    it('links plans to member environments only', () => {
      expect(node('plan:p-1')).toEqual(
        expect.objectContaining({
          type: 'plan',
          label: 'Refactor login',
          attrs: expect.objectContaining({ agentId: ENV_1 }),
        }),
      );
      expect(hasEdge(`environment:${ENV_1}`, 'plan:p-1', 'contains')).toBe(true);
      expect(node('plan:p-foreign')).toBeUndefined();
    });

    it('maps knowledge relations to relates_to edges', () => {
      expect(hasEdge('ticket:t-child', 'knowledge:k-page', 'relates_to')).toBe(true);
      expect(hasEdge('knowledge:k-page', 'ticket:t-parent', 'relates_to')).toBe(true);
      expect(graph.edges.filter((edge) => edge.type === 'relates_to')).toHaveLength(2);
    });

    it('adds cross-environment references within the workspace', () => {
      expect(hasEdge(`environment:${ENV_1}`, `environment:${ENV_2}`, 'references')).toBe(true);
      expect(hasEdge(`environment:${ENV_2}`, `environment:${ENV_1}`, 'references')).toBe(false);
    });
  });

  it('caps tickets, knowledge nodes and plans', () => {
    const graph = buildWorkspaceSnapshotGraph({
      clientId: CLIENT_A,
      environments: [{ agentId: ENV_1, managerKey, digest: digest() }],
      knowledge: Array.from({ length: WORKSPACE_GRAPH_LIMITS.maxKnowledgeNodes + 5 }, (_, index) => ({
        id: `k${index}`,
        nodeType: 'page',
        title: `Page ${index}`,
      })),
      tickets: Array.from({ length: WORKSPACE_GRAPH_LIMITS.maxTickets + 5 }, (_, index) => ({
        id: `t${index}`,
        title: `Ticket ${index}`,
        status: 'todo',
        priority: 'low',
      })),
      plans: Array.from({ length: WORKSPACE_GRAPH_LIMITS.maxPlans + 5 }, (_, index) => ({
        id: `p${index}`,
        agentId: ENV_1,
        status: 'ready',
      })),
      relations: [],
    });
    const count = (type: string) => graph.nodes.filter((entry) => entry.type === type).length;

    expect(count('knowledge')).toBe(WORKSPACE_GRAPH_LIMITS.maxKnowledgeNodes);
    expect(count('ticket')).toBe(WORKSPACE_GRAPH_LIMITS.maxTickets);
    expect(count('plan')).toBe(WORKSPACE_GRAPH_LIMITS.maxPlans);
  });

  describe('cross-environment references', () => {
    const env = (id: string, key: string, mountId?: string, referencedMountIds: string[] = []) => ({
      id: `environment:${id}`,
      type: 'environment' as const,
      label: id,
      attrs: { managerKey: key, referencedMountIds, ...(mountId ? { mountId } : {}) },
    });

    it('requires the same manager key', () => {
      const edges = buildCrossEnvironmentReferenceEdges([
        env(ENV_1, 'k1', 'm1', ['m2', 'm3']),
        env(ENV_2, 'k1', 'm2'),
        env(ENV_3, 'k2', 'm3'),
      ]);

      expect(edges).toEqual([
        {
          from: `environment:${ENV_1}`,
          to: `environment:${ENV_2}`,
          type: 'references',
          confidence: 'inferred',
          attrs: { mountId: 'm2' },
        },
      ]);
    });

    it('skips self references and existing edges', () => {
      const nodes = [env(ENV_1, 'k1', 'm1', ['m1', 'm2']), env(ENV_2, 'k1', 'm2')];
      const existing = buildCrossEnvironmentReferenceEdges(nodes);

      expect(existing).toHaveLength(1);
      expect(buildCrossEnvironmentReferenceEdges(nodes, existing)).toEqual([]);
    });

    it('connects environments across workspaces in the union', () => {
      const docA = buildWorkspaceSnapshotGraph({
        clientId: CLIENT_A,
        environments: [{ agentId: ENV_1, managerKey: 'k', digest: digest({ referencedMountIds: ['m2'] }) }],
        knowledge: [],
        tickets: [],
        plans: [],
        relations: [],
      });
      const docB = buildWorkspaceSnapshotGraph({
        clientId: CLIENT_B,
        environments: [{ agentId: ENV_2, managerKey: 'k', digest: digest({ environmentId: ENV_2, mountId: 'm2' }) }],
        knowledge: [],
        tickets: [],
        plans: [],
        relations: [],
      });

      expect(docA.edges.some((edge) => edge.type === 'references')).toBe(false);

      const union = unionWorkspaceGraphs([docA, docB]);

      expect(union.nodes.filter((entry) => entry.id === 'language:typescript')).toHaveLength(1);
      expect(
        union.edges.some(
          (edge) =>
            edge.from === `environment:${ENV_1}` && edge.to === `environment:${ENV_2}` && edge.type === 'references',
        ),
      ).toBe(true);
    });
  });

  describe('PAT scope filtering', () => {
    const doc: AgentGraphDocument = {
      version: 1,
      scope: 'global',
      layer: 'global',
      generatedAt: '2026-01-01T00:00:00.000Z',
      nodes: [
        { id: 'workspace:a', type: 'workspace', label: 'A' },
        { id: 'environment:e', type: 'environment', label: 'E' },
        { id: 'ticket:t', type: 'ticket', label: 'T' },
        { id: 'knowledge:k', type: 'knowledge', label: 'K' },
        { id: 'knowledge:f', type: 'knowledge-folder', label: 'F' },
        { id: 'plan:p', type: 'plan', label: 'P' },
        { id: 'module:e:m', type: 'module', label: 'M' },
        { id: 'language:ts', type: 'language', label: 'TS' },
      ],
      edges: [
        { from: 'workspace:a', to: 'environment:e', type: 'contains' },
        { from: 'workspace:a', to: 'ticket:t', type: 'contains' },
        { from: 'ticket:t', to: 'knowledge:k', type: 'relates_to' },
        { from: 'environment:e', to: 'plan:p', type: 'contains' },
        { from: 'environment:e', to: 'module:e:m', type: 'contains' },
        { from: 'environment:e', to: 'language:ts', type: 'written_in' },
      ],
      truncated: false,
      totalNodes: 8,
      totalEdges: 6,
    };

    it('returns the document unchanged when every scope is granted', () => {
      expect(filterGraphByScopes(doc, () => true)).toBe(doc);
    });

    it('drops nodes of missing scopes and their edges', () => {
      const filtered = filterGraphByScopes(doc, (scope) => scope === 'tickets:read');

      expect(filtered.nodes.map((entry) => entry.id)).toEqual(['workspace:a', 'environment:e', 'ticket:t']);
      expect(filtered.edges).toEqual([
        { from: 'workspace:a', to: 'environment:e', type: 'contains' },
        { from: 'workspace:a', to: 'ticket:t', type: 'contains' },
      ]);
      expect(filtered.totalNodes).toBe(3);
      expect(filtered.totalEdges).toBe(2);
    });

    it('maps node types to the mirrored scopes', () => {
      const keep = (scopes: string[]) =>
        filterGraphByScopes(doc, (scope) => scopes.includes(scope)).nodes.map((entry) => entry.type);

      expect(keep(['knowledge:read'])).toEqual(['workspace', 'environment', 'knowledge', 'knowledge-folder']);
      expect(keep(['agent_chats:read'])).toEqual(['workspace', 'environment', 'plan']);
      expect(keep(['agent_files:read'])).toEqual(['workspace', 'environment', 'module', 'language']);
    });

    it('only restricts PAT sessions', () => {
      expect(createGraphScopeCheck({ isApiKeyAuth: true })('tickets:read')).toBe(true);
      expect(
        createGraphScopeCheck({ isApiKeyAuth: false, userId: 'u', userRole: UserRole.USER, amr: ['pwd'] })(
          'tickets:read',
        ),
      ).toBe(true);

      const pat = createGraphScopeCheck({
        isApiKeyAuth: false,
        userId: 'u',
        userRole: UserRole.USER,
        amr: ['pat'],
        scopes: ['graph:read', 'tickets:write'],
      });

      expect(pat('tickets:read')).toBe(true);
      expect(pat('knowledge:read')).toBe(false);
    });
  });

  describe('limitGraphByDegree', () => {
    it('keeps workspaces and environments first, then the highest degree nodes', () => {
      const nodes = [
        { id: 'ticket:low', type: 'ticket' as const, label: 'low' },
        { id: 'ticket:hub', type: 'ticket' as const, label: 'hub' },
        { id: 'environment:e', type: 'environment' as const, label: 'e' },
        { id: 'ticket:leaf', type: 'ticket' as const, label: 'leaf' },
      ];
      const edges = [
        { from: 'ticket:hub', to: 'ticket:leaf', type: 'contains' as const },
        { from: 'ticket:hub', to: 'ticket:low', type: 'relates_to' as const },
        { from: 'ticket:hub', to: 'environment:e', type: 'relates_to' as const },
      ];
      const limited = limitGraphByDegree(nodes, edges, 2);

      expect(limited.truncated).toBe(true);
      expect(limited.nodes.map((entry) => entry.id)).toEqual(['ticket:hub', 'environment:e']);
      expect(limited.edges).toEqual([{ from: 'ticket:hub', to: 'environment:e', type: 'relates_to' }]);
      expect(limitGraphByDegree(nodes, edges, 10).truncated).toBe(false);
    });
  });

  it('attaches the workspace node to composed graphs and drops foreign environments', () => {
    const composed = attachWorkspaceToComposedGraph(
      {
        version: 1,
        scope: 'workspace',
        layer: 'code',
        generatedAt: '2026-01-01T00:00:00.000Z',
        nodes: [
          { id: `environment:${ENV_1}`, type: 'environment', label: 'one' },
          { id: `environment:${ENV_2}`, type: 'environment', label: 'foreign' },
          { id: `${ENV_1}::file:a.ts`, type: 'file', label: 'a.ts' },
          { id: `${ENV_2}::file:b.ts`, type: 'file', label: 'b.ts' },
        ],
        edges: [
          { from: `environment:${ENV_1}`, to: `${ENV_1}::file:a.ts`, type: 'contains' },
          { from: `environment:${ENV_2}`, to: `${ENV_2}::file:b.ts`, type: 'contains' },
        ],
        truncated: false,
        totalNodes: 4,
        totalEdges: 2,
      },
      CLIENT_A,
      [ENV_1],
      'Workspace A',
    );

    expect(composed.clientId).toBe(CLIENT_A);
    expect(composed.nodes.map((entry) => entry.id)).toEqual([
      `workspace:${CLIENT_A}`,
      `environment:${ENV_1}`,
      `${ENV_1}::file:a.ts`,
    ]);
    expect(composed.edges).toContainEqual({
      from: `workspace:${CLIENT_A}`,
      to: `environment:${ENV_1}`,
      type: 'contains',
      confidence: 'extracted',
    });
    expect(composed.edges).toHaveLength(2);
  });

  it('maps with bounded concurrency and keeps failures', async () => {
    let active = 0;
    let peak = 0;
    const results = await mapSettledWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (value) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;

      if (value === 3) {
        throw new Error('boom');
      }

      return value * 2;
    });

    expect(peak).toBeLessThanOrEqual(2);
    expect(results[0]).toEqual({ status: 'fulfilled', value: 2 });
    expect(results[2].status).toBe('rejected');
    expect(results[5]).toEqual({ status: 'fulfilled', value: 12 });
  });
});

describe('WorkspaceGraphSnapshotService', () => {
  let service: WorkspaceGraphSnapshotService;
  let changes: WorkspaceGraphChangeNotifierService;
  const snapshots = {
    findByClientId: jest.fn(),
    findByClientIds: jest.fn(),
    findStatusesByClientIds: jest.fn(),
    upsert: jest.fn(),
  };
  const clientsRepository = { findById: jest.fn(), findAllIds: jest.fn() };
  const graphProxy = { getDigest: jest.fn() };
  const agentProxy = { getClientAgents: jest.fn() };
  const credentialsRepo = { find: jest.fn() };
  const knowledgeRepo = { find: jest.fn() };
  const relationsRepo = { find: jest.fn() };
  const ticketsRepo = { find: jest.fn() };
  const plansRepo = { find: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkspaceGraphSnapshotService,
        WorkspaceGraphChangeNotifierService,
        { provide: WorkspaceGraphSnapshotsRepository, useValue: snapshots },
        { provide: ClientsRepository, useValue: clientsRepository },
        { provide: ClientAgentGraphProxyService, useValue: graphProxy },
        { provide: ClientAgentProxyService, useValue: agentProxy },
        { provide: getRepositoryToken(ClientAgentCredentialEntity), useValue: credentialsRepo },
        { provide: getRepositoryToken(KnowledgeNodeEntity), useValue: knowledgeRepo },
        { provide: getRepositoryToken(KnowledgeRelationEntity), useValue: relationsRepo },
        { provide: getRepositoryToken(TicketEntity), useValue: ticketsRepo },
        { provide: getRepositoryToken(ChatPlanEntity), useValue: plansRepo },
      ],
    }).compile();

    service = module.get(WorkspaceGraphSnapshotService);
    changes = module.get(WorkspaceGraphChangeNotifierService);
    service.onModuleInit();

    clientsRepository.findById.mockResolvedValue({
      id: CLIENT_A,
      name: 'Workspace A',
      endpoint: 'https://m.example.com',
    });
    credentialsRepo.find.mockResolvedValue([{ agentId: ENV_1.toUpperCase() }, { agentId: ENV_2 }]);
    agentProxy.getClientAgents.mockResolvedValue([{ id: ENV_1, name: 'Frontend' }]);
    graphProxy.getDigest.mockImplementation(async (_clientId: string, agentId: string) => {
      if (agentId === ENV_2) {
        throw new NotFoundException('unknown');
      }

      return digest();
    });
    knowledgeRepo.find.mockResolvedValue([{ id: 'k', nodeType: 'page', parentId: null, title: 'Page', longSha: 's' }]);
    ticketsRepo.find.mockResolvedValue([
      { id: 't', parentId: null, title: 'Ticket', longSha: 'ts', status: 'todo', priority: 'low' },
    ]);
    plansRepo.find.mockResolvedValue([]);
    relationsRepo.find.mockResolvedValue([]);
    snapshots.upsert.mockImplementation(async (clientId: string, fields: Record<string, unknown>) => ({
      clientId,
      status: 'missing',
      nodeCount: 0,
      edgeCount: 0,
      builtAt: null,
      error: null,
      ...fields,
    }));
  });

  it('lists member agent ids from the stored credentials', async () => {
    await expect(service.listMemberAgentIds(CLIENT_A)).resolves.toEqual([ENV_1, ENV_2]);
    expect(credentialsRepo.find).toHaveBeenCalledWith(expect.objectContaining({ where: { clientId: CLIENT_A } }));
  });

  it('builds and persists a snapshot, tolerating failed digests', async () => {
    const result = await service.build(CLIENT_A);

    expect(snapshots.upsert).toHaveBeenNthCalledWith(1, CLIENT_A, { status: 'building' });

    const saved = snapshots.upsert.mock.calls[1][1] as { graph: AgentGraphDocument; status: string };

    expect(saved.status).toBe('ready');
    expect(saved.graph.nodes.find((entry) => entry.id === `environment:${ENV_1}`)?.label).toBe('Frontend');
    expect(saved.graph.nodes.find((entry) => entry.id === `environment:${ENV_2}`)?.attrs?.['status']).toBe('missing');
    expect(saved.graph.nodes.some((entry) => entry.id === 'ticket:t')).toBe(true);
    expect(result).toEqual(expect.objectContaining({ clientId: CLIENT_A, status: 'ready', error: null }));
    expect(ticketsRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({ select: ['id', 'parentId', 'title', 'longSha', 'status', 'priority'] }),
    );
  });

  it('runs a single build per workspace at a time', async () => {
    const [first, second] = await Promise.all([service.build(CLIENT_A), service.build(CLIENT_A)]);

    expect(first).toEqual(second);
    expect(clientsRepository.findById).toHaveBeenCalledTimes(1);
  });

  it('keeps the previous graph when a build fails', async () => {
    knowledgeRepo.find.mockRejectedValue(new Error('db down'));

    const result = await service.build(CLIENT_A);

    expect(snapshots.upsert).toHaveBeenLastCalledWith(CLIENT_A, { status: 'failed', error: 'db down' });
    expect(result.status).toBe('failed');
  });

  it('builds on first access and serves stale snapshots while refreshing in the background', async () => {
    const graph = { nodes: [], edges: [] } as unknown as AgentGraphDocument;

    snapshots.findByClientId.mockResolvedValueOnce(null).mockResolvedValueOnce({ clientId: CLIENT_A, graph });
    await expect(service.getOrBuild(CLIENT_A)).resolves.toBe(graph);
    expect(clientsRepository.findById).toHaveBeenCalledTimes(1);

    const stale = {
      clientId: CLIENT_A,
      status: 'ready',
      graph,
      builtAt: new Date(Date.now() - WORKSPACE_GRAPH_LIMITS.staleAfterMs - 1000),
      updatedAt: new Date(Date.now() - WORKSPACE_GRAPH_LIMITS.staleAfterMs - 1000),
    };

    snapshots.findByClientId.mockResolvedValue(stale);
    await expect(service.getOrBuild(CLIENT_A)).resolves.toBe(graph);
    await new Promise((resolve) => setImmediate(resolve));
    expect(clientsRepository.findById).toHaveBeenCalledTimes(2);
  });

  it('serves fresh snapshots without rebuilding', async () => {
    const graph = { nodes: [], edges: [] } as unknown as AgentGraphDocument;

    snapshots.findByClientId.mockResolvedValue({
      clientId: CLIENT_A,
      status: 'ready',
      graph,
      builtAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(service.getOrBuild(CLIENT_A)).resolves.toBe(graph);
    expect(clientsRepository.findById).not.toHaveBeenCalled();
  });

  it('unions accessible snapshots, filters by scopes and limits by degree', async () => {
    const fresh = { status: 'ready', builtAt: new Date(), updatedAt: new Date() };
    const docA = buildWorkspaceSnapshotGraph({
      clientId: CLIENT_A,
      environments: [{ agentId: ENV_1, managerKey: 'k', digest: digest({ referencedMountIds: ['m2'] }) }],
      knowledge: [],
      tickets: [{ id: 't', title: 'Ticket', status: 'todo', priority: 'low' }],
      plans: [],
      relations: [],
    });
    const docB = buildWorkspaceSnapshotGraph({
      clientId: CLIENT_B,
      environments: [{ agentId: ENV_2, managerKey: 'k', digest: digest({ environmentId: ENV_2, mountId: 'm2' }) }],
      knowledge: [],
      tickets: [],
      plans: [],
      relations: [],
    });

    snapshots.findByClientIds.mockResolvedValue([
      { clientId: CLIENT_A, graph: docA, ...fresh },
      { clientId: CLIENT_B, graph: docB, ...fresh },
    ]);

    const result = await service.getGlobalDocument([CLIENT_A, CLIENT_B], {
      isAllowed: (scope) => scope !== 'tickets:read',
    });

    expect(snapshots.findByClientIds).toHaveBeenCalledWith([CLIENT_A, CLIENT_B]);
    expect(result.scope).toBe('global');
    expect(result.nodes.some((entry) => entry.type === 'ticket')).toBe(false);
    expect(
      result.edges.some((edge) => edge.from === `environment:${ENV_1}` && edge.to === `environment:${ENV_2}`),
    ).toBe(true);
    expect(clientsRepository.findById).not.toHaveBeenCalled();

    const limited = await service.getGlobalDocument([CLIENT_A, CLIENT_B], { limit: '2', isAllowed: () => true });

    expect(limited.nodes).toHaveLength(2);
    expect(limited.truncated).toBe(true);
    expect(limited.totalNodes).toBeGreaterThan(2);
  });

  it('reports missing snapshots in statuses', async () => {
    snapshots.findStatusesByClientIds.mockResolvedValue([
      {
        clientId: CLIENT_A,
        status: 'ready',
        builtAt: new Date('2026-01-01T00:00:00.000Z'),
        nodeCount: 3,
        edgeCount: 2,
      },
    ]);

    await expect(service.getStatuses([CLIENT_A, CLIENT_B])).resolves.toEqual([
      { clientId: CLIENT_A, status: 'ready', builtAt: '2026-01-01T00:00:00.000Z', error: null, nodes: 3, edges: 2 },
      { clientId: CLIENT_B, status: 'missing', builtAt: null, error: null, nodes: 0, edges: 0 },
    ]);
  });

  it('rebuilds every workspace snapshot', async () => {
    clientsRepository.findAllIds.mockResolvedValue([CLIENT_A]);

    await expect(service.rebuildAll()).resolves.toEqual({ built: 1, failed: 0 });
    expect(snapshots.upsert).toHaveBeenCalledWith(CLIENT_A, expect.objectContaining({ status: 'ready' }));
  });

  it('schedules the startup rebuild only in API processes and when enabled', async () => {
    const env = { ...process.env };

    jest.useFakeTimers();

    try {
      const rebuild = jest.spyOn(service, 'rebuildAll').mockResolvedValue({ built: 0, failed: 0 });

      process.env['QUEUE_ROLE'] = 'worker';
      service.onApplicationBootstrap();
      process.env['QUEUE_ROLE'] = 'api';
      process.env[WORKSPACE_GRAPH_STARTUP_REBUILD_ENV] = 'false';
      service.onApplicationBootstrap();
      await jest.advanceTimersByTimeAsync(10 * 60_000);
      expect(rebuild).not.toHaveBeenCalled();

      delete process.env[WORKSPACE_GRAPH_STARTUP_REBUILD_ENV];
      process.env[WORKSPACE_GRAPH_STARTUP_DELAY_MS_ENV] = '1000';
      service.onApplicationBootstrap();
      await jest.advanceTimersByTimeAsync(1000);
      expect(rebuild).toHaveBeenCalledTimes(1);
    } finally {
      service.onModuleDestroy();
      jest.useRealTimers();
      process.env = env;
    }
  });

  it('skips manual refreshes of a snapshot that was just built', async () => {
    const build = jest.spyOn(service, 'build').mockResolvedValue({ status: 'ready' } as never);

    snapshots.findStatusesByClientIds.mockResolvedValue([
      { clientId: CLIENT_A, status: 'ready', nodeCount: 1, edgeCount: 0, builtAt: new Date(), error: null },
    ]);
    await expect(service.refresh(CLIENT_A)).resolves.toEqual(expect.objectContaining({ status: 'ready' }));
    expect(build).not.toHaveBeenCalled();

    snapshots.findStatusesByClientIds.mockResolvedValue([
      {
        clientId: CLIENT_A,
        status: 'ready',
        nodeCount: 1,
        edgeCount: 0,
        builtAt: new Date(Date.now() - WORKSPACE_GRAPH_MANUAL_REFRESH_COOLDOWN_MS - 1000),
        error: null,
      },
    ]);
    await service.refresh(CLIENT_A);
    expect(build).toHaveBeenCalledWith(CLIENT_A);
  });

  describe('change-driven rebuilds', () => {
    const flush = () => jest.advanceTimersByTimeAsync(0);

    beforeEach(() => jest.useFakeTimers());

    afterEach(() => {
      service.onModuleDestroy();
      jest.useRealTimers();
    });

    it('rebuilds a built workspace once after a burst of change signals', async () => {
      snapshots.findStatusesByClientIds.mockResolvedValue([
        { clientId: CLIENT_A, status: 'ready', builtAt: new Date(Date.now() - 10 * 60_000) },
      ]);
      const build = jest.spyOn(service, 'build').mockResolvedValue({} as never);

      changes.notify(CLIENT_A, 'ticketUpsert');
      await flush();
      await jest.advanceTimersByTimeAsync(WORKSPACE_GRAPH_DIRTY_DEBOUNCE_MS - 1000);
      changes.notify(CLIENT_A, 'knowledgeTreeChanged');
      await flush();
      await jest.advanceTimersByTimeAsync(WORKSPACE_GRAPH_DIRTY_DEBOUNCE_MS - 1);
      expect(build).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(1);
      expect(build).toHaveBeenCalledTimes(1);
      expect(build).toHaveBeenCalledWith(CLIENT_A);
    });

    it('keeps the minimum interval after the last build', async () => {
      snapshots.findStatusesByClientIds.mockResolvedValue([
        { clientId: CLIENT_A, status: 'ready', builtAt: new Date(Date.now() - 5_000) },
      ]);
      const build = jest.spyOn(service, 'build').mockResolvedValue({} as never);

      changes.notify(CLIENT_A, 'chatPlanUpsert');
      await flush();
      await jest.advanceTimersByTimeAsync(WORKSPACE_GRAPH_MIN_REBUILD_INTERVAL_MS - 5_000 - 1);
      expect(build).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(1);
      expect(build).toHaveBeenCalledTimes(1);
    });

    it('does not let continuous writes postpone the rebuild forever', async () => {
      snapshots.findStatusesByClientIds.mockResolvedValue([
        { clientId: CLIENT_A, status: 'ready', builtAt: new Date(Date.now() - 10 * 60_000) },
      ]);
      const build = jest.spyOn(service, 'build').mockResolvedValue({} as never);

      for (let elapsed = 0; elapsed < WORKSPACE_GRAPH_DIRTY_MAX_WAIT_MS; elapsed += 5_000) {
        changes.notify(CLIENT_A, 'ticketUpsert');
        await flush();
        await jest.advanceTimersByTimeAsync(5_000);
      }

      expect(build).toHaveBeenCalledTimes(1);
    });

    it('ignores workspaces without a snapshot and missing workspace ids', async () => {
      snapshots.findStatusesByClientIds.mockResolvedValue([]);
      const build = jest.spyOn(service, 'build').mockResolvedValue({} as never);

      changes.notify(CLIENT_B, 'ticketUpsert');
      changes.notify(undefined, 'ticketUpsert');
      await flush();
      await jest.advanceTimersByTimeAsync(10 * 60_000);
      expect(build).not.toHaveBeenCalled();
      expect(snapshots.findStatusesByClientIds).toHaveBeenCalledTimes(1);
    });

    it('stops listening and cancels pending rebuilds on shutdown', async () => {
      snapshots.findStatusesByClientIds.mockResolvedValue([
        { clientId: CLIENT_A, status: 'ready', builtAt: new Date(Date.now() - 10 * 60_000) },
      ]);
      const build = jest.spyOn(service, 'build').mockResolvedValue({} as never);

      changes.notify(CLIENT_A, 'ticketUpsert');
      await flush();
      service.onModuleDestroy();
      changes.notify(CLIENT_A, 'ticketUpsert');
      await jest.advanceTimersByTimeAsync(10 * 60_000);
      expect(build).not.toHaveBeenCalled();
    });
  });
});
