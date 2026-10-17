import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  decodeAgentMessage,
  type Envelope,
  type MigrationProgress,
} from '@forepath/loadweaver/shared/util-agent-protocol';

import { MigrationSessions } from './migration-sessions';
import { MigrationService, peerReleased } from './migration.service';
import { sendCheckpointBatch } from './transfer.service';

jest.mock('./transfer.service', () => ({
  ...jest.requireActual('./transfer.service'),
  sendCheckpointBatch: jest.fn(async ({ batch }: { batch: string }) => (batch === 'final' ? 500 : 1000)),
}));

const MIGRATION = '6f1c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f';
const TOKEN = 'A'.repeat(43);
const REPLICA = 'shop/web/api/0';
const base = { migration: MIGRATION, attempt: 1, replica: REPLICA };
const endpoint = { address: '10.93.0.2', port: 7460 };

describe('MigrationService (node side of 3.10)', () => {
  let dir: string;
  let reports: MigrationProgress[];
  let calls: string[];

  /** Waits until the background step reported a final status for `phase` (the service runs steps async). */
  const settle = async (phase?: string) => {
    for (let i = 0; i < 400; i++) {
      const report = phase ? reports.filter((r) => r.phase === phase).pop() : undefined;

      if (phase ? report && report.status !== 'running' : i >= 20) return;

      await new Promise((r) => setTimeout(r, 5));
    }
  };

  const setup = (options: { preDumpBytes?: number[]; runtime?: 'runc' | 'runsc' } = {}) => {
    const preDumps = [...(options.preDumpBytes ?? [60_000_000, 300_000])];
    const checkpoints = {
      locate: jest.fn(async () => ({
        dockerId: 'c1',
        restored: false,
        containerId: 'c1',
        runtime: options.runtime ?? 'runc',
        binary: 'runc',
        globalArgs: [],
        pid: 42,
        upperdir: '/upper',
        restartPolicy: 'always',
      })),
      preDump: jest.fn(async (_s: unknown, path: string, parent: string | null) => {
        calls.push(`pre-dump ${path.split('/').pop()} parent=${parent}`);

        return { bytes: preDumps.shift() ?? 100, ms: 100 };
      }),
      dump: jest.fn(async (_s: unknown, _path: string, o: { parent: string | null; leaveRunning: boolean }) => {
        calls.push(`dump parent=${o.parent} leaveRunning=${o.leaveRunning}`);

        return { bytes: 400_000, ms: 150 };
      }),
      setRestartPolicy: jest.fn(async (_c: string, name: string) => void calls.push(`restart-policy ${name}`)),
      pause: jest.fn(async () => void calls.push('pause')),
      unpause: jest.fn(async () => void calls.push('unpause')),
      hostInterface: jest.fn(async () => 'veth1'),
      disconnect: jest.fn(async () => (calls.push('disconnect veth1'), [['-4', 'route', 'replace', '10.88.0.5']])),
      connect: jest.fn(async () => void calls.push('connect veth1')),
      tarUpper: jest.fn(async () => void calls.push('tar upper')),
      ociProcess: jest.fn(async () => ({ args: ['sh', '-c', 'app'], cwd: '/' })),
      runscCheckpoint: jest.fn(async (_s: unknown, path: string) => {
        calls.push('runsc checkpoint');
        await mkdir(path, { recursive: true });
        await writeFile(join(path, 'checkpoint.img'), 'state');

        return { bytes: 40_000_000, ms: 120 };
      }),
    };
    const workloads = {
      containerOf: jest.fn(async () => ({ Id: 'c1', State: 'exited' })),
      createOptions: jest.fn(async () => ({ name: 'lw-x' })),
      dnsServers: () => ['10.88.0.1'],
      watchRestored: jest.fn(),
      specOf: jest.fn(() => ({ id: REPLICA, addresses: ['10.88.0.5'] })),
      removeContainer: jest.fn(async (id: string) => void calls.push(`remove ${id}`)),
    };
    const transfer = { open: jest.fn(async () => endpoint), close: jest.fn(), waitFor: jest.fn(async () => undefined) };
    const restored = {
      createHolder: jest.fn(async () => 'holder-1'),
      removeReplica: jest.fn(),
      prewarm: jest.fn(async () => undefined),
      restore: jest.fn(async (holder: string, image: string, _work: string, sandbox?: { process: unknown }) => {
        calls.push(
          `restore ${holder} ${image.split('/').pop()}${sandbox ? ` process=${JSON.stringify(sandbox.process)}` : ''}`,
        );

        return { pid: 7, ms: 100 };
      }),
    };
    const volumes = {
      unmount: jest.fn(async (name: string) => void calls.push(`demote ${name}`)),
      byDockerName: () => undefined,
    };
    const state = {
      identity: async () => ({ clusterId: 'lab', nodeName: 'n1' }),
      credentials: async () => ({ privateKeyPem: 'k', certificatePem: 'c', caCertificatePem: 'ca' }),
      appliedState: async () => ({
        network: { addresses: ['10.93.0.1'], wireguard: [{ peer: 'n2', peerAddresses: ['10.93.0.2'] }] },
      }),
    };
    const commands = { run: jest.fn(async () => ({ stdout: '', stderr: '' })), json: jest.fn(async () => []) };
    const registry = new MigrationSessions();
    const service = new MigrationService(
      state as never,
      commands as never,
      workloads as never,
      checkpoints as never,
      restored as never,
      transfer as never,
      registry,
      volumes as never,
      { start: async () => undefined } as never,
    );

    service.attach((envelope: Envelope) => {
      const decoded = decodeAgentMessage(envelope);

      if (!decoded.ok) throw new Error(decoded.error);

      expect(envelope.channel).toBe(`migration:${MIGRATION}`);
      reports.push(decoded.message.payload as MigrationProgress);
    });

    return { service, checkpoints, workloads, transfer, restored, registry, commands };
  };

  const last = (phase: string) => reports.filter((r) => r.phase === phase).pop();

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'lw-migration-'));
    process.env['LOADWEAVER_STATE_DIR'] = dir;
    reports = [];
    calls = [];
    (sendCheckpointBatch as jest.Mock).mockClear();
  });

  afterEach(async () => {
    delete process.env['LOADWEAVER_STATE_DIR'];
    await rm(dir, { recursive: true, force: true });
  });

  it('target: opens the endpoint, allows only the source, prepares the placeholder and reports where it listens', async () => {
    const { service, transfer, restored, registry, commands } = setup();
    const spec = { id: REPLICA, addresses: ['10.88.0.5'] };

    await service.handle('migrationPrepare', {
      ...base,
      source: 'n2',
      runtime: 'runc',
      token: TOKEN,
      addresses: ['10.88.0.5'],
      expiresInSeconds: 600,
      spec,
    } as never);
    await settle('prepare');

    expect(transfer.open).toHaveBeenCalledWith(
      expect.objectContaining({ peer: 'n2', token: TOKEN, address: '10.93.0.1', expiresInSeconds: 600 }),
    );
    expect(commands.run).toHaveBeenCalledWith('nft', expect.arrayContaining(['input', 'saddr', '10.93.0.2', '7460']));
    expect(restored.createHolder).toHaveBeenCalledWith({ name: 'lw-x' }, MIGRATION);
    expect(last('prepare')).toMatchObject({ status: 'done', endpoint });
    expect(registry.protectedReplicas()).toEqual(new Set([REPLICA]));

    // A repeated command (the control plane re-sends until it sees a report) only re-reports.
    await service.handle('migrationPrepare', { ...base } as never);
    expect(transfer.open).toHaveBeenCalledTimes(1);
    expect(last('prepare')).toMatchObject({ status: 'done', endpoint });
  });

  it('source: pre-copies until a round is small enough, then freezes paused, disconnected and alive', async () => {
    const { service, checkpoints } = setup();

    await service.handle('migrationPrecopy', {
      ...base,
      target: 'n2',
      endpoint,
      token: TOKEN,
      maxRounds: 8,
      convergeBytes: 4 * 1024 * 1024,
    } as never);
    await settle('precopy');

    expect(last('precopy')).toMatchObject({ status: 'done', round: 2, bytes: 300_000, totalBytes: 2000 });
    expect(reports.find((r) => r.phase === 'precopy' && r.round === 2)?.dirtyBytesPerSecond).toBeGreaterThan(0);

    await service.handle('migrationFreeze', {
      ...base,
      target: 'n2',
      endpoint,
      token: TOKEN,
      runtime: 'runc',
      volumes: [],
      freezeBudgetMs: 3000,
    } as never);
    await settle('transfer');

    expect(calls).toEqual([
      'pre-dump p1 parent=null',
      'pre-dump p2 parent=../p1',
      'restart-policy no',
      'pause',
      'disconnect veth1',
      'dump parent=../p2 leaveRunning=true',
      'tar upper',
    ]);
    expect(last('freeze')).toMatchObject({ status: 'done', bytes: 400_000 });
    expect(last('transfer')).toMatchObject({ status: 'done', bytes: 500, totalBytes: 2500 });
    expect((sendCheckpointBatch as jest.Mock).mock.calls.map((c) => [c[0].batch, c[0].paths])).toEqual([
      ['p1', ['p1']],
      ['p2', ['p2']],
      ['final', ['final', 'meta.json', 'upper.tar']],
    ]);
    expect(checkpoints.dump).toHaveBeenCalledTimes(1);

    // Abort (the target confirmed first): reconnect, thaw, restore the restart policy.
    calls.length = 0;
    await service.handle('migrationAbort', { ...base, role: 'source', reason: 'x', volumes: [] } as never);
    expect(calls).toEqual(['connect veth1', 'unpause', 'restart-policy always']);
    expect(last('abort')).toMatchObject({ status: 'done', resumed: true });
  });

  it('source: a replica with replicated volumes is stopped by the dump and its volumes demoted', async () => {
    const { service } = setup();

    await service.handle('migrationFreeze', {
      ...base,
      target: 'n2',
      endpoint,
      token: TOKEN,
      runtime: 'runc',
      volumes: ['shop/web/data'],
      freezeBudgetMs: 3000,
    } as never);
    await settle('transfer');

    expect(calls).toEqual([
      'restart-policy no',
      'disconnect veth1',
      'dump parent=null leaveRunning=false',
      'tar upper',
      'demote lw-vol-shop.web.data',
    ]);
    expect(last('transfer')).toMatchObject({ status: 'done' });
  });

  it('source: a final dump over the freeze budget resumes at once and reports the failure', async () => {
    const { service, checkpoints } = setup();

    checkpoints.dump.mockResolvedValueOnce({ bytes: 1, ms: 5_000 });
    await service.handle('migrationFreeze', {
      ...base,
      target: 'n2',
      endpoint,
      token: TOKEN,
      runtime: 'runc',
      volumes: [],
      freezeBudgetMs: 3000,
    } as never);
    await settle('freeze');

    expect(calls.slice(-3)).toEqual(['connect veth1', 'unpause', 'restart-policy always']);
    expect(last('freeze')).toMatchObject({ status: 'failed', error: expect.stringContaining('freeze budget') });
    expect(sendCheckpointBatch).not.toHaveBeenCalled();
  });

  it('target: abort removes whatever was restored and demotes the volumes before confirming', async () => {
    const { service, restored, transfer, registry } = setup();

    await service.handle('migrationPrepare', {
      ...base,
      source: 'n2',
      runtime: 'runc',
      token: TOKEN,
      addresses: ['10.88.0.5'],
      expiresInSeconds: 600,
      spec: { id: REPLICA, addresses: ['10.88.0.5'] },
    } as never);
    await settle('prepare');
    await service.handle('migrationAbort', {
      ...base,
      role: 'target',
      reason: 'restore failed',
      volumes: ['shop/web/data'],
    } as never);

    expect(transfer.close).toHaveBeenCalledWith(MIGRATION, 1, 'aborted');
    expect(restored.removeReplica).toHaveBeenCalledWith('holder-1');
    expect(calls).toContain('demote lw-vol-shop.web.data');
    expect(last('abort')).toMatchObject({ status: 'done' });
    expect(registry.protectedReplicas()).toEqual(new Set());
  });

  it('gVisor source: stop-and-copy without pause or writable layer, the OCI process travels along', async () => {
    const { service } = setup({ runtime: 'runsc' });

    await service.handle('migrationFreeze', {
      ...base,
      target: 'n2',
      endpoint,
      token: TOKEN,
      runtime: 'runsc',
      volumes: [],
      freezeBudgetMs: 3000,
    } as never);
    await settle('transfer');

    expect(calls).toEqual(['restart-policy no', 'disconnect veth1', 'runsc checkpoint']);
    expect(last('freeze')).toMatchObject({ status: 'done', bytes: 40_000_000 });
    expect((sendCheckpointBatch as jest.Mock).mock.calls.map((c) => [c[0].batch, c[0].paths])).toEqual([
      ['final', ['final', 'meta.json', 'process.json']],
    ]);

    const root = (sendCheckpointBatch as jest.Mock).mock.calls[0][0].root as string;

    expect(JSON.parse(await readFile(join(root, 'process.json'), 'utf8'))).toEqual({
      args: ['sh', '-c', 'app'],
      cwd: '/',
    });

    // Abort: the sandbox exited with the checkpoint, so the source restores its own image into a fresh placeholder.
    calls.length = 0;
    await service.handle('migrationAbort', { ...base, role: 'source', reason: 'x', volumes: [] } as never);
    expect(calls).toEqual(['remove c1', 'restore holder-1 final process={"args":["sh","-c","app"],"cwd":"/"}']);
    expect(last('abort')).toMatchObject({ status: 'done', resumed: true });
  });

  it('gVisor target: restores the image with the checkpointed process into the placeholder', async () => {
    const { service } = setup();

    await service.handle('migrationPrepare', {
      ...base,
      source: 'n2',
      runtime: 'runsc',
      token: TOKEN,
      addresses: ['10.88.0.5'],
      expiresInSeconds: 600,
      spec: { id: REPLICA, addresses: ['10.88.0.5'] },
    } as never);
    await settle('prepare');

    const session = join(dir, 'migrations', `${MIGRATION}-1-target`);

    await writeFile(join(session, 'meta.json'), JSON.stringify({ freezeStartedAt: Date.now(), runtime: 'runsc' }));
    await writeFile(join(session, 'process.json'), JSON.stringify({ args: ['app'] }));
    await service.handle('migrationRestore', {
      ...base,
      runtime: 'runsc',
      volumes: [],
      addresses: ['10.88.0.5'],
    } as never);
    await settle('restore');

    expect(calls).toEqual(['restore holder-1 final process={"args":["app"]}']);
    expect(last('restore')).toMatchObject({ status: 'done' });
  });

  it('refuses a restore without a prepared session', async () => {
    const { service } = setup();

    await service.handle('migrationRestore', {
      ...base,
      runtime: 'runc',
      volumes: [],
      addresses: ['10.88.0.5'],
    } as never);
    expect(last('restore')).toMatchObject({ status: 'failed', error: expect.stringContaining('no prepared session') });
  });
});

describe('DRBD: never two primaries when the source resumes', () => {
  it('needs the target connected and demoted, or quorum when it is unreachable', () => {
    const connected = (role: string) => ({
      connections: [{ name: 'n2', 'connection-state': 'Connected', 'peer-role': role }],
    });

    expect(peerReleased(connected('Secondary'), 'n2', 2)).toBe(true);
    expect(peerReleased(connected('Primary'), 'n2', 3)).toBe(false);
    expect(peerReleased({ connections: [{ name: 'n2', 'connection-state': 'Connecting' }] }, 'n2', 2)).toBe(false);
    expect(peerReleased({ connections: [] }, 'n2', 3)).toBe(true);
    expect(peerReleased(undefined, 'n2', 2)).toBe(false);
  });
});
