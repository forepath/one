import { join } from 'node:path';

import { LabRecorder } from '@forepath/shared/backend/util-vm-lab';
import { GVISOR_RUNTIMES, parseGvisorRuntimeArgs } from '@forepath/shared/backend/util-container-runtime';

import { startVmLab, type Vm, type VmLab } from '../vm-lab';

import {
  eventually,
  IMAGE_HINTS,
  LAUNCHER_IMAGE,
  loadImages,
  log,
  nestedDescribe,
  type NodeDriver,
  podNetwork,
  requireImages,
  requireNested,
  restartNodeDriver,
  startNodeDriver,
  workload,
} from './m7-lab';

/**
 * Isolation ladder on real kernels (M7 W4, 3.1): the installer's components script (`components.generated.sh`, the
 * control plane's install script with KVM preparation) and the agent's per-level probes (real `IsolationProbeService`
 * in the M7 node driver) on two Debian 13 VMs — vm1 with nested KVM (`-cpu host`), vm2 an ordinary cloud VM
 * (`host,-vmx,-svm`).
 *
 * (a) the install registers `runsc-systrap` / `runsc-kvm` (+ `-hostnet`) with the shared catalog's exact platform /
 *     network args on vm1, only the systrap pair on vm2; (b) the probe reports all four levels ready on vm1 (microVM
 *     boot probe incl. the unpack cache), runc + sandboxed only on vm2 with `E_KVM_UNAVAILABLE`; probe containers are
 *     gone afterwards and never part of the workload status; (c) a `sandboxed-kvm` workload runs under gVisor on the
 *     KVM platform (`dmesg`, `--platform=kvm` in the host's process list); a `/dev/kvm` device workload sees the
 *     device; (d) the per-node opt-out (`desiredState.host.kvm: disabled`) removes the KVM runtimes and reports
 *     `disabled-by-admin`, `auto` restores them without a download; (e) a reboot keeps KVM and the probe never reuses
 *     the previous boot's result; KVM modules withheld (blacklisted, as when `linux-modules-extra` didn't come with a
 *     kernel update) → after the reboot `kvm.usable: false` and the KVM levels `E_KVM_UNAVAILABLE` — the fact the
 *     rollout's `kvm` gate fails on ("kvm lost after update"); restored afterwards.
 * Not here: Ubuntu's `linux-modules-extra` from the apt snapshot (spike S8 + unit tests of the install script), the
 * project allowance for `/dev/kvm` (a plan rule: scheduling.vm-lab.spec.ts).
 */

const COMPONENTS = join(__dirname, '..', 'components.generated.sh');

