import { LabRecorder, startUserNetVm, type UserNetVm } from '@forepath/shared/backend/util-vm-lab';

import {
  buildIsolationLabQemuArgs,
  buildIsolationLabRunUserData,
  ISOLATION_LAB_LABEL,
  ISOLATION_LAB_PREFIX,
  type IsolationLabVmOptions,
} from '../../lib/isolation-lab.config';

import { ensureGoldenImage, ensureQemuImage } from './images';

/**
 * A lab VM: the shared VM-lab harness's user-network VM (`@forepath/shared/backend/util-vm-lab`, M7.6) with the
 * isolation lab's golden image (Ubuntu 22.04 + Docker), QEMU arguments, cloud-init and names. Same behaviour as
 * before the shared harness, plus the heavy / VM-lab locks, the memory guard and cleanup on process exit.
 */
export type LabVm = UserNetVm;

/**
 * Start a lab VM: one container per VM (own memory cgroup, `--device /dev/kvm`) running QEMU on a
 * per-run overlay of the golden image. The test process reaches the guest with SSH through the container.
 *
 * Like Loadweaver's VM lab: the boot time is written as a lab result (`isolation-lab-<name>`, `LabRecorder`, JSON in
 * `$VM_LAB_RESULTS_DIR`), and with `LW_LAB_KEEP=1` (development only) the VM stays up after the run and the next
 * run re-attaches to it (keep key `isolation-lab-<name>`; the spec's `beforeAll` runs again on the kept VM — the host
 * preparation steps are idempotent by design).
 */
export async function startLabVm(name: string, options: IsolationLabVmOptions = {}): Promise<LabVm> {
  if (!/^[a-z0-9][a-z0-9-]{0,30}$/.test(name)) {
    throw new Error(`Invalid lab VM name: ${name}`);
  }

  const goldenVolume = await ensureGoldenImage();
  const qemuImage = await ensureQemuImage();
  const memoryMb = options.memoryMb ?? 3072;

  const rec = new LabRecorder(`isolation-lab-${name}`);
  const started = Date.now();
  const vm = await startUserNetVm(
    {
      prefix: ISOLATION_LAB_PREFIX,
      label: ISOLATION_LAB_LABEL,
      qemuImage,
      goldenVolume,
      diskGb: 30,
      overheadMb: 768,
      sshPort: 2222,
      qemuArgs: (paths) => buildIsolationLabQemuArgs({ ...options, memoryMb, ...paths }),
      userData: (sshPublicKey) => buildIsolationLabRunUserData({ hostname: name, sshPublicKey }),
      // Boot to SSH, then wait for this instance's cloud-init (lab user, keys) to finish.
      readiness: { script: 'cloud-init status --wait >/dev/null 2>&1; systemctl is-active docker', stdout: 'active' },
      bootTimeoutMs: 8 * 60_000,
    },
    name,
    memoryMb,
    { keep: `isolation-lab-${name}` },
  );

  rec.measure(vm.attached ? 'lab VM re-attached' : 'lab VM up', Math.round((Date.now() - started) / 100) / 10, 's');
  rec.flush();

  return vm;
}
