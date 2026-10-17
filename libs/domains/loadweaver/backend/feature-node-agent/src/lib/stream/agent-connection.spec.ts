import {
  agentHelloSchema,
  controlPlaneMessage,
  negotiate,
  type Envelope,
  PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_FEATURES,
} from '@forepath/loadweaver/shared/util-agent-protocol';
import { generateWireguardKeyPair } from '@forepath/loadweaver/shared/util-pki';

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
