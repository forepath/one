import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  agentHelloSchema,
  controlPlaneMessage,
  negotiate,
  type Envelope,
  PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_FEATURES,
} from '@forepath/loadweaver/shared/util-agent-protocol';
import { generateWireguardKeyPair } from '@forepath/loadweaver/shared/util-pki';
import { Logger } from '@nestjs/common';

import { HostInfoService } from '../host/host-info.service';
import { desiredState } from '../test-fixtures';
import { AgentConnectionService, preferredEndpoints } from './agent-connection.service';
import { RETRY_REPORT_EVERY } from './revision-retry';

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

  it('puts a draining member last: it stays a member, its traffic moves to the others (2026-10-26)', () => {
    const state = desiredState(2, {
      controlPlane: {
        role: 'member',
        scope: 'c',
        automaticFailover: false,
        members: [
          { name: 'n1', address: '10.93.0.1', witness: false, draining: true },
          { name: 'n2', address: '10.93.0.2', witness: false },
        ],
      },
    });

    expect(preferredEndpoints(identity, state)).toEqual(['10.93.0.2:7443', 'cp.example.com:7443', '10.93.0.1:7443']);
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

describe('AgentConnectionService etcd state in heartbeats (3.43)', () => {
  async function report(features: string[], role: 'none' | 'member', withData: boolean) {
    const dir = await mkdtemp(join(tmpdir(), 'lw-agent-'));

    if (withData) await mkdir(join(dir, 'etcd', 'member'), { recursive: true });

    const deps = Array.from({ length: 16 }, () => ({}) as unknown);

    deps[0] = { dir };

    const service = new (AgentConnectionService as unknown as new (...d: unknown[]) => AgentConnectionService)(...deps);
    const internals = service as unknown as {
      session: unknown;
      lastState: unknown;
      etcdReport: () => Promise<unknown>;
    };

    internals.session = { established: true, controlPlaneFeatures: new Set(features) };
    internals.lastState = desiredState(2, {
      controlPlane: { role, scope: 'c', automaticFailover: false, members: [] },
    });

    try {
      return await internals.etcdReport();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  it('reports whether a voter holds etcd data to control planes with etcd-bootstrap', async () => {
    expect(await report(['etcd-bootstrap'], 'member', false)).toEqual({ etcd: { hasData: false } });
    expect(await report(['etcd-bootstrap'], 'member', true)).toEqual({ etcd: { hasData: true } });
    // A non-voter only with data; nothing for control planes without the feature (their heartbeat schema is strict).
    expect(await report(['etcd-bootstrap'], 'none', false)).toEqual({});
    expect(await report(['etcd-bootstrap'], 'none', true)).toEqual({ etcd: { hasData: true } });
    expect(await report([], 'member', true)).toEqual({});
  });
});

describe('AgentConnectionService retries of failed revisions (live test 3.43)', () => {
  type Report = { revision: number; status: string; steps: unknown[]; error?: string };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(Math, 'random').mockReturnValue(0.999_999);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  function setup() {
    const writes: Envelope[] = [];
    const apply = jest.fn<Promise<Report>, [{ revision: number }]>();
    const deps = Array.from({ length: 16 }, () => ({}) as unknown);

    deps[2] = { apply };
    deps[4] = { status: async () => ({ workloads: [] }) };
    deps[9] = { apply: () => undefined };
    deps[14] = { configure: () => undefined, closeAll: async () => undefined };

    const service = new (AgentConnectionService as unknown as new (...d: unknown[]) => AgentConnectionService)(...deps);
    const session = {
      endpoint: 'cp:7443',
      established: true,
      connection: {
        stream: { write: (e: Envelope) => writes.push(e) > 0, end: () => undefined },
        client: { close: () => undefined },
      },
    };
    const internals = service as unknown as {
      session: unknown;
      lastState: { revision: number } | null;
      onMessage: (s: unknown, e: Envelope) => Promise<void>;
    };

    internals.session = session;

    const deliver = (revision: number) =>
      internals.onMessage(session, controlPlaneMessage('desiredState', desiredState(revision)));
    const reports = () =>
      writes
        .filter((e) => e.type === 'applyReport')
        .map((e) => JSON.parse(new TextDecoder().decode(e.payload)) as Report);
    const revisions = () => apply.mock.calls.map(([state]) => state.revision);

    return { service, internals, apply, deliver, reports, revisions };
  }

  const failed = (revision: number, error = 'pull failed'): Report => ({
    revision,
    status: 'rolled-back',
    steps: [],
    error,
  });
  const applied = (revision: number): Report => ({ revision, status: 'applied', steps: [] });

  it('applies the same state again after the backoff until it applies, then stops', async () => {
    const { internals, apply, deliver, reports, revisions } = setup();

    apply.mockResolvedValueOnce(failed(3)).mockResolvedValueOnce(failed(3)).mockResolvedValueOnce(applied(3));
    await deliver(3);
    await jest.advanceTimersByTimeAsync(14_999);

    expect(revisions()).toEqual([3]);

    await jest.advanceTimersByTimeAsync(1);

    expect(revisions()).toEqual([3, 3]);
    expect(internals.lastState).toBeNull();

    // Doubled: 30 s.
    await jest.advanceTimersByTimeAsync(29_999);

    expect(revisions()).toEqual([3, 3]);

    await jest.advanceTimersByTimeAsync(1);

    expect(revisions()).toEqual([3, 3, 3]);
    expect(internals.lastState?.revision).toBe(3);
    // The first failure and the success; the unchanged second failure isn't reported again.
    expect(reports().map((r) => r.status)).toEqual(['rolled-back', 'applied']);

    await jest.advanceTimersByTimeAsync(60 * 60_000);

    expect(apply).toHaveBeenCalledTimes(3);
  });

  it('reports a failing retry when its outcome changes, else every few attempts; the delay caps at 5 min', async () => {
    const { apply, deliver, reports } = setup();

    apply.mockResolvedValue(failed(3));
    await deliver(3);
    // 15 + 30 + 60 + 120 + 240 s: five retries, the fifth reported although unchanged.
    await jest.advanceTimersByTimeAsync(465_000);

    expect(apply).toHaveBeenCalledTimes(1 + RETRY_REPORT_EVERY);
    expect(reports()).toHaveLength(2);

    apply.mockResolvedValue(failed(3, 'rollback failed'));
    await jest.advanceTimersByTimeAsync(299_999);

    expect(apply).toHaveBeenCalledTimes(6);

    await jest.advanceTimersByTimeAsync(1);

    expect(apply).toHaveBeenCalledTimes(7);
    expect(reports().map((r) => r.error)).toEqual(['pull failed', 'pull failed', 'rollback failed']);
  });

  it('starts over with a new revision and drops the retry of the old one', async () => {
    const { apply, deliver, revisions } = setup();

    apply.mockResolvedValueOnce(failed(3)).mockResolvedValueOnce(failed(4)).mockResolvedValue(applied(4));
    await deliver(3);
    await jest.advanceTimersByTimeAsync(10_000);
    await deliver(4);
    // The new revision's first retry after 15 s again, not after the old one's 30 s.
    await jest.advanceTimersByTimeAsync(15_000);
    await jest.advanceTimersByTimeAsync(60 * 60_000);

    expect(revisions()).toEqual([3, 4, 4]);
  });

  it("doesn't reschedule a retry superseded while it applied (never two applies of it at once)", async () => {
    const { apply, deliver, revisions } = setup();
    let finishRetry: (report: Report) => void = () => undefined;

    apply
      .mockResolvedValueOnce(failed(3))
      .mockImplementationOnce(() => new Promise<Report>((resolve) => (finishRetry = resolve)))
      .mockResolvedValue(applied(4));
    await deliver(3);
    await jest.advanceTimersByTimeAsync(15_000);
    await deliver(4);
    finishRetry(failed(3));
    await jest.advanceTimersByTimeAsync(60 * 60_000);

    expect(revisions()).toEqual([3, 3, 4]);
  });

  it('stops retrying when the agent shuts down', async () => {
    const { service, apply, deliver } = setup();

    apply.mockResolvedValue(failed(3));
    await deliver(3);
    service.onApplicationShutdown();
    await jest.advanceTimersByTimeAsync(60 * 60_000);

    expect(apply).toHaveBeenCalledTimes(1);
  });
});
