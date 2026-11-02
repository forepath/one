import { controlPlaneMessage, type WorkloadSpec } from '@forepath/loadweaver/shared/util-agent-protocol';

import {
  DEFAULT_MIGRATION_TIMEOUTS as T,
  DEFAULT_SESSION_OPTIONS,
  hostRoutes,
  keptAddresses,
  precopyLimitMs,
  qemuDowntimeLimitMs,
  sessionCommands,
  sessionMetrics,
  sessionOptionsFromEnv,
  sessionStep,
  sourceMayResume,
  subnetOwner,
  VM_PRECOPY_MARGIN_MS,
  waveDependencies,
  waveReady,
  type NodeReport,
  type SessionRecord,
  type SessionState,
} from './migration-state.utils';

const NOW = 1_800_000_000_000;
const ok = (extra: Partial<NodeReport> = {}): NodeReport => ({ status: 'done', at: 'x', ...extra });
const running: NodeReport = { status: 'running', at: 'x' };
const failed = (error: string): NodeReport => ({ status: 'failed', at: 'x', error });
const ENDPOINT = { address: '10.93.0.2', port: 7480 };

const state = (extra: Partial<SessionState> = {}): SessionState => ({
  method: 'live',
  phase: 'prepare',
  phaseStartedAt: NOW,
  reports: {},
  restoreSent: false,
  targetLost: false,
  ...extra,
});

