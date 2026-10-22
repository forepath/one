import { GVISOR_RUNTIMES } from '@forepath/shared/backend/util-container-runtime';

import {
  labDockerRuntimes,
  labKvmAvailable,
  requireLabKvm,
  runHostScript,
  runProvisioningPreparation,
} from './harness/lab-host';
import { type LabVm, startLabVm } from './harness/vm';

const VM_BOOT_TIMEOUT = 45 * 60_000;
const SYSTRAP = GVISOR_RUNTIMES.systrap;
const KVM = GVISOR_RUNTIMES.kvm;

/** Host preparation of agent manager hosts on real VMs: the provider cloud-init block and the host script. */
describe('isolation lab: host preparation', () => {
  describe('host with hardware virtualization (nested KVM)', () => {
    let vm: LabVm;
    let kvm = false;

    beforeAll(async () => {
      vm = await startLabVm('prep-kvm');
      kvm = await requireLabKvm(vm, 'host preparation with KVM');
    }, VM_BOOT_TIMEOUT);

    afterAll(async () => {
      await vm?.stop();
    });

    it('installs both gVisor platforms with the provider cloud-init block (never fails the boot script)', async () => {
      const output = await runProvisioningPreparation(vm);

      expect(output).toContain('gVisor sandbox runtime installed');

      const runtimes = await labDockerRuntimes(vm);

      expect(runtimes[SYSTRAP.runtime]).toEqual(['--platform=systrap']);
      expect(runtimes[SYSTRAP.sharedNetnsRuntime]).toEqual(['--platform=systrap', '--network=host']);

      if (kvm) {
        expect(output).toContain('gVisor KVM runtimes installed');
        expect(runtimes[KVM.runtime]).toEqual(['--platform=kvm']);
        expect(runtimes[KVM.sharedNetnsRuntime]).toEqual(['--platform=kvm', '--network=host']);
      }

      // Docker's default runtime stays runc.
      expect((await vm.execOrThrow(`docker info --format '{{.DefaultRuntime}}'`)).trim()).toBe('runc');
    });

    it('reports the runtimes and KVM facts with the host script (check --json)', async () => {
      const { code, report } = await runHostScript(vm, 'check');

      expect(code).toBe(0);
      expect(report).toEqual(
        expect.objectContaining({ standard: 'ready', sandboxed: 'registered', kvmRuntime: KVM.runtime }),
      );

      if (kvm) {
        expect(report?.sandboxedKvm).toBe('registered');
        expect(report?.kvm).toEqual(expect.objectContaining({ cpu: 'yes', device: 'present', hypervisor: 'yes' }));
      }
    });

    it('runs workloads on every runtime with the expected kernel and platform', async () => {
      const runtimes = [
        'runc',
        SYSTRAP.runtime,
        SYSTRAP.sharedNetnsRuntime,
        ...(kvm ? [KVM.runtime, KVM.sharedNetnsRuntime] : []),
      ];

      for (const runtime of runtimes) {
        const dmesg = await vm.execOrThrow(
          `docker run --rm --runtime=${runtime} --network=none alpine:3.20 dmesg 2>&1 || true`,
        );

        if (runtime === 'runc') {
          expect(dmesg).not.toContain('Starting gVisor');
        } else {
          expect(dmesg).toContain('Starting gVisor');
        }
      }

      if (kvm) {
        // The sandbox really runs on the KVM platform (runsc process arguments on the host).
        const args = await vm.execOrThrow(
          `id=$(docker run -d --runtime=${KVM.runtime} --network=none alpine:3.20 sleep 60); sleep 2; ps -eo args | grep -c -- '[-]-platform=kvm' || true; docker rm -f "$id" >/dev/null`,
        );

        expect(Number(args.trim().split('\n')[0])).toBeGreaterThan(0);
      }
    });

    it('is idempotent (re-running the host script install)', async () => {
      const { code, report } = await runHostScript(vm, 'install');

      expect(code).toBe(0);
      expect(report?.sandboxed).toBe('ready');
      expect(report?.sandboxedKvm).toBe(kvm ? 'ready' : 'unsupported');
    });

    it('removes stale KVM runtimes when KVM disappears and keeps systrap untouched', async () => {
      if (!kvm) {
        return;
      }

      await vm.execOrThrow(
        `printf 'install kvm_intel /bin/false\\ninstall kvm_amd /bin/false\\ninstall kvm /bin/false\\n' > /etc/modprobe.d/agenstra-lab-nokvm.conf
modprobe -r kvm_intel kvm_amd kvm 2>/dev/null || true
for i in 1 2 3 4 5; do [ -c /dev/kvm ] || break; sleep 1; done
test ! -c /dev/kvm`,
        { sudo: true },
      );

      const { code, report } = await runHostScript(vm, 'install');
      const runtimes = await labDockerRuntimes(vm);

      expect(code).toBe(0);
      expect(report?.sandboxedKvm).toBe('unsupported');
      expect(report?.kvm?.device).toBe('absent');
      expect(runtimes[KVM.runtime]).toBeUndefined();
      expect(runtimes[KVM.sharedNetnsRuntime]).toBeUndefined();
      expect(runtimes[SYSTRAP.runtime]).toEqual(['--platform=systrap']);
    });

    it('restores KVM (modules loaded and persisted) on the next install', async () => {
      if (!kvm) {
        return;
      }

      await vm.execOrThrow('rm -f /etc/modprobe.d/agenstra-lab-nokvm.conf', { sudo: true });

      const { code, report } = await runHostScript(vm, 'install');

      expect(code).toBe(0);
      expect(report?.sandboxedKvm).toBe('ready');
      expect(await labKvmAvailable(vm)).toBe(true);
      expect(await vm.execOrThrow('cat /etc/modules-load.d/agenstra-kvm.conf')).toMatch(/^kvm\nkvm_(intel|amd)\n$/);
    });

    it('uninstall removes every gVisor runtime, keeps the KVM modules and leaves runc working', async () => {
      const { code } = await runHostScript(vm, 'uninstall');
      const runtimes = await labDockerRuntimes(vm);

      expect(code).toBe(0);
      expect(Object.keys(runtimes).filter((name) => name.startsWith('runsc'))).toEqual([]);
      expect(await vm.execOrThrow('docker run --rm --network=none hello-world')).toContain('Hello from Docker');
      // The persisted KVM modules stay: the microvm level needs /dev/kvm without gVisor.
      expect(await vm.execOrThrow('cat /etc/modules-load.d/agenstra-kvm.conf')).toMatch(/^kvm\nkvm_(intel|amd)\n$/);
    });
  });

  describe('ordinary cloud VM (no nested virtualization)', () => {
    let vm: LabVm;

    beforeAll(async () => {
      vm = await startLabVm('prep-plain', { exposeVirtualization: false });
    }, VM_BOOT_TIMEOUT);

    afterAll(async () => {
      await vm?.stop();
    });

    it('installs the systrap runtimes only and reports KVM as unsupported', async () => {
      const output = await runProvisioningPreparation(vm);

      expect(output).toContain('gVisor sandbox runtime installed');
      expect(output).toContain('the sandboxed-kvm level stays unavailable');

      const runtimes = await labDockerRuntimes(vm);
      const { code, report } = await runHostScript(vm, 'check');

      expect(runtimes[SYSTRAP.runtime]).toEqual(['--platform=systrap']);
      expect(runtimes[KVM.runtime]).toBeUndefined();
      expect(code).toBe(0);
      expect(report?.sandboxedKvm).toBe('unsupported');
      expect(report?.kvm).toEqual(expect.objectContaining({ cpu: 'no', device: 'absent' }));
    });
  });
});
