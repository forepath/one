import {
  chooseMigrationMethod,
  DEFAULT_ELIGIBILITY_OPTIONS,
  eligibilityOptionsFromEnv,
  estimateFreeze,
  type EligibilityInput,
  type EligibilityNode,
} from './migration-eligibility.utils';

const MiB = 1024 ** 2;

const node = (name: string, extra: Partial<EligibilityNode> = {}): EligibilityNode => ({
  name,
  features: ['live-migration'],
  capabilities: { criu: true, checkpoint: { runc: true, runsc: true, criuVersion: '4.1.1' } },
  reachable: true,
  ...extra,
});

const service = (extra: Partial<EligibilityInput['service']> = {}): EligibilityInput['service'] => ({
  kind: 'service',
  runtime: 'runc',
  liveMigration: true,
  privileged: false,
  devices: [],
  volumes: [],
  resources: { requests: { cpuMillis: 250, memoryBytes: 256 * MiB }, limits: {}, source: 'compose' },
  ...extra,
});

const input = (extra: Partial<EligibilityInput> = {}): EligibilityInput => ({
  service: service(),
  stateful: false,
  unsyncedVolumes: [],
  source: node('n1'),
  target: node('n2'),
  ...extra,
});

describe('chooseMigrationMethod (3.10)', () => {
  it('migrates runc services live and sandboxed ones by gVisor stop-and-copy', () => {
    expect(chooseMigrationMethod(input())).toMatchObject({ method: 'live', runtime: 'runc', label: 'live' });
    expect(
      chooseMigrationMethod(
        input({
          service: service({
            runtime: 'sandboxed',
            resources: { requests: { cpuMillis: 250, memoryBytes: 64 * MiB }, limits: {}, source: 'compose' },
          }),
        }),
      ),
    ).toMatchObject({ method: 'stop-and-copy', runtime: 'runsc', label: 'stop-and-copy (gVisor)' });
  });

  it.each([
    [{ service: service({ kind: 'job' }) }, 'one-off jobs are not checkpointed'],
    [{ service: service({ liveMigration: false }) }, 'live migration disabled for the service'],
    [{ source: node('n1', { reachable: false }) }, 'source node unreachable'],
    [{ target: undefined }, 'unknown target node'],
    [{ service: service({ privileged: true }) }, 'privileged container'],
    [{ service: service({ networkMode: 'host' }) }, 'host network'],
    [{ service: service({ devices: ['/dev/nvidia0'] }) }, 'device access (/dev/nvidia0)'],
    [
      { service: service({ volumes: [{ type: 'bind', source: '/srv', target: '/srv', readOnly: false }] }) },
      'bind mount of host path /srv',
    ],
    [{ source: node('n1', { features: [] }) }, 'agent on n1 does not support live migration'],
    [{ target: node('n2', { features: [] }) }, 'agent on n2 does not support live migration'],
    [
      { target: node('n2', { capabilities: { checkpoint: { runc: false, runsc: true } } }) },
      'no CRIU checkpoint support on n2',
    ],
    [{ source: node('n1', { capabilities: null }) }, 'no CRIU checkpoint support on n1'],
  ] as [Partial<EligibilityInput>, string][])(
    'falls back to blue / green for stateless replicas: %#',
    (extra, reason) => {
      expect(chooseMigrationMethod(input(extra))).toEqual({
        method: 'blue-green',
        reason,
        label: `blue-green (${reason})`,
      });
    },
  );

  it('needs gVisor checkpoint support on both nodes for sandboxed services', () => {
    expect(
      chooseMigrationMethod(
        input({
          service: service({ runtime: 'sandboxed' }),
          source: node('n1', { capabilities: { checkpoint: { runc: true, runsc: false } } }),
        }),
      ),
    ).toMatchObject({ method: 'blue-green', reason: 'no gVisor checkpoint support on n1' });
  });

  it('moves stateful services live only to a synchronous replica, else by short stop', () => {
    const stateful = {
      stateful: true,
      service: service({ volumes: [{ type: 'volume', source: 'data', target: '/d', readOnly: false }] }),
    } as const;

    expect(chooseMigrationMethod(input({ ...stateful }))).toMatchObject({ method: 'live' });
    expect(chooseMigrationMethod(input({ ...stateful, unsyncedVolumes: ['p/d/data'] }))).toEqual({
      method: 'short-stop',
      reason: 'volume p/d/data has no synchronous replica on n2',
      label: 'short-stop (volume p/d/data has no synchronous replica on n2)',
    });
    expect(
      chooseMigrationMethod(input({ ...stateful, service: { ...stateful.service, privileged: true } })),
    ).toMatchObject({
      method: 'short-stop',
      label: 'short-stop (privileged container)',
    });
  });

  it('counts tmpfs fully in the frozen size and compares the freeze with the budget', () => {
    // 200 MiB tmpfs at 1 Gbit/s ≈ 1.7 s + overhead: within 3 s …
    const tmpfs = service({ volumes: [{ type: 'tmpfs', target: '/dev/shm', sizeBytes: 200 * MiB }] });

    expect(chooseMigrationMethod(input({ service: tmpfs }))).toMatchObject({ method: 'live' });
    // … but not over a 100 Mbit/s link (the slower node counts).
    const slow = chooseMigrationMethod(
      input({
        service: tmpfs,
        target: node('n2', {
          capabilities: { checkpoint: { runc: true, runsc: true }, transferBitsPerSecond: 100_000_000 },
        }),
      }),
    );

    expect(slow.method).toBe('blue-green');
    expect(slow.reason).toBe('estimated freeze 17.4 s for 203 MiB at 100 Mbit/s exceeds 3.0 s');
    expect(slow.estimate).toMatchObject({ tmpfsBytes: 200 * MiB, linkBitsPerSecond: 100_000_000 });
  });

  it('estimates the dirty memory of the final round from measurements or the limits', () => {
    const options = DEFAULT_ELIGIBILITY_OPTIONS;
    const measured = estimateFreeze({ service: service(), memoryBytes: 1024 * MiB }, 'runc', 1e9, options);

    // 1 GiB × 5 %/s × 0.25 s = 12.8 MiB frozen.
    expect(measured.frozenBytes).toBe(Math.ceil(1024 * MiB * 0.05 * 0.25));
    expect(measured.freezeMs).toBe(Math.ceil((measured.frozenBytes * 8 * 1000) / 1e9) + 400);

    const limited = estimateFreeze(
      {
        service: service({
          resources: {
            requests: { cpuMillis: 1, memoryBytes: MiB },
            limits: { memoryBytes: 512 * MiB },
            source: 'compose',
          },
        }),
      },
      'runsc',
      1e9,
      options,
    );

    // gVisor has no pre-copy: the whole memory (limit before request) is frozen; unsized tmpfs counts 64 MiB.
    expect(limited).toMatchObject({ memoryBytes: 512 * MiB, frozenBytes: 512 * MiB });
    expect(
      estimateFreeze({ service: service({ volumes: [{ type: 'tmpfs', target: '/tmp' }] }) }, 'runc', 1e9, options)
        .tmpfsBytes,
    ).toBe(64 * MiB);
  });

  it('reads its limits from the environment within sane bounds', () => {
    expect(
      eligibilityOptionsFromEnv({
        LOADWEAVER_LIVE_MIGRATION_FREEZE_BUDGET_MS: '1500',
        LOADWEAVER_LIVE_MIGRATION_LINK_BPS: 'fast',
        LOADWEAVER_LIVE_MIGRATION_DIRTY_FRACTION: '2',
      }),
    ).toMatchObject({ freezeBudgetMs: 1500, defaultLinkBitsPerSecond: 1e9, dirtyFractionPerSecond: 0.05 });
  });
});
