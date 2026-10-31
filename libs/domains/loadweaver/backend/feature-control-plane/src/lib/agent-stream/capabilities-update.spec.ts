import {
  agentMessage,
  decodeControlPlaneMessage,
  type AgentHello,
  type Envelope,
} from '@forepath/loadweaver/shared/util-agent-protocol';

import { NodeEntity } from '../entities/node.entity';
import { NodeAgentsService } from '../services/node-agents.service';
import { AgentSessionRegistry } from './agent-session.registry';
import { AgentStreamServer, createAgentSession } from './agent-stream.server';

/**
 * Capability changes on the open stream (M7 follow-up, feature `capability-updates`): the control plane announces the
 * feature in `helloAck`; `capabilitiesUpdate` replaces the node's capabilities without a new session, so open live
 * sessions (terminals, consoles, tunnels) survive a changed isolation probe.
 */
const capabilities = {
  runtimes: ['runc' as const, 'microvm' as const],
  sandboxProbe: 'missing' as const,
  wireguard: true,
  nftables: true,
  bird: true,
  drbd: false,
  criu: false,
};

const hello = (features: string[]): AgentHello => ({
  nodeName: 'n1',
  agentVersion: '0.1.0',
  os: { id: 'debian', versionId: '12', kernel: '6.1.0', arch: 'amd64' },
  capabilities: { ...capabilities, runtimes: ['runc'] },
  capacity: { cpuMillis: 4000, memoryBytes: 8e9, diskBytes: 1e11 },
  wireguardPublicKey: 'yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=',
  appliedRevision: 0,
  protocolVersion: 2,
  features,
});

function setup() {
  const written: Envelope[] = [];
  const stream = {
    writableEnded: false,
    write: (envelope: Envelope) => written.push(envelope),
    end() {
      this.writableEnded = true;
    },
  };
  const agents = {
    handleHello: jest.fn(async () => undefined),
    handleCapabilitiesUpdate: jest.fn(async () => undefined),
  };
  const live = { released: jest.fn(async () => undefined) };
  const registry = new AgentSessionRegistry();
  const deps: unknown[] = Array.from({ length: 23 }, () => ({}));

  deps[2] = agents;
  deps[4] = registry;
  deps[17] = live;

  const server = new (AgentStreamServer as unknown as new (...d: unknown[]) => AgentStreamServer)(...deps);
  const internals = server as unknown as {
    dispatch: (session: unknown, envelope: Envelope) => Promise<void>;
    pushDesiredState: (session: unknown) => Promise<void>;
  };

  jest.spyOn(internals, 'pushDesiredState').mockResolvedValue(undefined);

  const session = createAgentSession('n1', stream);

  registry.register(session);

  return { written, stream, agents, live, registry, session, dispatch: internals.dispatch.bind(server) };
}

const types = (written: Envelope[]) => written.map((e) => e.type);

describe('capability updates on the agent stream (M7 follow-up)', () => {
  it('announces the feature in helloAck only to agents advertising capability-updates', async () => {
    const capable = setup();

    await capable.dispatch(capable.session, agentMessage('hello', hello(['capability-updates'])));

    expect(types(capable.written)).toEqual(['helloAck']);

    const ack = decodeControlPlaneMessage(capable.written[0]);

    expect(ack.ok && ack.message.payload).toMatchObject({ protocolVersion: 2 });
    expect(ack.ok && (ack.message.payload as { features: string[] }).features).toContain('capability-updates');

    const older = setup();

    await older.dispatch(older.session, agentMessage('hello', hello(['live-migration'])));

    expect(older.written).toEqual([]);
  });

  it('updates the node capabilities without replacing the session: an open live session survives', async () => {
    const { written, stream, agents, live, registry, session, dispatch } = setup();

    await dispatch(session, agentMessage('hello', hello(['capability-updates'])));
    await dispatch(session, agentMessage('capabilitiesUpdate', { capabilities }));

    expect(agents.handleCapabilitiesUpdate).toHaveBeenCalledWith('n1', { capabilities });
    // Still the same registered session, still open; its live sessions were never released.
    expect(registry.get('n1')).toBe(session);
    expect(stream.writableEnded).toBe(false);
    expect(live.released).not.toHaveBeenCalled();
    expect(types(written)).toEqual(['helloAck']);
    expect(agents.handleHello).toHaveBeenCalledTimes(1);
  });
});

describe('NodeAgentsService.handleCapabilitiesUpdate', () => {
  it('replaces the stored capabilities like a hello', async () => {
    const update = jest.fn(async () => ({ affected: 1 }));
    const dataSource = { getRepository: (entity: unknown) => (entity === NodeEntity ? { update } : null) };
    const service = new NodeAgentsService(dataSource as never, {} as never, {} as never, {} as never);

    await service.handleCapabilitiesUpdate('n1', { capabilities });

    expect(update).toHaveBeenCalledWith(
      { name: 'n1', lifecycle: expect.anything() },
      expect.objectContaining({ capabilities, connected: true, lastSeenAt: expect.any(Date) }),
    );
  });
});
