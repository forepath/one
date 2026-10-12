import { resolveEffectiveEgressPolicy } from '@forepath/agenstra/shared/util-opencode-config';

import { AgentEgressEventsCollectorService } from './agent-egress-events-collector.service';

const policy = resolveEffectiveEgressPolicy([
  { source: 'global', overlay: { egress: { mode: 'enforce', deny_hosts: ['example.org'] } } },
]);

describe('AgentEgressEventsCollectorService', () => {
  let agents: Record<string, jest.Mock>;
  let events: Record<string, jest.Mock>;
  let docker: Record<string, jest.Mock>;
  let egress: Record<string, jest.Mock>;
  let service: AgentEgressEventsCollectorService;
  const agent = {
    id: 'agent-1',
    containerId: 'agent-container',
    egressGuardContainerId: 'guard-1',
    egressPolicy: policy,
    egressPolicyRevision: 'rev-1',
    egressLogCursor: '2026-10-12T16:25:40.000000000Z',
  };

  beforeEach(() => {
    agents = {
      findAllWithEgressGuards: jest.fn().mockResolvedValue([agent]),
      update: jest.fn().mockResolvedValue({}),
    };
    events = {
      insertMany: jest.fn().mockResolvedValue(undefined),
      deleteCreatedBefore: jest.fn().mockResolvedValue(3),
    };
    docker = {
      inspectContainerSummary: jest.fn(async (id: string) => ({
        id,
        running: true,
        startedAt: new Date(1000),
        networkMode: id === 'agent-container' ? 'container:guard-1' : 'agent-net',
        labels: {},
      })),
      getContainerLogsSince: jest
        .fn()
        .mockResolvedValue(
          [
            '2026-10-12T16:25:39.000000000Z dnsmasq[1]: config old.example.org is NXDOMAIN',
            '2026-10-12T16:25:41.100000000Z AGENSTRA_EGRESS 1791822322.256 NONE_NONE 0 CONNECT 1.2.3.4:443 1.2.3.4 www.example.org - 0 0 2 deny_host -',
            '2026-10-12T16:25:41.200000000Z AGENSTRA_EGRESS 1791822322.300 NONE_NONE 0 CONNECT 1.2.3.4:443 1.2.3.4 www.example.org - 0 0 2 deny_host -',
            '2026-10-12T16:25:42.000000000Z AGENSTRA_EGRESS 1791822323.000 TCP_TUNNEL 200 CONNECT github.com:443 github.com github.com 140.82.121.4 100 10 5 - -',
            '2026-10-12T16:25:43.000000000Z dnsmasq[1]: config www.example.org is NXDOMAIN',
            '2026-10-12T16:25:44.000000000Z AGENSTRA_GUARD {"event":"process_restarted","detail":"dnsmasq exited"}',
          ].join('\n'),
        ),
      sendCommandToContainer: jest
        .fn()
        .mockResolvedValue(
          '[2:120] -A AGENSTRA_EGRESS_OUT -p udp -m udp --dport 443 -m comment --comment "agenstra:quic" -j REJECT',
        ),
    };
    egress = {
      recoverMissingGuard: jest.fn().mockResolvedValue('guard-2'),
      beforeAgentStart: jest.fn().mockResolvedValue(undefined),
      refreshAgentNamespaceIfStale: jest.fn().mockResolvedValue(false),
      removeOrphanedGuards: jest.fn().mockResolvedValue(0),
    };
    service = new AgentEgressEventsCollectorService(agents as never, events as never, docker as never, egress as never);
  });

  it('collects new log lines after the cursor, aggregates them and advances the cursor', async () => {
    await expect(service.collectForAgent(agent as never)).resolves.toBe(4);

    expect(docker.getContainerLogsSince).toHaveBeenCalledWith(
      'guard-1',
      Math.floor(Date.parse(agent.egressLogCursor) / 1000),
    );
    const rows = events.insertMany.mock.calls[0][0];

    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agentId: 'agent-1',
          kind: 'web',
          decision: 'blocked',
          host: 'www.example.org',
          rule: 'deny_host',
          matchedEntry: 'example.org',
          count: 2,
          mode: 'enforce',
          policyRevision: 'rev-1',
        }),
        expect.objectContaining({
          kind: 'web',
          decision: 'allowed',
          host: 'github.com',
          bytesIn: '100',
          bytesOut: '10',
        }),
        expect.objectContaining({ kind: 'dns', decision: 'blocked', host: 'www.example.org' }),
        expect.objectContaining({ kind: 'guard', decision: 'error', message: 'process_restarted: dnsmasq exited' }),
      ]),
    );
    expect(rows.some((row: { host: string }) => row.host === 'old.example.org')).toBe(false);
    expect(agents.update).toHaveBeenCalledWith('agent-1', { egressLogCursor: '2026-10-12T16:25:44.000000000Z' });
  });

  it('counts netfilter categories from the second poll on', async () => {
    docker.getContainerLogsSince.mockResolvedValue('');
    await service.collectForAgent(agent as never);
    expect(events.insertMany).not.toHaveBeenCalled();

    docker.sendCommandToContainer.mockResolvedValue(
      '[5:300] -A AGENSTRA_EGRESS_OUT -p udp -m udp --dport 443 -m comment --comment "agenstra:quic" -j REJECT',
    );
    await service.collectForAgent(agent as never);
    expect(events.insertMany).toHaveBeenCalledWith([
      expect.objectContaining({ kind: 'network', decision: 'blocked', rule: 'quic', count: 3 }),
    ]);
  });

  it('records and recovers a missing guard', async () => {
    docker.inspectContainerSummary.mockResolvedValue(null);

    await service.collectForAgent(agent as never);

    expect(events.insertMany).toHaveBeenCalledWith([
      expect.objectContaining({ kind: 'guard', decision: 'error', message: expect.stringContaining('guard_missing') }),
    ]);
    expect(egress.recoverMissingGuard).toHaveBeenCalledWith(agent);
  });

  it('restarts a stopped guard while its agent runs', async () => {
    docker.inspectContainerSummary.mockImplementation(async (id: string) => ({
      id,
      running: id !== 'guard-1',
      startedAt: new Date(1000),
      networkMode: 'container:guard-1',
      labels: {},
    }));

    await service.collectForAgent(agent as never);

    expect(egress.beforeAgentStart).toHaveBeenCalledWith(agent);
    expect(docker.getContainerLogsSince).not.toHaveBeenCalled();
    expect(events.insertMany).toHaveBeenCalledWith([
      expect.objectContaining({ message: expect.stringContaining('guard_stopped') }),
    ]);
  });

  it('runs cycles across agents, isolates failures and prunes old events', async () => {
    agents.findAllWithEgressGuards.mockResolvedValue([{ ...agent, id: 'broken', egressGuardContainerId: 'x' }, agent]);
    docker.inspectContainerSummary.mockImplementationOnce(async () => {
      throw new Error('docker down');
    });

    await service.runCycle();

    expect(events.insertMany).toHaveBeenCalled();
    expect(events.deleteCreatedBefore).toHaveBeenCalledWith(expect.any(Date));
    expect(egress.removeOrphanedGuards).toHaveBeenCalled();
  });

  it('does not start polling when disabled', () => {
    process.env['AGENT_EGRESS_EVENTS_COLLECTOR_ENABLED'] = 'false';
    const setIntervalSpy = jest.spyOn(global, 'setInterval');

    service.onModuleInit();
    expect(setIntervalSpy).not.toHaveBeenCalled();

    delete process.env['AGENT_EGRESS_EVENTS_COLLECTOR_ENABLED'];
    service.onModuleInit();
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    service.onModuleDestroy();
    setIntervalSpy.mockRestore();
  });
});
