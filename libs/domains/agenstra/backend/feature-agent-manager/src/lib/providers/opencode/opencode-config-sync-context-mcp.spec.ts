import type { AgentsRepository } from '../../repositories/agents.repository';
import type { AgentContextMcpService } from '../../services/agent-context-mcp.service';
import type { AgentRuntimeRefreshService } from '../../services/agent-runtime-refresh.service';
import type { DockerService } from '../../services/docker.service';

import type { OpenCodeClientFactory } from './opencode-client.factory';
import { OpenCodeConfigSyncService } from './opencode-config-sync.service';

describe('OpenCodeConfigSyncService platform context MCP', () => {
  const agent = { id: 'agent-1', name: 'Agent One', containerId: 'container-1', opencodeUserSecrets: null };
  const wireOptions = { apiUrl: 'http://agent-manager-api:3000/api', agentId: 'agent-1', agentToken: 'tok' };
  let contextMcp: { buildWireOptions: jest.Mock; invalidate: jest.Mock };
  let fetchSpy: jest.SpyInstance;
  let currentMcp: Record<string, unknown>;

  const createService = (withContextMcp = true) =>
    new OpenCodeConfigSyncService(
      { findById: jest.fn().mockResolvedValue(agent), update: jest.fn() } as unknown as AgentsRepository,
      {
        invalidate: jest.fn(),
        waitForHealthy: jest.fn().mockResolvedValue(undefined),
        getClient: jest.fn().mockResolvedValue({}),
        resolveConnection: jest.fn().mockResolvedValue({ baseUrl: 'http://opencode', authorization: 'Basic x' }),
      } as unknown as OpenCodeClientFactory,
      {
        getContainerEnvironmentMap: jest.fn().mockResolvedValue({}),
        updateContainer: jest.fn(),
        sendCommandToContainer: jest.fn().mockResolvedValue(''),
        getContainerHomeDirectory: jest.fn().mockResolvedValue('/home/agenstra'),
        getEnvironmentApplyStrategy: jest.fn().mockResolvedValue('restart'),
      } as unknown as DockerService,
      undefined,
      {
        invalidateConnections: jest.fn(),
        waitForHealthy: jest.fn().mockResolvedValue(true),
        reattachWatchers: jest.fn(),
        restoreGitCredentials: jest.fn(),
      } as unknown as AgentRuntimeRefreshService,
      undefined,
      undefined,
      withContextMcp ? (contextMcp as unknown as AgentContextMcpService) : undefined,
    );

  const patchedBody = (): Record<string, unknown> => {
    const call = fetchSpy.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH');

    return JSON.parse(String((call?.[1] as RequestInit).body)) as Record<string, unknown>;
  };

  beforeEach(() => {
    currentMcp = {};
    contextMcp = { buildWireOptions: jest.fn().mockResolvedValue(wireOptions), invalidate: jest.fn() };
    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
      const method = (init as RequestInit | undefined)?.method ?? 'GET';
      const body = method === 'GET' ? { mcp: currentMcp } : {};

      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => JSON.stringify(body),
        json: async () => body,
      } as unknown as Response;
    });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('registers the platform MCP server after user MCP filtering and refreshes the availability cache', async () => {
    const result = await createService().syncEffective(
      agent.id,
      { mcp: { servers: { agenstra: { type: 'remote', url: 'https://spoofed.example' } } } },
      {},
    );

    expect(result).toEqual({ ok: true });
    expect(contextMcp.buildWireOptions).toHaveBeenCalledWith('agent-1', 'container-1');
    expect((patchedBody()['mcp'] as Record<string, unknown>)['agenstra']).toEqual({
      type: 'local',
      command: ['node', '/opt/agenstra/mcp/agenstra-context-mcp.cjs'],
      environment: {
        AGENSTRA_CONTEXT_API_URL: wireOptions.apiUrl,
        AGENSTRA_CONTEXT_AGENT_ID: 'agent-1',
        AGENSTRA_CONTEXT_AGENT_TOKEN: 'tok',
      },
      enabled: true,
      timeout: expect.any(Number),
    });
    expect(contextMcp.invalidate).toHaveBeenCalledWith('agent-1');
  });

  it('disables a previously registered platform server when the worker no longer supports it', async () => {
    contextMcp.buildWireOptions.mockResolvedValue(null);
    currentMcp = { agenstra: { type: 'local', enabled: true } };

    await createService().syncEffective(agent.id, {}, {});

    expect((patchedBody()['mcp'] as Record<string, unknown>)['agenstra']).toEqual({ enabled: false });
  });

  it('keeps the previous wire config when the context MCP service is not wired', async () => {
    await createService(false).syncEffective(agent.id, {}, {});

    expect(patchedBody()['mcp']).toBeUndefined();
  });

  it('hides the platform server from the user-facing MCP status list', async () => {
    fetchSpy.mockImplementation(async () => {
      const body = { agenstra: { status: 'connected' }, github: { status: 'needs_auth' } };

      return { ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body } as Response;
    });

    await expect(createService().listMcpStatuses(agent.id)).resolves.toEqual({
      servers: [{ name: 'github', status: 'needs_auth' }],
    });
  });
});
