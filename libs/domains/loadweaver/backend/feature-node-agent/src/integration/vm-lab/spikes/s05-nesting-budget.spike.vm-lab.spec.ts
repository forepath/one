import { hostMemAvailableMb, readNestedReport } from '@forepath/shared/backend/util-vm-lab';
import type { WorkloadSpec } from '@forepath/loadweaver/shared/util-agent-protocol';

import {
  downloadDebianCloudImage,
  eventually,
  genericMicrovm,
  inspectHubImage,
  podNetwork,
  pushVmArtifact,
  serialText,
  vmVolumes,
  vmWorkload,
} from '../m7/m7-lab';

import { containerMemory, type SpikeLab, spikeRecorder, startSpikeLab } from './spike-lab';

/**
 * Spike S5 — the nesting budget on WSL / Docker Desktop: Hyper-V → WSL kernel → lab VM → microVM / VM (three levels).
 * Measures boot times per level, the launchers' real memory (cgroup current / peak) for 256 / 512 MiB guests, how
 * many 256 MiB microVMs a 3.5 GiB lab VM holds, and the host's available memory around it.
 */
const rec = spikeRecorder({
  id: 'S5',
  title: 'nesting budget (boot times at three levels, memory ceiling)',
  validates:
    'M7.6 "Nested virtualization on the WSL / Docker Desktop host" and the lab memory budget (≤ 7 GiB; guests 256–512 MiB, launcher overhead 384 MiB)',
  ifFails:
    'nesting unavailable or too slow: run the KVM specs on a bare-metal / nested-capable CI runner and keep them skipped locally (VM_LAB_REQUIRE_NESTED=0); memory: lower guest sizes or run the 2-VM specs one VM at a time',
});

describe('spike S5: nesting budget', () => {
  let s: SpikeLab;

  beforeAll(async () => {
    rec.note('nested preflight', readNestedReport());
    rec.measure('host MemAvailable before', hostMemAvailableMb() ?? -1, 'MiB');
    s = await startSpikeLab(rec, {
      vms: [{ name: 'vm1', site: 'a', memoryMb: 3584, cpus: 3, nested: true, dataDiskGb: 10, rootDiskGb: 16 }],
      packages: ['attr', 'qemu-utils'],
      registry: true,
    });
    rec.measure('host MemAvailable with the lab VM', hostMemAvailableMb() ?? -1, 'MiB');
  }, 3_600_000);

  afterAll(async () => {
    rec.flush();
    await s?.lab.stop();
  }, 300_000);

  it('measures boot times and memory of microVMs and a full VM inside the lab VM', async () => {
    expect(rec.verdict('nested KVM available in the lab VM', s.nested)).toBe(true);

    const [vm] = s.vms;
    const [driver] = s.drivers;
    const alpine = await inspectHubImage('alpine:3.22');
    const memAvailable = async () =>
      Number((await vm.exec("awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo")).trim());
    const workloads: WorkloadSpec[] = [];

    rec.measure('lab VM MemAvailable (idle)', await memAvailable(), 'MiB');

    for (const size of [256, 512]) {
      const id = `spike/s5/mv${size}/0`;

      workloads.push(
        genericMicrovm({ id, addresses: [`10.244.1.${size === 256 ? 20 : 21}`] }, alpine, {
          memoryMiB: size,
          process: { entrypoint: ['/bin/sh', '-c'], cmd: [`echo s5-up-${size}; exec sleep 1000000`] },
        }),
      );

      const t0 = Date.now();

      await driver.apply({ workloads, network: podNetwork('10.244.1.0/24') });

      const launcher = await eventually(
        `${id} launcher`,
        async () => (await driver.containerOf(id)) || undefined,
        300_000,
        1_000,
      );

      await eventually(
        `${id} up`,
        async () => ((await vm.exec(`docker logs ${launcher} 2>&1`)).includes(`s5-up-${size}`) ? true : undefined),
        300_000,
        500,
      );
      rec.measure(`microVM ${size} MiB: apply → workload output`, Math.round((Date.now() - t0) / 100) / 10, 's', 30);

      const mem = await containerMemory(vm, launcher);

      rec.measure(`launcher ${size} MiB: memory.current`, Math.round(mem.current / 1024 ** 2), 'MiB');
      rec.measure(`launcher ${size} MiB: memory.peak`, Math.round(mem.peak / 1024 ** 2), 'MiB', size + 384);
    }

    rec.measure('lab VM MemAvailable (two microVMs)', await memAvailable(), 'MiB');

    // A full VM (Debian cloud image, 512 MiB) to its login prompt.
    const image = await pushVmArtifact(vm, s.registry?.host ?? '', 'spike/debian', '13', {
      path: await downloadDebianCloudImage(vm),
      format: 'qcow2',
    });
    const options = {
      project: 'spike',
      name: 'budget',
      image,
      disks: [{ name: 'boot', sizeBytes: 4 * 1024 ** 3 }],
      nics: [{ name: 'nic0', addresses: ['10.244.1.50'] }],
      memoryMiB: 512,
    };
    const t0 = Date.now();

    await driver.apply({
      workloads: [...workloads, vmWorkload(options)],
      volumes: vmVolumes(options, [vm], vm, { minor: 1500, port: 8200 }),
      network: podNetwork('10.244.1.0/24'),
    });
    await serialText(driver, 'spike/lw-vm/budget/0', /login:/, 900_000);
    rec.measure('full VM 512 MiB: apply (incl. import) → login prompt', Math.round((Date.now() - t0) / 1000), 's');

    const vmLauncher = await driver.containerOf('spike/lw-vm/budget/0');
    const vmMem = await containerMemory(vm, vmLauncher);

    rec.measure('full VM launcher memory.peak', Math.round(vmMem.peak / 1024 ** 2), 'MiB', 512 + 384);
    rec.measure('lab VM MemAvailable (two microVMs + VM)', await memAvailable(), 'MiB');
    rec.measure('host MemAvailable (three levels running)', hostMemAvailableMb() ?? -1, 'MiB');

    // Ceiling: more 256 MiB microVMs until the lab VM runs low (≤ 300 MiB available) or one fails to start.
    let extra = 0;

    for (let i = 0; i < 8; i++) {
      if ((await memAvailable()) < 300 + 256 + 384) break;

      const id = `spike/s5/extra${i}/0`;

      workloads.push(
        genericMicrovm({ id, addresses: [`10.244.1.${60 + i}`] }, alpine, {
          process: { entrypoint: ['/bin/sh', '-c'], cmd: ['echo s5-extra; exec sleep 1000000'] },
        }),
      );
      await driver.apply({
        workloads: [...workloads, vmWorkload(options)],
        volumes: vmVolumes(options, [vm], vm, { minor: 1500, port: 8200 }),
        network: podNetwork('10.244.1.0/24'),
      });

      const ok = await eventually(
        `${id} up`,
        async () => {
          const launcher = await driver.containerOf(id);

          return launcher && (await vm.exec(`docker logs ${launcher} 2>&1`)).includes('s5-extra') ? true : undefined;
        },
        240_000,
        2_000,
      ).catch(() => false);

      if (!ok) break;

      extra++;
    }

    rec.measure('additional 256 MiB microVMs that fit next to them', extra, 'count');
    rec.verdict('the lab VM held two microVMs and a full VM', true);
  });
});
