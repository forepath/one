import {
  agentHelloSchema,
  controlPlaneMessage,
  negotiate,
  type Envelope,
  PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_FEATURES,
} from '@forepath/loadweaver/shared/util-agent-protocol';
import { generateWireguardKeyPair } from '@forepath/loadweaver/shared/util-pki';

import { HostInfoService } from '../host/host-info.service';
import { desiredState } from '../test-fixtures';
import { AgentConnectionService, preferredEndpoints } from './agent-connection.service';

describe('preferredEndpoints', () => {
  const identity = {
    clusterId: 'c',
    nodeName: 'n1',
    controlPlaneUrl: 'https://cp',
    controlPlaneEndpoints: ['cp.example.com:7443'],
  };

  it('uses the join-time endpoints before any tunnel exists', () => {
    expect(preferredEndpoints(identity, null)).toEqual(['cp.example.com:7443']);
  });

  it('prefers control-plane members reachable over the overlay (make-before-break, 3.21)', () => {
    const state = desiredState(2, {
      controlPlane: {
        role: 'none',
        scope: 'c',
        automaticFailover: true,
        members: [
          { name: 'n2', address: '10.93.0.2', witness: false },
          { name: 'n3', address: '10.93.0.3', witness: false },
          { name: 'w', address: '10.93.0.9', witness: true },
        ],
      },
    });

    // Only n2 has a link from n1 in the fixture; n3 is unreachable, the witness runs no API.
    expect(preferredEndpoints(identity, state)).toEqual(['10.93.0.2:7443', 'cp.example.com:7443']);
  });
});

describe('AgentConnectionService.hello', () => {
  it('announces the protocol version and every feature this agent supports (3.26)', async () => {
    const wg = generateWireguardKeyPair();
    const state = {
      identity: async () => ({
        clusterId: 'c',
        nodeName: 'n1',
        controlPlaneUrl: 'https://cp',
        controlPlaneEndpoints: [],
      }),
      wireguardPrivateKey: async () => wg.privateKey,
      sealPrivateKey: async () => null,
    };
    const hostInfo = {
      os: async () => ({ id: 'debian', versionId: '12', kernel: '6.1.0', arch: 'amd64' as const }),
      capabilities: async () => ({
        runtimes: ['runc' as const],
        sandboxProbe: 'missing' as const,
        wireguard: true,
        nftables: true,
        bird: true,
        drbd: false,
        criu: false,
      }),
      capacity: async () => ({ cpuMillis: 1000, memoryBytes: 1e9, diskBytes: 1e10 }),
    };
    // Only the state store and host info take part in the hello.
    const service = new (AgentConnectionService as unknown as new (...deps: unknown[]) => AgentConnectionService)(
      state,
      hostInfo,
    );
    const hello = agentHelloSchema.parse(await service.hello());

    expect(hello).toMatchObject({ protocolVersion: PROTOCOL_VERSION, features: [...SUPPORTED_PROTOCOL_FEATURES] });
    expect(negotiate(hello)).toEqual({ version: PROTOCOL_VERSION, features: new Set(SUPPORTED_PROTOCOL_FEATURES) });
    // Live migration (3.10): the agent side is implemented (checkpoint manager, transfer, restored replicas).
    expect(hello.features).toContain('live-migration');
  });
});

describe('AgentConnectionService live migration', () => {
  it('hands migration commands to the migration service', async () => {
    const handled: unknown[][] = [];
    const deps = Array.from({ length: 16 }, () => ({}) as unknown);

    deps[12] = { start: () => undefined };
    deps[15] = { handle: async (...args: unknown[]) => void handled.push(args) };

    const service = new (AgentConnectionService as unknown as new (...d: unknown[]) => AgentConnectionService)(...deps);
    const session = { endpoint: 'cp:7443', established: true, connection: { stream: { write: () => true } } };
    const payload = {
      migration: '6f1c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f',
      attempt: 1,
      replica: 'p1/d1/web/0',
      role: 'source' as const,
    };

    (service as unknown as { session: unknown }).session = session;
    await (service as unknown as { onMessage: (s: unknown, e: Envelope) => Promise<void> }).onMessage(
      session,
      controlPlaneMessage('migrationCommit', payload, { channel: 'migration:6f1c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f' }),
    );

    expect(handled).toEqual([['migrationCommit', payload]]);
  });
});

describe('AgentConnectionService capability changes (M7 follow-up)', () => {
  const capabilities = {
    runtimes: ['runc' as const, 'microvm' as const],
    sandboxProbe: 'missing' as const,
    wireguard: true,
    nftables: true,
    bird: true,
    drbd: false,
    criu: false,
  };

  function setup() {
    const writes: Envelope[] = [];
    const closeAll = jest.fn(async () => undefined);
    const deps = Array.from({ length: 16 }, () => ({}) as unknown);

    deps[1] = { capabilities: async () => capabilities };
    deps[12] = { start: () => undefined };
    deps[14] = { closeAll, drained: () => undefined };

    const service = new (AgentConnectionService as unknown as new (...d: unknown[]) => AgentConnectionService)(...deps);
    const end = jest.fn();
    const session = {
      endpoint: 'cp:7443',
      established: true,
      connection: { stream: { write: (e: Envelope) => writes.push(e) > 0, end }, client: { close: jest.fn() } },
    };
    const internals = service as unknown as {
      session: unknown;
      candidate: unknown;
      onMessage: (s: unknown, e: Envelope) => Promise<void>;
      refreshHello: () => void;
    };
    const refreshHello = jest.spyOn(internals, 'refreshHello').mockImplementation(() => undefined);

    internals.session = session;

    return { service, session, internals, writes, closeAll, end, refreshHello };
  }

  it('reports them on the open stream when the control plane announced capability-updates (live sessions survive)', async () => {
    const { service, session, internals, writes, closeAll, end, refreshHello } = setup();

    await internals.onMessage(
      session,
      controlPlaneMessage('helloAck', { protocolVersion: PROTOCOL_VERSION, features: ['capability-updates'] }),
    );
    await service.capabilitiesChanged();

    expect(writes.map((e) => e.type)).toEqual(['capabilitiesUpdate']);
    expect(JSON.parse(new TextDecoder().decode(writes[0].payload))).toEqual({ capabilities });
    // Same stream, no second hello: the open live sessions stay attached.
    expect(refreshHello).not.toHaveBeenCalled();
    expect(internals.session).toBe(session);
    expect(internals.candidate).toBeNull();
    expect(end).not.toHaveBeenCalled();
    expect(closeAll).not.toHaveBeenCalled();
  });

  it('falls back to a fresh hello for control planes without the feature', async () => {
    const { service, writes, refreshHello } = setup();

    await service.capabilitiesChanged();

    expect(writes).toEqual([]);
    expect(refreshHello).toHaveBeenCalledTimes(1);
  });

  it('is triggered by changed isolation probes through the host info', () => {
    const listeners: (() => void)[] = [];
    const isolation = { onChange: (listener: () => void) => listeners.push(listener) };
    const hostInfo = new HostInfoService({} as never, isolation as never);
    const changed = jest.fn();

    hostInfo.onChange(changed);
    listeners.forEach((l) => l());

    expect(changed).toHaveBeenCalledTimes(1);
  });
});
