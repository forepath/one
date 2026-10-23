import { MICROVM_LAUNCHER_OVERHEAD_MIB } from '@forepath/shared/backend/util-microvm-bridge';

import { eventually, genericMicrovm, inspectHubImage, podNetwork } from '../m7/m7-lab';

import { containerMemory, type SpikeLab, spikeRecorder, startSpikeLab } from './spike-lab';

/**
 * Spike S10 — memory accounting: is the guest's memory (QEMU's memfd backend) charged to the launcher container's
 * cgroup, what happens when the guest fills its RAM (guest OOM, not a host OOM kill of the launcher), and does
 * `LAUNCHER_OVERHEAD_MiB = 384` hold for a generic microVM with its second virtiofsd (guest tools) and a volume
 * virtiofsd?
 */
const rec = spikeRecorder({
  id: 'S10',
  title: 'memfd guest memory in the launcher cgroup, OOM behaviour, 384 MiB overhead',
  validates:
    'M7.2 "Sizing and boot budget": launcher memory limit = guest + 384 MiB; requests / quotas add the same overhead (W3)',
  ifFails:
    'raise MICROVM_LAUNCHER_OVERHEAD_MIB (bridge constants, planner + quotas follow) to the measured peak overhead + margin; if memfd is charged elsewhere: set the guest memory backend to `memory-backend-file` on the launcher tmpfs or account it via the node reserve',
});

describe('spike S10: memory accounting', () => {
  let s: SpikeLab;
  const GUEST = 256;
  const replica = 'spike/s10/mem/0';

  beforeAll(async () => {
    s = await startSpikeLab(rec, {
      vms: [{ name: 'vm1', site: 'a', memoryMb: 2048, cpus: 2, nested: true, dataDiskGb: 4 }],
      packages: ['attr'],
    });

    if (!s.nested) return;

    const alpine = await inspectHubImage('alpine:3.22');

    await s.drivers[0].apply({
      workloads: [
        genericMicrovm(
          {
            id: replica,
            addresses: ['10.244.1.20'],
            volumes: [{ type: 'tmpfs', target: '/scratch', sizeBytes: 8 * 1024 ** 2 }],
          },
          alpine,
          { memoryMiB: GUEST, process: { entrypoint: ['/bin/sh', '-c'], cmd: ['echo s10-up; exec sleep 1000000'] } },
        ),
      ],
      network: podNetwork('10.244.1.0/24'),
    });
  }, 3_600_000);

  afterAll(async () => {
    rec.flush();
    await s?.lab.stop();
  }, 300_000);

  it('charges guest memory to the launcher and stays within guest + overhead', async () => {
    if (!s.nested) return;

    const [vm] = s.vms;
    const [driver] = s.drivers;
    const launcher = await eventually(
      'launcher',
      async () => (await driver.containerOf(replica)) || undefined,
      300_000,
      2_000,
    );

    await eventually(
      'guest up',
      async () => ((await vm.exec(`docker logs ${launcher} 2>&1`)).includes('s10-up') ? true : undefined),
      300_000,
      2_000,
    );

    const idle = await containerMemory(vm, launcher);

    rec.measure('launcher memory.current (idle guest)', Math.round(idle.current / 1024 ** 2), 'MiB');
    rec.measure(
      'launcher memory limit',
      Math.round(idle.limit / 1024 ** 2),
      'MiB',
      GUEST + MICROVM_LAUNCHER_OVERHEAD_MIB,
    );
    rec.note(
      'virtiofsd processes in the launcher',
      (await vm.exec(`docker top ${launcher} -o pid,rss,args | grep -c virtiofsd || true`)).trim(),
    );

    // The guest touches 160 MiB (tmpfs in guest RAM): the launcher's cgroup grows with it (memfd charged there).
    await driver.exec(replica, [
      '/bin/sh',
      '-c',
      'mkdir -p /dev/shm && dd if=/dev/urandom of=/dev/shm/fill bs=1M count=160 2>/dev/null; sync; echo done',
    ]);

    const filled = await containerMemory(vm, launcher);
    const grown = Math.round((filled.current - idle.current) / 1024 ** 2);

    rec.measure('launcher growth after the guest touched 160 MiB', grown, 'MiB');
    expect(rec.verdict('guest memory is charged to the launcher cgroup', grown >= 120, `${grown} MiB`)).toBe(true);

    // Beyond its RAM: the guest's own OOM killer acts; the launcher is not OOM-killed by the host.
    await driver
      .exec(replica, ['/bin/sh', '-c', 'dd if=/dev/zero of=/dev/shm/more bs=1M count=400 2>/dev/null; echo rc=$?'])
      .catch(() => undefined);

    const after = await containerMemory(vm, launcher);
    const state = (await vm.exec(`docker inspect -f '{{.State.Running}} {{.State.OOMKilled}}' ${launcher}`)).trim();
    const overhead = Math.round(after.peak / 1024 ** 2) - GUEST;

    rec.measure(
      'launcher memory.peak',
      Math.round(after.peak / 1024 ** 2),
      'MiB',
      GUEST + MICROVM_LAUNCHER_OVERHEAD_MIB,
    );
    rec.measure(
      'peak overhead above the guest size (2 virtiofsd + volume virtiofsd + QEMU + libvirt)',
      overhead,
      'MiB',
      MICROVM_LAUNCHER_OVERHEAD_MIB,
    );
    rec.verdict('launcher not OOM-killed by the host when the guest overfills', state === 'true false', state);
    rec.verdict(
      `overhead within ${MICROVM_LAUNCHER_OVERHEAD_MIB} MiB`,
      overhead <= MICROVM_LAUNCHER_OVERHEAD_MIB,
      `${overhead} MiB`,
    );
    expect(rec.verdicts.every((v) => v.pass)).toBe(true);
  });
});
