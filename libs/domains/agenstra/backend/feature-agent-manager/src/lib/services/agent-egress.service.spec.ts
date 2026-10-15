import { resolveEffectiveEgressPolicy } from '@forepath/agenstra/shared/util-opencode-config';

import { computeEgressPolicyRevision } from '../utils/egress-guard-config.utils';

import { AgentEgressService, EGRESS_GUARDED_AGENT_CAP_DROP, withAgentEgressLock } from './agent-egress.service';

const enforce = resolveEffectiveEgressPolicy([
  { source: 'global', overlay: { egress: { mode: 'enforce', deny_hosts: ['example.org'] } } },
]);
const off = resolveEffectiveEgressPolicy([]);

describe('AgentEgressService', () => {
  let docker: Record<string, jest.Mock>;
  let repository: Record<string, jest.Mock>;
  let service: AgentEgressService;
  let guardStatus: Record<string, unknown>;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env['AGENT_EGRESS_GUARD_ENABLED'];
    process.env['AGENT_DOCKER_NETWORK'] = 'agent-net';
    guardStatus = { revision: '', mode: '', applied: '', squid: true, dnsmasq: true };
    docker = {
      ensureNetworkExists: jest.fn().mockResolvedValue(undefined),
      createEgressGuardContainer: jest.fn().mockResolvedValue('guard-1'),
      inspectContainerSummary: jest.fn(async (id: string) => ({
        id,
        running: true,
        startedAt: new Date(1000),
        networkMode: id === 'agent-container' ? 'agent-net' : 'agent-net',
        labels: {},
      })),
      sendCommandToContainer: jest.fn(async (_id: string, argv: string[]) =>
        argv[1] === 'status' ? `${JSON.stringify(guardStatus)}\n` : '',
      ),
      putFilesIntoContainer: jest.fn().mockResolvedValue(undefined),
      startContainer: jest.fn().mockResolvedValue(undefined),
      stopContainer: jest.fn().mockResolvedValue(undefined),
      restartContainer: jest.fn().mockResolvedValue(undefined),
      deleteContainer: jest.fn().mockResolvedValue(undefined),
      updateContainer: jest.fn().mockResolvedValue('agent-container-2'),
      listContainersByLabel: jest.fn().mockResolvedValue([]),
    };
    repository = {
      findById: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      findAllWithEgressGuards: jest.fn().mockResolvedValue([]),
    };
    service = new AgentEgressService(repository as never, docker as never);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('buildProxyEnv', () => {
    it('points every proxy variable at the guard while enforcing', () => {
      expect(service.buildProxyEnv(enforce, true, { NO_PROXY: 'internal.corp, localhost' })).toEqual({
        HTTP_PROXY: 'http://127.0.0.1:3128',
        HTTPS_PROXY: 'http://127.0.0.1:3128',
        http_proxy: 'http://127.0.0.1:3128',
        https_proxy: 'http://127.0.0.1:3128',
        NO_PROXY: 'localhost,127.0.0.1,::1,internal.corp',
        no_proxy: 'localhost,127.0.0.1,::1,internal.corp',
      });
    });

    it('only removes lower-case variants without an enforcing guard', () => {
      expect(service.buildProxyEnv(off, true, {})).toEqual({
        http_proxy: undefined,
        https_proxy: undefined,
        no_proxy: undefined,
      });
      expect(service.buildProxyEnv(enforce, false, {})).toEqual({
        http_proxy: undefined,
        https_proxy: undefined,
        no_proxy: undefined,
      });
    });
  });

  it('resolves the upstream proxy from layered network secrets', () => {
    expect(service.resolveUpstream({ HTTPS_PROXY: 'http://proxy:8080', NO_PROXY: 'a.corp' })).toEqual({
      host: 'proxy',
      port: 8080,
      bypassHosts: ['a.corp'],
    });
    expect(service.resolveUpstream({})).toBeNull();
  });

  describe('applyPolicyForAgent', () => {
    it('stays inactive without a guard when the policy is off', async () => {
      repository.findById.mockResolvedValue({ id: 'agent-1', containerId: 'agent-container' });

      const result = await service.applyPolicyForAgent('agent-1', off, {});

      expect(result).toEqual(expect.objectContaining({ ok: true, applied: false, revision: null }));
      expect(result.joinGuardId).toBeUndefined();
      expect(docker.createEgressGuardContainer).not.toHaveBeenCalled();
      expect(repository.update).toHaveBeenCalledWith('agent-1', expect.objectContaining({ egressStatus: 'inactive' }));
    });

    it('creates a guard, applies the bundle and asks the caller to join the namespace', async () => {
      repository.findById.mockResolvedValue({ id: 'agent-1', containerId: 'agent-container' });

      const result = await service.applyPolicyForAgent('agent-1', enforce, {});

      expect(docker.ensureNetworkExists).toHaveBeenCalledWith('agent-net');
      expect(docker.createEgressGuardContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'agenstra-egress-agent-1',
          network: 'agent-net',
          labels: { 'io.agenstra.egress-guard': '1', 'io.agenstra.agent-id': 'agent-1' },
          publishPorts: [4096, 6080],
        }),
      );
      expect(docker.sendCommandToContainer).toHaveBeenCalledWith(
        'guard-1',
        ['/usr/local/bin/agenstra-egress', 'prepare'],
        undefined,
        true,
        { user: '0' },
      );
      expect(docker.putFilesIntoContainer).toHaveBeenCalledWith(
        'guard-1',
        '/var/lib/agenstra-egress/staged',
        expect.arrayContaining([expect.objectContaining({ name: 'squid.conf', mode: 0o640 })]),
      );
      expect(docker.sendCommandToContainer).toHaveBeenCalledWith(
        'guard-1',
        ['/usr/local/bin/agenstra-egress', 'apply'],
        undefined,
        true,
        { user: '0' },
      );
      expect(result).toEqual(
        expect.objectContaining({ ok: true, applied: true, joinGuardId: 'guard-1', revision: expect.any(String) }),
      );
      expect(result.proxyEnv['HTTPS_PROXY']).toBe('http://127.0.0.1:3128');
      expect(repository.update).toHaveBeenCalledWith('agent-1', {
        egressGuardContainerId: 'guard-1',
        egressLogCursor: null,
      });
      expect(repository.update).toHaveBeenCalledWith(
        'agent-1',
        expect.objectContaining({
          egressStatus: 'active',
          egressPolicyRevision: result.revision,
          egressLastError: null,
        }),
      );
    });

    it('skips re-applying an unchanged revision on a joined guard', async () => {
      const revision = computeEgressPolicyRevision(enforce, null);

      guardStatus = { revision, mode: 'enforce', applied: revision, squid: true, dnsmasq: true };
      repository.findById.mockResolvedValue({
        id: 'agent-1',
        containerId: 'agent-container',
        egressGuardContainerId: 'guard-1',
      });
      docker.inspectContainerSummary.mockImplementation(async (id: string) => ({
        id,
        running: true,
        startedAt: new Date(1000),
        networkMode: id === 'agent-container' ? 'container:guard-1' : 'agent-net',
        labels: {},
      }));

      const result = await service.applyPolicyForAgent('agent-1', enforce, {});

      expect(result).toEqual(expect.objectContaining({ ok: true, applied: false, revision }));
      expect(result.joinGuardId).toBeUndefined();
      expect(docker.putFilesIntoContainer).not.toHaveBeenCalled();
    });

    it('keeps the guard (pass-through) when the policy switches to off', async () => {
      repository.findById.mockResolvedValue({
        id: 'agent-1',
        containerId: 'agent-container',
        egressGuardContainerId: 'guard-1',
      });

      const result = await service.applyPolicyForAgent('agent-1', off, {});

      expect(result.ok).toBe(true);
      expect(docker.putFilesIntoContainer).toHaveBeenCalled();
      expect(repository.update).toHaveBeenCalledWith('agent-1', expect.objectContaining({ egressStatus: 'inactive' }));
      expect(result.proxyEnv['HTTP_PROXY']).toBeUndefined();
    });

    it('reports failures, keeps the previous proxy env and marks the agent failed', async () => {
      repository.findById.mockResolvedValue({
        id: 'agent-1',
        containerId: 'agent-container',
        egressGuardContainerId: 'guard-1',
        egressPolicy: enforce,
        egressPolicyRevision: 'old',
      });
      docker.inspectContainerSummary.mockImplementation(async (id: string) => ({
        id,
        running: true,
        startedAt: new Date(1000),
        networkMode: id === 'agent-container' ? 'container:guard-1' : 'agent-net',
        labels: {},
      }));
      docker.sendCommandToContainer.mockImplementation(async (_id: string, argv: string[]) => {
        if (argv[1] === 'apply') {
          throw new Error('squid configuration rejected');
        }

        return argv[1] === 'status' ? JSON.stringify(guardStatus) : '';
      });

      const result = await service.applyPolicyForAgent('agent-1', enforce, {});

      expect(result).toEqual(
        expect.objectContaining({ ok: false, error: 'squid configuration rejected', revision: 'old', applied: false }),
      );
      expect(result.proxyEnv['HTTPS_PROXY']).toBe('http://127.0.0.1:3128');
      expect(repository.update).toHaveBeenCalledWith(
        'agent-1',
        expect.objectContaining({ egressStatus: 'failed', egressLastError: 'squid configuration rejected' }),
      );
      // Inside the guard namespace the last known good bundle keeps enforcing: the agent keeps running.
      expect(docker.stopContainer).not.toHaveBeenCalled();
    });

    it('fails closed: stops a running agent outside any guard namespace when the guard cannot be provisioned', async () => {
      docker.createEgressGuardContainer.mockRejectedValue(new Error('image not found'));
      repository.findById.mockResolvedValue({ id: 'agent-1', containerId: 'agent-container', egressPolicy: null });

      const result = await service.applyPolicyForAgent('agent-1', enforce, {});

      expect(result.ok).toBe(false);
      expect(docker.stopContainer).toHaveBeenCalledWith('agent-container');
      expect(repository.update).toHaveBeenCalledWith(
        'agent-1',
        expect.objectContaining({
          egressStatus: 'failed',
          egressLastError: 'image not found (agent stopped until its egress guard is available)',
        }),
      );
    });

    it('does not stop agents when the failed policy does not require a guard', async () => {
      docker.inspectContainerSummary.mockImplementation(async (id: string) =>
        id === 'guard-1' ? { id, running: false, startedAt: null, networkMode: 'agent-net', labels: {} } : null,
      );
      docker.startContainer.mockRejectedValue(new Error('boom'));
      repository.findById.mockResolvedValue({
        id: 'agent-1',
        containerId: 'agent-container',
        egressGuardContainerId: 'guard-1',
      });

      const result = await service.applyPolicyForAgent('agent-1', { ...enforce, mode: 'off' }, {});

      expect(result.ok).toBe(false);
      expect(docker.stopContainer).not.toHaveBeenCalled();
    });

    it('refuses to create guards when the feature is disabled', async () => {
      process.env['AGENT_EGRESS_GUARD_ENABLED'] = 'false';
      repository.findById.mockResolvedValue({ id: 'agent-1', containerId: 'agent-container' });

      const result = await service.applyPolicyForAgent('agent-1', enforce, {});

      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/disabled/);
      expect(docker.createEgressGuardContainer).not.toHaveBeenCalled();
    });

    it('fails cleanly for unknown agents', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.applyPolicyForAgent('missing', enforce, {})).resolves.toEqual(
        expect.objectContaining({ ok: false }),
      );
    });
  });

  it('provisions a guard for a new agent and removes it when apply fails', async () => {
    await expect(service.provisionGuardForNewAgent('agent-new', enforce, null)).resolves.toEqual({
      guardId: 'guard-1',
      revision: computeEgressPolicyRevision(enforce, null),
    });
    // Named after the (pre-assigned) agent id from the start, never a temporary "pending" name.
    expect(docker.createEgressGuardContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'agenstra-egress-agent-new',
        labels: expect.objectContaining({ 'io.agenstra.agent-id': 'agent-new' }),
      }),
    );

    docker.sendCommandToContainer.mockImplementation(async (_id: string, argv: string[]) => {
      if (argv[1] === 'apply') {
        throw new Error('boom');
      }

      return argv[1] === 'status' ? JSON.stringify(guardStatus) : '';
    });

    await expect(service.provisionGuardForNewAgent('agent-new', enforce, null)).rejects.toThrow('boom');
    expect(docker.deleteContainer).toHaveBeenCalledWith('guard-1');
  });

  it('removes a stale guard holding the container name and retries', async () => {
    docker.createEgressGuardContainer
      .mockRejectedValueOnce(Object.assign(new Error('conflict'), { statusCode: 409 }))
      .mockResolvedValueOnce('guard-2');
    docker.inspectContainerSummary.mockImplementation(async (id: string) => ({
      id: id === 'agenstra-egress-agent-1' ? 'stale' : id,
      running: true,
      startedAt: new Date(1000),
      networkMode: 'agent-net',
      labels: { 'io.agenstra.egress-guard': '1' },
    }));
    repository.findById.mockResolvedValue({ id: 'agent-1', containerId: 'agent-container' });

    const result = await service.applyPolicyForAgent('agent-1', enforce, {});

    expect(docker.deleteContainer).toHaveBeenCalledWith('stale');
    expect(result.joinGuardId).toBe('guard-2');
  });

  describe('lifecycle', () => {
    const agent = { id: 'agent-1', containerId: 'agent-container', egressGuardContainerId: 'guard-1' } as never;

    it('starts a stopped guard before the agent and restarts it before agent restarts', async () => {
      docker.inspectContainerSummary.mockResolvedValue({ id: 'guard-1', running: false, startedAt: null, labels: {} });

      await service.beforeAgentStart(agent);
      expect(docker.startContainer).toHaveBeenCalledWith('guard-1');

      await service.beforeAgentRestart(agent);
      expect(docker.restartContainer).toHaveBeenCalledWith('guard-1');
    });

    it('throws when the guard is missing', async () => {
      docker.inspectContainerSummary.mockResolvedValue(null);

      await expect(service.beforeAgentStart(agent)).rejects.toThrow(/missing/);
    });

    it('stops / removes the guard after the agent', async () => {
      await service.afterAgentStop(agent);
      await service.afterAgentRemove(agent);

      expect(docker.stopContainer).toHaveBeenCalledWith('guard-1');
      expect(docker.deleteContainer).toHaveBeenCalledWith('guard-1');
    });

    it('refuses to start agents whose policy requires a guard that does not exist yet', async () => {
      const unguarded = { id: 'agent-3', containerId: 'c', egressPolicy: enforce } as never;

      await expect(service.beforeAgentStart(unguarded)).rejects.toThrow(/requires an egress guard/);
      await expect(service.beforeAgentRestart(unguarded)).rejects.toThrow(/requires an egress guard/);
    });

    it('is a no-op for agents without a guard', async () => {
      const plain = { id: 'agent-2', containerId: 'c' } as never;

      await service.beforeAgentStart(plain);
      await service.beforeAgentRestart(plain);
      await service.afterAgentStop(plain);
      await service.afterAgentRemove(plain);

      expect(docker.inspectContainerSummary).not.toHaveBeenCalled();
    });

    it('restarts agents that still hold a stale namespace', async () => {
      docker.inspectContainerSummary.mockImplementation(async (id: string) => ({
        id,
        running: true,
        startedAt: id === 'guard-1' ? new Date(5000) : new Date(1000),
        labels: {},
      }));

      await expect(service.refreshAgentNamespaceIfStale(agent, 'guard-1')).resolves.toBe(true);
      expect(docker.restartContainer).toHaveBeenCalledWith('agent-container');

      docker.inspectContainerSummary.mockImplementation(async (id: string) => ({
        id,
        running: true,
        startedAt: id === 'guard-1' ? new Date(1000) : new Date(5000),
        labels: {},
      }));
      await expect(service.refreshAgentNamespaceIfStale(agent, 'guard-1')).resolves.toBe(false);
    });
  });

  it('recovers a missing guard and moves the agent into the new namespace', async () => {
    repository.findById.mockResolvedValue({
      id: 'agent-1',
      containerId: 'agent-container',
      egressGuardContainerId: 'gone',
      egressPolicy: enforce,
    });
    docker.inspectContainerSummary.mockImplementation(async (id: string) =>
      id === 'gone' ? null : { id, running: true },
    );

    await expect(
      service.recoverMissingGuard({
        id: 'agent-1',
        containerId: 'agent-container',
        egressGuardContainerId: 'gone',
      } as never),
    ).resolves.toBe('guard-1');
    expect(docker.updateContainer).toHaveBeenCalledWith('agent-container', {
      sharedNetworkContainerId: 'guard-1',
      capDrop: [...EGRESS_GUARDED_AGENT_CAP_DROP],
    });
    expect(repository.update).toHaveBeenCalledWith(
      'agent-1',
      expect.objectContaining({
        containerId: 'agent-container-2',
        egressGuardContainerId: 'guard-1',
        egressStatus: 'active',
      }),
    );
  });

  it('removes only old unreferenced guards', async () => {
    docker.listContainersByLabel.mockResolvedValue([
      { id: 'referenced-guard', labels: {}, createdAt: new Date(0) },
      { id: 'orphan', labels: {}, createdAt: new Date(0) },
      { id: 'fresh', labels: {}, createdAt: new Date() },
    ]);
    repository.findAllWithEgressGuards.mockResolvedValue([{ egressGuardContainerId: 'referenced' }]);

    await expect(service.removeOrphanedGuards()).resolves.toBe(1);
    expect(docker.deleteContainer).toHaveBeenCalledTimes(1);
    expect(docker.deleteContainer).toHaveBeenCalledWith('orphan');
  });

  it('describes status from the database and optionally live from the guard', async () => {
    const agent = {
      id: 'agent-1',
      egressGuardContainerId: 'abcdef1234567890',
      egressStatus: 'active',
      egressPolicy: enforce,
      egressPolicyRevision: 'rev',
      egressAppliedAt: new Date(1),
      egressLastError: null,
    } as never;

    await expect(service.describe(agent)).resolves.toEqual({
      status: 'active',
      mode: 'enforce',
      guardContainerId: 'abcdef123456',
      policyRevision: 'rev',
      appliedAt: new Date(1),
      lastError: null,
    });

    guardStatus = { revision: 'rev', mode: 'enforce', applied: 'rev', squid: true, dnsmasq: false };
    await expect(service.describe(agent, true)).resolves.toEqual(
      expect.objectContaining({
        guard: expect.objectContaining({ running: true, activeRevision: 'rev', proxyRunning: true, dnsRunning: false }),
      }),
    );
  });

  it('serializes work per agent', async () => {
    const order: string[] = [];
    const first = withAgentEgressLock('a', async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push('first');
    });
    const second = withAgentEgressLock('a', async () => {
      order.push('second');
    });

    await Promise.all([first, second]);
    expect(order).toEqual(['first', 'second']);
  });
});