describe('sessionStep (3.10)', () => {
  it('walks a live attempt through prepare → precopy → freeze → transfer → restore → cut-over → done', () => {
    expect(sessionStep(state(), NOW)).toEqual({ kind: 'wait' });
    // Prepare done without an endpoint isn't enough.
    expect(sessionStep(state({ reports: { target: { prepare: ok() } } }), NOW)).toEqual({ kind: 'wait' });
    expect(sessionStep(state({ reports: { target: { prepare: ok({ endpoint: ENDPOINT }) } } }), NOW)).toEqual({
      kind: 'phase',
      phase: 'precopy',
    });
    expect(
      sessionStep(state({ phase: 'precopy', reports: { source: { precopy: { ...running, round: 2 } } } }), NOW),
    ).toEqual({ kind: 'wait' });
    expect(sessionStep(state({ phase: 'precopy', reports: { source: { precopy: ok() } } }), NOW)).toEqual({
      kind: 'phase',
      phase: 'freeze',
    });
    expect(sessionStep(state({ phase: 'freeze', reports: { source: { freeze: ok() } } }), NOW)).toEqual({
      kind: 'phase',
      phase: 'transfer',
    });
    // A source that reports the transfer right away skips straight on.
    expect(sessionStep(state({ phase: 'freeze', reports: { source: { freeze: ok(), transfer: ok() } } }), NOW)).toEqual(
      { kind: 'phase', phase: 'restore' },
    );
    expect(sessionStep(state({ phase: 'transfer', reports: { source: { transfer: ok() } } }), NOW)).toEqual({
      kind: 'phase',
      phase: 'restore',
    });
    expect(sessionStep(state({ phase: 'restore', reports: { target: { restore: ok() } } }), NOW)).toEqual({
      kind: 'cutover',
    });
    expect(sessionStep(state({ phase: 'cutover', reports: { source: { commit: ok() } } }), NOW)).toEqual({
      kind: 'wait',
    });
    expect(
      sessionStep(state({ phase: 'cutover', reports: { source: { commit: ok() }, target: { commit: running } } }), NOW),
    ).toEqual({ kind: 'done' });
  });

  it('skips the pre-copy for gVisor stop-and-copy', () => {
    expect(
      sessionStep(
        state({ method: 'stop-and-copy', reports: { target: { prepare: ok({ endpoint: ENDPOINT }) } } }),
        NOW,
      ),
    ).toEqual({ kind: 'phase', phase: 'freeze' });
  });

  it.each(['prepare', 'precopy', 'freeze', 'transfer', 'restore'] as const)('aborts when %s times out', (phase) => {
    expect(sessionStep(state({ phase }), NOW + T[phase])).toEqual({ kind: 'wait' });
    expect(sessionStep(state({ phase }), NOW + T[phase] + 1)).toEqual({
      kind: 'abort',
      reason: `${phase} timed out after ${Math.round(T[phase] / 1000)} s`,
    });
  });

  it('aborts on any failure report, the target lost, but not on failed commits', () => {
    expect(
      sessionStep(state({ phase: 'restore', reports: { target: { restore: failed('criu: no tcp repair') } } }), NOW),
    ).toEqual({
      kind: 'abort',
      reason: 'target restore failed: criu: no tcp repair',
    });
    expect(sessionStep(state({ phase: 'precopy', reports: { source: { precopy: failed('') } } }), NOW)).toEqual({
      kind: 'abort',
      reason: 'source precopy failed',
    });
    expect(sessionStep(state({ phase: 'freeze', targetLost: true }), NOW)).toEqual({
      kind: 'abort',
      reason: 'target node lost',
    });
    // After the cut-over the target runs: a failed commit only ends the attempt (at the latest on timeout).
    expect(sessionStep(state({ phase: 'cutover', reports: { source: { commit: failed('x') } } }), NOW)).toEqual({
      kind: 'wait',
    });
    expect(sessionStep(state({ phase: 'cutover' }), NOW + T.cutover + 1)).toEqual({ kind: 'done' });
  });

  it('falls back once the source confirmed the abort, or gives up waiting after two abort timeouts', () => {
    const aborting = state({ phase: 'aborting', restoreSent: true });

    expect(sessionStep(aborting, NOW)).toEqual({ kind: 'wait' });
    expect(sessionStep({ ...aborting, reports: { source: { abort: running } } }, NOW)).toEqual({ kind: 'wait' });
    expect(sessionStep({ ...aborting, reports: { source: { abort: ok({ resumed: true }) } } }, NOW)).toEqual({
      kind: 'fallback',
      resumed: true,
    });
    expect(sessionStep({ ...aborting, reports: { source: { abort: failed('gone') } } }, NOW)).toEqual({
      kind: 'fallback',
      resumed: false,
    });
    expect(sessionStep(aborting, NOW + 2 * T.aborting + 1)).toEqual({ kind: 'fallback', resumed: false });
  });

  it('resumes the source only once nothing can run on the target any more', () => {
    const aborting = state({ phase: 'aborting', restoreSent: true });

    expect(sourceMayResume(aborting, NOW, T)).toBe(false);
    expect(sourceMayResume({ ...aborting, restoreSent: false }, NOW, T)).toBe(true);
    expect(sourceMayResume({ ...aborting, targetLost: true }, NOW, T)).toBe(true);
    expect(sourceMayResume({ ...aborting, reports: { target: { abort: ok() } } }, NOW, T)).toBe(true);
    expect(sourceMayResume(aborting, NOW + T.aborting + 1, T)).toBe(true);
  });

  it('collects the measurements for the history', () => {
    expect(
      sessionMetrics({
        source: {
          precopy: ok({ round: 3, totalBytes: 150_000_000 }),
          transfer: ok({ totalBytes: 150_400_000, freezeMs: 480 }),
        },
        target: { restore: ok({ freezeMs: 510 }) },
      }),
    ).toEqual({ precopyRounds: 3, checkpointBytes: 150_400_000, freezeMs: 510 });
    expect(sessionMetrics({})).toEqual({ precopyRounds: null, checkpointBytes: null, freezeMs: null });
  });
});

