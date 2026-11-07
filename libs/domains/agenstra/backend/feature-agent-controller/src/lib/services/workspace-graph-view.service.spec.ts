import type { AgentGraphDocument } from '@forepath/agenstra/shared/util-opencode-config';

import { WorkspaceGraphViewService } from './workspace-graph-view.service';

const CLIENT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CLIENT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ENV_1 = '11111111-1111-4111-8111-111111111111';
const ENV_2 = '22222222-2222-4222-8222-222222222222';

function document(nodes: AgentGraphDocument['nodes'], edges: AgentGraphDocument['edges'] = []): AgentGraphDocument {
  return {
    version: 1,
    scope: 'workspace',
    layer: 'code',
    generatedAt: '2026-01-01T00:00:00.000Z',
    nodes,
    edges,
    truncated: false,
    totalNodes: nodes.length,
    totalEdges: edges.length,
  };
}

describe('WorkspaceGraphViewService', () => {
  const allowAll = () => true;
  let snapshots: {
    listMemberAgentIds: jest.Mock;
    resolveEnvironmentNames: jest.Mock;
    getOrBuild: jest.Mock;
  };
  let graphProxy: { compose: jest.Mock };
  let clientsRepository: { findById: jest.Mock };
  let service: WorkspaceGraphViewService;

  beforeEach(() => {
    snapshots = {
      listMemberAgentIds: jest.fn(async (clientId: string) => (clientId === CLIENT_A ? [ENV_1] : [ENV_2])),
      resolveEnvironmentNames: jest.fn(async () => ({ [ENV_1]: 'Frontend', [ENV_2]: 'Backend' })),
      getOrBuild: jest.fn(async (clientId: string) =>
        document([
          { id: `workspace:${clientId}`, type: 'workspace', label: clientId },
          { id: `environment:${clientId === CLIENT_A ? ENV_1 : ENV_2}`, type: 'environment', label: 'env' },
          { id: `ticket:${clientId}`, type: 'ticket', label: 'Ticket' },
          { id: `module:${ENV_1}:module:.`, type: 'module', label: 'summary module' },
        ]),
      ),
    };
    graphProxy = {
      compose: jest.fn(async (_clientId: string, request: { environmentIds: string[] }) =>
        document(
          [
            { id: `environment:${request.environmentIds[0]}`, type: 'environment', label: 'Env' },
            { id: `${request.environmentIds[0]}::file:a.ts`, type: 'file', label: 'a.ts' },
          ],
          [
            {
              from: `environment:${request.environmentIds[0]}`,
              to: `${request.environmentIds[0]}::file:a.ts`,
              type: 'contains',
            },
          ],
        ),
      ),
    };
    clientsRepository = { findById: jest.fn(async (id: string) => ({ id, name: `WS ${id.slice(0, 4)}` })) };
    service = new WorkspaceGraphViewService(snapshots as never, graphProxy as never, clientsRepository as never);
  });

  const page = (overrides: Partial<Parameters<WorkspaceGraphViewService['page']>[0]> = {}) =>
    service.page({
      scope: 'workspace',
      clientIds: [CLIENT_A],
      layer: 'code',
      offset: 0,
      limit: 100,
      isAllowed: allowAll,
      ...overrides,
    });

  it('composes code layers from the controller-resolved members, without the knowledge snapshot', async () => {
    const result = await page();

    // Workspace views are rooted at the workspace (no global root).
    expect(result.nodes.some((node) => node.type === 'instance')).toBe(false);

    expect(graphProxy.compose).toHaveBeenCalledWith(CLIENT_A, {
      environmentIds: [ENV_1],
      layer: 'code',
      names: { [ENV_1]: 'Frontend' },
    });
    expect(snapshots.getOrBuild).not.toHaveBeenCalled();
    expect(result.nodes.map((node) => node.type).sort()).toEqual(['environment', 'file', 'workspace']);
    expect(result.edges).toContainEqual(expect.objectContaining({ from: `workspace:${CLIENT_A}`, type: 'contains' }));
    expect(result).toEqual(
      expect.objectContaining({ scope: 'workspace', layer: 'code', clientId: CLIENT_A, nextOffset: null }),
    );
  });

  it('serves the knowledge snapshot alone for the knowledge layer', async () => {
    const result = await page({ layer: 'knowledge' });

    expect(graphProxy.compose).not.toHaveBeenCalled();
    expect(result.nodes.map((node) => node.type)).toContain('ticket');
  });

  it('merges composition and knowledge for `all`, dropping the summary modules', async () => {
    const result = await page({ layer: 'all' });
    const types = result.nodes.map((node) => node.type);

    expect(graphProxy.compose).toHaveBeenCalledWith(CLIENT_A, expect.objectContaining({ layer: 'all' }));
    expect(types).toEqual(expect.arrayContaining(['workspace', 'environment', 'file', 'ticket']));
    expect(types).not.toContain('module');
    // The environment node exists once (composition and snapshot share the id).
    expect(result.nodes.filter((node) => node.type === 'environment')).toHaveLength(1);
  });

  it('filters snapshot nodes by the caller scopes', async () => {
    const result = await page({ layer: 'knowledge', isAllowed: (scope) => scope !== 'tickets:read' });

    expect(result.nodes.map((node) => node.type)).not.toContain('ticket');
  });

  it('falls back to workspace and environments when the agent-manager is unreachable', async () => {
    graphProxy.compose.mockRejectedValue(new Error('ECONNREFUSED'));

    const code = await page();

    expect(code.nodes.map((node) => node.type).sort()).toEqual(['environment', 'workspace']);
  });

  it('unions the accessible workspaces for the global scope and pages the result', async () => {
    const first = await page({ scope: 'global', clientIds: [CLIENT_A, CLIENT_B], limit: 3 });

    expect(graphProxy.compose).toHaveBeenCalledTimes(2);
    expect(first.scope).toBe('global');
    expect(first.clientId).toBeUndefined();
    // 2 workspaces, 2 environments, 2 files + the global root.
    expect(first.totalNodes).toBe(7);
    expect(first.nodes).toHaveLength(3);
    expect(first.nextOffset).toBe(3);
    // The root comes first, then the other anchors (workspaces, environments).
    expect(first.nodes[0]).toEqual(expect.objectContaining({ id: 'instance', type: 'instance' }));
    expect(first.nodes.every((node) => ['instance', 'workspace', 'environment'].includes(node.type))).toBe(true);

    const second = await page({ scope: 'global', clientIds: [CLIENT_A, CLIENT_B], limit: 3, offset: 3 });

    // Later pages reuse the view their first page built.
    expect(graphProxy.compose).toHaveBeenCalledTimes(2);
    expect(second.nodes).toHaveLength(3);
    expect(second.nextOffset).toBe(6);

    const third = await page({ scope: 'global', clientIds: [CLIENT_A, CLIENT_B], limit: 3, offset: 6 });

    expect(third.nextOffset).toBeNull();

    const all = [...first.nodes, ...second.nodes, ...third.nodes];
    const ids = new Set(all.map((node) => node.id));
    const edges = [...first.edges, ...second.edges, ...third.edges];

    expect(ids.size).toBe(7);
    expect(edges.every((edge) => ids.has(edge.from) && ids.has(edge.to))).toBe(true);
    // 2 × (workspace → environment, environment → file) + 2 × (root → workspace).
    expect(edges).toHaveLength(6);
    expect(
      edges
        .filter((edge) => edge.from === 'instance')
        .map((edge) => edge.to)
        .sort(),
    ).toEqual([`workspace:${CLIENT_A}`, `workspace:${CLIENT_B}`].sort());
  });
});
