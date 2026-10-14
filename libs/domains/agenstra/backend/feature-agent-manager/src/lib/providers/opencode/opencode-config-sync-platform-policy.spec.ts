import type { AgentsRepository } from '../../repositories/agents.repository';
import type { AgentEgressService } from '../../services/agent-egress.service';
import type { AgentMessageFiltersService } from '../../services/agent-message-filters.service';
import type { AgentRuntimeRefreshService } from '../../services/agent-runtime-refresh.service';
import type { DockerService } from '../../services/docker.service';

import type { OpenCodeClientFactory } from './opencode-client.factory';
import { OpenCodeConfigSyncService } from './opencode-config-sync.service';

describe('OpenCodeConfigSyncService platform security policy', () => {
  const agent = {
    id: 'agent-1',
    name: 'Agent One',
    containerId: 'container-1',
    opencodeUserSecrets: null,
    egressGuardContainerId: null as string | null,
  };
  let agentsRepository: { findById: jest.Mock; update: jest.Mock };
  let dockerService: Record<string, jest.Mock>;
  let egress: { applyPolicyForAgent: jest.Mock; describe: jest.Mock };
  let messageFilters: { store: jest.Mock };
  let service: OpenCodeConfigSyncService;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    agent.egressGuardContainerId = null;
    agentsRepository = {
      findById: jest.fn().mockResolvedValue(agent),
      update: jest.fn().mockResolvedValue(agent),
    };
    dockerService = {
      getContainerEnvironmentMap: jest.fn().mockResolvedValue({}),
      updateContainer: jest.fn().mockResolvedValue('container-2'),
      sendCommandToContainer: jest.fn().mockResolvedValue(''),
      getContainerHomeDirectory: jest.fn().mockResolvedValue('/home/agenstra'),
      getEnvironmentApplyStrategy: jest.fn().mockResolvedValue('restart'),
    };
    egress = {
      applyPolicyForAgent: jest.fn().mockResolvedValue({
        ok: true,
        applied: true,
        revision: 'rev-1',
        joinGuardId: 'guard-1',
        proxyEnv: {
          HTTP_PROXY: 'http://127.0.0.1:3128',
          HTTPS_PROXY: 'http://127.0.0.1:3128',
          http_proxy: 'http://127.0.0.1:3128',
          https_proxy: 'http://127.0.0.1:3128',
          NO_PROXY: 'localhost,127.0.0.1,::1',
          no_proxy: 'localhost,127.0.0.1,::1',
        },
      }),
      describe: jest.fn().mockResolvedValue({ status: 'active', mode: 'enforce' }),
    };
    messageFilters = { store: jest.fn().mockResolvedValue([]) };
    service = new OpenCodeConfigSyncService(
      agentsRepository as unknown as AgentsRepository,
      {
        invalidate: jest.fn(),
        waitForHealthy: jest.fn().mockResolvedValue(undefined),
        getClient: jest.fn().mockResolvedValue({}),
        resolveConnection: jest.fn().mockResolvedValue({ baseUrl: 'http://opencode', authorization: 'Basic x' }),
      } as unknown as OpenCodeClientFactory,
      dockerService as unknown as DockerService,
      undefined,
      {
        invalidateConnections: jest.fn(),
        waitForHealthy: jest.fn().mockResolvedValue(true),
        reattachWatchers: jest.fn().mockResolvedValue(undefined),
        restoreGitCredentials: jest.fn().mockResolvedValue(true),
      } as unknown as AgentRuntimeRefreshService,
      egress as unknown as AgentEgressService,
      messageFilters as unknown as AgentMessageFiltersService,
    );
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => '{}',
      json: async () => ({}),
    } as unknown as Response);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('stores message filters, applies the egress policy and joins the guard namespace in one recreate', async () => {
    const result = await service.syncEffective(
      agent.id,
      {},
      { HTTPS_PROXY: 'http://corp-proxy:8080' },
      {
        egress: { mode: 'enforce', allowHosts: [{ value: 'github.com', source: 'global' }] },
        messageFilters: [{ name: 'A', pattern: 'a', action: 'drop', source: 'global' }],
      },
    );

    expect(result).toEqual({ ok: true });
    expect(messageFilters.store).toHaveBeenCalledWith('agent-1', [
      { name: 'A', pattern: 'a', action: 'drop', source: 'global' },
    ]);
    expect(egress.applyPolicyForAgent).toHaveBeenCalledWith(
      'agent-1',
      expect.objectContaining({ mode: 'enforce', allowHosts: [{ value: 'github.com', source: 'global' }] }),
      { HTTPS_PROXY: 'http://corp-proxy:8080' },
    );
    // Agent proxies point at the guard (the corporate proxy is chained by the guard instead).
    expect(dockerService.updateContainer).toHaveBeenCalledWith('container-1', {
      env: expect.objectContaining({
        HTTPS_PROXY: 'http://127.0.0.1:3128',
        https_proxy: 'http://127.0.0.1:3128',
        no_proxy: 'localhost,127.0.0.1,::1',
      }),
      sharedNetworkContainerId: 'guard-1',
      capDrop: ['NET_ADMIN', 'NET_RAW'],
    });
    expect(agentsRepository.update).toHaveBeenCalledWith('agent-1', { containerId: 'container-2' });
  });

  it('keeps the stored policy when an older controller omits the platform policy', async () => {
    const result = await service.syncEffective(agent.id, {}, {});

    expect(result.ok).toBe(true);
    expect(messageFilters.store).not.toHaveBeenCalled();
    expect(egress.applyPolicyForAgent).not.toHaveBeenCalled();
  });

  it('re-applies the stored egress policy for guarded agents without a new policy', async () => {
    agent.egressGuardContainerId = 'guard-1';
    egress.applyPolicyForAgent.mockResolvedValue({ ok: true, applied: false, revision: 'rev-1', proxyEnv: {} });

    await service.syncEffective(agent.id, {}, {});

    expect(egress.applyPolicyForAgent).toHaveBeenCalledWith('agent-1', undefined, {});
  });

  it('applies everything else but reports egress failures', async () => {
    egress.applyPolicyForAgent.mockResolvedValue({
      ok: false,
      error: 'squid configuration rejected',
      applied: false,
      revision: null,
      proxyEnv: {},
    });

    const result = await service.syncEffective(agent.id, {}, {}, { egress: { mode: 'enforce' } });

    expect(result).toEqual({ ok: false, error: 'Egress policy not applied: squid configuration rejected' });
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://opencode/global/config',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });

  it('includes the egress status in the environment layer config response', async () => {
    await expect(service.get(agent.id)).resolves.toEqual(
      expect.objectContaining({ egress: { status: 'active', mode: 'enforce' } }),
    );
  });

  it('rejects invalid platform security config on environment PUT', async () => {
    await expect(service.put(agent.id, { config: { egress: { mode: 'nope' } } })).rejects.toThrow(/mode/);
    await expect(
      service.put(agent.id, { config: { message_filters: [{ name: 'x', pattern: '(a+)+', action: 'drop' }] } }),
    ).rejects.toThrow(/nested quantifiers/);
  });
});