describe('dependency waves (3.10)', () => {
  // web → api → db; cache is independent.
  const dependsOn = new Map([
    ['web', ['api']],
    ['api', ['db']],
    ['db', []],
    ['cache', []],
  ]);

  it('makes each moving replica wait for the moving replicas it depends on, transitively', () => {
    const waves = waveDependencies(dependsOn, [
      { replica: 'p/d/web/0', service: 'web' },
      { replica: 'p/d/db/0', service: 'db' },
      { replica: 'p/d/cache/0', service: 'cache' },
      { replica: 'p/d/api/0', service: 'api' },
      { replica: 'p/d/api/1', service: 'api' },
    ]);

    expect(waves.get('p/d/db/0')).toEqual([]);
    expect(waves.get('p/d/cache/0')).toEqual([]);
    expect(waves.get('p/d/api/0')).toEqual(['p/d/db/0']);
    expect(waves.get('p/d/api/1')).toEqual(['p/d/db/0']);
    expect(waves.get('p/d/web/0')).toEqual(['p/d/db/0', 'p/d/api/0', 'p/d/api/1']);
    // Only moving replicas count: web waits for db although api stays.
    expect(
      waveDependencies(dependsOn, [
        { replica: 'p/d/web/0', service: 'web' },
        { replica: 'p/d/db/0', service: 'db' },
      ]).get('p/d/web/0'),
    ).toEqual(['p/d/db/0']);
  });

  it('lets a wave start once the previous targets run (removed replicas count as done)', () => {
    const p = (id: string, migration: unknown, state?: string) => ({
      id,
      node: 'n2',
      migration,
      status: state ? { n2: { state } } : null,
    });

    expect(waveReady([], [])).toBe(true);
    expect(waveReady(['a'], [p('a', { phase: 'prepare' }, 'running')])).toBe(false);
    expect(waveReady(['a'], [p('a', null, 'starting')])).toBe(false);
    expect(waveReady(['a'], [p('a', null)])).toBe(false);
    expect(waveReady(['a', 'b'], [p('a', null, 'healthy')])).toBe(true);
    expect(waveReady(['a'], [p('a', null, 'running')])).toBe(true);
  });
});

describe('kept addresses (3.10)', () => {
  const subnets = new Map([
    ['n1', ['10.88.0.0/24', 'fd88::/64']],
    ['n2', ['10.88.1.0/24', 'fd88:0:0:1::/64']],
  ]);

  it('finds addresses outside the node subnets and the node they belong to', () => {
    expect(keptAddresses(['10.88.0.10', 'fd88::a'], subnets.get('n2') ?? [])).toEqual(['10.88.0.10', 'fd88::a']);
    expect(keptAddresses(['10.88.1.10'], subnets.get('n2') ?? [])).toEqual([]);
    expect(subnetOwner('10.88.0.10', subnets)).toBe('n1');
    expect(subnetOwner('fd88:0:0:1::5', subnets)).toBe('n2');
    expect(subnetOwner('192.0.2.1', subnets)).toBeNull();
    expect(hostRoutes(['10.88.0.10', 'fd88::a'])).toEqual(['10.88.0.10/32', 'fd88::a/128']);
  });
});

