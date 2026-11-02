import {
  BUNDLED_MICROVM_LIVE_LABEL,
  checkpointSupport,
  chooseMigrationMethod,
  DEFAULT_ELIGIBILITY_OPTIONS,
  QEMU_DEVICE_STATE_BYTES,
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

describe('chooseMigrationMethod per isolation level (M7.1 / M7.4)', () => {
  const kvmNode = (name: string, extra: Partial<EligibilityNode> = {}): EligibilityNode =>
    node(name, {
      features: ['live-migration', 'isolation-ladder'],
      capabilities: {
        runtimes: ['runc', 'sandboxed', 'sandboxed-kvm'],
        checkpoint: { runc: true, runsc: true, runscKvm: true },
      },
      ...extra,
    });
  const vmNode = (name: string, capabilities: Record<string, unknown> = {}): EligibilityNode =>
    node(name, {
      features: [
        'live-migration',
        'vm-migration',
        'isolation-ladder',
        'microvm',
        'virtual-machines',
        'vm-block-volumes',
      ],
      capabilities: { runtimes: ['runc', 'microvm'], cpuFlagsHash: 'a'.repeat(16), ...capabilities },
    });
  const small = { requests: { cpuMillis: 250, memoryBytes: 64 * MiB }, limits: {}, source: 'compose' as const };
  const disk = { type: 'volume' as const, source: 'db1.root', target: '/lw-vm/disks/root', readOnly: false };
  const vm = (extra: Partial<EligibilityInput> = {}): EligibilityInput =>
    input({
      service: service({ runtime: 'microvm', volumes: [disk], resources: small }),
      stateful: true,
      launcher: { kind: 'vm', cpuModel: 'host-model' },
      source: vmNode('n1'),
      target: vmNode('n2'),
      targetFeatures: ['isolation-ladder', 'virtual-machines', 'vm-block-volumes'],
      ...extra,
    });

  it('checkpoints gVisor KVM sandboxes and restores them on the KVM platform only', () => {
    const tiny = { requests: { cpuMillis: 250, memoryBytes: 32 * MiB }, limits: {}, source: 'compose' as const };
    const kvm = input({
      service: service({ runtime: 'sandboxed-kvm', resources: tiny }),
      source: kvmNode('n1'),
      target: kvmNode('n2'),
    });

    expect(chooseMigrationMethod(kvm)).toMatchObject({
      method: 'stop-and-copy',
      runtime: 'runsc',
      label: 'stop-and-copy (gVisor KVM)',
      // The whole memory (no pre-copy): 32 MiB at 1 Gbit/s ≈ 269 ms + the KVM platform's own overhead (2.5 s).
      estimate: { freezeMs: Math.ceil((32 * MiB * 8 * 1000) / 1e9) + 2_500 },
    });

    // A systrap checkpoint (runsc: true) is no KVM checkpoint, and the level must be ready on both.
    const reason = 'no gVisor KVM checkpoint support on n2 (restore must use the same platform)';

    expect(
      chooseMigrationMethod({
        ...kvm,
        target: kvmNode('n2', { capabilities: { runtimes: ['sandboxed-kvm'], checkpoint: { runsc: true } } }),
      }),
    ).toMatchObject({ method: 'blue-green', reason });
    expect(
      chooseMigrationMethod({
        ...kvm,
        target: kvmNode('n2', { capabilities: { runtimes: ['sandboxed'], checkpoint: { runscKvm: true } } }),
      }),
    ).toMatchObject({ reason });
    expect(chooseMigrationMethod({ ...kvm, source: kvmNode('n1', { features: ['live-migration'] }) })).toMatchObject({
      reason: 'agent on n1 has no gVisor KVM platform support',
    });
  });

  it('migrates full VMs through QEMU with the disks staying on DRBD', () => {
    expect(chooseMigrationMethod(vm())).toMatchObject({
      method: 'vm-live',
      runtime: 'qemu',
      label: 'vm-live (QEMU)',
      // 64 MiB × 5 %/s × 0.25 s + 2 MiB device state at 1 Gbit/s + 300 ms.
      estimate: { frozenBytes: Math.ceil(64 * MiB * 0.05 * 0.25) + 2 * MiB },
    });
  });

  it.each([
    [{ unsyncedVolumes: ['p/lw-vm/db1.root'] }, 'volume p/lw-vm/db1.root has no synchronous replica on n2'],
    [{ source: node('n1') }, 'agent on n1 does not support VM live migration'],
    [
      { target: vmNode('n2'), targetFeatures: ['isolation-ladder', 'vm-snapshots'] },
      'agent on n2 lacks the feature vm-snapshots this replica needs',
    ],
    [
      {
        launcher: { kind: 'vm', cpuModel: 'host-passthrough' },
        target: vmNode('n2', { cpuFlagsHash: 'b'.repeat(16) }),
      },
      'cpu model host-passthrough needs identical CPUs on n1 and n2',
    ],
    [
      { launcher: { kind: 'vm', cpuModel: 'host-passthrough' }, target: vmNode('n2', { cpuFlagsHash: undefined }) },
      'cpu model host-passthrough needs identical CPUs on n1 and n2',
    ],
    [
      { service: service({ runtime: 'microvm', liveMigration: false, volumes: [disk] }) },
      'live migration disabled for the service',
    ],
  ] as [Partial<EligibilityInput>, string][])('falls back to a short stop for VMs: %#', (extra, reason) => {
    expect(chooseMigrationMethod(vm(extra))).toEqual({ method: 'short-stop', reason, label: `short-stop (${reason})` });
  });

  it('keeps host-passthrough VMs live between identical CPUs', () => {
    expect(chooseMigrationMethod(vm({ launcher: { kind: 'vm', cpuModel: 'host-passthrough' } })).method).toBe(
      'vm-live',
    );
  });

  it('moves generic microVMs through QEMU with virtio-fs state when both launchers can (M7 W10b)', () => {
    const capable = { microvmMigration: true };
    const micro = (launcher: EligibilityInput['launcher'], extra: Partial<EligibilityInput> = {}) =>
      vm({
        service: service({ runtime: 'microvm', resources: small }),
        stateful: false,
        launcher,
        source: vmNode('n1', capable),
        target: vmNode('n2', capable),
        targetFeatures: ['isolation-ladder', 'microvm'],
        ...extra,
      });
    const withVolume = {
      stateful: true,
      service: service({
        runtime: 'microvm',
        resources: small,
        volumes: [
          { type: 'volume' as const, source: 'data', target: '/data', readOnly: false },
          { type: 'tmpfs' as const, target: '/run/cache', sizeBytes: 16 * MiB },
        ],
      }),
    };
    const generic = chooseMigrationMethod(micro({ kind: 'generic' }));

    expect(generic).toMatchObject({ method: 'vm-live', runtime: 'qemu', label: 'microvm-live (QEMU)' });

    // Filesystem volumes migrate too: handed over in the freeze (its estimate holds the sync and the hand-over).
    const volumes = chooseMigrationMethod(micro({ kind: 'generic' }, withVolume));

    expect(volumes).toMatchObject({ method: 'vm-live', label: 'microvm-live (QEMU)' });
    expect((volumes.estimate?.freezeMs ?? 0) - (generic.estimate?.freezeMs ?? 0)).toBeGreaterThanOrEqual(400);

    // Fallback only where a node's launcher can't (old QEMU / virtiofsd, microVM level not ready).
    expect(chooseMigrationMethod(micro({ kind: 'generic' }, { target: vmNode('n2') }))).toMatchObject({
      method: 'blue-green',
      reason:
        'no microVM live migration on n2 (its launcher needs virtio-fs state migration: QEMU 10.0+, virtiofsd 1.13+)',
    });
    expect(
      chooseMigrationMethod(
        micro({ kind: 'generic' }, { ...withVolume, source: vmNode('n1', { microvmMigration: false }) }),
      ),
    ).toMatchObject({ method: 'short-stop', reason: expect.stringMatching(/^no microVM live migration on n1/) });
    // MicroVM launchers boot with host-passthrough: only between identical CPUs.
    expect(
      chooseMigrationMethod(
        micro({ kind: 'generic' }, { target: vmNode('n2', { ...capable, cpuFlagsHash: 'b'.repeat(16) }) }),
      ),
    ).toMatchObject({ method: 'blue-green', reason: 'cpu model host-passthrough needs identical CPUs on n1 and n2' });
    expect(chooseMigrationMethod(micro({ kind: 'unknown' })).reason).toBe('microVM image not inspected yet');
    expect(chooseMigrationMethod(micro(undefined)).reason).toBe('microVM image not inspected yet');
    // Full VMs don't need the microVM capability.
    expect(chooseMigrationMethod(vm())).toMatchObject({ method: 'vm-live', label: 'vm-live (QEMU)' });
  });

  it('moves bundled microVMs live when their launcher has the incoming mode, connections reset (M7 F5)', () => {
    const capable = { microvmBundledMigration: true };
    const micro = (launcher: EligibilityInput['launcher'], extra: Partial<EligibilityInput> = {}) =>
      vm({
        service: service({ runtime: 'microvm', resources: small }),
        stateful: false,
        launcher,
        source: vmNode('n1', capable),
        target: vmNode('n2', capable),
        targetFeatures: ['isolation-ladder', 'microvm'],
        ...extra,
      });
    const label = 'microvm-live (QEMU; guest connections reset: user-mode networking)';

    expect(BUNDLED_MICROVM_LIVE_LABEL).toBe(label);
    expect(chooseMigrationMethod(micro({ kind: 'bundled', migration: true }))).toMatchObject({
      method: 'vm-live',
      runtime: 'qemu',
      label,
    });

    // With a filesystem volume (Agenstra's workspace): handed over in the freeze, the estimate holds it.
    const withVolume = chooseMigrationMethod(
      micro(
        { kind: 'bundled', migration: true },
        {
          stateful: true,
          service: service({
            runtime: 'microvm',
            resources: small,
            volumes: [{ type: 'volume' as const, source: 'workspace', target: '/app', readOnly: false }],
          }),
        },
      ),
    );

    expect(withVolume).toMatchObject({ method: 'vm-live', label });
    // The generic launcher's capability doesn't matter for bundled images (they bring their own launcher).
    expect(
      chooseMigrationMethod(
        micro({ kind: 'bundled', migration: true }, { source: vmNode('n1', { ...capable, microvmMigration: false }) }),
      ).method,
    ).toBe('vm-live');

    // Older images (launcher label without `bundled`) and agents without the capability fall back.
    expect(chooseMigrationMethod(micro({ kind: 'bundled' }))).toMatchObject({
      method: 'blue-green',
      reason:
        'bundled microVM: its launcher has no live migration (image built before the incoming mode; label io.forepath.microvm.migration without bundled)',
    });
    expect(chooseMigrationMethod(micro({ kind: 'bundled', migration: true }, { target: vmNode('n2') }))).toMatchObject({
      method: 'blue-green',
      reason: 'no bundled microVM live migration on n2 (agent or microVM level)',
    });
    expect(
      chooseMigrationMethod(
        micro(
          { kind: 'bundled', migration: true },
          { target: vmNode('n2', { ...capable, cpuFlagsHash: 'c'.repeat(16) }) },
        ),
      ).reason,
    ).toBe('cpu model host-passthrough needs identical CPUs on n1 and n2');
  });

  it('keeps a VM whose freeze would exceed the budget for a short stop', () => {
    const big = vm({
      service: service({
        runtime: 'microvm',
        volumes: [disk],
        resources: { requests: { cpuMillis: 1, memoryBytes: 64 * 1024 * MiB }, limits: {}, source: 'compose' },
      }),
    });
    const choice = chooseMigrationMethod(big);

    expect(choice.method).toBe('short-stop');
    expect(choice.reason).toMatch(/^estimated freeze .* exceeds 3\.0 s$/);
  });

  it('estimates per method: QEMU adds its device state, gVisor KVM its own overhead', () => {
    const options = DEFAULT_ELIGIBILITY_OPTIONS;
    const qemu = estimateFreeze({ service: service(), memoryBytes: 1024 * MiB }, 'qemu', 1e9, options);

    expect(qemu.frozenBytes).toBe(Math.ceil(1024 * MiB * 0.05 * 0.25) + QEMU_DEVICE_STATE_BYTES);
    expect(qemu.freezeMs).toBe(Math.ceil((qemu.frozenBytes * 8 * 1000) / 1e9) + 300);

    const kvm = estimateFreeze({ service: service(), memoryBytes: 64 * MiB }, 'runsc', 1e9, options, 'kvm');
    const systrap = estimateFreeze({ service: service(), memoryBytes: 64 * MiB }, 'runsc', 1e9, options);

    expect(kvm.freezeMs - systrap.freezeMs).toBe(500);
  });

  it('has no hidden switch for microVM live migration any more', () => {
    expect(eligibilityOptionsFromEnv({ LOADWEAVER_MICROVM_LIVE_MIGRATION: 'off' })).toEqual(
      eligibilityOptionsFromEnv({}),
    );
  });

  it('counts the tmpfs of a microVM as pre-copied (only the final round), the one of runc fully', () => {
    const tmpfs = service({ volumes: [{ type: 'tmpfs', target: '/t', sizeBytes: 100 * MiB }] });
    const options = DEFAULT_ELIGIBILITY_OPTIONS;
    const qemu = estimateFreeze({ service: tmpfs, memoryBytes: 0 }, 'qemu', 1e9, options);
    const runc = estimateFreeze({ service: tmpfs, memoryBytes: 0 }, 'runc', 1e9, options);

    expect(runc.frozenBytes).toBe(100 * MiB);
    expect(qemu.frozenBytes).toBe(Math.ceil(100 * MiB * 0.05 * 0.25) + QEMU_DEVICE_STATE_BYTES);
  });

  it('reads checkpoint support per platform', () => {
    expect(checkpointSupport(kvmNode('n1'), 'runsc', 'kvm')).toBe(true);
    expect(checkpointSupport(node('n1'), 'runsc', 'kvm')).toBe(false);
    expect(checkpointSupport(node('n1'), 'runsc')).toBe(true);
  });
});
