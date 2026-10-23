import { randomBytes, randomUUID } from 'node:crypto';

import type { MigrationProgress } from '@forepath/loadweaver/shared/util-agent-protocol';

import {
  downloadDebianCloudImage,
  eventually,
  type NodeDriver,
  podNetwork,
  pushVmArtifact,
  vmVolumes,
  vmWorkload,
} from '../m7/m7-lab';

import { type SpikeLab, spikeRecorder, startSpikeLab } from './spike-lab';

/**
 * Spike S4 — libvirt tunnelled p2p migration between two *session* daemons through a relayed unix socket: does the
 * target's session libvirtd accept the agent's (uid 0) connection on its socket via `/proc/<pid>/root/…`, and does
 * `virsh migrate --live --p2p --tunnelled` to `qemu+unix:///session?socket=…` complete through the agent's mTLS relay?
 */
const rec = spikeRecorder({
  id: 'S4',
  title: 'libvirt tunnelled p2p migration through the relayed session socket',
  validates:
    'M7.4 "Flow and messages": source `virsh migrate --p2p --tunnelled` to the target session daemon, bytes relayed over the agents\' mTLS transfer endpoint',
  ifFails:
    "uid-0 refused by the session daemon: relay through `docker exec <launcher> setpriv --reuid 10930 socat …`; tunnelled p2p unusable: QMP `migrate unix:` from the source QEMU and `-incoming defer` on the target (agent relays the QEMU stream instead of libvirt's)",
});

const SOCKET = '/dev/shm/agenstra-microvm/vmm/run/libvirt/libvirt-sock';

describe('spike S4: tunnelled p2p migration through the relay', () => {
  let s: SpikeLab;

  beforeAll(async () => {
    s = await startSpikeLab(rec, {
      vms: [
        { name: 'vm1', site: 'a', memoryMb: 2560, cpus: 2, nested: true, dataDiskGb: 8, rootDiskGb: 16 },
        { name: 'vm2', site: 'a', memoryMb: 2560, cpus: 2, nested: true, dataDiskGb: 8 },
      ],
      packages: ['attr', 'qemu-utils', 'libvirt-clients'],
      registry: true,
      certs: true,
    });
  }, 3_600_000);

  afterAll(async () => {
    rec.flush();
    await s?.lab.stop();
  }, 300_000);

  it('connects to a session daemon as root through /proc/<pid>/root and migrates a VM tunnelled', async () => {
    if (!s.nested || !s.registry) return;

    const [vm1, vm2] = s.vms;
    const [n1, n2] = s.drivers as [NodeDriver, NodeDriver];
    const image = await pushVmArtifact(vm1, s.registry.host, 'spike/debian', '13', {
      path: await downloadDebianCloudImage(vm1),
      format: 'qcow2',
    });
    const options = {
      project: 'spike',
      name: 'mig',
      image,
      disks: [{ name: 'boot', sizeBytes: 4 * 1024 ** 3 }],
      nics: [{ name: 'nic0', addresses: ['10.244.1.50'] }],
      memoryMiB: 512,
    };
    const spec = vmWorkload(options);

    await n2.apply({
      workloads: [],
      volumes: vmVolumes(options, [vm1, vm2], vm1, { minor: 1400, port: 8100 }),
      network: podNetwork('10.244.1.0/24'),
    });
    await n1.apply({
      workloads: [spec],
      volumes: vmVolumes(options, [vm1, vm2], vm1, { minor: 1400, port: 8100 }),
      network: podNetwork('10.244.1.0/24'),
    });

    const launcher = await eventually(
      'VM launcher',
      async () => (await n1.containerOf(spec.id)) || undefined,
      900_000,
      5_000,
    );

    await eventually(
      'VM running',
      async () =>
        (await vm1.exec(`docker exec ${launcher} /usr/lib/agenstra-microvm/vm-ctl state 2>/dev/null || true`)).includes(
          'running',
        )
          ? true
          : undefined,
      900_000,
      5_000,
    );

    // 1. The session daemon and a root client through /proc/<pid>/root.
    const direct = await vm1.execResult(
      `pid=$(docker inspect -f '{{.State.Pid}}' ${launcher}); virsh -c "qemu+unix:///session?socket=/proc/$pid/root${SOCKET}" list --all 2>&1`,
      { allowFailure: true },
    );

    rec.note('virsh as root via /proc/<pid>/root', direct.stdout.trim() || direct.stderr.trim());
    rec.verdict(
      'session libvirtd accepts the uid-0 connection on its socket',
      direct.code === 0 && /lw-vm/.test(direct.stdout),
    );

    // 2. The real path: vmMigrationPrepare (target) → vmMigrationStart (source) through the agents' relay.
    const migration = randomUUID();
    const token = randomBytes(32).toString('base64url');
    const base = { migration, attempt: 1, replica: spec.id };
    const progress = (driver: NodeDriver, phase: string) =>
      eventually(
        `${phase}`,
        async () =>
          (await driver.messages(0))
            .filter((m) => m.type === 'migrationProgress')
            .map((m) => m.payload as MigrationProgress)
            .filter((p) => p.migration === migration && p.phase === phase && p.status !== 'running')
            .pop(),
        600_000,
        500,
      );

    await n2.migration('vmMigrationPrepare', {
      ...base,
      source: 'vm1',
      token,
      addresses: spec.addresses,
      volumes: spec.vm?.disks.map((d) => d.volume),
      expiresInSeconds: 900,
      spec,
    });

    const prepared = await progress(n2, 'prepare');

    rec.verdict(
      'target prepared (incoming launcher + relay endpoint)',
      prepared.status === 'done',
      JSON.stringify(prepared),
    );

    const start = Date.now();

    await n1.migration('vmMigrationStart', {
      ...base,
      target: 'vm2',
      endpoint: prepared.endpoint,
      token,
      downtimeLimitMs: 3000,
      maxSeconds: 300,
    });

    const precopy = await progress(n1, 'precopy');
    const freeze = precopy.status === 'done' ? await progress(n1, 'freeze') : undefined;

    rec.measure('tunnelled migration (start → freeze reported)', Math.round((Date.now() - start) / 100) / 10, 's');
    rec.measure('downtime (freezeMs)', freeze?.freezeMs ?? -1, 'ms', 3000);

    const passed = rec.verdict(
      'virsh migrate --p2p --tunnelled through the relay completed',
      precopy.status === 'done',
      precopy.error ?? '',
    );

    if (passed) {
      await progress(n2, 'restore');
      await n1.migration('migrationCommit', { ...base, role: 'source' });
      await n2.migration('migrationCommit', { ...base, role: 'target' });
    } else {
      await n2.migration('migrationAbort', {
        ...base,
        role: 'target',
        reason: 'spike',
        volumes: spec.vm?.disks.map((d) => d.volume) ?? [],
      });
      await n1.migration('migrationAbort', {
        ...base,
        role: 'source',
        reason: 'spike',
        volumes: spec.vm?.disks.map((d) => d.volume) ?? [],
      });
    }

    expect(passed).toBe(true);
  });
});