describe('sessionCommands (3.10)', () => {
  const record = (extra: Partial<SessionRecord> = {}): SessionRecord => ({
    id: '6f1c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f',
    attempt: 1,
    replica: 'p1/d1/web/0',
    fromNode: 'n1',
    toNode: 'n2',
    method: 'live',
    runtime: 'runc',
    phase: 'prepare',
    phaseStartedAt: NOW,
    token: 'A'.repeat(43),
    addresses: ['10.88.0.10'],
    volumes: ['p1/d1/data'],
    spec: { id: 'p1/d1/web/0' } as WorkloadSpec,
    reports: {},
    restoreSent: false,
    targetLost: false,
    ...extra,
  });
  const summary = (r: SessionRecord, now = NOW) => sessionCommands(r, now).map((c) => `${c.node}:${c.type}`);

  it('sends each phase its command until the node reported it', () => {
    expect(summary(record())).toEqual(['n2:migrationPrepare']);
    expect(summary(record({ reports: { target: { prepare: running } } }))).toEqual([]);
    expect(summary(record({ spec: null }))).toEqual([]);
    // Pre-copy and freeze need the target's endpoint.
    expect(summary(record({ phase: 'precopy' }))).toEqual([]);

    const prepared = { target: { prepare: ok({ endpoint: ENDPOINT }) } };

    expect(summary(record({ phase: 'precopy', reports: prepared }))).toEqual(['n1:migrationPrecopy']);
    expect(summary(record({ phase: 'freeze', reports: prepared }))).toEqual(['n1:migrationFreeze']);
    expect(summary(record({ phase: 'transfer', reports: { ...prepared, source: { transfer: running } } }))).toEqual([]);
    expect(summary(record({ phase: 'restore', reports: prepared }))).toEqual(['n2:migrationRestore']);
    expect(summary(record({ phase: 'cutover', reports: { source: { commit: ok() } } }))).toEqual([
      'n2:migrationCommit',
    ]);
  });

  it('aborts the target first and resumes the source only when allowed', () => {
    const aborting = record({ phase: 'aborting', restoreSent: true });

    expect(summary(aborting)).toEqual(['n2:migrationAbort']);
    expect(summary({ ...aborting, reports: { target: { abort: ok() } } })).toEqual(['n1:migrationAbort']);
    expect(summary({ ...aborting, targetLost: true })).toEqual(['n1:migrationAbort']);
    expect(summary({ ...aborting, restoreSent: false })).toEqual(['n2:migrationAbort', 'n1:migrationAbort']);
  });

  it('builds valid protocol messages on the session channel', () => {
    const prepared = { target: { prepare: ok({ endpoint: ENDPOINT }) } };
    const spec = {
      id: 'p1/d1/web/0',
      project: 'p1',
      deployment: 'd1',
      service: 'web',
      kind: 'service',
      image: 'nginx',
      environment: {},
      labels: {},
      addresses: ['10.88.0.10'],
      dnsSearch: [],
      runtime: 'runc',
      resources: { cpuMillis: 1, memoryBytes: 1 },
      restart: 'always',
      stopGracePeriodMs: 1,
      init: false,
      readOnly: false,
      privileged: false,
      capAdd: [],
      capDrop: [],
      ulimits: {},
      extraHosts: [],
      volumes: [],
      secrets: [],
      specHash: 'a'.repeat(32),
    } as WorkloadSpec;
    const all = (['prepare', 'precopy', 'freeze', 'restore', 'cutover', 'aborting'] as const).flatMap((phase) =>
      sessionCommands(record({ phase, spec, reports: prepared }), NOW),
    );

    expect(all.map((c) => c.type)).toEqual([
      'migrationPrecopy',
      'migrationFreeze',
      'migrationRestore',
      'migrationCommit',
      'migrationCommit',
      'migrationAbort',
      'migrationAbort',
    ]);
    expect(sessionCommands(record({ spec }), NOW)[0].payload).toMatchObject({ token: 'A'.repeat(43), spec });

    for (const command of [...all, ...sessionCommands(record({ spec }), NOW)]) {
      expect(command.channel).toBe('migration:6f1c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f');
      expect(() => controlPlaneMessage(command.type, command.payload as never)).not.toThrow();
    }
  });
});

