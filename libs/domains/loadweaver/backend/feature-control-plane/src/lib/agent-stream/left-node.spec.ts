import { agentMessage, type DesiredState } from '@forepath/loadweaver/shared/util-agent-protocol';

import { AgentSessionRegistry, type AgentSession } from './agent-session.registry';
import { AgentStreamServer, leftNodeState } from './agent-stream.server';

const state = {
  revision: 41,
  lifecycle: 'draining',
  network: {
    node: 'n3',
    addresses: ['10.93.0.1'],
    wireguard: [],
    services: [],
    bgp: { asn: 64512, routerId: '10.93.0.1', routeReflector: false, originate: [], sessions: [] },
    firewall: { sets: {}, rules: [] },
    dns: { domain: 'lw', records: [], visibility: {} },
  },
  controlPlane: {
    role: 'member',
    members: [
      { name: 'n1', address: '10.93.0.9', witness: false },
      { name: 'n2', address: '10.93.0.10', witness: false },
    ],
    automaticFailover: false,
    scope: 'lw-abc',
    logStore: { clusterName: 'lw-abc', heapMb: 512, httpPort: 9200, transportPort: 9300 },
    database: 'ready',
  },
} as unknown as DesiredState;

/**
 * A node that left keeps streaming to whichever replica it was connected to (the leave only closed the local session),
 * and kept its control-plane role with its last state (live 3.43).
 */
describe('a left node (3.43)', () => {
  it('gets its last state without the control-plane role, one revision above the last', () => {
    const last = leftNodeState(state);

    expect(last.revision).toBe(42);
    expect(last.lifecycle).toBe('leaving');
    expect(last.controlPlane).toEqual({
      role: 'none',
      members: state.controlPlane.members,
      automaticFailover: false,
      scope: 'lw-abc',
    });
  });

  function server(left: string[]) {
    const registry = new AgentSessionRegistry();
    const srv = Object.create(AgentStreamServer.prototype) as Record<string, unknown>;
    const session = (name: string) => {
      const s: AgentSession = {
        nodeName: name,
        sessionId: name,
        connectedAt: new Date(),
        sentRevision: 41,
        protocol: { features: new Set() } as never,
        negotiated: true,
        send: jest.fn(),
        close: jest.fn(),
      };

      registry.register(s);

      return s;
    };

    srv['registry'] = registry;
    srv['logger'] = { warn: jest.fn(), log: jest.fn() };
    srv['network'] = { getDesiredState: jest.fn(async () => state) };
    srv['dataSource'] = {
      getRepository: () => ({ find: jest.fn(async () => left.map((name) => ({ name }))) }),
    };

    return { srv, registry, session };
  }

  it('is sent that state and disconnected on the next push round, on whichever replica it streams to', async () => {
    const { srv, registry, session } = server(['n3']);
    const leaving = session('n3');
    const staying = session('n1');

    await (srv['pushToAll'] as () => Promise<void>).call(srv);

    expect((srv['logger'] as { warn: jest.Mock }).warn).not.toHaveBeenCalled();
    expect(leaving.send).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(Buffer.from((leaving.send as jest.Mock).mock.calls[0][0].payload).toString('utf8'));

    expect(sent).toMatchObject({ revision: 42, lifecycle: 'leaving', controlPlane: { role: 'none' } });
    expect(leaving.close).toHaveBeenCalledWith('node left the cluster');
    expect(registry.get('n3')).toBeUndefined();
    // Others: nothing newer than what they have, still connected.
    expect(staying.send).not.toHaveBeenCalled();
    expect(registry.get('n1')).toBe(staying);
  });

  it('is said goodbye to when its heartbeat is not recorded (the node left)', async () => {
    const { srv, registry, session } = server([]);
    const leaving = session('n3');

    srv['agents'] = { handleHeartbeat: jest.fn(async () => false) };
    await (srv['dispatch'] as (s: AgentSession, e: unknown) => Promise<void>).call(
      srv,
      leaving,
      agentMessage('heartbeat', {
        appliedRevision: 41,
        usage: { cpuMillis: 0, memoryBytes: 0, diskBytes: 0 },
        at: new Date().toISOString(),
      }),
    );

    expect(leaving.send).toHaveBeenCalledTimes(1);
    expect(leaving.close).toHaveBeenCalledWith('node left the cluster');
    expect(registry.get('n3')).toBeUndefined();
  });
});