nestedDescribe('isolation ladder')('isolation ladder on real kernels (VM lab, M7 W4)', () => {
  let lab: VmLab;
  let vm1: Vm;
  let vm2: Vm;
  let n1: NodeDriver;
  let n2: NodeDriver;
  let nested = false;
  const rec = new LabRecorder('m7-isolation-ladder');

  const runtimes = async (vm: Vm) =>
    JSON.parse(await vm.exec(`docker info --format '{{json .Runtimes}}'`)) as Record<
      string,
      { runtimeArgs?: string[] }
    >;

  beforeAll(async () => {
    await requireImages({ [LAUNCHER_IMAGE]: IMAGE_HINTS[LAUNCHER_IMAGE] });
    lab = await rec.time('lab up', () =>
      startVmLab({
        vms: [
          { name: 'vm1', site: 'a', memoryMb: 2048, cpus: 2, nested: true },
          { name: 'vm2', site: 'a', memoryMb: 1536, cpus: 2, nested: false },
        ],
        log,
      }),
    );
    ({ vm1, vm2 } = lab.vms as Record<'vm1' | 'vm2', Vm>);
    nested = await requireNested(vm1, 'isolation ladder');

    await Promise.all(
      [vm1, vm2].map(async (vm) => {
        await vm.copyIn(COMPONENTS, '/root/components.sh', '0700');
        await rec.time(`${vm.name} components`, () =>
          vm.exec(
            'bash /root/components.sh > /var/log/lw-components.log 2>&1 || { tail -n 80 /var/log/lw-components.log; exit 1; }',
            {
              timeoutMs: 1_800_000,
            },
          ),
        );
      }),
    );
    await loadImages(vm1, [LAUNCHER_IMAGE]);
    [n1, n2] = await Promise.all([startNodeDriver(vm1), startNodeDriver(vm2)]);
  }, 3_600_000);

  afterAll(async () => {
    rec.flush();
    await lab?.stop();
  }, 300_000);

  it('(a) registers the gVisor runtimes with the exact platform / network args (KVM pair only with KVM)', async () => {
    const r1 = await runtimes(vm1);
    const r2 = await runtimes(vm2);
    const expectPair = (r: typeof r1, platform: 'systrap' | 'kvm') => {
      const pair = GVISOR_RUNTIMES[platform];

      expect(parseGvisorRuntimeArgs(r[pair.runtime]?.runtimeArgs)).toEqual({ platform, network: null });
      expect(parseGvisorRuntimeArgs(r[pair.sharedNetnsRuntime]?.runtimeArgs)).toEqual({ platform, network: 'host' });
    };

    expectPair(r1, 'systrap');
    expectPair(r2, 'systrap');

    if (nested) expectPair(r1, 'kvm');

    expect(r2[GVISOR_RUNTIMES.kvm.runtime]).toBeUndefined();
    expect(await vm1.exec('cat /var/log/lw-components.log')).not.toMatch(/apt-get .*linux-modules-extra/);
  });

  it('(b) probes every level: all four ready with nested KVM, runc + sandboxed only without', async () => {
    const report1 = await rec.time('probe vm1 (incl. microVM boot probe)', () => n1.isolation(true), 300);
    const report2 = await rec.time('probe vm2', () => n2.isolation(true));

    rec.note('vm1 levels', report1.levels);
    rec.note('vm2 levels', report2.levels);
    expect(report2.runtimes).toEqual(['runc', 'sandboxed']);
    expect(report2.levels['sandboxed-kvm'].reasonCode).toBe('E_KVM_UNAVAILABLE');
    expect(report2.levels.microvm.reasonCode).toBe('E_KVM_UNAVAILABLE');
    expect(report2.kvm?.usable).toBe(false);

    if (nested) {
      expect(report1.runtimes).toEqual(['runc', 'sandboxed', 'sandboxed-kvm', 'microvm']);
      expect(report1.kvm?.usable).toBe(true);
      expect(report1.microvm).toMatchObject({ unpackCache: true });
      expect(report1.cpuFlagsHash).toMatch(/^[0-9a-f]{64}$/);
    }

    // Probe containers are removed and never reported (no drift).
    for (const vm of [vm1, vm2])
      expect((await vm.exec('docker ps -aq --filter label=loadweaver.com/probe=1')).trim()).toBe('');

    expect(JSON.stringify(await n1.status())).not.toContain('lw-probe-');

    const caps = await n1.capabilities();

    expect(caps['runtimes']).toEqual(report1.runtimes);
  });

  it('(c) runs a sandboxed-kvm workload under gVisor on the KVM platform, and a /dev/kvm device workload', async () => {
    if (!nested) return;

    const gkvm = workload({
      id: 'lab/iso/gkvm/0',
      addresses: ['10.244.1.10'],
      runtime: 'sandboxed',
      isolation: 'sandboxed-kvm',
      command: ['sh', '-c', 'dmesg; sleep 1000000'],
    });
    const device = workload({
      id: 'lab/iso/kvmdev/0',
      addresses: ['10.244.1.11'],
      devices: [{ path: '/dev/kvm', permissions: 'rwm' }],
      command: ['sh', '-c', 'ls -l /dev/kvm; sleep 1000000'],
    });

    await n1.apply({ workloads: [gkvm, device], network: podNetwork('10.244.1.0/24') });

    const g = await eventually('gVisor KVM container', async () => (await n1.containerOf(gkvm.id)) || undefined);

    expect(
      await eventually('gVisor dmesg', async () => (await vm1.exec(`docker logs ${g} 2>&1`)).match(/gVisor/i)?.[0]),
    ).toBeTruthy();
    expect(await vm1.exec(`docker inspect -f '{{.HostConfig.Runtime}}' ${g}`)).toContain(GVISOR_RUNTIMES.kvm.runtime);
    expect(await vm1.exec('ps -eo args | grep -c -- "--platform=kvm" || true')).not.toMatch(/^0\s*$/);

    const d = await eventually('device container', async () => (await n1.containerOf(device.id)) || undefined);

    expect(
      await eventually(
        '/dev/kvm in the container',
        async () => (await vm1.exec(`docker logs ${d} 2>&1`)).match(/\/dev\/kvm/)?.[0],
      ),
    ).toBeTruthy();
    await n1.apply({ workloads: [], network: podNetwork('10.244.1.0/24') });
  });

  it('(d) opts out of KVM per node (runtimes removed, disabled-by-admin) and back (no download)', async () => {
    if (!nested) return;

    await n1.host({ kvm: 'disabled' });

    const off = await eventually('KVM levels disabled', async () => {
      const report = await n1.isolation(true);

      return report.levels['sandboxed-kvm'].state === 'disabled-by-admin' ? report : undefined;
    });

    expect(off.levels.microvm.state).toBe('disabled-by-admin');
    expect(off.kvm?.optOut).toBe(true);
    expect(Object.keys(await runtimes(vm1)).filter((r) => r.startsWith('runsc-kvm'))).toEqual([]);

    await n1.host({ kvm: 'auto' });

    const on = await eventually('KVM levels back', async () => {
      const report = await n1.isolation(true);

      return report.runtimes.includes('sandboxed-kvm') ? report : undefined;
    });

    expect(on.kvm?.optOut).toBe(false);
    expect(Object.keys(await runtimes(vm1))).toEqual(expect.arrayContaining(['runsc-kvm', 'runsc-kvm-hostnet']));
    // install-kvm never downloads (the release's gVisor is already there).
    expect(await vm1.exec('journalctl -u lw-m7 --no-pager | grep -ci "downloading gvisor" || true')).toMatch(/^0/);
  });

  it('(e) keeps KVM across a reboot; withheld KVM modules are reported after the reboot (rollout kvm gate input)', async () => {
    if (!nested) return;

    const before = await n1.isolation();

    await rec.time('vm1 reboot', () => vm1.reboot());
    await restartNodeDriver(vm1);

    const after = await n1.isolation();

    expect(after.bootId).not.toBe(before.bootId);
    expect(after.kvm?.usable).toBe(true);
    expect(after.runtimes).toContain('sandboxed-kvm');

    await vm1.exec(
      [
        "printf 'install kvm_intel /bin/false\\ninstall kvm_amd /bin/false\\n' > /etc/modprobe.d/lw-lab-no-kvm.conf",
        'update-initramfs -u >/dev/null 2>&1 || true',
      ].join('\n'),
    );
    await vm1.reboot();
    await restartNodeDriver(vm1);

    try {
      const lost = await n1.isolation();

      rec.note('levels without KVM modules', lost.levels);
      expect(lost.kvm?.usable).toBe(false);
      expect(lost.levels['sandboxed-kvm'].reasonCode).toBe('E_KVM_UNAVAILABLE');
      expect(lost.levels.microvm.reasonCode).toBe('E_KVM_UNAVAILABLE');
    } finally {
      await vm1.exec('rm -f /etc/modprobe.d/lw-lab-no-kvm.conf && (update-initramfs -u >/dev/null 2>&1 || true)');
      await vm1.reboot();
      await restartNodeDriver(vm1);
    }

    expect((await n1.isolation()).kvm?.usable).toBe(true);
  });
});