describe('QEMU live migration sessions (vm-live, M7.4)', () => {
  const vmState = (extra: Partial<SessionState> = {}): SessionState => state({ method: 'vm-live', ...extra });
  const record = (extra: Partial<SessionRecord> = {}): SessionRecord => ({
    id: '6f1c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f',
    attempt: 1,
    replica: 'p1/lw-vm/db1/0',
    fromNode: 'n1',
    toNode: 'n2',
    method: 'vm-live',
    runtime: 'qemu',
    phase: 'prepare',
    phaseStartedAt: NOW,
    token: 'A'.repeat(43),
    addresses: ['10.88.0.10'],
    volumes: ['p1/lw-vm/db1.root'],
    spec: { id: 'p1/lw-vm/db1/0' } as WorkloadSpec,
    reports: {},
    restoreSent: false,
    targetLost: false,
    ...extra,
  });
  const summary = (r: SessionRecord, now = NOW, options = DEFAULT_SESSION_OPTIONS) =>
    sessionCommands(r, now, options).map((c) => `${c.node}:${c.type}`);
  const prepared = { target: { prepare: ok({ endpoint: ENDPOINT }) } };

  it('walks prepare → precopy → freeze → restore → cut-over without a transfer phase', () => {
    expect(sessionStep(vmState({ reports: prepared }), NOW)).toEqual({ kind: 'phase', phase: 'precopy' });
    expect(sessionStep(vmState({ phase: 'precopy', reports: { source: { precopy: running } } }), NOW)).toEqual({
      kind: 'wait',
    });
    expect(sessionStep(vmState({ phase: 'precopy', reports: { source: { precopy: ok() } } }), NOW)).toEqual({
      kind: 'phase',
      phase: 'freeze',
    });
    // QEMU's switch-over can finish within one poll: freeze done ends the pre-copy directly.
    expect(
      sessionStep(vmState({ phase: 'precopy', reports: { source: { precopy: ok(), freeze: ok() } } }), NOW),
    ).toEqual({ kind: 'phase', phase: 'restore' });
    expect(sessionStep(vmState({ phase: 'freeze', reports: { source: { freeze: ok() } } }), NOW)).toEqual({
      kind: 'phase',
      phase: 'restore',
    });
    expect(sessionStep(vmState({ phase: 'freeze', reports: { source: { freeze: running } } }), NOW)).toEqual({
      kind: 'wait',
    });
    expect(sessionStep(vmState({ phase: 'restore', reports: { target: { restore: ok() } } }), NOW)).toEqual({
      kind: 'cutover',
    });
  });

  it('aborts a pre-copy that runs past its limit and on failures', () => {
    const limit = precopyLimitMs('vm-live');

    expect(limit).toBe(120_000 + VM_PRECOPY_MARGIN_MS);
    expect(precopyLimitMs('live')).toBeUndefined();
    expect(
      sessionStep(
        vmState({ phase: 'precopy', precopyLimitMs: limit, reports: { source: { precopy: running } } }),
        NOW + (limit as number) + 1,
      ),
    ).toEqual({ kind: 'abort', reason: 'precopy timed out after 150 s' });
    expect(
      sessionStep(vmState({ phase: 'precopy', reports: { source: { precopy: failed('job aborted') } } }), NOW),
    ).toEqual({ kind: 'abort', reason: 'source precopy failed: job aborted' });
  });

  it('sends the VM messages per phase and forces the switch-over of a slow pre-copy', () => {
    expect(summary(record())).toEqual(['n2:vmMigrationPrepare']);
    expect(summary(record({ reports: { target: { prepare: running } } }))).toEqual([]);
    expect(summary(record({ phase: 'precopy' }))).toEqual([]);
    expect(summary(record({ phase: 'precopy', reports: prepared }))).toEqual(['n1:vmMigrationStart']);

    const copying = { ...prepared, source: { precopy: running } };

    expect(summary(record({ phase: 'precopy', reports: copying }), NOW + 59_000)).toEqual([]);
    expect(summary(record({ phase: 'precopy', reports: copying }), NOW + 61_000)).toEqual(['n1:vmMigrationSwitchover']);
    expect(
      summary(
        record({ phase: 'precopy', reports: { ...copying, source: { precopy: running, freeze: ok() } } }),
        NOW + 61_000,
      ),
    ).toEqual([]);
    // Freeze and restore are reported by the nodes on their own.
    expect(summary(record({ phase: 'freeze', reports: prepared }))).toEqual([]);
    expect(summary(record({ phase: 'restore', reports: prepared }))).toEqual([]);
    expect(summary(record({ phase: 'cutover' }))).toEqual(['n1:migrationCommit', 'n2:migrationCommit']);

    const aborting = record({ phase: 'aborting', restoreSent: true });

    expect(summary(aborting)).toEqual(['n2:migrationAbort']);
    expect(summary({ ...aborting, restoreSent: false })).toEqual(['n2:migrationAbort', 'n1:migrationAbort']);
  });

  it('builds valid vmMigration messages with the freeze budget as the downtime limit', () => {
    const spec = {
      id: 'p1/lw-vm/db1/0',
      project: 'p1',
      deployment: 'lw-vm',
      service: 'db1',
      kind: 'service',
      image: 'launcher',
      environment: {},
      labels: {},
      addresses: ['10.88.0.10'],
      dnsSearch: [],
      runtime: 'runc',
      resources: { cpuMillis: 1, memoryBytes: 1 },
      restart: 'always',
      stopGracePeriodMs: 1,
      init: false,
      readOnly: false,
      privileged: false,
      capAdd: [],
      capDrop: [],
      ulimits: {},
      extraHosts: [],
      volumes: [],
      secrets: [],
      specHash: 'a'.repeat(32),
    } as WorkloadSpec;
    const options = { ...DEFAULT_SESSION_OPTIONS, freezeBudgetMs: 1500, vmMaxBandwidthBps: 500_000_000 };
    const commands = [
      ...sessionCommands(record({ spec }), NOW, options),
      ...sessionCommands(
        record({ phase: 'precopy', spec, reports: { ...prepared, source: { precopy: running } } }),
        NOW + 61_000,
        options,
      ),
      ...sessionCommands(record({ phase: 'aborting', spec }), NOW, options),
    ];

    expect(commands.map((c) => c.type)).toEqual([
      'vmMigrationPrepare',
      'vmMigrationSwitchover',
      'migrationAbort',
      'migrationAbort',
    ]);
    expect(commands[0].payload).toMatchObject({ volumes: ['p1/lw-vm/db1.root'], addresses: ['10.88.0.10'], spec });

    const start = sessionCommands(record({ phase: 'precopy', spec, reports: prepared }), NOW, options)[0];

    // QEMU's share of the 1.5 s budget: minus the switch-over / resume overhead (300 ms) of the estimate (G5).
    expect(start.payload).toMatchObject({ downtimeLimitMs: 1200, maxSeconds: 120, maxBandwidthBps: 500_000_000 });

    for (const command of [...commands, start])
      expect(() => controlPlaneMessage(command.type, command.payload as never)).not.toThrow();
  });

  it("derives QEMU's downtime limit from the freeze budget minus the freeze's other parts", () => {
    const volume = { type: 'volume', volume: 'p1/app/data', target: '/data', readOnly: false };
    const tmpfs = { type: 'tmpfs', target: '/tmp', sizeBytes: 1024 };
    const microvm = { mode: 'generic', vcpus: 1, memoryMiB: 256 } as WorkloadSpec['microvm'];

    // VM: budget − overheadMs.qemu (300).
    expect(qemuDowntimeLimitMs({ volumes: [] } as never, 3_000)).toBe(2_700);
    // MicroVM: also the final guest pass (250) and each filesystem volume's hand-over (400); tmpfs doesn't count.
    expect(qemuDowntimeLimitMs({ microvm, volumes: [tmpfs] } as never, 3_000)).toBe(2_450);
    expect(qemuDowntimeLimitMs({ microvm, volumes: [volume, volume, tmpfs] } as never, 3_000)).toBe(1_650);
    // Never below 100 ms; no spec → the VM rule.
    expect(qemuDowntimeLimitMs({ microvm, volumes: [volume, volume, volume, volume, volume] } as never, 1_000)).toBe(
      100,
    );
    expect(qemuDowntimeLimitMs(null, 3_000)).toBe(2_700);
  });

  it('reads the QEMU session options from the environment', () => {
    expect(
      sessionOptionsFromEnv({
        LOADWEAVER_VM_MIGRATION_MAX_SECONDS: '300',
        LOADWEAVER_VM_MIGRATION_SWITCHOVER_AFTER_MS: '5',
        LOADWEAVER_VM_MIGRATION_MAX_BANDWIDTH_BPS: '1000000',
        LOADWEAVER_LIVE_MIGRATION_FREEZE_BUDGET_MS: '2000',
      }),
    ).toMatchObject({
      vmMaxSeconds: 300,
      vmSwitchoverAfterMs: 60_000,
      vmMaxBandwidthBps: 1_000_000,
      freezeBudgetMs: 2000,
    });
    expect(sessionOptionsFromEnv({}).vmMaxBandwidthBps).toBeUndefined();
  });
});
